import { type Order as OrderRow, type Prisma } from '@prisma/client';
import { type Currency, type Location, type Order, type OrderItem, type OrderStatus } from './domain/order';
import { type ListOrdersQuery, type OrdersPage, type OrdersRepository } from './orders.repository';

function toDomain(row: OrderRow): Order {
  return {
    id: row.id,
    merchantId: row.merchantId,
    status: row.status as OrderStatus,
    pickup: row.pickup as unknown as Location,
    dropoff: row.dropoff as unknown as Location,
    items: row.items as unknown as OrderItem[],
    amountCents: row.amountCents,
    currency: row.currency as Currency,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

export class PrismaOrdersRepository implements OrdersRepository {
  /** Accepts the root client or an interactive-transaction client. */
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  async insert(order: Order): Promise<void> {
    await this.prisma.order.create({
      data: {
        ...order,
        pickup: order.pickup as unknown as Prisma.InputJsonObject,
        dropoff: order.dropoff as unknown as Prisma.InputJsonObject,
        items: order.items as unknown as Prisma.InputJsonArray,
      },
    });
  }

  async findById(id: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async list({ merchantId, status, limit, after }: ListOrdersQuery): Promise<OrdersPage> {
    const where: Prisma.OrderWhereInput = {
      merchantId,
      ...(status ? { status } : {}),
      ...(after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {}),
    };
    // Fetch one extra row to learn whether another page exists.
    const rows = await this.prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit).map(toDomain);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  async updateStatus(id: string, expectedVersion: number, status: OrderStatus, at: Date): Promise<Order | null> {
    const { count } = await this.prisma.order.updateMany({
      where: { id, version: expectedVersion },
      data: { status, updatedAt: at, version: { increment: 1 } },
    });
    return count === 1 ? this.findById(id) : null;
  }
}
