import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new ConsoleLogger({ json: true });
  const app = await NestFactory.create(AppModule.forRoot(config), { logger });
  app.enableShutdownHooks();
  await app.listen(config.port);
  logger.log(`pulso-orders-api listening on :${config.port} (persistence=${config.persistence})`, 'Bootstrap');
}

void bootstrap();
