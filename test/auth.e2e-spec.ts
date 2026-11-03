import { JwtService } from '@nestjs/jwt';
import { createTestApp, demoMerchantId, OTHER_API_KEY, OTHER_MERCHANT_ID, type TestApp, testConfig } from './test-app';

describe('auth, health and platform (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('GET /health is public', async () => {
    const res = await t.http().get('/health').expect(200);

    expect(res.body).toEqual({ status: 'ok', persistence: { driver: 'memory', healthy: true } });
  });

  it('exchanges an API key for a bearer token', async () => {
    const res = await t.http().post('/auth/token').send({ apiKey: 'pk_test_demo_merchant' }).expect(200);

    expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 300, scope: 'orders:read orders:write' });
  });

  it('rejects an unknown API key with problem+json', async () => {
    const res = await t.http().post('/auth/token').send({ apiKey: 'pk_does_not_exist' }).expect(401);

    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.headers['www-authenticate']).toBe('Bearer realm="pulso-orders"');
    expect(res.body).toMatchObject({ status: 401, title: 'Unauthorized', instance: '/auth/token' });
  });

  it('validates the token request body', async () => {
    const res = await t.http().post('/auth/token').send({ apiKey: 'pk_test_demo_merchant', scopes: ['admin'] });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: 'scopes', messages: [expect.stringContaining('scopes')] }]);
  });

  it('requires a bearer token on protected routes', async () => {
    const res = await t.http().get('/orders').expect(401);

    expect(res.body.detail).toBe('Missing bearer token');
  });

  it.each([
    ['garbage', 'Bearer not.a.jwt'],
    ['wrong scheme', 'Basic dXNlcjpwYXNz'],
  ])('rejects a %s token', async (_label, header) => {
    await t.http().get('/orders').set('Authorization', header).expect(401);
  });

  it('rejects tokens signed with another secret or issuer, or expired', async () => {
    const forged = await new JwtService({ secret: 'x'.repeat(40) }).signAsync(
      { sub: demoMerchantId, scope: 'orders:read' },
      { issuer: testConfig.jwt.issuer },
    );
    const wrongIssuer = await new JwtService({ secret: testConfig.jwt.secret }).signAsync(
      { sub: demoMerchantId, scope: 'orders:read' },
      { issuer: 'someone-else' },
    );
    const expired = await new JwtService({ secret: testConfig.jwt.secret }).signAsync(
      { sub: demoMerchantId, scope: 'orders:read', exp: Math.floor(Date.now() / 1000) - 10 },
      { issuer: testConfig.jwt.issuer },
    );

    for (const token of [forged, wrongIssuer, expired]) {
      await t.http().get('/orders').auth(token, { type: 'bearer' }).expect(401);
    }
  });

  it('enforces scopes: a read-only token cannot create orders', async () => {
    const token = await t.token(undefined, ['orders:read']);

    await t.http().get('/orders').auth(token, { type: 'bearer' }).expect(200);
    const res = await t
      .http()
      .post('/orders')
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', 'k')
      .send({})
      .expect(403);
    expect(res.body.detail).toBe('Token lacks required scope: orders:write');
  });

  it('GET /merchants/me returns the merchant bound to the token', async () => {
    const token = await t.token(OTHER_API_KEY);

    const res = await t.http().get('/merchants/me').auth(token, { type: 'bearer' }).expect(200);

    expect(res.body).toMatchObject({ id: OTHER_MERCHANT_ID, name: 'Abarrotes Doña Lupe' });
  });

  it('propagates a caller X-Request-Id and generates one otherwise', async () => {
    const propagated = await t.http().get('/health').set('X-Request-Id', 'req-abc.123');
    const generated = await t.http().get('/orders');

    expect(propagated.headers['x-request-id']).toBe('req-abc.123');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.body.requestId).toBe(generated.headers['x-request-id']);
  });

  it('ignores unsafe X-Request-Id values', async () => {
    const res = await t.http().get('/health').set('X-Request-Id', 'bad id with spaces');

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('renders unknown routes and malformed JSON as problem+json', async () => {
    const notFound = await t.http().get('/nope').expect(404);
    const malformed = await t
      .http()
      .post('/auth/token')
      .set('Content-Type', 'application/json')
      .send('{"apiKey":')
      .expect(400);

    expect(notFound.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(malformed.body).toMatchObject({ status: 400, title: 'Bad Request' });
  });

  it('serves the OpenAPI document', async () => {
    const res = await t.http().get('/docs/openapi.json').expect(200);

    expect(res.body.info.title).toBe('Pulso Orders API');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/orders', '/orders/{id}', '/orders/{id}/transitions', '/auth/token', '/health']),
    );
  });
});
