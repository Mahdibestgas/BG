import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from './http';

/**
 * Per-address rate limits, in memory (one API process). Sign-in and sign-up cost a 32 MB scrypt each, and the
 * per-account lockout alone lets anyone lock a user out, so these routes get the tightest limit.
 * Over the limit: HTTP 429 with a Retry-After header. Tune with CF13_RATE_* ; CF13_RATE=off switches it off (tests).
 */
interface Rule { name: string; limit: number; windowMs: number }
const hits = new Map<string, number[]>();
let lastSweep = 0;
const num = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };

function rulesFor(req: Request): Rule[] {
  if (process.env.CF13_RATE === 'off') return [];
  const path = req.path, write = req.method !== 'GET' && req.method !== 'HEAD';
  const auth = req.method === 'POST' && /^\/api\/auth\/(login|signup|firebase|password|switch|invite\/accept|reset|totp\/[a-z]+)$/.test(path);
  const heavy = req.method === 'GET' && /^\/api\/plans\/[^/]+\/(forecast|items)$/.test(path);
  const out: Rule[] = [{ name: 'all', limit: num('CF13_RATE_ALL', 900), windowMs: 60_000 }];
  if (auth) out.push({ name: 'auth', limit: num('CF13_RATE_AUTH', 10), windowMs: 60_000 }, { name: 'auth-hour', limit: num('CF13_RATE_AUTH_HOUR', 60), windowMs: 3_600_000 });
  else if (write) out.push({ name: 'write', limit: num('CF13_RATE_WRITE', 90), windowMs: 60_000 });
  if (heavy) out.push({ name: 'heavy', limit: num('CF13_RATE_HEAVY', 180), windowMs: 60_000 });
  return out;
}

/** Forget every counter (used by the tests). */
export function resetRateLimits() { hits.clear(); }

@Injectable()
export class RateLimitGuard implements CanActivate {
  canActivate(ec: ExecutionContext): boolean {
    const http = ec.switchToHttp(), req = http.getRequest<Request>(), res = http.getResponse<Response>();
    const rules = rulesFor(req);
    if (!rules.length) return true;
    const now = Date.now(), ip = (req.get('authorization')?.startsWith('Bearer cf13k_') ? 'key:' + (req.get('authorization') || '').slice(7, 19) + ':' : '') + (req.ip || req.socket?.remoteAddress || 'unknown');
    if (now - lastSweep > 60_000) {                                     // drop idle counters so memory stays flat
      lastSweep = now;
      for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 3_600_000) hits.delete(k);
    }
    // check every rule first, so a refused request does not use up the other counters
    for (const r of rules) {
      const key = r.name + '|' + ip, arr = (hits.get(key) || []).filter((t) => now - t < r.windowMs);
      hits.set(key, arr);
      if (arr.length >= r.limit) {
        const wait = Math.max(1, Math.ceil((arr[0] + r.windowMs - now) / 1000));
        res.setHeader('Retry-After', String(wait));
        throw new AppError('rate_limited', 429);
      }
    }
    for (const r of rules) hits.get(r.name + '|' + ip)!.push(now);
    return true;
  }
}
