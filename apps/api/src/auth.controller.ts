import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { starterModel, TEMPLATES } from '@cf13/engine';
import { Db } from './db';
import { AppError, Context, Public, str, type Ctx } from './http';
import { decoyHash, hashPassword, LOCK_AFTER, LOCK_MINUTES, SESSION_COOKIE, SESSION_HOURS, signSession, verifyPassword, type Role } from './security';
import { DEFAULT_THEME } from './theme';
import { firebaseWebConfig, verifyFirebaseToken } from './firebase';
import { requireSecondFactor } from './secondfactor';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
function email(v: unknown): string {
  const e = str(v, 'email', 254).toLowerCase();
  if (!EMAIL.test(e)) throw new AppError('invalid_email');
  return e;
}
function newPassword(v: unknown): string {
  const p = typeof v === 'string' ? v : '';
  if (p.length < 12) throw new AppError('weak_password');
  if (p.length > 200) throw new AppError('too_long:password');
  return p;
}
/** The Sunday that starts the current week (Asia/Riyadh has no DST, UTC+3). */
function thisSunday(): string {
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'company';
}

@Controller('api/auth')
export class AuthController {
  constructor(@Inject(Db) private readonly db: Db) {}

  private setCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_HOURS * 3600 * 1000
    });
  }
  private async companies(accountId: string) {
    return this.db.$queryRaw<Array<{ tenant_id: string; slug: string; name: string; name_ar: string | null; role: Role }>>`
      SELECT * FROM account_memberships(${accountId}::uuid)`;
  }

  /** A new company signs up: its own space, its owner, and a starter plan of demo figures. */
  @Public() @Post('signup')
  async signup(@Body() b: any, @Res({ passthrough: true }) res: Response) {
    if (process.env.CF13_SIGNUP === 'off') throw new AppError('signup_closed', 403);   // production: companies are created by the platform owner
    const company = str(b?.company, 'company', 120);
    const companyAr = str(b?.companyAr, 'companyAr', 120, false) || null;
    const name = str(b?.name, 'name', 120);
    const em = email(b?.email);
    const pw = newPassword(b?.password);
    const template = str(b?.template, 'template', 40);
    if (!Object.prototype.hasOwnProperty.call(TEMPLATES, template)) throw new AppError('unknown_template');
    if (await this.db.account.findUnique({ where: { email: em }, select: { id: true } })) throw new AppError('email_taken', 409);
    let slug = slugify(company);
    for (let i = 0; (await this.db.$queryRaw<Array<{ t: boolean }>>`SELECT slug_taken(${slug}) AS t`)[0].t; i++) {
      slug = slugify(company).slice(0, 34) + '-' + crypto.randomBytes(2).toString('hex');
      if (i > 5) throw new AppError('slug_unavailable');
    }
    const hash = await hashPassword(pw);
    const tenantId = crypto.randomUUID();
    // one transaction: a failure anywhere leaves no account behind, so the email is never stranded
    const account = await this.db.inTenant(tenantId, async (tx) => {
      const account = await tx.account.create({ data: { email: em, name, passwordHash: hash, language: b?.language === 'ar' ? 'ar' : 'en' } });
      await tx.tenant.create({ data: { id: tenantId, slug, name: company, nameAr: companyAr, template } });
      await tx.membership.create({ data: { tenantId, accountId: account.id, role: 'owner' } });
      await tx.branding.create({ data: { tenantId, theme: DEFAULT_THEME as any } });
      const plan = await tx.plan.create({ data: { tenantId, name: 'First plan (demo figures)', model: starterModel(template, thisSunday()) as any, createdBy: account.id } });
      await tx.auditEntry.create({ data: { tenantId, actorId: account.id, action: 'company_created', entity: 'tenant', entityId: tenantId, changes: { template, plan: plan.id } } });
      return account;
    });
    this.setCookie(res, signSession({ sub: account.id, tid: tenantId, role: 'owner', ep: 0 }));
    return { ok: true, tenant: { id: tenantId, slug, name: company }, account: { id: account.id, name, email: em } };
  }

  @Public() @Post('login')
  async login(@Body() b: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const em = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
    const pw = typeof b?.password === 'string' ? b.password : '';
    const acc = em ? await this.db.account.findUnique({ where: { email: em } }) : null;
    if (!acc) { await verifyPassword(pw, await decoyHash()); throw new AppError('invalid_credentials', 401); }
    if (acc.lockedUntil && acc.lockedUntil > new Date()) throw new AppError('locked', 429);
    if (!(await verifyPassword(pw, acc.passwordHash))) {
      const fails = acc.failedLogins + 1;
      await this.db.account.update({ where: { id: acc.id }, data: fails >= LOCK_AFTER
        ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) } : { failedLogins: fails } });
      throw new AppError('invalid_credentials', 401);
    }
    try { await requireSecondFactor(this.db, acc, b?.code); }
    catch (e) {
      if (e instanceof AppError && e.code === 'invalid_credentials') {   // a wrong second factor counts like a wrong password
        const fails = acc.failedLogins + 1;
        await this.db.account.update({ where: { id: acc.id }, data: fails >= LOCK_AFTER ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) } : { failedLogins: fails } });
      }
      throw e;
    }
    await this.db.account.update({ where: { id: acc.id }, data: { failedLogins: 0, lockedUntil: null } });
    const companies = await this.companies(acc.id);
    if (!companies.length) throw new AppError('no_company', 403);
    const pick = companies.find((c) => c.tenant_id === b?.tenantId) || companies[0];
    await this.db.inTenant(pick.tenant_id, (tx) => tx.auditEntry.create({ data: { tenantId: pick.tenant_id, actorId: acc.id, action: 'login', changes: { ip: req.ip } } }));
    this.setCookie(res, signSession({ sub: acc.id, tid: pick.tenant_id, role: pick.role, ep: acc.sessionEpoch }));
    return { ok: true, tenantId: pick.tenant_id, companies: companies.map((c) => ({ id: c.tenant_id, slug: c.slug, name: c.name, nameAr: c.name_ar, role: c.role })) };
  }

  /** What the sign-in screen needs to know: whether Firebase sign-in is switched on, and its public web config. */
  @Public() @Get('config')
  config() {
    const w = firebaseWebConfig();
    return { ok: true, signup: process.env.CF13_SIGNUP !== 'off', firebase: w ? { enabled: true, config: w } : { enabled: false } };
  }

  /** Sign in with a Firebase ID token. Same session cookie, same audit entry, same company isolation as a password sign-in. */
  @Public() @Post('firebase')
  async firebase(@Body() b: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const id = await verifyFirebaseToken(b?.idToken);
    if (!id.email) throw new AppError('email_required', 403);
    if (!id.emailVerified) throw new AppError('email_not_verified', 403);          // an unverified email proves nothing
    const acc = await this.db.account.findUnique({ where: { email: id.email } });
    if (!acc) throw new AppError('no_account', 403);                                // Firebase never creates an account here
    await requireSecondFactor(this.db, acc, b?.code);                               // our two-factor still applies after Firebase
    const companies = await this.companies(acc.id);
    if (!companies.length) throw new AppError('no_company', 403);
    const pick = companies.find((c) => c.tenant_id === b?.tenantId) || companies[0];
    await this.db.inTenant(pick.tenant_id, (tx) => tx.auditEntry.create({ data: { tenantId: pick.tenant_id, actorId: acc.id, action: 'login', changes: { ip: req.ip, method: 'firebase', provider: id.provider } } }));
    this.setCookie(res, signSession({ sub: acc.id, tid: pick.tenant_id, role: pick.role, ep: acc.sessionEpoch }));
    return { ok: true, tenantId: pick.tenant_id, companies: companies.map((c) => ({ id: c.tenant_id, slug: c.slug, name: c.name, nameAr: c.name_ar, role: c.role })) };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@Context() ctx: Ctx) {
    const acc = await this.db.account.findUnique({ where: { id: ctx.accountId }, select: { id: true, name: true, email: true, language: true } });
    const companies = await this.companies(ctx.accountId);
    return { ok: true, account: acc, role: ctx.role, tenantId: ctx.tenantId,
      companies: companies.map((c) => ({ id: c.tenant_id, slug: c.slug, name: c.name, nameAr: c.name_ar, role: c.role })) };
  }

  /** Move this session to another company the person belongs to. */
  @Post('switch')
  async switch(@Context() ctx: Ctx, @Body() b: any, @Res({ passthrough: true }) res: Response) {
    const c = (await this.companies(ctx.accountId)).find((x) => x.tenant_id === b?.tenantId);
    if (!c) throw new AppError('not_found', 404);
    const acc = await this.db.account.findUniqueOrThrow({ where: { id: ctx.accountId }, select: { sessionEpoch: true } });
    this.setCookie(res, signSession({ sub: ctx.accountId, tid: c.tenant_id, role: c.role, ep: acc.sessionEpoch }));
    return { ok: true, tenantId: c.tenant_id };
  }

  /** A new password ends every other session (the epoch in their cookie no longer matches). */
  @Post('password')
  async password(@Context() ctx: Ctx, @Body() b: any, @Res({ passthrough: true }) res: Response) {
    const acc = await this.db.account.findUniqueOrThrow({ where: { id: ctx.accountId } });
    if (!(await verifyPassword(typeof b?.current === 'string' ? b.current : '', acc.passwordHash))) throw new AppError('wrong_current_password', 403);
    const next = newPassword(b?.next);
    const upd = await this.db.account.update({ where: { id: acc.id }, data: { passwordHash: await hashPassword(next), sessionEpoch: { increment: 1 } } });
    await this.db.inTenant(ctx.tenantId, (tx) => tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: acc.id, action: 'password_changed' } }));
    this.setCookie(res, signSession({ sub: acc.id, tid: ctx.tenantId, role: ctx.role, ep: upd.sessionEpoch }));
    return { ok: true };
  }
}
