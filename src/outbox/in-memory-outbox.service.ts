import { type DomainEvent } from './domain-event';
import { type OutboxService } from './outbox.service';

export class InMemoryOutboxService implements OutboxService {
  private events: DomainEvent[] = [];

  async publish(event: DomainEvent): Promise<void> {
    this.appendSync(event);
  }

  appendSync(event: DomainEvent): void {
    this.events.push(structuredClone(event));
  }

  /** Events in commit order; what a relay would drain. */
  published(): readonly DomainEvent[] {
    return this.events;
  }

  snapshot(): () => void {
    const saved = [...this.events];
    return () => {
      this.events = saved;
    };
  }
}
