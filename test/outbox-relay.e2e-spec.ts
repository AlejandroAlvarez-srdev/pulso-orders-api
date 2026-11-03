import { type EventPublisher } from '../src/outbox/relay/event-publisher';
import { type WireEvent } from '../src/outbox/wire-format';
import { createTestApp, newKey, orderBody, type TestApp } from './test-app';

describe('outbox relay (e2e)', () => {
  const delivered: WireEvent[] = [];
  const publisher: EventPublisher = { publish: async (event) => void delivered.push(event) };
  let t: TestApp;
  let token: string;

  beforeAll(async () => {
    t = await createTestApp({ publisher });
    token = await t.token();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('delivers order.created and order.cancelled after the HTTP calls commit', async () => {
    const created = await t
      .http()
      .post('/orders')
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', newKey())
      .send(orderBody())
      .expect(201);
    await t
      .http()
      .post(`/orders/${created.body.id}/transitions`)
      .auth(token, { type: 'bearer' })
      .send({ status: 'CANCELLED', reason: 'Duplicate order' })
      .expect(200);

    expect(delivered).toHaveLength(0);
    // One event per aggregate per drain keeps per-order ordering strict.
    expect(await t.relay.runOnce()).toEqual({ published: 1, failed: 0 });
    expect(await t.relay.runOnce()).toEqual({ published: 1, failed: 0 });

    expect(delivered.map((e) => [e.type, e.aggregateId])).toEqual([
      ['order.created', created.body.id],
      ['order.cancelled', created.body.id],
    ]);
    expect(delivered[1].data).toMatchObject({ previousStatus: 'CREATED', reason: 'Duplicate order' });
  });
});
