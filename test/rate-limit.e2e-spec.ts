import { createTestApp, DEMO_API_KEY, OTHER_API_KEY, type TestApp } from './test-app';

describe('rate limiting (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      config: {
        rateLimit: {
          enabled: true,
          merchant: { capacity: 3, refillPerSecond: 1 },
          anonymous: { capacity: 4, refillPerSecond: 1 },
        },
      },
    });
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('throttles a merchant after its burst with 429, Retry-After and problem+json', async () => {
    const token = await t.token(DEMO_API_KEY);
    const statuses: number[] = [];
    let last;
    for (let i = 0; i < 4; i++) {
      last = await t.http().get('/orders').auth(token, { type: 'bearer' });
      statuses.push(last.status);
    }

    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(last!.headers['retry-after']).toBe('1');
    expect(last!.headers['ratelimit-limit']).toBe('3');
    expect(last!.headers['ratelimit-remaining']).toBe('0');
    expect(last!.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(last!.body).toMatchObject({ status: 429, type: 'https://docs.pulso.example/problems/rate-limited', retryAfter: 1 });
  });

  it('keeps merchants isolated from each other', async () => {
    const other = await t.token(OTHER_API_KEY);

    await t.http().get('/orders').auth(other, { type: 'bearer' }).expect(200);
  });

  it('limits the public token endpoint per client IP', async () => {
    // Two tokens were already issued above from this IP; the bucket holds 4.
    await t.http().post('/auth/token').send({ apiKey: DEMO_API_KEY }).expect(200);
    await t.http().post('/auth/token').send({ apiKey: 'pk_wrong_key_1' }).expect(401);
    const res = await t.http().post('/auth/token').send({ apiKey: DEMO_API_KEY }).expect(429);

    expect(res.headers['retry-after']).toBeDefined();
  });

  it('authenticates before limiting: a missing token is a 401 even with the IP bucket empty', async () => {
    await t.http().get('/orders').expect(401);
  });

  it('never throttles health checks', async () => {
    for (let i = 0; i < 10; i++) await t.http().get('/health/ready').expect(200);
  });
});
