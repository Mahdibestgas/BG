import crypto from 'node:crypto';

/** RFC 6238 time-based one-time passwords (SHA-1, 6 digits, 30 s), the format every authenticator app reads. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const newTotpSecret = () => b32(crypto.randomBytes(20));
function b32(buf: Buffer): string {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function unb32(s: string): Buffer {
  let bits = '';
  for (const c of s.replace(/=+$/, '')) { const v = B32.indexOf(c); if (v < 0) throw new Error('bad base32'); bits += v.toString(2).padStart(5, '0'); }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export function hotp(secret: string, counter: number): string {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', unb32(secret)).update(c).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
/** The matching time step (accepting one step either side for clock drift), or null. The caller refuses a step it has already accepted. */
export function verifyTotp(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30000);
  for (const s of [step, step - 1, step + 1]) {
    const want = Buffer.from(hotp(secret, s)), got = Buffer.from(code);
    if (crypto.timingSafeEqual(want, got)) return s;
  }
  return null;
}
export const otpauthUri = (secret: string, account: string, issuer = 'Cash Flow 13') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// the secret is stored encrypted (AES-256-GCM) with a key derived from SESSION_KEY, so a database copy alone cannot generate codes
const key = () => crypto.createHash('sha256').update('totp|' + (process.env.SESSION_KEY || '')).digest();
export function sealSecret(s: string): string {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}
export function openSecret(sealed: string): string {
  const [iv, tag, enc] = sealed.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
