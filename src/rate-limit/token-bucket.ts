import { type Clock } from '../common/clock';

export interface BucketPolicy {
  /** Maximum burst size. */
  capacity: number;
  /** Tokens added per second, i.e. the sustained request rate. */
  refillPerSecond: number;
}

export interface TakeResult {
  allowed: boolean;
  limit: number;
  /** Whole tokens left after this request. */
  remaining: number;
  /** Seconds until one token is available again (0 when allowed). */
  retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Token bucket per key, held in process memory. Buckets refill lazily on
 * access, so idle keys cost nothing; the map is bounded by evicting the least
 * recently used key.
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly policy: BucketPolicy,
    private readonly clock: Clock,
    private readonly maxKeys = 10_000,
  ) {}

  take(key: string): TakeResult {
    const now = this.clock.now().getTime();
    const bucket = this.refill(this.buckets.get(key), now);

    // Re-insert to mark the key as most recently used.
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    if (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }

    const { capacity, refillPerSecond } = this.policy;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, limit: capacity, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSecond));
    return { allowed: false, limit: capacity, remaining: 0, retryAfterSeconds };
  }

  private refill(bucket: Bucket | undefined, now: number): Bucket {
    if (!bucket) return { tokens: this.policy.capacity, updatedAt: now };
    const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1000;
    return {
      tokens: Math.min(this.policy.capacity, bucket.tokens + elapsedSeconds * this.policy.refillPerSecond),
      updatedAt: now,
    };
  }
}
