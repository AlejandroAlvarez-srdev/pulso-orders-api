import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request, type Response } from 'express';
import { CLOCK, type Clock } from '../common/clock';
import { RateLimitedError } from '../common/domain-errors';
import '../common/http/request-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { SKIP_RATE_LIMIT } from './rate-limit.decorator';
import { TokenBucketLimiter } from './token-bucket';

/**
 * Runs after JwtAuthGuard: authenticated calls spend from their merchant's
 * bucket, public ones (token exchange) from the client IP's bucket. Every
 * response carries RateLimit-Limit/Remaining; a 429 also carries Retry-After.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly merchants: TokenBucketLimiter;
  private readonly anonymous: TokenBucketLimiter;

  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) clock: Clock,
  ) {
    this.merchants = new TokenBucketLimiter(config.rateLimit.merchant, clock);
    this.anonymous = new TokenBucketLimiter(config.rateLimit.anonymous, clock);
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.rateLimit.enabled) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const result = req.principal
      ? this.merchants.take(`merchant:${req.principal.merchantId}`)
      : this.anonymous.take(`ip:${req.ip ?? 'unknown'}`);

    res.setHeader('RateLimit-Limit', String(result.limit));
    res.setHeader('RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
    return true;
  }
}
