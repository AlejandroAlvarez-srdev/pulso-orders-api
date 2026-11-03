import { createTestApp, newKey, orderBody, type TestApp } from './test-app';

describe('ETag / If-Match (e2e)', () => {
  let t: TestApp;
  let token: string;

  beforeAll(async () => {
    t = await createTestApp();
    token = await t.token();
  });

  afterAll(async () => {
    await t.app.close();
  });

  const createOrder = async () =>
    (
      await t
        .http()
        .post('/orders')
        .auth(token, { type: 'bearer' })
        .set('Idempotency-Key', newKey())
        .send(orderBody())
        .expect(201)
    ).body as { id: string };

  const patch = (id: string, body: object, ifMatch?: string) => {
    const req = t.http().patch(`/orders/${id}`).auth(token, { type: 'bearer' });
    return (ifMatch === undefined ? req : req.set('If-Match', ifMatch)).send(body);
  };

  const newDropoff = { lat: 19.3467, lng: -99.1617, address: 'Francisco Sosa 30, Coyoacán' };

  it('returns an ETag on create and read, and 304 for a matching If-None-Match', async () => {
    const created = await t
      .http()
      .post('/orders')
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', newKey())
      .send(orderBody())
      .expect(201);
    expect(created.headers.etag).toBe('"v0"');

    const read = await t.http().get(`/orders/${created.body.id}`).auth(token, { type: 'bearer' }).expect(200);
    expect(read.headers.etag).toBe('"v0"');

    await t
      .http()
      .get(`/orders/${created.body.id}`)
      .auth(token, { type: 'bearer' })
      .set('If-None-Match', '"v0"')
      .expect(304);
  });

  it('requires If-Match on PATCH (428)', async () => {
    const { id } = await createOrder();

    const res = await patch(id, { dropoff: newDropoff }).expect(428);

    expect(res.body.type).toBe('https://docs.pulso.example/problems/precondition-required');
  });

  it('applies a PATCH with the current ETag and returns the next one', async () => {
    const { id } = await createOrder();

    const res = await patch(id, { dropoff: newDropoff, amountCents: 21_500 }, '"v0"').expect(200);

    expect(res.headers.etag).toBe('"v1"');
    expect(res.body).toMatchObject({ dropoff: newDropoff, amountCents: 21_500, status: 'CREATED' });
  });

  it('rejects a PATCH with a stale ETag (412), so concurrent editors cannot overwrite each other', async () => {
    const { id } = await createOrder();
    await patch(id, { amountCents: 100 }, '"v0"').expect(200);

    const res = await patch(id, { amountCents: 200 }, '"v0"').expect(412);

    expect(res.body.type).toBe('https://docs.pulso.example/problems/precondition-failed');
    const current = await t.http().get(`/orders/${id}`).auth(token, { type: 'bearer' }).expect(200);
    expect(current.body.amountCents).toBe(100);
  });

  it('rejects an unparseable If-Match with 412', async () => {
    const { id } = await createOrder();

    await patch(id, { amountCents: 100 }, 'v0').expect(412);
  });

  it('validates the PATCH body', async () => {
    const { id } = await createOrder();

    await patch(id, {}, '"v0"').expect(400);
    await patch(id, { status: 'PAID' }, '"v0"').expect(400);
    await patch(id, { items: [] }, '"v0"').expect(400);
  });

  it('refuses edits once the order left CREATED (409)', async () => {
    const { id } = await createOrder();
    await t
      .http()
      .post(`/orders/${id}/transitions`)
      .auth(token, { type: 'bearer' })
      .send({ status: 'PAYMENT_PENDING' })
      .expect(200);

    const res = await patch(id, { amountCents: 1 }, '"v1"').expect(409);

    expect(res.body.type).toBe('https://docs.pulso.example/problems/order-not-editable');
  });

  it('honours If-Match on transitions', async () => {
    const { id } = await createOrder();
    const transition = (ifMatch: string) =>
      t
        .http()
        .post(`/orders/${id}/transitions`)
        .auth(token, { type: 'bearer' })
        .set('If-Match', ifMatch)
        .send({ status: 'CANCELLED' });

    await transition('"v3"').expect(412);
    const ok = await transition('"v0"').expect(200);
    expect(ok.headers.etag).toBe('"v1"');
  });
});
