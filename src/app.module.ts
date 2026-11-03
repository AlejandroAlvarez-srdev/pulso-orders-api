import { type DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { HealthModule } from './health/health.module';
import { MerchantsModule } from './merchants/merchants.module';
import { PersistenceModule } from './persistence/persistence.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [PersistenceModule.register(config), AuthModule, MerchantsModule, HealthModule],
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
