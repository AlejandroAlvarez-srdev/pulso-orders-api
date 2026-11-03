import { PrismaIdempotencyStore } from '../idempotency/prisma-idempotency.store';
import { PrismaOrdersRepository } from '../orders/prisma-orders.repository';
import { PrismaOutboxService } from '../outbox/prisma-outbox.service';
import { type PrismaService } from './prisma.service';
import { type TransactionalPorts, type UnitOfWork } from './unit-of-work';

/**
 * Runs `work` inside one interactive `prisma.$transaction`: the adapters handed
 * to it share the transaction client, so the order row, its outbox_events row
 * and the idempotency-key completion commit together or roll back together.
 */
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(work: (tx: TransactionalPorts) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((client) =>
      work({
        orders: new PrismaOrdersRepository(client),
        outbox: new PrismaOutboxService(client),
        idempotency: new PrismaIdempotencyStore(client),
      }),
    );
  }
}
