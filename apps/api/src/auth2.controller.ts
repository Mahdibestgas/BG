import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Db } from './db';
import { AppError, Context, Public, str, type Ctx } from './http';
import { hashPassword, SESSION_COOKIE, SESSION_HOURS, sha256, signSession, verifyPassword, type Role } from './security';
import { newTotpSecret, openSecret, otpauthUri, sealSecret, verifyTotp } from './totp';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
function newPassword(v: unknown): string {
  const p = typeof v === 'string' ? v : '';
  if (p.length < 12) throw new AppError('weak_password');
  if (p.length > 200) throw new AppError('too_long:password');
  return p;
}
const cookie = (res: Response, token: string) => res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_HOURS * 3600 * 1000 });

/** Joining a company by invitation, resetting a password by an owner-issued link, and two-factor set-up. */
@Controller('api/auth')
export class Auth2Controller {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ---- invitations (the link is made by an owner in the Members screen)
  /** What an invitation link is for, so the screen can greet the person. Reveals only the company name, role and the invited email. */
  @Public() @Post('invite/peek')
  async peek(@Body() b: any) {
    const inv = await this.invite(b?.token);
    const exists = !!(await this.db.account.findUnique({ where: { email: inv.email }, select: { id: true } }));
    return { ok: true, company: inv.tenant_name, role: inv.role, email: inv.email, existingAccount: exists };
  }

