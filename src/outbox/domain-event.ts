import { type Location, type OrderItem, type OrderStatus } from '../orders/domain/order';

export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  id: string;
  type: TType;
  aggregateId: string;
  occurredAt: Date;
  payload: TPayload;
}

export type OrderCreatedEvent = DomainEvent<
  'order.created',
  {
    orderId: string;
    merchantId: string;
    amountCents: number;
    currency: string;
    pickup: Location;
    dropoff: Location;
    items: OrderItem[];
  }
>;

export type OrderCancelledEvent = DomainEvent<
  'order.cancelled',
  {
    orderId: string;
    merchantId: string;
    previousStatus: OrderStatus;
    reason: string | null;
  }
>;

export type OrderEvent = OrderCreatedEvent | OrderCancelledEvent;
