import { createTestApp, newKey, orderBody, type TestApp } from './test-app';

describe('metrics (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('exposes Prometheus metrics for HTTP latency, orders and the outbox', async () => {
    const token = await t.token();
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
      .send({ status: 'CANCELLED' })
      .expect(200);
    await t.http().get(`/orders/${created.body.id}`).auth(token, { type: 'bearer' }).expect(200);
    await t.http().get('/does-not-exist').expect(404);

    const res = await t.http().get('/metrics').expect(200);

    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    const text = res.text;
    expect(text).toMatch(/http_request_duration_seconds_count\{method="GET",route="\/orders\/:id",status_code="200"\} 1/);
    expect(text).toMatch(/http_request_duration_seconds_count\{method="GET",route="unmatched",status_code="404"\} 1/);
    expect(text).toContain('orders_created_total 1');
    expect(text).toContain('order_status_transitions_total{from="CREATED",to="CANCELLED"} 1');
    expect(text).toContain('orders_by_status{status="CANCELLED"} 1');
    expect(text).toContain('orders_by_status{status="CREATED"} 0');
    expect(text).toContain('outbox_pending_events 2');
    expect(text).toContain('process_cpu_user_seconds_total');
  });

  it('is public and not part of the OpenAPI document', async () => {
    const doc = await t.http().get('/docs/openapi.json').expect(200);

    expect(Object.keys(doc.body.paths)).not.toContain('/metrics');
  });
});
