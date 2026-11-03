import { InMemoryIdempotencyStore } from './in-memory-idempotency.store';

const at = new Date('2026-06-01T10:00:00Z');
const EPOCH = new Date(0);

describe('InMemoryIdempotencyStore', () => {
  it('lets exactly one caller reserve a key per merchant', async () => {
    const store = new InMemoryIdempotencyStore();

    const results = await Promise.all([
      store.reserve('m1', 'k', 'hash', at, EPOCH),
      store.reserve('m1', 'k', 'hash', at, EPOCH),
      store.reserve('m2', 'k', 'hash', at, EPOCH),
    ]);

    expect(results.map((r) => r.reserved)).toEqual([true, false, true]);
  });

  it('exposes the stored response once completed', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.reserve('m1', 'k', 'hash', at, EPOCH);
    await store.complete('m1', 'k', { statusCode: 201, body: { id: 'o1' } });

    const result = await store.reserve('m1', 'k', 'hash', at, EPOCH);

    expect(result).toEqual({
      reserved: false,
      existing: expect.objectContaining({ requestHash: 'hash', response: { statusCode: 201, body: { id: 'o1' } } }),
    });
  });

  it('frees the key on release', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.reserve('m1', 'k', 'hash', at, EPOCH);
    await store.release('m1', 'k');

    expect(await store.reserve('m1', 'k', 'other', at, EPOCH)).toEqual({ reserved: true });
  });

  it('treats records created before expiredBefore as absent', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.reserve('m1', 'k', 'hash', at, EPOCH);
    await store.complete('m1', 'k', { statusCode: 201, body: { id: 'o1' } });
    const later = new Date(at.getTime() + 1000);

    expect(await store.reserve('m1', 'k', 'other', later, at)).toMatchObject({ reserved: false });
    expect(await store.reserve('m1', 'k', 'other', later, later)).toEqual({ reserved: true });
  });

  it('purges only expired records', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.reserve('m1', 'old', 'h', new Date('2026-06-01T00:00:00Z'), EPOCH);
    await store.reserve('m1', 'new', 'h', new Date('2026-06-02T00:00:00Z'), EPOCH);

    expect(await store.purgeExpired(new Date('2026-06-01T12:00:00Z'))).toBe(1);
    expect(await store.reserve('m1', 'old', 'h', at, EPOCH)).toEqual({ reserved: true });
    expect(await store.reserve('m1', 'new', 'h', at, EPOCH)).toMatchObject({ reserved: false });
  });
});
