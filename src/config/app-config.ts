export type PersistenceDriver = 'memory' | 'prisma';

export interface AppConfig {
  port: number;
  persistence: PersistenceDriver;
  databaseUrl?: string;
  jwt: {
    secret: string;
    issuer: string;
    ttlSeconds: number;
  };
  /** API key of the demo merchant seeded by the in-memory driver. */
  demoMerchantApiKey: string;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

const MIN_SECRET_LENGTH = 32;

export class ConfigError extends Error {}

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${key} must be a positive integer, got "${raw}"`);
  }
  return value;
}

/**
 * Builds the typed configuration from environment variables and fails fast on
 * anything that would only blow up later at request time.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const persistence = (env.PERSISTENCE ?? 'prisma') as PersistenceDriver;
  if (persistence !== 'memory' && persistence !== 'prisma') {
    throw new ConfigError(`PERSISTENCE must be "memory" or "prisma", got "${String(persistence)}"`);
  }

  const databaseUrl = env.DATABASE_URL;
  if (persistence === 'prisma' && !databaseUrl) {
    throw new ConfigError('DATABASE_URL is required when PERSISTENCE=prisma');
  }

  const secret = env.JWT_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  return {
    port: readInt(env, 'PORT', 3000),
    persistence,
    databaseUrl,
    jwt: {
      secret,
      issuer: env.JWT_ISSUER ?? 'pulso-orders-api',
      ttlSeconds: readInt(env, 'JWT_TTL_SECONDS', 3600),
    },
    demoMerchantApiKey: env.DEMO_MERCHANT_API_KEY ?? 'pk_demo_pulso_merchant',
  };
}
