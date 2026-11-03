import { InMemoryIdempotencyStore } from './in-memory-idempotency.store';

const at = new Date('2026-06-01T10:00:00Z');

describe('InMemoryIdempotencyStore', () => {
  it('lets exactly one caller reserve a key per merchant', async () => {
    const store = new InMemoryIdempotencyStore();

    const results = await Promise.all([
      store.reserve('m1', 'k', 'hash', at),
      store.reserve('m1', 'k', 'hash', at),
      store.reserve('m2', 'k', 'hash', at),
    ]);

    expect(results.map((r) => r.reserved)).toEqual([true, false, true]);
  });

  it('exposes the stored response once completed', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.reserve('m1', 'k', 'hash', at);
    await store.complete('m1', 'k', { statusCode: 201, body: { id: 'o1' } });

    const result = await store.reserve('m1', 'k', 'hash', at);

    expect(result).toEqual({
      reserved: false,
      existing: expect.objectContaining({ requestHash: 'hash', response: { statusCode: 201, body: { id: 'o1' } } }),
    });
  });

  it('frees the key on release', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.reserve('m1', 'k', 'hash', at);
    await store.release('m1', 'k');

    expect(await store.reserve('m1', 'k', 'other', at)).toEqual({ reserved: true });
  });
});
