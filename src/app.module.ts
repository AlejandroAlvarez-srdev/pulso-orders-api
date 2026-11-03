import { type DynamicModule, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { HealthModule } from './health/health.module';
import { PersistenceModule } from './persistence/persistence.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [PersistenceModule.register(config), HealthModule],
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
