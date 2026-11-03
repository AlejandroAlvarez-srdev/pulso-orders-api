import { type DynamicModule, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './config/app-config';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
      global: true,
    };
  }
}
