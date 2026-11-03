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

  it('rejects non-numeric ports', () => {
    expect(() => loadConfig({ PERSISTENCE: 'memory', JWT_SECRET: secret, PORT: 'abc' })).toThrow(/PORT/);
  });
});
