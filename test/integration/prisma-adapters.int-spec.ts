import { randomUUID } from 'node:crypto';
import { PrismaIdempotencyStore } from '../../src/idempotency/prisma-idempotency.store';
import { DEMO_MERCHANT } from '../../src/merchants/merchant';
import { OrderStatus } from '../../src/orders/domain/order';
import { orderCancelled, orderCreated } from '../../src/orders/order-events';
import { PrismaOrdersRepository } from '../../src/orders/prisma-orders.repository';
import { PrismaOutboxService } from '../../src/outbox/prisma-outbox.service';
import { type PendingOutboxEvent } from '../../src/outbox/relay/outbox-relay.store';
import { PrismaOutboxRelayStore } from '../../src/outbox/relay/prisma-outbox-relay.store';
import { PrismaUnitOfWork } from '../../src/persistence/prisma-unit-of-work';
import { type PrismaService } from '../../src/persistence/prisma.service';
import { connect, newOrder, resetDatabase } from './db';

const merchant = DEMO_MERCHANT.id;
const t0 = new Date('2026-06-01T10:00:00.000Z');
const plus = (ms: number) => new Date(t0.getTime() + ms);
const FAR_FUTURE = new Date('2100-01-01T00:00:00.000Z');

describe('Prisma adapters against PostgreSQL', () => {
  let prisma: PrismaService;

  beforeAll(() => {
    prisma = connect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('PrismaIdempotencyStore', () => {
    it('lets exactly one of several concurrent reservations of a key win', async () => {
      const store = new PrismaIdempotencyStore(prisma);
      const results = await Promise.all(
        Array.from({ length: 8 }, () => store.reserve(merchant, 'key-race', 'a'.repeat(64), t0, plus(-1))),
      );
      expect(results.filter((r) => r.reserved)).toHaveLength(1);
      expect(await prisma.idempotencyKey.count()).toBe(1);
    });

    it('replaces an expired reservation and keeps a live one', async () => {
      const store = new PrismaIdempotencyStore(prisma);
      await store.reserve(merchant, 'k', 'a'.repeat(64), t0, plus(-1));

      const live = await store.reserve(merchant, 'k', 'b'.repeat(64), plus(1000), t0);
      expect(live).toMatchObject({ reserved: false, existing: { requestHash: 'a'.repeat(64), response: null } });

      const expired = await store.reserve(merchant, 'k', 'b'.repeat(64), plus(2000), plus(1));
      expect(expired).toEqual({ reserved: true });
      const row = await prisma.idempotencyKey.findUniqueOrThrow({ where: { merchantId_key: { merchantId: merchant, key: 'k' } } });
      expect(row.requestHash).toBe('b'.repeat(64));
    });

    it('stores the response verbatim so replays are byte-identical', async () => {
      const store = new PrismaIdempotencyStore(prisma);
      await store.reserve(merchant, 'k', 'a'.repeat(64), t0, plus(-1));
      // JSONB would reorder these keys (shorter keys first); TEXT keeps them.
      const body = { zeta: 1, id: 'x', amountCents: 100, a: { y: 2, b: 1 } };
      await store.complete(merchant, 'k', { statusCode: 201, body });

      const replay = await store.reserve(merchant, 'k', 'a'.repeat(64), plus(1), plus(-1));
      expect(replay.reserved).toBe(false);
      if (replay.reserved) return;
      expect(JSON.stringify(replay.existing.response!.body)).toBe(JSON.stringify(body));
    });
  });

  describe('PrismaOrdersRepository', () => {
    it('applies a compare-and-set update only at the expected version', async () => {
      const repo = new PrismaOrdersRepository(prisma);
      const order = newOrder();
      await repo.insert(order);

      const updated = await repo.updateStatus(order.id, 0, OrderStatus.PAYMENT_PENDING, plus(1));
      expect(updated).toMatchObject({ status: OrderStatus.PAYMENT_PENDING, version: 1 });
      expect(await repo.updateStatus(order.id, 0, OrderStatus.CANCELLED, plus(2))).toBeNull();
      expect(await repo.findById(order.id)).toMatchObject({ status: OrderStatus.PAYMENT_PENDING, version: 1 });
    });

    it('lets one of several concurrent writers at the same version win', async () => {
      const repo = new PrismaOrdersRepository(prisma);
      const order = newOrder();
      await repo.insert(order);

      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => repo.updateStatus(order.id, 0, OrderStatus.CANCELLED, plus(i + 1))),
      );
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect((await repo.findById(order.id))!.version).toBe(1);
    });

    it('pages with a keyset cursor across rows that share created_at', async () => {
      const repo = new PrismaOrdersRepository(prisma);
      // Seven orders, three of them in the same millisecond, so the id tie-break matters.
      const stamps = [0, 1, 1, 1, 2, 3, 4];
      for (const ms of stamps) await repo.insert(newOrder({ createdAt: plus(ms), updatedAt: plus(ms) }));

      const seen: string[] = [];
      let after: { createdAt: Date; id: string } | undefined;
      for (;;) {
        const page = await repo.list({ merchantId: merchant, limit: 2, after });
        seen.push(...page.items.map((o) => o.id));
        if (!page.nextCursor) break;
        after = page.nextCursor;
      }

      const all = await prisma.order.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      expect(seen).toEqual(all.map((o) => o.id));
      expect(new Set(seen).size).toBe(stamps.length);
    });
  });

  describe('PrismaUnitOfWork', () => {
    it('rolls back the order row when the outbox insert fails', async () => {
      const uow = new PrismaUnitOfWork(prisma);
      const order = newOrder();
      const event = orderCreated(order);
      await new PrismaOutboxService(prisma).publish({ ...event, aggregateId: randomUUID() });

      // Same event id again: the outbox primary key rejects it inside the transaction.
      await expect(
        uow.run(async (tx) => {
          await tx.orders.insert(order);
          await tx.outbox.publish(event);
        }),
      ).rejects.toThrow();

      expect(await prisma.order.findUnique({ where: { id: order.id } })).toBeNull();
      expect(await prisma.outboxEvent.count()).toBe(1);
    });

    it('commits the order, its event and the idempotent response together', async () => {
      const uow = new PrismaUnitOfWork(prisma);
      const store = new PrismaIdempotencyStore(prisma);
      await store.reserve(merchant, 'k', 'a'.repeat(64), t0, plus(-1));
      const order = newOrder();

      await uow.run(async (tx) => {
        await tx.orders.insert(order);
        await tx.outbox.publish(orderCreated(order));
        await tx.idempotency.complete(merchant, 'k', { statusCode: 201, body: { id: order.id } });
      });

      expect(await prisma.order.count()).toBe(1);
      expect(await prisma.outboxEvent.count({ where: { aggregateId: order.id } })).toBe(1);
      const key = await prisma.idempotencyKey.findFirstOrThrow();
      expect(key.responseStatus).toBe(201);
    });
  });

  describe('PrismaOutboxRelayStore', () => {
    const publishAll = (sink: string[]) => async (pending: PendingOutboxEvent) => {
      sink.push(pending.event.id);
      return { status: 'published' as const };
    };

    it('keeps per-order commit order even when the later event carries an earlier timestamp', async () => {
      // Two replicas whose clocks disagree by 50 ms: the cancellation is committed
      // after the creation but stamped before it.
      const outbox = new PrismaOutboxService(prisma);
      const order = newOrder({ createdAt: plus(50), updatedAt: plus(50) });
      await new PrismaOrdersRepository(prisma).insert(order);
      const created = orderCreated(order);
      await outbox.publish(created);
      const cancelled = orderCancelled({ ...order, status: OrderStatus.CANCELLED, updatedAt: t0, version: 1 }, OrderStatus.CREATED, 'skew');
      await outbox.publish(cancelled);

      const relay = new PrismaOutboxRelayStore(prisma);
      const delivered: string[] = [];
      expect(await relay.drain(10, FAR_FUTURE, publishAll(delivered))).toEqual({ published: 1, failed: 0 });
      expect(await relay.drain(10, FAR_FUTURE, publishAll(delivered))).toEqual({ published: 1, failed: 0 });
      expect(delivered).toEqual([created.id, cancelled.id]);
    });

    it('holds back later events of an order while an earlier one is failing', async () => {
      const outbox = new PrismaOutboxService(prisma);
      const order = newOrder();
      const created = orderCreated(order);
      const cancelled = orderCancelled({ ...order, updatedAt: plus(10) }, OrderStatus.CREATED, undefined);
      await outbox.publish(created);
      await outbox.publish(cancelled);

      // next_attempt_at defaults to the database clock, so drive the relay with real time.
      const now = new Date(Date.now() + 1000);
      const relay = new PrismaOutboxRelayStore(prisma);
      const retryAt = new Date(now.getTime() + 60_000);
      const result = await relay.drain(10, now, async () => ({ status: 'failed', retryAt, error: 'HTTP 503' }));
      expect(result).toEqual({ published: 0, failed: 1 });

      const rows = await prisma.outboxEvent.findMany({ where: { aggregateId: order.id }, orderBy: { occurredAt: 'asc' } });
      expect(rows.map((r) => [r.id, r.attempts, r.lastError])).toEqual([
        [created.id, 1, 'HTTP 503'],
        [cancelled.id, 0, null],
      ]);
      // Not due yet: nothing is claimed, and the cancellation does not jump the queue.
      expect(await relay.drain(10, new Date(now.getTime() + 1000), publishAll([]))).toEqual({ published: 0, failed: 0 });
    });

    it('never hands the same event to two relays draining concurrently', async () => {
      const outbox = new PrismaOutboxService(prisma);
      const ids: string[] = [];
      for (let i = 0; i < 40; i++) {
        const event = orderCreated(newOrder({ createdAt: plus(i), updatedAt: plus(i) }));
        ids.push(event.id);
        await outbox.publish(event);
      }

      const delivered: string[] = [];
      const slowPublish = async (pending: PendingOutboxEvent) => {
        delivered.push(pending.event.id);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { status: 'published' as const };
      };
      const relays = Array.from({ length: 3 }, () => new PrismaOutboxRelayStore(prisma));
      for (let round = 0; round < 10 && delivered.length < ids.length; round++) {
        await Promise.all(relays.map((relay) => relay.drain(7, FAR_FUTURE, slowPublish)));
      }

      expect([...delivered].sort()).toEqual([...ids].sort());
      expect(await relays[0].countPending()).toBe(0);
    });
  });
});
