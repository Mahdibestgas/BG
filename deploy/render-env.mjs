// On hosts that hand over one database URL and random secrets (Render), derive what the app needs:
//  - SESSION_KEY as hex (the app wants >= 64 hex characters),
//  - APP_DB_PW, the password of the restricted cf13_app role, derived from SESSION_KEY so it never has to be stored,
//  - DATABASE_APP_URL: the same database, logged in as cf13_app.
// Prints shell `export` lines; every value is hex or a URL built from hex, so single quotes are safe.
import { createHash } from 'node:crypto';

const out = [];
const hex = (s) => createHash('sha256').update(s).digest('hex');
let key = process.env.SESSION_KEY || '';
if (!/^[0-9a-f]{64,}$/.test(key)) {
  if (!key) { console.error('SESSION_KEY is not set'); process.exit(1); }
  key = hex('cf13-session:' + key);
  out.push(`export SESSION_KEY='${key}'`);
}
let pw = process.env.APP_DB_PW || '';
if (!/^[0-9a-f]{32,}$/.test(pw)) { pw = hex('cf13-app-db:' + key); out.push(`export APP_DB_PW='${pw}'`); }
if (!process.env.DATABASE_APP_URL) {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1); }
  const u = new URL(process.env.DATABASE_URL);
  u.username = 'cf13_app'; u.password = pw;
  if (/\.render\.com$/.test(u.hostname) && !u.searchParams.has('sslmode')) u.searchParams.set('sslmode', 'require');
  const s = u.toString();
  if (s.includes("'")) { console.error('unexpected character in DATABASE_URL'); process.exit(1); }
  out.push(`export DATABASE_APP_URL='${s}'`);
}
console.log(out.join('\n'));
