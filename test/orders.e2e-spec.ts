import { randomUUID } from 'node:crypto';
import { createTestApp, demoMerchantId, newKey, orderBody, OTHER_API_KEY, type TestApp } from './test-app';

describe('orders (e2e)', () => {
  let t: TestApp;
  let token: string;

  beforeAll(async () => {
    t = await createTestApp();
    token = await t.token();
  });

  afterAll(async () => {
    await t.app.close();
  });

  const create = (body: object = orderBody(), key: string = newKey(), as = token) =>
    t.http().post('/orders').auth(as, { type: 'bearer' }).set('Idempotency-Key', key).send(body);

  const transition = (id: string, status: string, reason?: string) =>
    t.http().post(`/orders/${id}/transitions`).auth(token, { type: 'bearer' }).send({ status, reason });

  describe('POST /orders', () => {
    it('creates an order', async () => {
      const res = await create().expect(201);

      expect(res.body).toMatchObject({ merchantId: demoMerchantId, status: 'CREATED', amountCents: 18_950 });
      expect(res.body).not.toHaveProperty('version');
      expect(res.headers.location).toBe(`/orders/${res.body.id}`);
      expect(res.headers['idempotency-replayed']).toBe('false');
    });

    it('requires an Idempotency-Key header', async () => {
      const res = await t.http().post('/orders').auth(token, { type: 'bearer' }).send(orderBody()).expect(400);

      expect(res.body).toMatchObject({
        type: 'https://docs.pulso.example/problems/validation-failed',
        errors: [{ field: 'Idempotency-Key', messages: ['Idempotency-Key header is required'] }],
      });
    });

    it('reports every invalid field with its path', async () => {
      const res = await create(
        orderBody({
          pickup: { lat: 120, lng: -99.1, address: 'Somewhere 1' },
          items: [{ sku: 'A', name: 'Tortillas', qty: 0 }],
          currency: 'USD',
          tip: 500,
        }),
      ).expect(400);

      const fields = res.body.errors.map((e: { field: string }) => e.field);
      expect(fields).toEqual(expect.arrayContaining(['pickup.lat', 'items.0.qty', 'currency', 'tip']));
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    });

    it('rejects an empty items list', async () => {
      const res = await create(orderBody({ items: [] })).expect(400);

      expect(res.body.errors).toEqual([{ field: 'items', messages: ['items must contain at least 1 elements'] }]);
    });

    describe('idempotency', () => {
      it('returns the same response for the same key and body, without creating twice', async () => {
        const key = newKey();
        const eventsBefore = t.outbox.published().length;

        const first = await create(orderBody(), key).expect(201);
        const replay = await create(orderBody(), key).expect(201);

        expect(replay.body).toEqual(first.body);
        expect(replay.headers['idempotency-replayed']).toBe('true');
        expect(replay.headers.location).toBe(first.headers.location);
        expect(t.outbox.published()).toHaveLength(eventsBefore + 1);
      });

      it('returns the original snapshot even after the order has moved on', async () => {
        const key = newKey();
        const first = await create(orderBody(), key).expect(201);
        await transition(first.body.id, 'CANCELLED').expect(200);

        const replay = await create(orderBody(), key).expect(201);

        expect(replay.body.status).toBe('CREATED');
      });

      it('rejects the same key with a different body (422)', async () => {
        const key = newKey();
        await create(orderBody(), key).expect(201);

        const res = await create(orderBody({ amountCents: 99 }), key).expect(422);

        expect(res.body.type).toBe('https://docs.pulso.example/problems/idempotency-key-reused');
      });

      it('scopes keys per merchant', async () => {
        const key = newKey();
        const other = await t.token(OTHER_API_KEY);

        const mine = await create(orderBody(), key).expect(201);
        const theirs = await create(orderBody(), key, other).expect(201);

        expect(theirs.headers['idempotency-replayed']).toBe('false');
        expect(theirs.body.id).not.toBe(mine.body.id);
      });
    });
  });

  describe('GET /orders/:id', () => {
    it('returns the merchant’s order', async () => {
      const { body } = await create().expect(201);

      const res = await t.http().get(`/orders/${body.id}`).auth(token, { type: 'bearer' }).expect(200);

      expect(res.body).toEqual(body);
    });

    it('returns 404 for another merchant’s order', async () => {
      const { body } = await create().expect(201);
      const other = await t.token(OTHER_API_KEY);

      await t.http().get(`/orders/${body.id}`).auth(other, { type: 'bearer' }).expect(404);
    });

    it('returns 400 for a malformed id', async () => {
      await t.http().get('/orders/123').auth(token, { type: 'bearer' }).expect(400);
    });
  });

  describe('POST /orders/:id/transitions', () => {
    it('walks the full lifecycle', async () => {
      const { body } = await create().expect(201);

      for (const status of ['PAYMENT_PENDING', 'PAID', 'ASSIGNED', 'IN_PROGRESS', 'DELIVERED']) {
        const res = await transition(body.id, status).expect(200);
        expect(res.body.status).toBe(status);
      }
    });

    it('returns 409 problem+json with the allowed targets for an invalid transition', async () => {
      const { body } = await create().expect(201);

      const res = await transition(body.id, 'DELIVERED').expect(409);

      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(res.body).toMatchObject({
        type: 'https://docs.pulso.example/problems/invalid-transition',
        status: 409,
        from: 'CREATED',
        to: 'DELIVERED',
        allowed: ['PAYMENT_PENDING', 'CANCELLED'],
        instance: `/orders/${body.id}/transitions`,
      });
    });

    it('treats terminal statuses as final', async () => {
      const { body } = await create().expect(201);
      await transition(body.id, 'CANCELLED').expect(200);

      const res = await transition(body.id, 'PAYMENT_PENDING').expect(409);

      expect(res.body.allowed).toEqual([]);
    });

    it('cannot cancel once the task is in progress', async () => {
      const { body } = await create().expect(201);
      for (const status of ['PAYMENT_PENDING', 'PAID', 'ASSIGNED', 'IN_PROGRESS']) {
        await transition(body.id, status).expect(200);
      }

      await transition(body.id, 'CANCELLED').expect(409);
    });

    it('publishes order.cancelled with the reason', async () => {
      const { body } = await create().expect(201);
      await transition(body.id, 'PAYMENT_PENDING').expect(200);

      await transition(body.id, 'CANCELLED', 'Customer changed their mind').expect(200);

      expect(t.outbox.published().at(-1)).toMatchObject({
        type: 'order.cancelled',
        aggregateId: body.id,
        payload: { previousStatus: 'PAYMENT_PENDING', reason: 'Customer changed their mind' },
      });
    });

    it('rejects unknown target statuses', async () => {
      const { body } = await create().expect(201);

      const res = await transition(body.id, 'TELEPORTED').expect(400);

      expect(res.body.errors[0].field).toBe('status');
    });

    it('returns 404 for unknown orders', async () => {
      await transition(randomUUID(), 'CANCELLED').expect(404);
    });
  });

  describe('GET /orders (pagination)', () => {
    let paging: TestApp;
    let pagingToken: string;
    const created: string[] = [];

    beforeAll(async () => {
      paging = await createTestApp();
      pagingToken = await paging.token();
      for (let i = 0; i < 7; i++) {
        const res = await paging
          .http()
          .post('/orders')
          .auth(pagingToken, { type: 'bearer' })
          .set('Idempotency-Key', `page-${i}`)
          .send(orderBody({ amountCents: 1000 + i }))
          .expect(201);
        created.push(res.body.id);
      }
      for (const id of created.slice(0, 3)) {
        await paging
          .http()
          .post(`/orders/${id}/transitions`)
          .auth(pagingToken, { type: 'bearer' })
          .send({ status: 'CANCELLED' })
          .expect(200);
      }
    });

    afterAll(async () => {
      await paging.app.close();
    });

    const list = (query: Record<string, string | number>) =>
      paging.http().get('/orders').auth(pagingToken, { type: 'bearer' }).query(query);

    it('walks every page exactly once, newest first', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: { body: { data: { id: string }[]; nextCursor: string | null } } = await list(
          cursor ? { limit: 3, cursor } : { limit: 3 },
        ).expect(200);
        seen.push(...res.body.data.map((o) => o.id));
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor);

      expect(pages).toBe(3);
      expect(seen).toEqual([...created].reverse());
    });

    it('defaults to 20 items and returns a null cursor on the last page', async () => {
      const res = await list({}).expect(200);

      expect(res.body.data).toHaveLength(7);
      expect(res.body.nextCursor).toBeNull();
    });

    it('filters by status and paginates within the filter', async () => {
      const first = await list({ status: 'CANCELLED', limit: 2 }).expect(200);
      const second = await list({ status: 'CANCELLED', limit: 2, cursor: first.body.nextCursor }).expect(200);

      const ids = [...first.body.data, ...second.body.data].map((o: { id: string }) => o.id);
      expect(ids).toEqual(created.slice(0, 3).reverse());
      expect(second.body.nextCursor).toBeNull();
    });

    it('does not leak orders across merchants', async () => {
      const other = await paging.token(OTHER_API_KEY);

      const res = await paging.http().get('/orders').auth(other, { type: 'bearer' }).expect(200);

      expect(res.body).toEqual({ data: [], nextCursor: null });
    });

    it.each([
      [{ limit: 0 }, 'limit'],
      [{ limit: 101 }, 'limit'],
      [{ limit: 'ten' }, 'limit'],
      [{ status: 'LOST' }, 'status'],
    ])('rejects invalid query %p', async (query, field) => {
      const res = await list(query as Record<string, string | number>).expect(400);

      expect(res.body.errors[0].field).toBe(field);
    });

    it('rejects a tampered cursor', async () => {
      const res = await list({ cursor: 'eyJub3QiOiJ2YWxpZCJ9' }).expect(400);

      expect(res.body.type).toBe('https://docs.pulso.example/problems/invalid-cursor');
    });
  });
});
