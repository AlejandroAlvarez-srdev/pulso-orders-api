import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { type Response } from 'express';
import { Public } from '../common/http/public.decorator';
import { SkipRateLimit } from '../rate-limit/rate-limit.decorator';
import { MetricsService } from './metrics.service';

/** Prometheus scrape endpoint. Expose it on the internal network only. */
@ApiExcludeController()
@Public()
@SkipRateLimit()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(@Res({ passthrough: true }) res: Response): Promise<string> {
    res.type(this.metrics.registry.contentType);
    return this.metrics.registry.metrics();
  }
}
