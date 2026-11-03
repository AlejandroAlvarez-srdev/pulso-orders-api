import { Inject, Injectable } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { OrderStatus } from '../orders/domain/order';
import { ORDERS_REPOSITORY, type OrdersRepository } from '../orders/orders.repository';
import { OUTBOX_RELAY_STORE, type OutboxRelayStore } from '../outbox/relay/outbox-relay.store';

/**
 * Prometheus metrics for this process. Each application instance owns its
 * registry (no global default registry), which keeps tests isolated.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency by method, route template and status code',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  readonly ordersCreated = new Counter({
    name: 'orders_created_total',
    help: 'Orders created (idempotent replays excluded)',
    registers: [this.registry],
  });

  readonly orderTransitions = new Counter({
    name: 'order_status_transitions_total',
    help: 'Committed order status transitions',
    labelNames: ['from', 'to'] as const,
    registers: [this.registry],
  });

  readonly idempotentReplays = new Counter({
    name: 'idempotent_replays_total',
    help: 'POST /orders requests answered from the idempotency store',
    registers: [this.registry],
  });

  readonly outboxDeliveries = new Counter({
    name: 'outbox_deliveries_total',
    help: 'Outbox delivery attempts by result',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  readonly rateLimited = new Counter({
    name: 'rate_limited_requests_total',
    help: 'Requests rejected with 429, by bucket scope',
    labelNames: ['scope'] as const,
    registers: [this.registry],
  });

  constructor(
    @Inject(ORDERS_REPOSITORY) orders: OrdersRepository,
    @Inject(OUTBOX_RELAY_STORE) outbox: OutboxRelayStore,
  ) {
    collectDefaultMetrics({ register: this.registry });

    new Gauge({
      name: 'orders_by_status',
      help: 'Current number of orders in each status (computed at scrape time)',
      labelNames: ['status'] as const,
      registers: [this.registry],
      async collect() {
        const counts = await orders.countByStatus();
        for (const status of Object.values(OrderStatus)) this.set({ status }, counts[status] ?? 0);
      },
    });

    new Gauge({
      name: 'outbox_pending_events',
      help: 'Committed events not yet delivered by the relay',
      registers: [this.registry],
      async collect() {
        this.set(await outbox.countPending());
      },
    });
  }

  /** Express middleware timing every request. Unmatched routes share one label to bound cardinality. */
  httpMiddleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const end = this.httpDuration.startTimer();
      res.on('finish', () => {
        const route = req.route?.path ? `${req.baseUrl}${String(req.route.path)}` : 'unmatched';
        end({ method: req.method, route, status_code: String(res.statusCode) });
      });
      next();
    };
  }
}
