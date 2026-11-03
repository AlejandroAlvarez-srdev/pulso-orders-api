import { type PrismaService } from '../persistence/prisma.service';
import { type Merchant } from './merchant';
import { type MerchantsRepository } from './merchants.repository';

export class PrismaMerchantsRepository implements MerchantsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Merchant | null> {
    return this.prisma.merchant.findUnique({ where: { id } });
  }

  findByApiKeyHash(apiKeyHash: string): Promise<Merchant | null> {
    return this.prisma.merchant.findUnique({ where: { apiKeyHash } });
  }
}
