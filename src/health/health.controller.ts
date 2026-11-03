import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';
import { Public } from '../common/http/public.decorator';
import { SkipRateLimit } from '../rate-limit/rate-limit.decorator';
import { PERSISTENCE_HEALTH, type PersistenceHealth } from '../persistence/persistence-health';

export interface HealthReport {
  status: 'ok' | 'unavailable';
  persistence: { driver: string; healthy: boolean };
}

@ApiTags('health')
@Public()
@SkipRateLimit()
@Controller('health')
export class HealthController {
  constructor(@Inject(PERSISTENCE_HEALTH) private readonly persistence: PersistenceHealth) {}

  @Get()
  @ApiOkResponse({ description: 'Service and its database are reachable' })
  @ApiServiceUnavailableResponse({ description: 'The database is unreachable' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const healthy = await this.persistence.isHealthy();
    if (!healthy) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: healthy ? 'ok' : 'unavailable',
      persistence: { driver: this.persistence.driver, healthy },
    };
  }
}
