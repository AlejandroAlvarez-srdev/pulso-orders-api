import { type AppConfig } from '../config/app-config';
import { IdempotencyCleanupJob } from './idempotency-cleanup.job';
import { InMemoryIdempotencyStore } from './in-memory-idempotency.store';

describe('IdempotencyCleanupJob', () => {
  it('purges records older than the TTL', async () => {
    const store = new InMemoryIdempotencyStore();
    const now = new Date('2026-06-02T12:00:00Z');
    const epoch = new Date(0);
    await store.reserve('m1', 'stale', 'h', new Date('2026-06-01T11:59:59Z'), epoch);
    await store.reserve('m1', 'fresh', 'h', new Date('2026-06-01T12:00:01Z'), epoch);
    const config = { idempotency: { ttlSeconds: 24 * 3600, cleanupEnabled: false, cleanupIntervalMs: 1000 } };
    const job = new IdempotencyCleanupJob(store, { now: () => now }, config as AppConfig);

    expect(await job.runOnce()).toBe(1);
    expect(await job.runOnce()).toBe(0);
    expect(await store.reserve('m1', 'fresh', 'h', now, epoch)).toMatchObject({ reserved: false });
  });
});
