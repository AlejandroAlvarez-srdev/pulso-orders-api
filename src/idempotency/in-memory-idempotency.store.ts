import {
  type IdempotencyRecord,
  type IdempotencyStore,
  type ReserveResult,
  type StoredResponse,
} from './idempotency.store';

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private records = new Map<string, IdempotencyRecord>();

  private static id(merchantId: string, key: string): string {
    return `${merchantId}\u0000${key}`;
  }

  async reserve(merchantId: string, key: string, requestHash: string, at: Date): Promise<ReserveResult> {
    const id = InMemoryIdempotencyStore.id(merchantId, key);
    const existing = this.records.get(id);
    if (existing) return { reserved: false, existing: structuredClone(existing) };
    this.records.set(id, { merchantId, key, requestHash, response: null, createdAt: at });
    return { reserved: true };
  }

  async complete(merchantId: string, key: string, response: StoredResponse): Promise<void> {
    this.completeSync(merchantId, key, response);
  }

  async release(merchantId: string, key: string): Promise<void> {
    this.records.delete(InMemoryIdempotencyStore.id(merchantId, key));
  }

  completeSync(merchantId: string, key: string, response: StoredResponse): void {
    const id = InMemoryIdempotencyStore.id(merchantId, key);
    const record = this.records.get(id);
    if (!record) throw new Error(`No idempotency reservation for key "${key}"`);
    this.records.set(id, { ...record, response: structuredClone(response) });
  }

  snapshot(): () => void {
    const saved = new Map(this.records);
    return () => {
      this.records = saved;
    };
  }
}
