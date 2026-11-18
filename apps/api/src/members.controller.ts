import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { Db } from './db';
import { AppError, Context, isUuid, Roles, str, type Ctx } from './http';
import { newToken } from './security';
import { KSA_LPG } from '@cf13/budget';

const ROLES = ['owner', 'finance', 'viewer', 'contributor'];
/** A department head belongs to exactly one department of the company's budget pack. */
function departmentFor(role: string, v: unknown): string | null {
  if (role !== 'contributor') return null;
  const d = typeof v === 'string' ? v : '';
  if (!KSA_LPG.departments.some((x) => x.id === d)) throw new AppError('invalid_department');
  return d;
}
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

/** People in the company. Owners invite, change roles, remove, and issue password-reset links. Links are shown once. */
@Controller('api/members')
export class MembersController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get() @Roles('owner')
  async list(@Context() ctx: Ctx) {
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      const ms = await tx.membership.findMany({ orderBy: { createdAt: 'asc' }, include: { account: { select: { id: true, name: true, email: true, totpEnabled: true } } } });
      const inv = await tx.invitation.findMany({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, role: true, department: true, createdAt: true, expiresAt: true } });
      return { ok: true, you: ctx.accountId, members: ms.map((m) => ({ accountId: m.accountId, name: m.account.name, email: m.account.email, role: m.role, department: m.department, twoFactor: m.account.totpEnabled, since: m.createdAt })), invitations: inv };
    });
  }

  @Post('invites') @Roles('owner')
  async invite(@Context() ctx: Ctx, @Body() b: any) {
    const email = str(b?.email, 'email', 254).toLowerCase();
    if (!EMAIL.test(email)) throw new AppError('invalid_email');
    const role = str(b?.role, 'role', 20);
    if (!ROLES.includes(role)) throw new AppError('invalid_role');
    const department = departmentFor(role, b?.department);
    const days = b?.days === undefined ? 7 : Number(b.days);
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new AppError('invalid_number:days');
    const t = newToken('cf13i_');
    const row = await this.db.inTenant(ctx.tenantId, async (tx) => {
      if (await tx.membership.count({ where: { account: { email } } })) throw new AppError('already_member', 409);
      if (await tx.invitation.count({ where: { email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }) >= 1) throw new AppError('already_invited', 409);
      const r = await tx.invitation.create({ data: { tenantId: ctx.tenantId, email, role, department, tokenHash: t.hash, invitedBy: ctx.accountId, expiresAt: new Date(Date.now() + days * 86_400_000) } });
      await tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: ctx.accountId, action: 'invite_created', entity: 'invitation', entityId: r.id, changes: { email, role, department, days } } });
      return r;
    });
    return { ok: true, id: row.id, token: t.token, path: '/join/' + t.token, expiresAt: row.expiresAt };
  }

  @Delete('invites/:id') @Roles('owner')
  async revokeInvite(@Context() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw new AppError('not_found', 404);
    await this.db.inTenant(ctx.tenantId, async (tx) => {
      const r = await tx.invitation.updateMany({ where: { id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      if (!r.count) throw new AppError('not_found', 404);
      await tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: ctx.accountId, action: 'invite_revoked', entity: 'invitation', entityId: id } });
    });
    return { ok: true };
  }

  @Patch(':accountId') @Roles('owner')
  async setRole(@Context() ctx: Ctx, @Param('accountId') accountId: string, @Body() b: any) {
    if (!isUuid(accountId)) throw new AppError('not_found', 404);
    const role = str(b?.role, 'role', 20);
    if (!ROLES.includes(role)) throw new AppError('invalid_role');
    const department = departmentFor(role, b?.department);
    await this.db.inTenant(ctx.tenantId, async (tx) => {
      const m = await tx.membership.findFirst({ where: { accountId } });
      if (!m) throw new AppError('not_found', 404);
      if (m.role === 'owner' && role !== 'owner' && (await tx.membership.count({ where: { role: 'owner' } })) <= 1) throw new AppError('last_owner', 409);
      await tx.membership.update({ where: { id: m.id }, data: { role, department } });
      await tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: ctx.accountId, action: 'member_role_changed', entity: 'account', entityId: accountId, changes: { from: m.role, to: role, department } } });
    });
    return { ok: true };
  }

  /** Removing someone ends their access at once: the guard re-checks the membership on every request. */
  @Delete(':accountId') @Roles('owner')
  async remove(@Context() ctx: Ctx, @Param('accountId') accountId: string) {
    if (!isUuid(accountId)) throw new AppError('not_found', 404);
    await this.db.inTenant(ctx.tenantId, async (tx) => {
      const m = await tx.membership.findFirst({ where: { accountId } });
      if (!m) throw new AppError('not_found', 404);
      if (m.role === 'owner' && (await tx.membership.count({ where: { role: 'owner' } })) <= 1) throw new AppError('last_owner', 409);
      await tx.membership.delete({ where: { id: m.id } });
      await tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: ctx.accountId, action: 'member_removed', entity: 'account', entityId: accountId, changes: { role: m.role } } });
    });
    return { ok: true };
  }

  /** A one-time link for a member who forgot their password, valid one hour. The owner passes it on; no email is sent from here. */
  @Post(':accountId/reset') @Roles('owner')
  async resetLink(@Context() ctx: Ctx, @Param('accountId') accountId: string) {
    if (!isUuid(accountId)) throw new AppError('not_found', 404);
    const m = await this.db.inTenant(ctx.tenantId, (tx) => tx.membership.findFirst({ where: { accountId } }));
    if (!m) throw new AppError('not_found', 404);
    const t = newToken('cf13r_');
    await this.db.resetToken.create({ data: { accountId, tokenHash: t.hash, createdBy: ctx.accountId, expiresAt: new Date(Date.now() + 3_600_000) } });
    await this.db.inTenant(ctx.tenantId, (tx) => tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: ctx.accountId, action: 'reset_link_issued', entity: 'account', entityId: accountId } }));
    return { ok: true, token: t.token, path: '/reset/' + t.token, expiresInMinutes: 60 };
  }
}
