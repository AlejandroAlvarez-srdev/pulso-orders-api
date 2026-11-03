import { type OrderCursor } from './domain/cursor';
import { type Location, type Order, type OrderItem, type OrderStatus } from './domain/order';

export const ORDERS_REPOSITORY = Symbol('ORDERS_REPOSITORY');

export interface ListOrdersQuery {
  merchantId: string;
  status?: OrderStatus;
  limit: number;
  after?: OrderCursor;
}

export interface OrdersPage {
  items: Order[];
  /** Position of the last returned item when more results exist, otherwise null. */
  nextCursor: OrderCursor | null;
}

export interface OrderDetailsChange {
  dropoff?: Location;
  items?: OrderItem[];
  amountCents?: number;
}

export interface OrdersRepository {
  insert(order: Order): Promise<void>;
  findById(id: string): Promise<Order | null>;
  /** Keyset page ordered by (createdAt DESC, id DESC). */
  list(query: ListOrdersQuery): Promise<OrdersPage>;
  /**
   * Compare-and-set status change: applies only when the stored version still
   * equals `expectedVersion`, bumping it by one. Returns null on a version miss.
   */
  updateStatus(id: string, expectedVersion: number, status: OrderStatus, at: Date): Promise<Order | null>;
  /** Compare-and-set edit of mutable details; same version semantics as `updateStatus`. */
  updateDetails(id: string, expectedVersion: number, change: OrderDetailsChange, at: Date): Promise<Order | null>;
  /** Order counts per status across all merchants, for monitoring. */
  countByStatus(): Promise<Partial<Record<OrderStatus, number>>>;
}
