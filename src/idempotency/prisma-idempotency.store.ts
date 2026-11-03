import { Prisma, type IdempotencyKey } from '@prisma/client';
import { type PrismaService } from '../persistence/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  async reserve(merchantId: string, key: string, requestHash: string, at: Date): Promise<ReserveResult> {
    try {
      await this.prisma.idempotencyKey.create({ data: { merchantId, key, requestHash, createdAt: at } });
      return { reserved: true };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== UNIQUE_VIOLATION) throw error;
      const existing = await this.prisma.idempotencyKey.findUniqueOrThrow({
        where: { merchantId_key: { merchantId, key } },
      });
      return { reserved: false, existing: toRecord(existing) };
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
}
