import { type Merchant } from './merchant';
import { type MerchantsRepository } from './merchants.repository';

export class InMemoryMerchantsRepository implements MerchantsRepository {
  private readonly merchants = new Map<string, Merchant>();

  constructor(seed: Merchant[] = []) {
    seed.forEach((m) => this.add(m));
  }

  add(merchant: Merchant): void {
    this.merchants.set(merchant.id, { ...merchant });
  }

  async findById(id: string): Promise<Merchant | null> {
    const merchant = this.merchants.get(id);
    return merchant ? { ...merchant } : null;
  }

  async findByApiKeyHash(apiKeyHash: string): Promise<Merchant | null> {
    for (const merchant of this.merchants.values()) {
      if (merchant.apiKeyHash === apiKeyHash) return { ...merchant };
    }
    return null;
  }
}
