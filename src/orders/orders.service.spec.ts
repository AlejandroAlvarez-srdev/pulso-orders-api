import { randomUUID } from 'node:crypto';
import { type Clock } from '../common/clock';
import { type AppConfig } from '../config/app-config';
import {
  ConcurrentModificationError,
  IdempotencyKeyInFlightError,
  IdempotencyKeyReusedError,
  InvalidCursorError,
  InvalidTransitionError,
  NotFoundError,
  OrderNotEditableError,
  PreconditionFailedError,
} from '../common/domain-errors';
import { MetricsService } from '../metrics/metrics.service';
import { InMemoryIdempotencyStore } from '../idempotency/in-memory-idempotency.store';
import { InMemoryOutboxService } from '../outbox/in-memory-outbox.service';
import { InMemoryUnitOfWork } from '../persistence/in-memory-unit-of-work';
import { type NewOrderInput, OrderStatus } from './domain/order';
import { InMemoryOrdersRepository } from './in-memory-orders.repository';
import { OrdersService } from './orders.service';

const S = OrderStatus;

class SteppingClock implements Clock {
  private t = Date.parse('2026-06-01T10:00:00.000Z');
  now(): Date {
    this.t += 1000;
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

const TTL_SECONDS = 24 * 3600;
const config = { idempotency: { ttlSeconds: TTL_SECONDS } } as AppConfig;

const input = (overrides: Partial<NewOrderInput> = {}): NewOrderInput => ({
  pickup: { lat: 19.4326, lng: -99.1332, address: 'Farmacia Roma, Álvaro Obregón 120' },
  dropoff: { lat: 19.4115, lng: -99.1694, address: 'Ámsterdam 45, Condesa' },
  items: [{ sku: 'FARM-PARA-500', name: 'Paracetamol 500 mg', qty: 2 }],
  amountCents: 18_950,
  currency: 'MXN',
  ...overrides,
});

function setup() {
  const repo = new InMemoryOrdersRepository();
  const idempotency = new InMemoryIdempotencyStore();
  const outbox = new InMemoryOutboxService();
  const uow = new InMemoryUnitOfWork(repo, outbox, idempotency);
  const clock = new SteppingClock();
  const metrics = new MetricsService(repo, outbox);
  const service = new OrdersService(repo, idempotency, uow, clock, config, metrics);
  return { repo, idempotency, outbox, uow, clock, metrics, service };
}

const merchant = randomUUID();

async function createAt(service: OrdersService, status: OrderStatus) {
  const { body } = await service.create(merchant, input(), randomUUID());
  const path: Partial<Record<OrderStatus, OrderStatus[]>> = {
    [S.CREATED]: [],
    [S.PAYMENT_PENDING]: [S.PAYMENT_PENDING],
    [S.PAID]: [S.PAYMENT_PENDING, S.PAID],
    [S.ASSIGNED]: [S.PAYMENT_PENDING, S.PAID, S.ASSIGNED],
    [S.IN_PROGRESS]: [S.PAYMENT_PENDING, S.PAID, S.ASSIGNED, S.IN_PROGRESS],
    [S.DELIVERED]: [S.PAYMENT_PENDING, S.PAID, S.ASSIGNED, S.IN_PROGRESS, S.DELIVERED],
  };
  for (const step of path[status]!) await service.transition(merchant, body.id, step);
  return body.id;
}

describe('OrdersService', () => {
  describe('create', () => {
    it('creates a CREATED order and publishes order.created', async () => {
      const { service, outbox } = setup();

      const result = await service.create(merchant, input(), 'key-1');

      expect(result).toMatchObject({ statusCode: 201, replayed: false });
      expect(result.body).toMatchObject({ merchantId: merchant, status: S.CREATED, amountCents: 18_950 });
      expect(outbox.stored()).toEqual([
        expect.objectContaining({
          type: 'order.created',
          aggregateId: result.body.id,
          payload: expect.objectContaining({ orderId: result.body.id, merchantId: merchant, currency: 'MXN' }),
        }),
      ]);
    });

    it('replays the original response for the same key and body', async () => {
      const { service, outbox, repo, metrics } = setup();

      const first = await service.create(merchant, input(), 'key-1');
      const second = await service.create(merchant, input(), 'key-1');

      expect(second).toEqual({ ...first, replayed: true });
      expect((await metrics.ordersCreated.get()).values[0].value).toBe(1);
      expect((await metrics.idempotentReplays.get()).values[0].value).toBe(1);
      expect(outbox.stored()).toHaveLength(1);
      expect((await repo.list({ merchantId: merchant, limit: 10 })).items).toHaveLength(1);
    });

    it('treats bodies with reordered keys as the same request', async () => {
      const { service } = setup();
      const { pickup, dropoff, items, amountCents, currency } = input();

      const first = await service.create(merchant, input(), 'key-1');
      const second = await service.create(merchant, { currency, amountCents, items, dropoff, pickup }, 'key-1');

      expect(second.body.id).toBe(first.body.id);
    });

    it('rejects reusing a key with a different body', async () => {
      const { service } = setup();
      await service.create(merchant, input(), 'key-1');

      await expect(service.create(merchant, input({ amountCents: 1 }), 'key-1')).rejects.toBeInstanceOf(
        IdempotencyKeyReusedError,
      );
    });

    it('forgets a key once its TTL has passed', async () => {
      const { service, clock } = setup();
      const first = await service.create(merchant, input(), 'key-1');
      clock.advance((TTL_SECONDS - 10) * 1000);
      const stillReplayed = await service.create(merchant, input(), 'key-1');
      clock.advance(60_000);

      const afterTtl = await service.create(merchant, input({ amountCents: 1 }), 'key-1');

      expect(stillReplayed.replayed).toBe(true);
      expect(afterTtl).toMatchObject({ replayed: false, statusCode: 201 });
      expect(afterTtl.body.id).not.toBe(first.body.id);
    });

    it('scopes keys per merchant', async () => {
      const { service } = setup();

      const a = await service.create(merchant, input(), 'shared-key');
      const b = await service.create(randomUUID(), input(), 'shared-key');

      expect(b.replayed).toBe(false);
      expect(b.body.id).not.toBe(a.body.id);
    });

    it('reports in-flight when the same body is retried before completion', async () => {
      const { service, uow } = setup();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const run = uow.run.bind(uow);
      jest.spyOn(uow, 'run').mockImplementationOnce(async (work) => {
        await gate;
        return run(work);
      });

      const first = service.create(merchant, input(), 'key-1');
      await new Promise((r) => setImmediate(r));

      await expect(service.create(merchant, input(), 'key-1')).rejects.toBeInstanceOf(IdempotencyKeyInFlightError);
      release();
      await expect(first).resolves.toMatchObject({ statusCode: 201 });
    });

    it('releases the key when creation fails so the client can retry', async () => {
      const { service, repo, outbox } = setup();
      jest.spyOn(repo, 'insertSync').mockImplementationOnce(() => {
        throw new Error('db down');
      });

      await expect(service.create(merchant, input(), 'key-1')).rejects.toThrow('db down');
      const retry = await service.create(merchant, input(), 'key-1');

      expect(retry).toMatchObject({ statusCode: 201, replayed: false });
      expect(outbox.stored()).toHaveLength(1);
    });
  });

  describe('atomicity (transactional outbox)', () => {
    it('persists no order and releases the key when the outbox write fails', async () => {
      const { service, repo, outbox, idempotency } = setup();
      jest.spyOn(outbox, 'appendSync').mockImplementationOnce(() => {
        throw new Error('outbox unavailable');
      });

      await expect(service.create(merchant, input(), 'key-1')).rejects.toThrow('outbox unavailable');

      expect((await repo.list({ merchantId: merchant, limit: 10 })).items).toHaveLength(0);
      expect(outbox.stored()).toHaveLength(0);
      expect(await idempotency.reserve(merchant, 'key-1', 'probe', new Date(), new Date(0))).toEqual({ reserved: true });
    });

    it('lets the client retry the same key after an outbox failure', async () => {
      const { service, repo, outbox } = setup();
      jest.spyOn(outbox, 'appendSync').mockImplementationOnce(() => {
        throw new Error('outbox unavailable');
      });
      await expect(service.create(merchant, input(), 'key-1')).rejects.toThrow();

      const retry = await service.create(merchant, input(), 'key-1');

      expect(retry).toMatchObject({ statusCode: 201, replayed: false });
      expect((await repo.list({ merchantId: merchant, limit: 10 })).items.map((o) => o.id)).toEqual([retry.body.id]);
      expect(outbox.stored()).toEqual([expect.objectContaining({ type: 'order.created', aggregateId: retry.body.id })]);
    });

    it('does not complete the idempotency key when the transaction rolls back', async () => {
      const { service, idempotency, outbox } = setup();
      const complete = jest.spyOn(idempotency, 'completeSync');
      jest.spyOn(outbox, 'appendSync').mockImplementationOnce(() => {
        throw new Error('outbox unavailable');
      });

      await expect(service.create(merchant, input(), 'key-1')).rejects.toThrow();

      expect(complete).not.toHaveBeenCalled();
    });

    it('keeps the order status when the order.cancelled event cannot be stored', async () => {
      const { service, repo, outbox } = setup();
      const id = await createAt(service, S.PAID);
      jest.spyOn(outbox, 'appendSync').mockImplementationOnce(() => {
        throw new Error('outbox unavailable');
      });

      await expect(service.transition(merchant, id, S.CANCELLED, 'x')).rejects.toThrow('outbox unavailable');

      expect(await repo.findById(id)).toMatchObject({ status: S.PAID, version: 2 });
      expect(outbox.stored().map((e) => e.type)).toEqual(['order.created']);
    });
  });

  describe('get', () => {
    it('hides orders that belong to another merchant', async () => {
      const { service } = setup();
      const { body } = await service.create(merchant, input(), 'key-1');

      await expect(service.get(randomUUID(), body.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.get(merchant, body.id)).resolves.toMatchObject({ id: body.id });
    });
  });

  describe('transition', () => {
    it('applies an allowed transition and bumps the version', async () => {
      const { service } = setup();
      const id = await createAt(service, S.CREATED);

      const updated = await service.transition(merchant, id, S.PAYMENT_PENDING);

      expect(updated).toMatchObject({ status: S.PAYMENT_PENDING, version: 1 });
      expect(updated.updatedAt.getTime()).toBeGreaterThan(updated.createdAt.getTime());
    });

    it('rejects an invalid transition without side effects', async () => {
      const { service, outbox, repo } = setup();
      const id = await createAt(service, S.DELIVERED);

      await expect(service.transition(merchant, id, S.CANCELLED)).rejects.toBeInstanceOf(InvalidTransitionError);
      expect((await repo.findById(id))!.status).toBe(S.DELIVERED);
      expect(outbox.stored().map((e) => e.type)).toEqual(['order.created']);
    });

    it('publishes order.cancelled with the previous status and reason', async () => {
      const { service, outbox } = setup();
      const id = await createAt(service, S.PAID);

      await service.transition(merchant, id, S.CANCELLED, 'Store closed early');

      expect(outbox.stored().at(-1)).toMatchObject({
        type: 'order.cancelled',
        aggregateId: id,
        payload: { orderId: id, merchantId: merchant, previousStatus: S.PAID, reason: 'Store closed early' },
      });
    });

    it('does not publish events for non-cancel transitions', async () => {
      const { service, outbox } = setup();
      await createAt(service, S.IN_PROGRESS);

      expect(outbox.stored().map((e) => e.type)).toEqual(['order.created']);
    });

    it('detects a concurrent status change', async () => {
      const { service } = setup();
      const id = await createAt(service, S.PAID);

      const results = await Promise.allSettled([
        service.transition(merchant, id, S.ASSIGNED),
        service.transition(merchant, id, S.CANCELLED),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
      expect(rejected.reason).toBeInstanceOf(ConcurrentModificationError);
    });

    it('cannot transition another merchant’s order', async () => {
      const { service } = setup();
      const id = await createAt(service, S.CREATED);

      await expect(service.transition(randomUUID(), id, S.CANCELLED)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('conditional updates', () => {
    it('edits details of a CREATED order when the version matches', async () => {
      const { service } = setup();
      const id = await createAt(service, S.CREATED);
      const dropoff = { lat: 19.36, lng: -99.16, address: 'Coyoacán 10' };

      const updated = await service.updateDetails(merchant, id, { dropoff, amountCents: 20_000 }, 0);

      expect(updated).toMatchObject({ dropoff, amountCents: 20_000, version: 1, status: S.CREATED });
      expect(updated.items).toHaveLength(1);
    });

    it('rejects a stale version with 412', async () => {
      const { service } = setup();
      const id = await createAt(service, S.CREATED);
      await service.updateDetails(merchant, id, { amountCents: 1 }, 0);

      await expect(service.updateDetails(merchant, id, { amountCents: 2 }, 0)).rejects.toBeInstanceOf(
        PreconditionFailedError,
      );
    });

    it('refuses to edit orders past CREATED', async () => {
      const { service } = setup();
      const id = await createAt(service, S.PAYMENT_PENDING);

      await expect(service.updateDetails(merchant, id, { amountCents: 1 }, 1)).rejects.toBeInstanceOf(
        OrderNotEditableError,
      );
    });

    it('applies the expected version to transitions too', async () => {
      const { service } = setup();
      const id = await createAt(service, S.CREATED);

      await expect(service.transition(merchant, id, S.CANCELLED, undefined, 5)).rejects.toBeInstanceOf(
        PreconditionFailedError,
      );
      await expect(service.transition(merchant, id, S.CANCELLED, undefined, 0)).resolves.toMatchObject({ version: 1 });
    });

    it('turns a lost race into 412 when the client sent If-Match', async () => {
      const { service } = setup();
      const id = await createAt(service, S.PAID);

      const results = await Promise.allSettled([
        service.transition(merchant, id, S.ASSIGNED, undefined, 2),
        service.transition(merchant, id, S.CANCELLED, undefined, 2),
      ]);

      const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
      expect(rejected.reason).toBeInstanceOf(PreconditionFailedError);
    });
  });

  describe('list', () => {
    it('returns newest first with an opaque cursor for the next page', async () => {
      const { service } = setup();
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push((await service.create(merchant, input(), `k-${i}`)).body.id);

      const first = await service.list(merchant, { limit: 2 });
      const second = await service.list(merchant, { limit: 2, cursor: first.nextCursor! });
      const third = await service.list(merchant, { limit: 2, cursor: second.nextCursor! });

      expect([...first.items, ...second.items, ...third.items].map((o) => o.id)).toEqual(ids.reverse());
      expect(third.nextCursor).toBeNull();
    });

    it('filters by status', async () => {
      const { service } = setup();
      const cancelled = await createAt(service, S.CREATED);
      await service.transition(merchant, cancelled, S.CANCELLED);
      await createAt(service, S.CREATED);

      const page = await service.list(merchant, { status: S.CANCELLED });

      expect(page.items.map((o) => o.id)).toEqual([cancelled]);
    });

    it('rejects tampered cursors', async () => {
      const { service } = setup();

      await expect(service.list(merchant, { cursor: 'not-a-cursor' })).rejects.toBeInstanceOf(InvalidCursorError);
    });
  });
});
