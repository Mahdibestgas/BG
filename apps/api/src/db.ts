import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

/**
 * The API's only database client. It connects as cf13_app, which cannot bypass
 * row-level security; boot fails if it could. Company data is reached only
 * through inTenant(), which pins the transaction to one company.
 */
@Injectable()
export class Db extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Db');

  constructor() {
    const url = process.env.DATABASE_APP_URL;
    if (!url) throw new Error('DATABASE_APP_URL is not set');
    super({ datasourceUrl: url });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    const [role] = await this.$queryRaw<Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>>`
      SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    if (!role || role.rolsuper || role.rolbypassrls) {
      throw new Error(`FATAL: connected as "${role?.rolname}", which can bypass row-level security. Use the cf13_app role.`);
    }
    this.log.log(`Database role "${role.rolname}" verified: row-level security is enforced`);
  }

  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }

  /** One transaction, one company. The setting is transaction-local, so it cannot leak to the next request. */
  inTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    }, { timeout: 20_000, maxWait: 5_000 });
  }
}
