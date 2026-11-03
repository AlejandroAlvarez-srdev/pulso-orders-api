import { type Merchant } from './merchant';

export const MERCHANTS_REPOSITORY = Symbol('MERCHANTS_REPOSITORY');

export interface MerchantsRepository {
  findById(id: string): Promise<Merchant | null>;
  findByApiKeyHash(apiKeyHash: string): Promise<Merchant | null>;
}
