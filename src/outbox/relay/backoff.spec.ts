import { backoffDelayMs } from './backoff';

const policy = { baseMs: 1000, maxMs: 60_000 };

describe('backoffDelayMs', () => {
  it('doubles per attempt', () => {
    expect([1, 2, 3, 4].map((a) => backoffDelayMs(a, policy, () => 1))).toEqual([1000, 2000, 4000, 8000]);
  });

  it('caps at maxMs', () => {
    expect(backoffDelayMs(30, policy, () => 1)).toBe(60_000);
  });

  it('keeps at least half of the delay when jittering', () => {
    expect(backoffDelayMs(3, policy, () => 0)).toBe(2000);
  });
});
