import { type Server } from 'node:http';
import { PERSISTENCE_HEALTH, type PersistenceHealth } from '../src/persistence/persistence-health';
import { createTestApp, testConfig } from './test-app';

describe('health and graceful shutdown (e2e)', () => {
  it('reports liveness and readiness separately', async () => {
    const t = await createTestApp();

    await t.http().get('/health/live').expect(200, { status: 'ok' });
    await t.http().get('/health/ready').expect(200);

    await t.app.close();
  });

  it('turns readiness to 503 while draining, keeps liveness green, then closes', async () => {
    const t = await createTestApp({ config: { shutdown: { ...testConfig.shutdown, drainDelayMs: 400 } } });
    const server = t.app.getHttpServer() as Server;
    await new Promise<void>((resolve) => server.listen(0, resolve));

    const closing = t.app.close();
    await new Promise((r) => setTimeout(r, 50));

    const ready = await t.http().get('/health/ready');
    const live = await t.http().get('/health/live');
    expect(ready.status).toBe(503);
    expect(ready.body).toMatchObject({ status: 'draining' });
    expect(live.status).toBe(200);

    await closing;
    expect(server.listening).toBe(false);
  });

  it('reports unavailable when the database check fails', async () => {
    const t = await createTestApp();
    jest.spyOn(t.app.get<PersistenceHealth>(PERSISTENCE_HEALTH), 'isHealthy').mockResolvedValue(false);

    const res = await t.http().get('/health/ready').expect(503);

    expect(res.body).toEqual({ status: 'unavailable', persistence: { driver: 'memory', healthy: false } });
    await t.http().get('/health/live').expect(200);
    await t.app.close();
  });
});
