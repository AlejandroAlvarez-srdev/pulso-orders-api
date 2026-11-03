import { TokenBucketLimiter } from './token-bucket';

class ManualClock {
  t = Date.parse('2026-06-01T10:00:00Z');
  now(): Date {
    return new Date(this.t);
  }
}

describe('TokenBucketLimiter', () => {
  it('allows a burst up to capacity, then rejects with a retry hint', () => {
    const clock = new ManualClock();
    const limiter = new TokenBucketLimiter({ capacity: 3, refillPerSecond: 1 }, clock);

    const results = [1, 2, 3, 4].map(() => limiter.take('m1'));

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3]).toMatchObject({ limit: 3, retryAfterSeconds: 1 });
  });

  it('refills over time at the sustained rate, never above capacity', () => {
    const clock = new ManualClock();
    const limiter = new TokenBucketLimiter({ capacity: 2, refillPerSecond: 2 }, clock);
    limiter.take('m1');
    limiter.take('m1');

    clock.t += 500;
    expect(limiter.take('m1').allowed).toBe(true);
    expect(limiter.take('m1').allowed).toBe(false);

    clock.t += 60_000;
    expect(limiter.take('m1').remaining).toBe(1);
  });

  it('keeps buckets independent per key', () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 1 }, new ManualClock());

    expect(limiter.take('m1').allowed).toBe(true);
    expect(limiter.take('m1').allowed).toBe(false);
    expect(limiter.take('m2').allowed).toBe(true);
  });

  it('evicts the least recently used key beyond maxKeys', () => {
    const clock = new ManualClock();
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 1 }, clock, 2);
    limiter.take('a');
    limiter.take('b');
    limiter.take('a'); // a is now most recent (and empty)
    limiter.take('c'); // evicts b

    expect(limiter.take('a').allowed).toBe(false);
    expect(limiter.take('b').allowed).toBe(true); // fresh bucket after eviction
  });
});
