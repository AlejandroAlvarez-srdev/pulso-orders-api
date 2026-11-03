import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new ConsoleLogger({ json: true });
  const app = await NestFactory.create(AppModule.forRoot(config), { logger });
  configureApp(app, { trustProxy: config.trustProxy });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`received ${signal}, shutting down`, 'Bootstrap');
    const deadline = setTimeout(() => {
      logger.error(`shutdown exceeded ${config.shutdown.timeoutMs}ms, forcing exit`, undefined, 'Bootstrap');
      process.exit(1);
    }, config.shutdown.timeoutMs);
    deadline.unref();
    await app.close();
    logger.log('shutdown complete', 'Bootstrap');
  };
  process.once('SIGTERM', (signal) => void shutdown(signal));
  process.once('SIGINT', (signal) => void shutdown(signal));

  await app.listen(config.port);
  logger.log(`pulso-orders-api listening on :${config.port} (persistence=${config.persistence})`, 'Bootstrap');
}

void bootstrap();
