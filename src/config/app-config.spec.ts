import { ConfigError, loadConfig } from './app-config';

const secret = 'x'.repeat(32);

describe('loadConfig', () => {
  it('applies defaults for the in-memory driver', () => {
    const config = loadConfig({ PERSISTENCE: 'memory', JWT_SECRET: secret });

    expect(config).toMatchObject({
      port: 3000,
      persistence: 'memory',
      jwt: { secret, issuer: 'pulso-orders-api', ttlSeconds: 3600 },
    });
  });

  it('requires DATABASE_URL for the prisma driver', () => {
    expect(() => loadConfig({ PERSISTENCE: 'prisma', JWT_SECRET: secret })).toThrow(ConfigError);
  });

  it('rejects unknown persistence drivers', () => {
    expect(() => loadConfig({ PERSISTENCE: 'mongo', JWT_SECRET: secret })).toThrow(/PERSISTENCE/);
  });

  it('rejects short JWT secrets', () => {
    expect(() => loadConfig({ PERSISTENCE: 'memory', JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('configures the outbox relay', () => {
    const config = loadConfig({
      PERSISTENCE: 'memory',
      JWT_SECRET: secret,
      OUTBOX_RELAY_ENABLED: 'false',
      EVENTS_WEBHOOK_URL: 'http://saga.internal/events',
    });

    expect(config.outboxRelay).toMatchObject({ enabled: false, batchSize: 50, webhookUrl: 'http://saga.internal/events' });
  });

  it('rejects malformed booleans and URLs', () => {
    expect(() => loadConfig({ PERSISTENCE: 'memory', JWT_SECRET: secret, OUTBOX_RELAY_ENABLED: 'yes' })).toThrow(
      /OUTBOX_RELAY_ENABLED/,
    );
    expect(() => loadConfig({ PERSISTENCE: 'memory', JWT_SECRET: secret, EVENTS_WEBHOOK_URL: 'nope' })).toThrow(
      /EVENTS_WEBHOOK_URL/,
    );
  });

  it('allows disabling the shutdown drain delay', () => {
    const config = loadConfig({ PERSISTENCE: 'memory', JWT_SECRET: secret, SHUTDOWN_DRAIN_DELAY_MS: '0' });

    expect(config.shutdown).toEqual({ drainDelayMs: 0, timeoutMs: 25_000 });
  });

  it('rejects non-numeric ports', () => {
    expect(() => loadConfig({ PERSISTENCE: 'memory', JWT_SECRET: secret, PORT: 'abc' })).toThrow(/PORT/);
  });
});
