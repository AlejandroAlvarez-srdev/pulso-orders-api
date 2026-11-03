import { type DomainEvent } from './domain-event';
import { type OutboxService } from './outbox.service';
import {
  type DeliveryOutcome,
  type DrainResult,
  type OutboxRelayStore,
  type PendingOutboxEvent,
} from './relay/outbox-relay.store';

interface OutboxRow {
  event: DomainEvent;
  publishedAt: Date | null;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
}

/** In-memory outbox table: written through the unit of work, drained by the relay. */
export class InMemoryOutboxService implements OutboxService, OutboxRelayStore {
  private readonly rows: OutboxRow[] = [];
  /** Rows claimed by an in-flight drain; the in-memory analogue of FOR UPDATE SKIP LOCKED. */
  private readonly claimed = new Set<string>();

  async publish(event: DomainEvent): Promise<void> {
    this.appendSync(event);
  }

  appendSync(event: DomainEvent): void {
    this.rows.push({
      event: structuredClone(event),
      publishedAt: null,
      attempts: 0,
      nextAttemptAt: event.occurredAt,
      lastError: null,
    });
  }

  /** Every event recorded, in commit order, whether or not it was delivered yet. */
  stored(): readonly DomainEvent[] {
    return this.rows.map((row) => row.event);
  }

  /** Delivery state of one event, for assertions. */
  state(eventId: string): Omit<OutboxRow, 'event'> | undefined {
    const row = this.rows.find((r) => r.event.id === eventId);
    return row && { publishedAt: row.publishedAt, attempts: row.attempts, nextAttemptAt: row.nextAttemptAt, lastError: row.lastError };
  }

  async countPending(): Promise<number> {
    return this.rows.filter((row) => row.publishedAt === null).length;
  }

  async drain(
    limit: number,
    now: Date,
    deliver: (pending: PendingOutboxEvent) => Promise<DeliveryOutcome>,
  ): Promise<DrainResult> {
    const batch = this.claimDue(limit, now);
    batch.forEach((row) => this.claimed.add(row.event.id));
    const result: DrainResult = { published: 0, failed: 0 };
    try {
      for (const row of batch) {
        const outcome = await deliver({ event: structuredClone(row.event), attempts: row.attempts });
        row.attempts += 1;
        if (outcome.status === 'published') {
          row.publishedAt = now;
          row.lastError = null;
          result.published++;
        } else {
          row.nextAttemptAt = outcome.retryAt;
          row.lastError = outcome.error;
          result.failed++;
        }
      }
    } finally {
      batch.forEach((row) => this.claimed.delete(row.event.id));
    }
    return result;
  }

  /** The unit of work only appends here, so rolling back means dropping the appended rows. */
  snapshot(): () => void {
    const length = this.rows.length;
    return () => {
      this.rows.length = length;
    };
  }

  private claimDue(limit: number, now: Date): OutboxRow[] {
    const pending = this.rows.filter((row) => row.publishedAt === null);
    return pending
      .filter((row) => !this.claimed.has(row.event.id) && row.nextAttemptAt.getTime() <= now.getTime())
      .filter((row) => {
        // Hold back an event while an earlier one of the same aggregate is undelivered.
        const first = pending.find((p) => p.event.aggregateId === row.event.aggregateId);
        return first === row;
      })
      .slice(0, limit);
  }
}
