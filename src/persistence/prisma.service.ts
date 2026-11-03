import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { type PersistenceHealth } from './persistence-health';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy, PersistenceHealth {
  readonly driver = 'prisma';

  constructor(databaseUrl: string) {
    super({ datasources: { db: { url: databaseUrl } } });
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
