export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
}

/**
 * Exponential backoff with "equal jitter": half the capped delay is fixed,
 * half random, so retries spread out without collapsing towards zero.
 * `attempt` is 1 for the first retry.
 */
export function backoffDelayMs(attempt: number, policy: BackoffPolicy, random: () => number = Math.random): number {
  const exp = Math.min(policy.maxMs, policy.baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}
