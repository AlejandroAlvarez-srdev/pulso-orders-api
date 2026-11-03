import { type DomainEvent } from './domain-event';
import { type OutboxService } from './outbox.service';

export class InMemoryOutboxService implements OutboxService {
  private readonly events: DomainEvent[] = [];

  async publish(event: DomainEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }

  /** Events in publication order; what a relay would drain. */
  published(): readonly DomainEvent[] {
    return this.events;
  }
}
