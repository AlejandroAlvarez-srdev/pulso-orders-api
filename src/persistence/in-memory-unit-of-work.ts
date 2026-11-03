import { ConcurrentModificationError } from '../common/domain-errors';
import { type InMemoryIdempotencyStore } from '../idempotency/in-memory-idempotency.store';
import { type Order } from '../orders/domain/order';
import { type InMemoryOrdersRepository } from '../orders/in-memory-orders.repository';
import { type OrdersRepository } from '../orders/orders.repository';
import { type InMemoryOutboxService } from '../outbox/in-memory-outbox.service';
import { type TransactionalPorts, type UnitOfWork } from './unit-of-work';

/** A write recorded during the transaction and applied at commit. Throws if it no longer applies. */
type StagedWrite = () => void;

/**
 * All-or-nothing semantics for the in-memory adapters, mirroring the Prisma
 * transaction: writes are staged while `work` runs (visible only to reads made
 * through the same transaction) and applied synchronously at commit, so no
 * other request can interleave. If `work` throws, the stage is discarded; if a
 * write fails while committing (e.g. the order version moved on), every
 * adapter is restored to its pre-commit snapshot.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(
    private readonly orders: InMemoryOrdersRepository,
    private readonly outbox: InMemoryOutboxService,
    private readonly idempotency: InMemoryIdempotencyStore,
  ) {}

  async run<T>(work: (tx: TransactionalPorts) => Promise<T>): Promise<T> {
    const staged: StagedWrite[] = [];
    const result = await work(this.transactionalPorts(staged));
    this.commit(staged);
    return result;
  }

  private commit(staged: StagedWrite[]): void {
    const restores = [this.orders.snapshot(), this.outbox.snapshot(), this.idempotency.snapshot()];
    try {
      staged.forEach((write) => write());
    } catch (error) {
      restores.forEach((restore) => restore());
      throw error;
    }
  }

  private transactionalPorts(staged: StagedWrite[]): TransactionalPorts {
    const base = this.orders;
    const overlay = new Map<string, Order>();
    const read = async (id: string): Promise<Order | null> => {
      const own = overlay.get(id);
      return own ? structuredClone(own) : base.findById(id);
    };

    const orders: OrdersRepository = {
      insert: async (order) => {
        if (await read(order.id)) throw new Error(`Order ${order.id} already exists`);
        overlay.set(order.id, structuredClone(order));
        staged.push(() => base.insertSync(order));
      },
      findById: read,
      // Reporting reads never run inside a transaction.
      list: (query) => base.list(query),
      countByStatus: () => base.countByStatus(),
      updateStatus: async (id, expectedVersion, status, at) => {
        const current = await read(id);
        if (!current || current.version !== expectedVersion) return null;
        const updated: Order = { ...current, status, updatedAt: at, version: current.version + 1 };
        overlay.set(id, updated);
        staged.push(() => {
          // Same compare-and-set as the SQL `WHERE version = $n`, re-checked at commit.
          if (!base.updateStatusSync(id, expectedVersion, status, at)) {
            throw new ConcurrentModificationError(`Order ${id} was modified concurrently; reload and retry`);
          }
        });
        return structuredClone(updated);
      },
    };

    return {
      orders,
      outbox: {
        publish: async (event) => {
          staged.push(() => this.outbox.appendSync(event));
        },
      },
      idempotency: {
        complete: async (merchantId, key, response) => {
          staged.push(() => this.idempotency.completeSync(merchantId, key, response));
        },
      },
    };
  }
}