  /** Accept: a new person chooses a name and password; an existing account proves itself with its password. Either way the membership is created in one transaction. */
  @Public() @Post('invite/accept')
  async accept(@Body() b: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const inv = await this.invite(b?.token);
    let acc = await this.db.account.findUnique({ where: { email: inv.email } });
    if (acc) {
      if (!(await verifyPassword(typeof b?.password === 'string' ? b.password : '', acc.passwordHash))) throw new AppError('invalid_credentials', 401);
      if (acc.totpEnabled) throw new AppError('sign_in_first', 409);   // someone with two-factor signs in normally, then switches: keep it simple and safe
    } else {
      acc = await this.db.account.create({ data: { email: inv.email, name: str(b?.name, 'name', 120), passwordHash: await hashPassword(newPassword(b?.password)), language: b?.language === 'ar' ? 'ar' : 'en' } });
    }
    const accountId = acc.id;
    await this.db.inTenant(inv.tenant_id, async (tx) => {
      const used = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date() } });
      if (used.count !== 1) throw new AppError('invalid_invite', 410);
      await tx.membership.upsert({ where: { tenantId_accountId: { tenantId: inv.tenant_id, accountId } }, create: { tenantId: inv.tenant_id, accountId, role: inv.role }, update: {} });
      await tx.auditEntry.create({ data: { tenantId: inv.tenant_id, actorId: accountId, action: 'invite_accepted', entity: 'invitation', entityId: inv.id, changes: { email: inv.email, role: inv.role, ip: req.ip } } });
    });
    cookie(res, signSession({ sub: accountId, tid: inv.tenant_id, role: inv.role as Role, ep: acc.sessionEpoch }));
    return { ok: true, tenantId: inv.tenant_id };
  }

  private async invite(token: unknown) {
    const t = typeof token === 'string' && /^cf13i_[A-Za-z0-9_-]{20,80}$/.test(token) ? token : '';
    const rows = t ? await this.db.$queryRaw<Array<{ id: string; tenant_id: string; email: string; role: string; tenant_name: string }>>`SELECT * FROM invite_lookup(${sha256(t)})` : [];
    if (!rows.length) throw new AppError('invalid_invite', 410);
    return rows[0];
  }

  // ---- password reset by an owner-issued link
  @Public() @Post('reset')
  async reset(@Body() b: any, @Res({ passthrough: true }) res: Response) {
    const t = typeof b?.token === 'string' && /^cf13r_[A-Za-z0-9_-]{20,80}$/.test(b.token) ? b.token : '';
    const next = newPassword(b?.password);
    const tok = t ? await this.db.resetToken.findUnique({ where: { tokenHash: sha256(t) } }) : null;
    if (!tok || tok.usedAt || tok.expiresAt < new Date()) throw new AppError('invalid_reset', 410);
    const claimed = await this.db.resetToken.updateMany({ where: { id: tok.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new AppError('invalid_reset', 410);
    // a new password ends every session and clears any lock; two-factor stays on
    await this.db.account.update({ where: { id: tok.accountId }, data: { passwordHash: await hashPassword(next), sessionEpoch: { increment: 1 }, failedLogins: 0, lockedUntil: null } });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  // ---- two-factor
  @Get('totp')
  async status(@Context() ctx: Ctx) {
    const a = await this.db.account.findUniqueOrThrow({ where: { id: ctx.accountId }, select: { totpEnabled: true, recoveryCodes: true } });
    return { ok: true, enabled: a.totpEnabled, recoveryLeft: ((a.recoveryCodes as string[] | null) || []).length };
  }

  /** Step 1: a fresh secret (kept unconfirmed). The person adds it to an authenticator app, then confirms with a code. */
  @Post('totp/setup')
  async setup(@Context() ctx: Ctx) {
    const a = await this.db.account.findUniqueOrThrow({ where: { id: ctx.accountId } });
    if (a.totpEnabled) throw new AppError('totp_already_on', 409);
    const secret = newTotpSecret();
    await this.db.account.update({ where: { id: a.id }, data: { totpSecret: sealSecret(secret) } });
    return { ok: true, secret, uri: otpauthUri(secret, a.email) };
  }

  /** Step 2: prove the app works. Turns two-factor on and returns eight recovery codes, once. */
  @Post('totp/enable')
  async enable(@Context() ctx: Ctx, @Body() b: any) {
    const a = await this.db.account.findUniqueOrThrow({ where: { id: ctx.accountId } });
    if (a.totpEnabled || !a.totpSecret) throw new AppError('totp_not_ready', 409);
    const step = verifyTotp(openSecret(a.totpSecret), String(b?.code ?? '').replace(/\s/g, ''));
    if (step === null) throw new AppError('invalid_code', 400);
    const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
    await this.db.account.update({ where: { id: a.id }, data: { totpEnabled: true, totpLastStep: step, recoveryCodes: codes.map((c) => sha256(c)) } });
    await this.db.inTenant(ctx.tenantId, (tx) => tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: a.id, action: 'totp_enabled' } }));
    return { ok: true, recoveryCodes: codes };
  }

  /** Turning it off needs the password and a current code (or a recovery code), so a stolen session cannot remove it. */
  @Post('totp/disable')
  async disable(@Context() ctx: Ctx, @Body() b: any, @Res({ passthrough: true }) res: Response) {
    const a = await this.db.account.findUniqueOrThrow({ where: { id: ctx.accountId } });
    if (!a.totpEnabled || !a.totpSecret) throw new AppError('totp_not_ready', 409);
    if (!(await verifyPassword(typeof b?.password === 'string' ? b.password : '', a.passwordHash))) throw new AppError('wrong_current_password', 403);
    const code = String(b?.code ?? '').replace(/\s|-/g, '');
    const okTotp = /^\d{6}$/.test(code) && verifyTotp(openSecret(a.totpSecret), code) !== null;
    const okRecovery = !okTotp && ((a.recoveryCodes as string[] | null) || []).includes(sha256(code.toLowerCase()));
    if (!okTotp && !okRecovery) throw new AppError('invalid_code', 400);
    const upd = await this.db.account.update({ where: { id: a.id }, data: { totpEnabled: false, totpSecret: null, totpLastStep: null, recoveryCodes: Prisma.DbNull, sessionEpoch: { increment: 1 } } });
    await this.db.inTenant(ctx.tenantId, (tx) => tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: a.id, action: 'totp_disabled' } }));
    cookie(res, signSession({ sub: a.id, tid: ctx.tenantId, role: ctx.role, ep: upd.sessionEpoch }));
    return { ok: true };
  }
}
