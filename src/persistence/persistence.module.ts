import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { type AppConfig } from '../config/app-config';
import { IDEMPOTENCY_STORE } from '../idempotency/idempotency.store';
import { InMemoryIdempotencyStore } from '../idempotency/in-memory-idempotency.store';
import { PrismaIdempotencyStore } from '../idempotency/prisma-idempotency.store';
import { InMemoryMerchantsRepository } from '../merchants/in-memory-merchants.repository';
import { DEMO_MERCHANT, hashApiKey } from '../merchants/merchant';
import { MERCHANTS_REPOSITORY } from '../merchants/merchants.repository';
import { PrismaMerchantsRepository } from '../merchants/prisma-merchants.repository';
import { InMemoryOrdersRepository } from '../orders/in-memory-orders.repository';
import { ORDERS_REPOSITORY } from '../orders/orders.repository';
import { PrismaOrdersRepository } from '../orders/prisma-orders.repository';
import { InMemoryOutboxService } from '../outbox/in-memory-outbox.service';
import { OUTBOX_SERVICE } from '../outbox/outbox.service';
import { PrismaOutboxService } from '../outbox/prisma-outbox.service';
import { PERSISTENCE_HEALTH, type PersistenceHealth } from './persistence-health';
import { PrismaService } from './prisma.service';

const PORTS = [ORDERS_REPOSITORY, MERCHANTS_REPOSITORY, IDEMPOTENCY_STORE, OUTBOX_SERVICE, PERSISTENCE_HEALTH];

function inMemoryProviders(config: AppConfig): Provider[] {
  const health: PersistenceHealth = { driver: 'memory', isHealthy: async () => true };
  return [
    { provide: ORDERS_REPOSITORY, useValue: new InMemoryOrdersRepository() },
    {
      provide: MERCHANTS_REPOSITORY,
      useValue: new InMemoryMerchantsRepository([
        { ...DEMO_MERCHANT, apiKeyHash: hashApiKey(config.demoMerchantApiKey), createdAt: new Date() },
      ]),
    },
    { provide: IDEMPOTENCY_STORE, useValue: new InMemoryIdempotencyStore() },
    { provide: OUTBOX_SERVICE, useValue: new InMemoryOutboxService() },
    { provide: PERSISTENCE_HEALTH, useValue: health },
  ];
}

function prismaProviders(config: AppConfig): Provider[] {
  const inject = [PrismaService];
  return [
    { provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl!) },
    { provide: ORDERS_REPOSITORY, useFactory: (p: PrismaService) => new PrismaOrdersRepository(p), inject },
    { provide: MERCHANTS_REPOSITORY, useFactory: (p: PrismaService) => new PrismaMerchantsRepository(p), inject },
    { provide: IDEMPOTENCY_STORE, useFactory: (p: PrismaService) => new PrismaIdempotencyStore(p), inject },
    { provide: OUTBOX_SERVICE, useFactory: (p: PrismaService) => new PrismaOutboxService(p), inject },
    { provide: PERSISTENCE_HEALTH, useExisting: PrismaService },
  ];
}

/**
 * Binds every persistence port to either the in-memory or the Prisma adapter.
 * Swapping the driver is a configuration change; no consumer knows which one it got.
 */
@Module({})
export class PersistenceModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: PersistenceModule,
      global: true,
      providers: config.persistence === 'prisma' ? prismaProviders(config) : inMemoryProviders(config),
      exports: PORTS,
    };
  }
}
