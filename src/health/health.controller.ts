import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';
import { Public } from '../common/http/public.decorator';
import { PERSISTENCE_HEALTH, type PersistenceHealth } from '../persistence/persistence-health';
import { SkipRateLimit } from '../rate-limit/rate-limit.decorator';
import { ShutdownState } from './shutdown-state';

export interface LivenessReport {
  status: 'ok';
}

export interface ReadinessReport {
  status: 'ready' | 'unavailable' | 'draining';
  persistence: { driver: string; healthy: boolean };
}

@ApiTags('health')
@Public()
@SkipRateLimit()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PERSISTENCE_HEALTH) private readonly persistence: PersistenceHealth,
    private readonly shutdown: ShutdownState,
  ) {}

  /**
   * Liveness: the process can serve HTTP. Deliberately ignores dependencies so
   * a database outage does not get every replica restarted at once.
   */
  @Get('live')
  @ApiOkResponse({ description: 'The process is running' })
  live(): LivenessReport {
    return { status: 'ok' };
  }

  /** Readiness: send traffic here. False while draining or when the database is unreachable. */
  @Get('ready')
  @ApiOkResponse({ description: 'Ready to receive traffic' })
  @ApiServiceUnavailableResponse({ description: 'Draining for shutdown, or the database is unreachable' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    const healthy = await this.persistence.isHealthy();
    const persistence = { driver: this.persistence.driver, healthy };
    const status = this.shutdown.isDraining() ? 'draining' : healthy ? 'ready' : 'unavailable';
    if (status !== 'ready') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status, persistence };
  }
}
