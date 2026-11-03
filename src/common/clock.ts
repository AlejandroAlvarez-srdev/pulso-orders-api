export const CLOCK = Symbol('CLOCK');

/** Injected time source so tests can control timestamps and ordering. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
