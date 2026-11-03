import { type BeforeApplicationShutdown, Inject, Injectable, Logger } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

/**
 * Drain phase of a graceful shutdown. Nest closes in this order:
 *   1. onModuleDestroy          background loops (relay, cleanup) stop
 *   2. beforeApplicationShutdown readiness turns 503 and we wait drainDelayMs so the
 *                                load balancer stops routing new traffic here
 *   3. HTTP server close         in-flight requests finish, idle keep-alives close
 *   4. onApplicationShutdown     the database pool is closed last
 */
@Injectable()
export class ShutdownState implements BeforeApplicationShutdown {
  private readonly logger = new Logger(ShutdownState.name);
  private draining = false;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  isDraining(): boolean {
    return this.draining;
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.draining = true;
    const { drainDelayMs } = this.config.shutdown;
    this.logger.log({ msg: 'draining before shutdown', signal, drainDelayMs });
    if (drainDelayMs > 0) await sleep(drainDelayMs);
  }
}
