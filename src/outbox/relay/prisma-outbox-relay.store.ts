import { type Prisma } from '@prisma/client';
import { type PrismaService } from '../../persistence/prisma.service';
import {
  type DeliveryOutcome,
  type DrainResult,
  type OutboxRelayStore,
  type PendingOutboxEvent,
} from './outbox-relay.store';

interface ClaimedRow {
  id: string;
  type: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  occurredAt: Date;
  attempts: number;
}

const MAX_ERROR_LENGTH = 1000;

/**
 * Claims rows with `FOR UPDATE SKIP LOCKED` inside one transaction, so several
 * relay instances can drain the same table without double delivery, and
 * records each outcome before the locks are released.
 *
 * Ordering uses `seq` (a database sequence, i.e. insertion order), not
 * `occurred_at`: the timestamp comes from the writer's clock, and replicas
 * whose clocks disagree could otherwise release order.cancelled before the
 * order.created it follows.
 */
export class PrismaOutboxRelayStore implements OutboxRelayStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionTimeoutMs = 30_000,
  ) {}

  countPending(): Promise<number> {
    return this.prisma.outboxEvent.count({ where: { publishedAt: null } });
  }

  drain(
    limit: number,
    now: Date,
    deliver: (pending: PendingOutboxEvent) => Promise<DeliveryOutcome>,
  ): Promise<DrainResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<ClaimedRow[]>`
          SELECT e.id, e.type, e.aggregate_id AS "aggregateId", e.payload, e.occurred_at AS "occurredAt", e.attempts
          FROM outbox_events e
          WHERE e.published_at IS NULL
            AND e.next_attempt_at <= ${now}
            AND NOT EXISTS (
              SELECT 1 FROM outbox_events earlier
              WHERE earlier.aggregate_id = e.aggregate_id
                AND earlier.published_at IS NULL
                AND earlier.seq < e.seq
            )
          ORDER BY e.seq
          LIMIT ${limit}
          FOR UPDATE OF e SKIP LOCKED`;

        const result: DrainResult = { published: 0, failed: 0 };
        for (const row of rows) {
          const outcome = await deliver({
            event: {
              id: row.id,
              type: row.type,
              aggregateId: row.aggregateId,
              occurredAt: row.occurredAt,
              payload: row.payload,
            },
            attempts: row.attempts,
          });
          if (outcome.status === 'published') {
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: { publishedAt: now, attempts: { increment: 1 }, lastError: null },
            });
            result.published++;
          } else {
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: {
                attempts: { increment: 1 },
                nextAttemptAt: outcome.retryAt,
                lastError: outcome.error.slice(0, MAX_ERROR_LENGTH),
              },
            });
            result.failed++;
          }
        }
        return result;
      },
      { timeout: this.transactionTimeoutMs },
    );
  }
}
