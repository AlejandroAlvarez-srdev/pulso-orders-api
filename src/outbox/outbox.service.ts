import { type DomainEvent } from './domain-event';

export const OUTBOX_SERVICE = Symbol('OUTBOX_SERVICE');

/**
 * Port for publishing domain events. Implementations persist events so a relay
 * can deliver them at-least-once to the broker that pulso-saga consumes.
 */
export interface OutboxService {
  publish(event: DomainEvent): Promise<void>;
}
