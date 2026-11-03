import { randomUUID } from 'node:crypto';
import { type OrderCancelledEvent, type OrderCreatedEvent } from '../outbox/domain-event';
import { type Order, type OrderStatus } from './domain/order';

export function orderCreated(order: Order): OrderCreatedEvent {
  return {
    id: randomUUID(),
    type: 'order.created',
    aggregateId: order.id,
    occurredAt: order.createdAt,
    payload: {
      orderId: order.id,
      merchantId: order.merchantId,
      amountCents: order.amountCents,
      currency: order.currency,
      pickup: order.pickup,
      dropoff: order.dropoff,
      items: order.items,
    },
  };
}

export function orderCancelled(order: Order, previousStatus: OrderStatus, reason: string | undefined): OrderCancelledEvent {
  return {
    id: randomUUID(),
    type: 'order.cancelled',
    aggregateId: order.id,
    occurredAt: order.updatedAt,
    payload: { orderId: order.id, merchantId: order.merchantId, previousStatus, reason: reason ?? null },
  };
}
