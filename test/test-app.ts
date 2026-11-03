import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { type AppConfig } from '../src/config/app-config';
import { InMemoryMerchantsRepository } from '../src/merchants/in-memory-merchants.repository';
import { DEMO_MERCHANT, hashApiKey } from '../src/merchants/merchant';
import { MERCHANTS_REPOSITORY } from '../src/merchants/merchants.repository';
import { InMemoryOutboxService } from '../src/outbox/in-memory-outbox.service';

export const DEMO_API_KEY = 'pk_test_demo_merchant';
export const OTHER_API_KEY = 'pk_test_other_merchant';
export const OTHER_MERCHANT_ID = '2a9d4c1e-8b7f-4e3a-9c2d-1f0e9d8c7b6a';

export const testConfig: AppConfig = {
  port: 0,
  persistence: 'memory',
  jwt: { secret: 'e2e-secret-that-is-long-enough-123456', issuer: 'pulso-orders-api-test', ttlSeconds: 300 },
  demoMerchantApiKey: DEMO_API_KEY,
};

export interface TestApp {
  app: INestApplication<App>;
  outbox: InMemoryOutboxService;
  /** Fresh agent per call so headers never leak between requests. */
  http: () => ReturnType<typeof request>;
  token: (apiKey?: string, scopes?: string[]) => Promise<string>;
}

/** Boots the real application wiring (pipes, filters, guards) on in-memory adapters. */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(testConfig)] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app);
  await app.init();

  moduleRef.get<InMemoryMerchantsRepository>(MERCHANTS_REPOSITORY).add({
    id: OTHER_MERCHANT_ID,
    name: 'Abarrotes Doña Lupe',
    apiKeyHash: hashApiKey(OTHER_API_KEY),
    createdAt: new Date(),
  });

  const http = () => request(app.getHttpServer());
  return {
    app,
    outbox: moduleRef.get(InMemoryOutboxService),
    http,
    token: async (apiKey = DEMO_API_KEY, scopes?: string[]) => {
      const res = await http().post('/auth/token').send({ apiKey, scopes }).expect(200);
      return res.body.accessToken as string;
    },
  };
}

export const demoMerchantId = DEMO_MERCHANT.id;

export const orderBody = (overrides: Record<string, unknown> = {}) => ({
  pickup: { lat: 19.4326, lng: -99.1332, address: 'Farmacia Roma, Álvaro Obregón 120' },
  dropoff: { lat: 19.4115, lng: -99.1694, address: 'Ámsterdam 45, Condesa' },
  items: [{ sku: 'FARM-PARA-500', name: 'Paracetamol 500 mg', qty: 2 }],
  amountCents: 18_950,
  currency: 'MXN',
  ...overrides,
});

export const newKey = (): string => randomUUID();
