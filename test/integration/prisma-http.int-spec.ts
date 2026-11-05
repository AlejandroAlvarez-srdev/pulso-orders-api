import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { OutboxRelay } from '../../src/outbox/relay/outbox-relay';
import { EVENT_PUBLISHER, type EventPublisher } from '../../src/outbox/relay/event-publisher';
import { type WireEvent } from '../../src/outbox/wire-format';
import { PrismaService } from '../../src/persistence/prisma.service';
import { orderBody, testConfig } from '../test-app';
import { databaseUrl, DEMO_API_KEY, resetDatabase } from './db';

/** The real HTTP pipeline with PERSISTENCE=prisma: the same flows the e2e suite runs in memory. */
describe('HTTP API on PostgreSQL', () => {
  const delivered: WireEvent[] = [];
  const publisher: EventPublisher = { publish: async (event) => void delivered.push(event) };
  let app: INestApplication<App>;
  let relay: OutboxRelay;
  let db: PrismaService;
  let token: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot({ ...testConfig, persistence: 'prisma', databaseUrl: databaseUrl() })],
    })
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(publisher)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
    configureApp(app);
    await app.init();
    relay = moduleRef.get(OutboxRelay);
    // The app's own client: assertions read through the same pool the API writes with.
    db = moduleRef.get(PrismaService);
    await resetDatabase(db);
    const res = await http().post('/auth/token').send({ apiKey: DEMO_API_KEY }).expect(200);
    token = res.body.accessToken as string;
  });

  afterAll(async () => {
    // Closing the app disconnects its PrismaService.
    await app.close();
  });

  it('reports ready when the database answers', async () => {
    await http().get('/health/ready').expect(200);
  });

  it('creates once per Idempotency-Key and replays the stored response byte for byte', async () => {
    const send = (body: object) =>
      http().post('/orders').auth(token, { type: 'bearer' }).set('Idempotency-Key', 'int-key-1').send(body);

    const first = await send(orderBody()).expect(201);
    const replay = await send(orderBody()).expect(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.text).toBe(first.text);
    await send(orderBody({ amountCents: 1 })).expect(422);

    expect(await db.order.count({ where: { id: first.body.id } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { aggregateId: first.body.id } })).toBe(1);
  });

  it('enforces If-Match with the version column and writes the cancellation to the outbox', async () => {
    const created = await http()
      .post('/orders')
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', 'int-key-2')
      .send(orderBody())
      .expect(201);
    const id = created.body.id as string;

    const patched = await http()
      .patch(`/orders/${id}`)
      .auth(token, { type: 'bearer' })
      .set('If-Match', '"v0"')
      .send({ amountCents: 20_000 })
      .expect(200);
    expect(patched.headers.etag).toBe('"v1"');
    await http().patch(`/orders/${id}`).auth(token, { type: 'bearer' }).set('If-Match', '"v0"').send({ amountCents: 1 }).expect(412);

    await http()
      .post(`/orders/${id}/transitions`)
      .auth(token, { type: 'bearer' })
      .set('If-Match', '"v1"')
      .send({ status: 'CANCELLED', reason: 'Customer changed their mind' })
      .expect(200);

    const row = await db.order.findUniqueOrThrow({ where: { id } });
    expect({ status: row.status, version: row.version, amountCents: row.amountCents }).toEqual({
      status: 'CANCELLED',
      version: 2,
      amountCents: 20_000,
    });

    delivered.length = 0;
    await relay.drainAvailable();
    expect(delivered.filter((e) => e.aggregateId === id).map((e) => e.type)).toEqual(['order.created', 'order.cancelled']);
  });

  it('pages through orders newest first with an opaque cursor', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: request.Response = await http()
        .get('/orders')
        .query({ limit: 1, ...(cursor ? { cursor } : {}) })
        .auth(token, { type: 'bearer' })
        .expect(200);
      seen.push(...(res.body.data as { id: string }[]).map((o) => o.id));
      cursor = res.body.nextCursor as string | null;
    } while (cursor);

    const rows = await db.order.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    expect(seen).toEqual(rows.map((r) => r.id));
  });
});
