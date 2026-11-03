import { type Prisma } from '@prisma/client';
import { type PrismaService } from '../persistence/prisma.service';
import { type DomainEvent } from './domain-event';
import { type OutboxService } from './outbox.service';

/** Appends events to `outbox_events`; a relay marks them `published_at` once delivered. */
export class PrismaOutboxService implements OutboxService {
  constructor(private readonly prisma: PrismaService) {}

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
