import {
  ArgumentsHost, CanActivate, Catch, ExceptionFilter, ExecutionContext, HttpException, Inject, Injectable, Logger,
  SetMetadata, createParamDecorator
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { EngineError } from '@cf13/engine';
import { Db } from './db';
import { API_KEY_PREFIX, hashApiKey, readSession, SESSION_COOKIE, type Role } from './security';

/** An error the client may see: a code it can translate, never a stack or SQL. */
export class AppError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (e instanceof AppError) return res.status(e.status).json({ ok: false, error: e.code });
    if (e instanceof EngineError) return res.status(422).json({ ok: false, error: e.code });
    // a unique index won a race (two sign-ups with the same email or company at once)
    if ((e as any)?.code === 'P2002') return res.status(409).json({ ok: false, error: 'already_exists' });
    if (e instanceof HttpException) {
      const s = e.getStatus();
      return res.status(s).json({ ok: false, error: s === 404 ? 'not_found' : s === 413 ? 'too_large' : 'bad_request' });
    }
    this.log.error(e instanceof Error ? e.stack : String(e));
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}

export interface Ctx { accountId: string; tenantId: string; role: Role; viaKey?: string }
export const CTX = Symbol('ctx');
export const Public = () => SetMetadata('public', true);
/** Routes an API key may call. Everything else refuses keys. Keys are read-only. */
export const KeyOk = () => SetMetadata('keyOk', true);
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export const Context = createParamDecorator((_: unknown, ec: ExecutionContext): Ctx => (ec.switchToHttp().getRequest() as any)[CTX]);

/**
 * Every route is private unless marked @Public(). A session is re-checked on
 * each request against the database: a removed membership or a changed
 * password (session epoch) ends it at once, not when the cookie expires.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(Db) private readonly db: Db) {}
  async canActivate(ec: ExecutionContext): Promise<boolean> {
    const req = ec.switchToHttp().getRequest<Request>();
    // cookies are SameSite=Strict; a custom header on every write also stops cross-site forms
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-cf13') !== '1') throw new AppError('missing_csrf_header', 403);
    if (this.reflector.getAllAndOverride<boolean>('public', [ec.getHandler(), ec.getClass()])) return true;
    const bearer = /^Bearer (cf13k_[A-Za-z0-9_-]{20,80})$/.exec(req.get('authorization') || '');
    if (bearer && !req.cookies?.[SESSION_COOKIE]) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError('api_key_read_only', 403);
      if (!this.reflector.getAllAndOverride<boolean>('keyOk', [ec.getHandler(), ec.getClass()])) throw new AppError('api_key_not_allowed', 403);
      const found = await this.db.$queryRaw<Array<{ id: string; tenant_id: string }>>`SELECT id, tenant_id FROM api_key_lookup(${hashApiKey(bearer[1])})`;
      if (!found.length) throw new AppError('auth_required', 401);
      const kc: Ctx = { accountId: '', tenantId: found[0].tenant_id, role: 'viewer', viaKey: found[0].id };
      // a record of use; failing to write it must not block a read
      this.db.inTenant(kc.tenantId, (tx) => tx.apiKey.update({ where: { id: found[0].id }, data: { lastUsedAt: new Date() } })).catch(() => undefined);
      (req as any)[CTX] = kc;
      return true;
    }
    if (req.get('authorization')?.startsWith('Bearer ')) throw new AppError('auth_required', 401);
    const s = readSession(req.cookies?.[SESSION_COOKIE]);
    if (!s) throw new AppError('auth_required', 401);
    const acc = await this.db.account.findUnique({ where: { id: s.sub }, select: { sessionEpoch: true } });
    if (!acc || acc.sessionEpoch !== s.ep) throw new AppError('auth_required', 401);
    const m = await this.db.inTenant(s.tid, (tx) => tx.membership.findFirst({ where: { accountId: s.sub }, select: { role: true } }));
    if (!m) throw new AppError('auth_required', 401);
    const ctx: Ctx = { accountId: s.sub, tenantId: s.tid, role: m.role as Role };
    (req as any)[CTX] = ctx;
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>('roles', [ec.getHandler(), ec.getClass()]);
    if (roles && !roles.includes(ctx.role)) throw new AppError('forbidden', 403);
    return true;
  }
}

// ---- input checks
export function str(v: unknown, field: string, max = 120, required = true): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new AppError('required:' + field);
  if (s.length > max) throw new AppError('too_long:' + field);
  return s;
}
export function amount(v: unknown, field: string, allowNegative = false): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
  if (v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(n)) throw new AppError('invalid_number:' + field);
  if (!allowNegative && n < 0) throw new AppError('negative_not_allowed:' + field);
  if (Math.abs(n) > 1e12) throw new AppError('amount_too_large:' + field);
  return Math.round(n * 100) / 100;
}
export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
