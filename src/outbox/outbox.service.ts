import { type DomainEvent } from './domain-event';

/**
 * Port for recording domain events. It is only reached through a UnitOfWork,
 * so an event is stored if and only if the state change that caused it commits.
 * A separate relay delivers stored events at-least-once to the broker that
 * pulso-saga consumes.
 */
export interface OutboxService {
  publish(event: DomainEvent): Promise<void>;
}
