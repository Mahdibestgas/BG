import { Body, Controller, Get, Inject, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Db } from './db';
import { AppError, Context, Roles, type Ctx } from './http';
import { checkTheme } from './theme';

const LOGO_TYPES: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/webp': [0x52, 0x49, 0x46, 0x46]
};
const LOGO_MAX = 512 * 1024;

@Controller('api/tenant')
export class TenantController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get()
  async get(@Context() ctx: Ctx) {
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { id: true, slug: true, name: true, nameAr: true, template: true, status: true } });
      const b = await tx.branding.findUnique({ where: { tenantId: ctx.tenantId }, select: { theme: true, logoType: true, updatedAt: true } });
      return { ok: true, tenant: t, theme: b?.theme ?? null, hasLogo: !!b?.logoType, brandingVersion: b?.updatedAt ?? null };
    });
  }

  /** The logo itself, only ever to a member of its company. */
  @Get('logo')
  async logo(@Context() ctx: Ctx, @Res() res: Response) {
    const b = await this.db.inTenant(ctx.tenantId, (tx) => tx.branding.findUnique({ where: { tenantId: ctx.tenantId }, select: { logo: true, logoType: true } }));
    if (!b?.logo || !b.logoType) throw new AppError('not_found', 404);
    res.set({ 'Content-Type': b.logoType, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    res.send(Buffer.from(b.logo));
  }

  /** Logo (PNG/JPEG/WebP, by its real bytes, not its name) and the theme the browser derived from it. */
  @Put('branding') @Roles('owner')
  async branding(@Context() ctx: Ctx, @Body() b: any) {
    const theme = checkTheme(b?.theme);
    let logo: Buffer | undefined, logoType: string | undefined;
    if (b?.logo !== undefined) {
      if (typeof b.logo !== 'string' || typeof b.logoType !== 'string' || !LOGO_TYPES[b.logoType]) throw new AppError('logo_type');
      logo = Buffer.from(b.logo, 'base64');
      if (!logo.length || logo.length > LOGO_MAX) throw new AppError('logo_size');
      if (!LOGO_TYPES[b.logoType].every((byte, i) => logo![i] === byte)) throw new AppError('logo_type');
      logoType = b.logoType;
    }
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      const data: any = { theme };
      if (logo) { data.logo = logo; data.logoType = logoType; }
      await tx.branding.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...data }, update: data });
      await tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: ctx.accountId, action: 'branding_saved', changes: { theme, logo: logo ? logo.length + ' bytes' : 'unchanged' } } });
      return { ok: true };
    });
  }
}

@Controller('api/audit')
export class AuditController {
  constructor(@Inject(Db) private readonly db: Db) {}
  @Get() @Roles('owner', 'finance')
  async list(@Context() ctx: Ctx) {
    const rows = await this.db.inTenant(ctx.tenantId, (tx) => tx.auditEntry.findMany({ orderBy: { at: 'desc' }, take: 200 }));
    return { ok: true, audit: rows.map((a) => ({ at: a.at, action: a.action, actorId: a.actorId, entity: a.entity, entityId: a.entityId, changes: a.changes })) };
  }
}
