import { type IdempotencyStore } from '../idempotency/idempotency.store';
import { type OrdersRepository } from '../orders/orders.repository';
import { type OutboxService } from '../outbox/outbox.service';

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

/** Ports bound to one transaction. Everything written through them commits or rolls back together. */
export interface TransactionalPorts {
  orders: OrdersRepository;
  outbox: OutboxService;
  idempotency: Pick<IdempotencyStore, 'complete'>;
}

/**
 * Transaction boundary. `work` receives transaction-scoped ports; if it throws
 * (or the commit fails) none of its writes become visible.
 */
export interface UnitOfWork {
  run<T>(work: (tx: TransactionalPorts) => Promise<T>): Promise<T>;
}
