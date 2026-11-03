import { randomUUID } from 'node:crypto';
import { type Order, OrderStatus } from './domain/order';
import { InMemoryOrdersRepository } from './in-memory-orders.repository';

const merchantId = randomUUID();

function order(overrides: Partial<Order> = {}): Order {
  const at = new Date('2026-06-01T10:00:00Z');
  return {
    id: randomUUID(),
    merchantId,
    status: OrderStatus.CREATED,
    pickup: { lat: 19.43, lng: -99.13, address: 'Av. Reforma 1' },
    dropoff: { lat: 19.41, lng: -99.17, address: 'Condesa 22' },
    items: [{ sku: 'SKU-1', name: 'Café', qty: 1 }],
    amountCents: 12_000,
    currency: 'MXN',
    createdAt: at,
    updatedAt: at,
    version: 0,
    ...overrides,
  };
}

describe('InMemoryOrdersRepository', () => {
  it('pages through orders sharing a timestamp without gaps or duplicates', async () => {
    const repo = new InMemoryOrdersRepository();
    const all = Array.from({ length: 7 }, () => order());
    for (const o of all) await repo.insert(o);

    const seen: string[] = [];
    let after;
    do {
      const page = await repo.list({ merchantId, limit: 3, after });
      seen.push(...page.items.map((o) => o.id));
      after = page.nextCursor ?? undefined;
    } while (after);

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(seen).toEqual([...seen].sort().reverse());
  });

  it('isolates merchants and filters by status', async () => {
    const repo = new InMemoryOrdersRepository();
    await repo.insert(order({ status: OrderStatus.PAID }));
    await repo.insert(order());
    await repo.insert(order({ merchantId: randomUUID(), status: OrderStatus.PAID }));

    const page = await repo.list({ merchantId, status: OrderStatus.PAID, limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('applies status changes only when the version matches', async () => {
    const repo = new InMemoryOrdersRepository();
    const o = order();
    await repo.insert(o);
    const at = new Date('2026-06-01T11:00:00Z');

    const updated = await repo.updateStatus(o.id, 0, OrderStatus.PAYMENT_PENDING, at);
    const stale = await repo.updateStatus(o.id, 0, OrderStatus.CANCELLED, at);

    expect(updated).toMatchObject({ status: OrderStatus.PAYMENT_PENDING, version: 1, updatedAt: at });
    expect(stale).toBeNull();
  });

  it('returns copies so callers cannot mutate stored state', async () => {
    const repo = new InMemoryOrdersRepository();
    const o = order();
    await repo.insert(o);

    const loaded = await repo.findById(o.id);
    loaded!.status = OrderStatus.DELIVERED;

    expect((await repo.findById(o.id))!.status).toBe(OrderStatus.CREATED);
  });
});
