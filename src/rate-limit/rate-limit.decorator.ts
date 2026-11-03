import { SetMetadata } from '@nestjs/common';

export const SKIP_RATE_LIMIT = 'pulso:skipRateLimit';

/** For probes and scrapers (health, metrics) that must never be throttled. */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_RATE_LIMIT, true);
