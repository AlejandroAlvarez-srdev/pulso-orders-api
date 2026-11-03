import { type Prisma } from '@prisma/client';
import { type DomainEvent } from './domain-event';
import { type OutboxService } from './outbox.service';

/** Appends events to `outbox_events`; a relay marks them `published_at` once delivered. */
export class PrismaOutboxService implements OutboxService {
  /** Accepts the root client or an interactive-transaction client. */
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  async publish(event: DomainEvent): Promise<void> {
    await this.prisma.outboxEvent.create({
      data: {
        id: event.id,
        type: event.type,
        aggregateId: event.aggregateId,
        occurredAt: event.occurredAt,
        payload: event.payload as Prisma.InputJsonValue,
      },
    });
  }
}
