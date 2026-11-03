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
import { InMemoryUnitOfWork } from './in-memory-unit-of-work';
import { PERSISTENCE_HEALTH, type PersistenceHealth } from './persistence-health';
import { PrismaUnitOfWork } from './prisma-unit-of-work';
import { PrismaService } from './prisma.service';
import { UNIT_OF_WORK } from './unit-of-work';

const PORTS = [ORDERS_REPOSITORY, MERCHANTS_REPOSITORY, IDEMPOTENCY_STORE, UNIT_OF_WORK, PERSISTENCE_HEALTH];

function inMemoryProviders(config: AppConfig): Provider[] {
  const orders = new InMemoryOrdersRepository();
  const idempotency = new InMemoryIdempotencyStore();
  const outbox = new InMemoryOutboxService();
  const health: PersistenceHealth = { driver: 'memory', isHealthy: async () => true };
  return [
    { provide: ORDERS_REPOSITORY, useValue: orders },
    {
      provide: MERCHANTS_REPOSITORY,
      useValue: new InMemoryMerchantsRepository([
        { ...DEMO_MERCHANT, apiKeyHash: hashApiKey(config.demoMerchantApiKey), createdAt: new Date() },
      ]),
    },
    { provide: IDEMPOTENCY_STORE, useValue: idempotency },
    { provide: UNIT_OF_WORK, useValue: new InMemoryUnitOfWork(orders, outbox, idempotency) },
    // Exposed by class so tests can inspect what a relay would publish.
    { provide: InMemoryOutboxService, useValue: outbox },
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
    { provide: UNIT_OF_WORK, useFactory: (p: PrismaService) => new PrismaUnitOfWork(p), inject },
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
    const memory = config.persistence === 'memory';
    return {
      module: PersistenceModule,
      global: true,
      providers: memory ? inMemoryProviders(config) : prismaProviders(config),
      exports: memory ? [...PORTS, InMemoryOutboxService] : PORTS,
    };
  }
}
