import { randomUUID } from 'node:crypto';
import { DEMO_MERCHANT, hashApiKey } from '../../src/merchants/merchant';
import { type Order, OrderStatus } from '../../src/orders/domain/order';
import { PrismaService } from '../../src/persistence/prisma.service';

export const DEMO_API_KEY = 'pk_integration_demo_merchant';

/** Required: jest.integration.config.js refuses to start without it. */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must point at a migrated PostgreSQL database');
  return url;
}

export function connect(): PrismaService {
  return new PrismaService(databaseUrl());
}

/** Empties every table and seeds the demo merchant. Suites run in band, so this is race-free. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE outbox_events, idempotency_keys, orders, merchants CASCADE');
  await prisma.merchant.create({
    data: { id: DEMO_MERCHANT.id, name: DEMO_MERCHANT.name, apiKeyHash: hashApiKey(DEMO_API_KEY) },
  });
}

export function newOrder(overrides: Partial<Order> = {}): Order {
  const at = new Date('2026-06-01T10:00:00.000Z');
  return {
    id: randomUUID(),
    merchantId: DEMO_MERCHANT.id,
    status: OrderStatus.CREATED,
    pickup: { lat: 19.4326, lng: -99.1332, address: 'Mercado de Medellín, Roma Sur' },
    dropoff: { lat: 19.4115, lng: -99.1694, address: 'Ámsterdam 45, Condesa' },
    items: [{ sku: 'ABAR-CAFE-250', name: 'Café molido 250 g', qty: 1 }],
    amountCents: 12_500,
    currency: 'MXN',
    createdAt: at,
    updatedAt: at,
    version: 0,
    ...overrides,
  };
}
