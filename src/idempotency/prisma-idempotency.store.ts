import { Prisma, type IdempotencyKey } from '@prisma/client';
import {
  type IdempotencyRecord,
  type IdempotencyStore,
  type ReserveResult,
  type StoredResponse,
} from './idempotency.store';

const UNIQUE_VIOLATION = 'P2002';

function toRecord(row: IdempotencyKey): IdempotencyRecord {
  return {
    merchantId: row.merchantId,
    key: row.key,
    requestHash: row.requestHash,
    response:
      row.responseStatus === null || row.responseBody === null
        ? null
        : { statusCode: row.responseStatus, body: JSON.parse(row.responseBody) as unknown },
    createdAt: row.createdAt,
  };
}

/** Atomicity comes from the (merchant_id, key) primary key: the INSERT either wins or conflicts. */
export class PrismaIdempotencyStore implements IdempotencyStore {
  /** Accepts the root client or an interactive-transaction client. */
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  async reserve(
    merchantId: string,
    key: string,
    requestHash: string,
    at: Date,
    expiredBefore: Date,
  ): Promise<ReserveResult> {
    const existing = await this.tryInsert(merchantId, key, requestHash, at);
    if (!existing) return { reserved: true };
    if (existing.createdAt >= expiredBefore) return { reserved: false, existing: toRecord(existing) };

    // Expired: drop it (only if still expired, in case another request just replaced it) and retry once.
    await this.prisma.idempotencyKey.deleteMany({ where: { merchantId, key, createdAt: { lt: expiredBefore } } });
    const raced = await this.tryInsert(merchantId, key, requestHash, at);
    return raced ? { reserved: false, existing: toRecord(raced) } : { reserved: true };
  }

  /** Inserts the reservation, or returns the row that already holds the key. */
  private async tryInsert(merchantId: string, key: string, requestHash: string, at: Date): Promise<IdempotencyKey | null> {
    try {
      await this.prisma.idempotencyKey.create({ data: { merchantId, key, requestHash, createdAt: at } });
      return null;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== UNIQUE_VIOLATION) throw error;
      return this.prisma.idempotencyKey.findUniqueOrThrow({ where: { merchantId_key: { merchantId, key } } });
    }
  }

  async complete(merchantId: string, key: string, response: StoredResponse): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { merchantId_key: { merchantId, key } },
      data: { responseStatus: response.statusCode, responseBody: JSON.stringify(response.body) },
    });
  }

  async release(merchantId: string, key: string): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({ where: { merchantId, key } });
  }

  async purgeExpired(expiredBefore: Date): Promise<number> {
    const { count } = await this.prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: expiredBefore } } });
    return count;
  }
}
