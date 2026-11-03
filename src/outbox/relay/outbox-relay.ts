import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { PeriodicTask } from '../../common/periodic-task';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { toWireEvent } from '../wire-format';
import { backoffDelayMs } from './backoff';
import { EVENT_PUBLISHER, type EventPublisher } from './event-publisher';
import { type DeliveryOutcome, type DrainResult, OUTBOX_RELAY_STORE, type OutboxRelayStore } from './outbox-relay.store';

/**
 * Moves committed outbox rows to the publisher, at-least-once. Failed
 * deliveries are retried with capped exponential backoff; consumers
 * deduplicate on the event id.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly task: PeriodicTask;

  constructor(
    @Inject(OUTBOX_RELAY_STORE) private readonly store: OutboxRelayStore,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.task = new PeriodicTask('OutboxRelay', config.outboxRelay.intervalMs, () => this.drainAvailable());
  }

  onModuleInit(): void {
    if (this.config.outboxRelay.enabled) this.task.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.task.stop();
  }

  /**
   * Keeps draining while progress is made (bounded), so a backlog or a chain of
   * events for one order — released one per drain to keep their order — clears
   * within a single tick instead of one event per interval.
   */
  async drainAvailable(maxRounds = 10): Promise<DrainResult> {
    const total: DrainResult = { published: 0, failed: 0 };
    for (let round = 0; round < maxRounds; round++) {
      const result = await this.runOnce();
      total.published += result.published;
      total.failed += result.failed;
      if (result.published === 0) break;
    }
    return total;
  }

  /** Drains one batch. */
  async runOnce(): Promise<DrainResult> {
    const { batchSize, retryBaseMs, retryMaxMs } = this.config.outboxRelay;
    const now = this.clock.now();
    const result = await this.store.drain(batchSize, now, async ({ event, attempts }): Promise<DeliveryOutcome> => {
      try {
        await this.publisher.publish(toWireEvent(event));
        return { status: 'published' };
      } catch (error) {
        const delay = backoffDelayMs(attempts + 1, { baseMs: retryBaseMs, maxMs: retryMaxMs });
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn({ msg: 'event delivery failed', eventId: event.id, attempt: attempts + 1, retryInMs: delay, error: message });
        return { status: 'failed', retryAt: new Date(now.getTime() + delay), error: message };
      }
    });
    if (result.published || result.failed) this.logger.log({ msg: 'outbox drained', ...result });
    return result;
  }
}
