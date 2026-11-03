import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ShutdownState } from './shutdown-state';

@Module({ controllers: [HealthController], providers: [ShutdownState] })
export class HealthModule {}
