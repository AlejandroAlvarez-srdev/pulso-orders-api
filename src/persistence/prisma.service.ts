import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { type PersistenceHealth } from './persistence-health';

@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown, PersistenceHealth {
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

  /** Last shutdown step, after the HTTP server has finished in-flight requests. */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
