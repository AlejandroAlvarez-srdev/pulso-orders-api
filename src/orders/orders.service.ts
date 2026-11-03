import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { canonicalHash } from '../common/canonical-hash';
import { CLOCK, type Clock } from '../common/clock';
import {
  ConcurrentModificationError,
  IdempotencyKeyInFlightError,
  IdempotencyKeyReusedError,
  NotFoundError,
} from '../common/domain-errors';
import { IDEMPOTENCY_STORE, type IdempotencyStore } from '../idempotency/idempotency.store';
import { OUTBOX_SERVICE, type OutboxService } from '../outbox/outbox.service';
import { decodeCursor, encodeCursor } from './domain/cursor';
import { type NewOrderInput, type Order, OrderStatus } from './domain/order';
import { assertTransition } from './domain/order-state-machine';
import { DEFAULT_PAGE_SIZE, type OrderResponseDto, toOrderResponse } from './dto/order.dto';
import { orderCancelled, orderCreated } from './order-events';
import { ORDERS_REPOSITORY, type OrdersRepository } from './orders.repository';

export interface CreateOrderResult {
  statusCode: number;
  body: OrderResponseDto;
  /** True when the response was served from the idempotency store. */
  replayed: boolean;
}

export interface ListOrdersParams {
  status?: OrderStatus;
  limit?: number;
  cursor?: string;
}

export interface OrdersListResult {
  items: Order[];
  nextCursor: string | null;
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(ORDERS_REPOSITORY) private readonly orders: OrdersRepository,
    @Inject(IDEMPOTENCY_STORE) private readonly idempotency: IdempotencyStore,
    @Inject(OUTBOX_SERVICE) private readonly outbox: OutboxService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Creates an order exactly once per (merchant, idempotency key). Retries with
   * the same key and body get the original response; a different body is a
   * client bug and is rejected instead of silently returning the old order.
   */
  async create(merchantId: string, input: NewOrderInput, idempotencyKey: string): Promise<CreateOrderResult> {
    const now = this.clock.now();
    const requestHash = canonicalHash(input);
    const reservation = await this.idempotency.reserve(merchantId, idempotencyKey, requestHash, now);

    if (!reservation.reserved) {
      const { existing } = reservation;
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyKeyReusedError(
          `Idempotency-Key "${idempotencyKey}" was already used with a different request body`,
        );
      }
      if (!existing.response) {
        throw new IdempotencyKeyInFlightError(`Request with Idempotency-Key "${idempotencyKey}" is still in flight`);
      }
      return {
        statusCode: existing.response.statusCode,
        body: existing.response.body as OrderResponseDto,
        replayed: true,
      };
    }

    try {
      const order: Order = {
        id: randomUUID(),
        merchantId,
        status: OrderStatus.CREATED,
        pickup: { ...input.pickup },
        dropoff: { ...input.dropoff },
        items: input.items.map((item) => ({ ...item })),
        amountCents: input.amountCents,
        currency: input.currency,
        createdAt: now,
        updatedAt: now,
        version: 0,
      };
      await this.orders.insert(order);
      await this.outbox.publish(orderCreated(order));

      const result = { statusCode: 201, body: toOrderResponse(order) };
      await this.idempotency.complete(merchantId, idempotencyKey, result);
      return { ...result, replayed: false };
    } catch (error) {
      // Let the client retry with the same key instead of locking it forever.
      await this.idempotency.release(merchantId, idempotencyKey);
      throw error;
    }
  }

  /** Orders of other merchants are reported as missing so ids cannot be probed. */
  async get(merchantId: string, orderId: string): Promise<Order> {
    const order = await this.orders.findById(orderId);
    if (!order || order.merchantId !== merchantId) throw new NotFoundError(`Order ${orderId} not found`);
    return order;
  }

  async list(merchantId: string, params: ListOrdersParams): Promise<OrdersListResult> {
    const page = await this.orders.list({
      merchantId,
      status: params.status,
      limit: params.limit ?? DEFAULT_PAGE_SIZE,
      after: params.cursor ? decodeCursor(params.cursor) : undefined,
    });
    return { items: page.items, nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null };
  }

  async transition(merchantId: string, orderId: string, to: OrderStatus, reason?: string): Promise<Order> {
    const current = await this.get(merchantId, orderId);
    assertTransition(current.status, to);

    const updated = await this.orders.updateStatus(orderId, current.version, to, this.clock.now());
    if (!updated) {
      throw new ConcurrentModificationError(`Order ${orderId} changed while transitioning to ${to}; reload and retry`);
    }

    if (to === OrderStatus.CANCELLED) {
      await this.outbox.publish(orderCancelled(updated, current.status, reason));
    }
    return updated;
  }
}
