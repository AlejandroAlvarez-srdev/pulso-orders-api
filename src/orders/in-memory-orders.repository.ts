import { type OrderCursor, isAfterCursor } from './domain/cursor';
import { type Order, type OrderStatus } from './domain/order';
import {
  type ListOrdersQuery,
  type OrderDetailsChange,
  type OrdersPage,
  type OrdersRepository,
} from './orders.repository';

const byNewest = (a: Order, b: Order): number =>
  b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** Process-local adapter used by tests and the zero-dependency dev mode. */
export class InMemoryOrdersRepository implements OrdersRepository {
  private orders = new Map<string, Order>();

  async insert(order: Order): Promise<void> {
    this.insertSync(order);
  }

  async findById(id: string): Promise<Order | null> {
    const order = this.orders.get(id);
    return order ? structuredClone(order) : null;
  }

  async list({ merchantId, status, limit, after }: ListOrdersQuery): Promise<OrdersPage> {
    const matching = [...this.orders.values()]
      .filter((o) => o.merchantId === merchantId)
      .filter((o) => status === undefined || o.status === status)
      .filter((o) => after === undefined || isAfterCursor(o, after))
      .sort(byNewest);

    const items = matching.slice(0, limit).map((o) => structuredClone(o));
    const last = items.at(-1);
    const nextCursor: OrderCursor | null =
      matching.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null;
    return { items, nextCursor };
  }

  async updateStatus(id: string, expectedVersion: number, status: OrderStatus, at: Date): Promise<Order | null> {
    return this.updateStatusSync(id, expectedVersion, status, at);
  }

  async updateDetails(
    id: string,
    expectedVersion: number,
    change: OrderDetailsChange,
    at: Date,
  ): Promise<Order | null> {
    return this.updateDetailsSync(id, expectedVersion, change, at);
  }

  async countByStatus(): Promise<Partial<Record<OrderStatus, number>>> {
    const counts: Partial<Record<OrderStatus, number>> = {};
    for (const order of this.orders.values()) counts[order.status] = (counts[order.status] ?? 0) + 1;
    return counts;
  }

  // Synchronous primitives used by InMemoryUnitOfWork to commit without interleaving.

  insertSync(order: Order): void {
    if (this.orders.has(order.id)) throw new Error(`Order ${order.id} already exists`);
    this.orders.set(order.id, structuredClone(order));
  }

  updateStatusSync(id: string, expectedVersion: number, status: OrderStatus, at: Date): Order | null {
    const current = this.orders.get(id);
    if (!current || current.version !== expectedVersion) return null;
    const updated: Order = { ...current, status, updatedAt: at, version: current.version + 1 };
    this.orders.set(id, updated);
    return structuredClone(updated);
  }

  updateDetailsSync(id: string, expectedVersion: number, change: OrderDetailsChange, at: Date): Order | null {
    const current = this.orders.get(id);
    if (!current || current.version !== expectedVersion) return null;
    const updated: Order = { ...current, ...structuredClone(change), updatedAt: at, version: current.version + 1 };
    this.orders.set(id, updated);
    return structuredClone(updated);
  }

  /** Captures the current state; calling the returned function restores it. */
  snapshot(): () => void {
    const saved = new Map(this.orders);
    return () => {
      this.orders = saved;
    };
  }
}
