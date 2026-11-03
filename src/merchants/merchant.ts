import { createHash } from 'node:crypto';

export interface Merchant {
  id: string;
  name: string;
  /** SHA-256 hex digest of the merchant API key; the raw key is never stored. */
  apiKeyHash: string;
  createdAt: Date;
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

/** Seeded by the in-memory driver and by prisma/seed.sql. */
export const DEMO_MERCHANT = {
  id: '6f1c2b7a-3d4e-4f5a-8b9c-0d1e2f3a4b5c',
  name: 'Tienda Demo CDMX',
} as const;
