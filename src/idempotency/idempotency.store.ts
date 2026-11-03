export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');

export interface StoredResponse {
  statusCode: number;
  body: unknown;
}

export interface IdempotencyRecord {
  merchantId: string;
  key: string;
  /** SHA-256 of the canonical request body, used to detect key reuse. */
  requestHash: string;
  /** Null while the first request holding the key is still in flight. */
  response: StoredResponse | null;
  createdAt: Date;
}

export type ReserveResult = { reserved: true } | { reserved: false; existing: IdempotencyRecord };

/**
 * Keys are scoped per merchant. `reserve` must be atomic: exactly one caller
 * wins a given (merchantId, key) pair, everyone else sees the existing record.
 */
export interface IdempotencyStore {
  reserve(merchantId: string, key: string, requestHash: string, at: Date): Promise<ReserveResult>;
  complete(merchantId: string, key: string, response: StoredResponse): Promise<void>;
  /** Frees a reservation whose request failed so the client can retry with the same key. */
  release(merchantId: string, key: string): Promise<void>;
}
