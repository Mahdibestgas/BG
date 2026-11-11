import { Body, Controller, Delete, Get, Inject, Param } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { Db } from './db';
import { AppError, Context, isUuid, Roles, str, type Ctx } from './http';
import { newApiKey } from './security';

const MAX_ACTIVE = 20;

/** Owners manage the company's API keys. A key can never manage keys: these routes do not accept them. */
@Controller('api/keys')
export class ApiKeysController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get() @Roles('owner')
  async list(@Context() ctx: Ctx) {
    const rows = await this.db.inTenant(ctx.tenantId, (tx) => tx.apiKey.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true, prefix: true, createdAt: true, expiresAt: true, lastUsedAt: true, revokedAt: true } }));
    return { ok: true, keys: rows.map((k) => ({ ...k, active: !k.revokedAt && k.expiresAt > new Date() })) };
  }

  /** The key is returned once, here, and never again: only its hash is stored. */
  @Post() @Roles('owner')
  async create(@Context() ctx: Ctx, @Body() b: any) {
    const name = str(b?.name, 'name', 60);
    const days = b?.days === undefined ? 365 : Number(b.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new AppError('invalid_number:days');
    const k = newApiKey();
    const row = await this.db.inTenant(ctx.tenantId, async (tx) => {
      const active = await tx.apiKey.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } });
      if (active >= MAX_ACTIVE) throw new AppError('too_many_keys', 409);
      const r = await tx.apiKey.create({ data: { tenantId: ctx.tenantId, name, prefix: k.prefix, hash: k.hash, createdBy: ctx.accountId, expiresAt: new Date(Date.now() + days * 86_400_000) } });
      await tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: ctx.accountId, action: 'api_key_created', entity: 'api_key', entityId: r.id, changes: { name, prefix: k.prefix, days } } });
      return r;
    });
    return { ok: true, key: k.key, id: row.id, prefix: k.prefix, expiresAt: row.expiresAt };
  }

  @Delete(':id') @Roles('owner')
  async revoke(@Context() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw new AppError('not_found', 404);
    await this.db.inTenant(ctx.tenantId, async (tx) => {
      const k = await tx.apiKey.findUnique({ where: { id } });
      if (!k) throw new AppError('not_found', 404);
      if (!k.revokedAt) {
        await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
        await tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: ctx.accountId, action: 'api_key_revoked', entity: 'api_key', entityId: id, changes: { name: k.name, prefix: k.prefix } } });
      }
    });
    return { ok: true };
  }
}
