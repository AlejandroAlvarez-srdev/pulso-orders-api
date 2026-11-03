import { Module } from '@nestjs/common';
import { IdempotencyCleanupJob } from './idempotency-cleanup.job';

@Module({ providers: [IdempotencyCleanupJob], exports: [IdempotencyCleanupJob] })
export class IdempotencyModule {}
