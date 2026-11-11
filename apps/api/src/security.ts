import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (pw: crypto.BinaryLike, salt: crypto.BinaryLike, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** scrypt$N$r$p$salt$hash — the parameters travel with the hash so they can be raised later. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(plain.normalize('NFKC'), salt, 32, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), h.toString('base64')].join('$');
}
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const p = String(stored).split('$');
  if (p.length !== 6 || p[0] !== 'scrypt') return false;
  const want = Buffer.from(p[5], 'base64');
  const got = await scrypt(plain.normalize('NFKC'), Buffer.from(p[4], 'base64'), want.length, { N: +p[1], r: +p[2], p: +p[3], maxmem: SCRYPT.maxmem });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
/** A hash of nothing, verified on unknown emails so a wrong address takes as long as a wrong password. */
let decoy: Promise<string> | null = null;
export function decoyHash(): Promise<string> { return decoy || (decoy = hashPassword(crypto.randomBytes(12).toString('hex'))); }

export interface Session { sub: string; tid: string; role: Role; ep: number; exp: number; iat: number }
export type Role = 'owner' | 'finance' | 'viewer';
export const SESSION_COOKIE = 'cf13';
export const SESSION_HOURS = 8;

function key(): Buffer {
  const k = process.env.SESSION_KEY || '';
  if (k.length < 64) throw new Error('SESSION_KEY must be at least 64 hex characters');
  return Buffer.from(k, 'hex');
}
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** A compact HS256 token (header.payload.signature), carried in an httpOnly cookie. */
export function signSession(s: Omit<Session, 'exp' | 'iat'>): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ ...s, iat: now, exp: now + SESSION_HOURS * 3600 }));
  const sig = crypto.createHmac('sha256', key()).update(head + '.' + body).digest('base64url');
  return head + '.' + body + '.' + sig;
}
export function readSession(token: string | undefined): Session | null {
  if (!token || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const sig = crypto.createHmac('sha256', key()).update(parts[0] + '.' + parts[1]).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== sig.length || !crypto.timingSafeEqual(given, sig)) return null;
  try {
    const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (head.alg !== 'HS256') return null;
    const s = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Session;
    if (!s.sub || !s.tid || typeof s.exp !== 'number' || s.exp < Date.now() / 1000) return null;
    return s;
  } catch { return null; }
}

export const LOCK_AFTER = 8;
export const LOCK_MINUTES = 15;

// ---- API keys: read-only access for other systems. Only the SHA-256 hash is stored.
export const API_KEY_PREFIX = 'cf13k_';
export function newApiKey(): { key: string; prefix: string; hash: string } {
  const key = API_KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}
export const hashApiKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
/** A one-time link token: shown once, only its hash is stored. */
export function newToken(prefix: string): { token: string; hash: string } { const token = prefix + crypto.randomBytes(32).toString('base64url'); return { token, hash: sha256(token) }; }
