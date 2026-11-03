import { type DomainEvent } from '../domain-event';

export const OUTBOX_RELAY_STORE = Symbol('OUTBOX_RELAY_STORE');

export interface PendingOutboxEvent {
  event: DomainEvent;
  /** Delivery attempts made so far. */
  attempts: number;
}

export type DeliveryOutcome = { status: 'published' } | { status: 'failed'; retryAt: Date; error: string };

export interface DrainResult {
  published: number;
  failed: number;
}

/**
 * Relay-side view of the outbox. `drain` claims up to `limit` due, unpublished
 * events so that concurrent relays never get the same row, skips events whose
 * aggregate still has an earlier undelivered event (per-aggregate ordering),
 * hands each to `deliver` in order and records the outcome.
 */
export interface OutboxRelayStore {
  /** Undelivered events (the relay's backlog), for monitoring. */
  countPending(): Promise<number>;
  drain(limit: number, now: Date, deliver: (pending: PendingOutboxEvent) => Promise<DeliveryOutcome>): Promise<DrainResult>;
}
