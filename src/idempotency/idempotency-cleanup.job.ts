import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CLOCK, type Clock } from '../common/clock';
import { PeriodicTask } from '../common/periodic-task';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { IDEMPOTENCY_STORE, type IdempotencyStore } from './idempotency.store';

/** Periodically deletes idempotency records older than the TTL so the table stays bounded. */
@Injectable()
export class IdempotencyCleanupJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdempotencyCleanupJob.name);
  private readonly task: PeriodicTask;

  constructor(
    @Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.task = new PeriodicTask('IdempotencyCleanup', config.idempotency.cleanupIntervalMs, () => this.runOnce());
  }

  onModuleInit(): void {
    if (this.config.idempotency.cleanupEnabled) this.task.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.task.stop();
  }

  async runOnce(): Promise<number> {
    const expiredBefore = new Date(this.clock.now().getTime() - this.config.idempotency.ttlSeconds * 1000);
    const removed = await this.store.purgeExpired(expiredBefore);
    if (removed) this.logger.log({ msg: 'expired idempotency keys purged', removed });
    return removed;
  }
}
