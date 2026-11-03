import { type DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CLOCK, systemClock } from './common/clock';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { HealthModule } from './health/health.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { MetricsModule } from './metrics/metrics.module';
import { MerchantsModule } from './merchants/merchants.module';
import { OrdersModule } from './orders/orders.module';
import { OutboxModule } from './outbox/outbox.module';
import { PersistenceModule } from './persistence/persistence.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        PersistenceModule.register(config),
        MetricsModule,
        AuthModule, MerchantsModule, OrdersModule, OutboxModule, IdempotencyModule, HealthModule],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: CLOCK, useValue: systemClock },
      ],
      exports: [APP_CONFIG, CLOCK],
    };
  }
}
