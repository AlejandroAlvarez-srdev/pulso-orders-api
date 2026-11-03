import { randomUUID } from 'node:crypto';
import { ConcurrentModificationError } from '../common/domain-errors';
import { InMemoryIdempotencyStore } from '../idempotency/in-memory-idempotency.store';
import { type Order, OrderStatus } from '../orders/domain/order';
import { InMemoryOrdersRepository } from '../orders/in-memory-orders.repository';
import { InMemoryOutboxService } from '../outbox/in-memory-outbox.service';
import { InMemoryUnitOfWork } from './in-memory-unit-of-work';

const at = new Date('2026-06-01T10:00:00Z');

const order = (): Order => ({
  id: randomUUID(),
  merchantId: 'm1',
  status: OrderStatus.CREATED,
  pickup: { lat: 19.4, lng: -99.1, address: 'Reforma 1' },
  dropoff: { lat: 19.3, lng: -99.2, address: 'Coyoacán 2' },
  items: [{ sku: 'S', name: 'Pan', qty: 1 }],
  amountCents: 100,
  currency: 'MXN',
  createdAt: at,
  updatedAt: at,
  version: 0,
});

const event = (aggregateId: string) => ({
  id: randomUUID(),
  type: 'order.created',
  aggregateId,
  occurredAt: at,
  payload: {},
});

function setup() {
  const orders = new InMemoryOrdersRepository();
  const outbox = new InMemoryOutboxService();
  const idempotency = new InMemoryIdempotencyStore();
  return { orders, outbox, idempotency, uow: new InMemoryUnitOfWork(orders, outbox, idempotency) };
}

describe('InMemoryUnitOfWork', () => {
  it('keeps writes invisible outside the transaction until commit, visible inside it', async () => {
    const { uow, orders, outbox } = setup();
    const o = order();

    await uow.run(async (tx) => {
      await tx.orders.insert(o);
      await tx.outbox.publish(event(o.id));
      expect(await tx.orders.findById(o.id)).toMatchObject({ id: o.id });
      expect(await orders.findById(o.id)).toBeNull();
      expect(outbox.published()).toHaveLength(0);
    });

    expect(await orders.findById(o.id)).toMatchObject({ id: o.id });
    expect(outbox.published()).toHaveLength(1);
  });

  it('discards staged writes when the work throws', async () => {
    const { uow, orders, outbox } = setup();
    const o = order();

    await expect(
      uow.run(async (tx) => {
        await tx.orders.insert(o);
        await tx.outbox.publish(event(o.id));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await orders.findById(o.id)).toBeNull();
    expect(outbox.published()).toHaveLength(0);
  });

  it('restores every adapter when a write fails during commit', async () => {
    const { uow, orders, outbox, idempotency } = setup();
    await idempotency.reserve('m1', 'k', 'h', at);
    const o = order();
    jest.spyOn(outbox, 'appendSync').mockImplementationOnce(() => {
      throw new Error('outbox down');
    });

    await expect(
      uow.run(async (tx) => {
        await tx.orders.insert(o);
        await tx.idempotency.complete('m1', 'k', { statusCode: 201, body: {} });
        await tx.outbox.publish(event(o.id));
      }),
    ).rejects.toThrow('outbox down');

    expect(await orders.findById(o.id)).toBeNull();
    const probe = await idempotency.reserve('m1', 'k', 'h', at);
    expect(probe).toEqual({ reserved: false, existing: expect.objectContaining({ response: null }) });
  });

  it('fails the commit when the order version moved on after it was read', async () => {
    const { uow, orders, outbox } = setup();
    const o = order();
    await orders.insert(o);

    const slow = uow.run(async (tx) => {
      await tx.orders.updateStatus(o.id, 0, OrderStatus.CANCELLED, at);
      await tx.outbox.publish(event(o.id));
      await new Promise((r) => setImmediate(r));
    });
    await orders.updateStatus(o.id, 0, OrderStatus.PAYMENT_PENDING, at);

    await expect(slow).rejects.toBeInstanceOf(ConcurrentModificationError);
    expect(await orders.findById(o.id)).toMatchObject({ status: OrderStatus.PAYMENT_PENDING, version: 1 });
    expect(outbox.published()).toHaveLength(0);
  });
});
