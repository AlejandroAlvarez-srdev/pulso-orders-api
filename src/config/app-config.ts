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
  /** Express `trust proxy`: set when running behind a load balancer so req.ip is the client. */
  trustProxy: boolean;
  rateLimit: {
    enabled: boolean;
    /** Per authenticated merchant. */
    merchant: { capacity: number; refillPerSecond: number };
    /** Per client IP on public endpoints such as POST /auth/token. */
    anonymous: { capacity: number; refillPerSecond: number };
  };
  idempotency: {
    /** How long a key (and its stored response) stays valid. */
    ttlSeconds: number;
    cleanupEnabled: boolean;
    cleanupIntervalMs: number;
  };
  outboxRelay: {
    enabled: boolean;
    intervalMs: number;
    batchSize: number;
    retryBaseMs: number;
    retryMaxMs: number;
    /** When set, events are POSTed here; otherwise they are written to the log. */
    webhookUrl?: string;
  };
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

function readBool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new ConfigError(`${key} must be true or false, got "${raw}"`);
}

function readUrl(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key];
  if (!raw) return undefined;
  try {
    return new URL(raw).toString();
  } catch {
    throw new ConfigError(`${key} must be an absolute URL, got "${raw}"`);
  }
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
    trustProxy: readBool(env, 'TRUST_PROXY', false),
    rateLimit: {
      enabled: readBool(env, 'RATE_LIMIT_ENABLED', true),
      merchant: {
        capacity: readInt(env, 'RATE_LIMIT_CAPACITY', 60),
        refillPerSecond: readInt(env, 'RATE_LIMIT_REFILL_PER_SECOND', 10),
      },
      anonymous: {
        capacity: readInt(env, 'RATE_LIMIT_ANON_CAPACITY', 10),
        refillPerSecond: readInt(env, 'RATE_LIMIT_ANON_REFILL_PER_SECOND', 1),
      },
    },
    idempotency: {
      ttlSeconds: readInt(env, 'IDEMPOTENCY_TTL_SECONDS', 24 * 3600),
      cleanupEnabled: readBool(env, 'IDEMPOTENCY_CLEANUP_ENABLED', true),
      cleanupIntervalMs: readInt(env, 'IDEMPOTENCY_CLEANUP_INTERVAL_MS', 3600_000),
    },
    outboxRelay: {
      enabled: readBool(env, 'OUTBOX_RELAY_ENABLED', true),
      intervalMs: readInt(env, 'OUTBOX_RELAY_INTERVAL_MS', 1000),
      batchSize: readInt(env, 'OUTBOX_RELAY_BATCH_SIZE', 50),
      retryBaseMs: readInt(env, 'OUTBOX_RELAY_RETRY_BASE_MS', 1000),
      retryMaxMs: readInt(env, 'OUTBOX_RELAY_RETRY_MAX_MS', 5 * 60_000),
      webhookUrl: readUrl(env, 'EVENTS_WEBHOOK_URL'),
    },
  };
}
