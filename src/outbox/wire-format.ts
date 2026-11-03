import { type DomainEvent } from './domain-event';

/**
 * JSON shape delivered to consumers (pulso-saga). Kept separate from the
 * in-process DomainEvent so internal refactors cannot silently change the contract.
 */
export interface WireEvent {
  id: string;
  type: string;
  specVersion: '1.0';
  source: 'pulso-orders-api';
  aggregateId: string;
  occurredAt: string;
  data: unknown;
}

export function toWireEvent(event: DomainEvent): WireEvent {
  return {
    id: event.id,
    type: event.type,
    specVersion: '1.0',
    source: 'pulso-orders-api',
    aggregateId: event.aggregateId,
    occurredAt: event.occurredAt.toISOString(),
    data: event.payload,
  };
}
