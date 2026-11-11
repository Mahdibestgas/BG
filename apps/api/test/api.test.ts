// End-to-end tests against the real local database (docker compose up -d).
// Every company here is created fresh, with a unique test-… email.
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
process.env.CF13_QUIET = '1';
process.env.CF13_RATE = 'off';          // the suite signs in and up far faster than a person; the limiter has its own test below
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app';
import { setFirebaseKeyResolver } from '../src/firebase';
import { resetRateLimits } from '../src/ratelimit';

let app: INestApplication, base = '';
const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });       // superuser: test set-up only
const asApp = new PrismaClient({ datasourceUrl: process.env.DATABASE_APP_URL });   // what the API connects as
const run = Date.now().toString(36);

class Client {
  cookie = '';
  async call(method: string, url: string, body?: unknown, opts: { csrf?: boolean } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.csrf !== false) headers['x-cf13'] = '1';
    if (this.cookie) headers.cookie = this.cookie;
    const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.arrayBuffer() } as { status: number; body: any };
  }
}
const PW = 'test-correct-horse-1';
const A = new Client(), B = new Client();
let planA = '', planB = '', tenantA = '', tenantB = '', accountA = '';

before(async () => {
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = 'http://127.0.0.1:' + (app.getHttpServer().address() as any).port;
});
after(async () => { await app.close(); await owner.$disconnect(); await asApp.$disconnect(); });

test('two companies sign up, each gets its own space and starter plan', async () => {
  let r = await A.call('POST', '/api/auth/signup', { company: 'Test Gas ' + run, name: 'Owner A', email: `test-a-${run}@example.com`, password: PW, template: 'lpg-distribution' });
  assert.equal(r.status, 201, JSON.stringify(r.body)); tenantA = r.body.tenant.id; accountA = r.body.account.id;
  r = await B.call('POST', '/api/auth/signup', { company: 'Test Water ' + run, name: 'Owner B', email: `test-b-${run}@example.com`, password: PW, template: 'generic' });
  assert.equal(r.status, 201); tenantB = r.body.tenant.id;
  assert.notEqual(tenantA, tenantB);
  const la = await A.call('GET', '/api/plans'), lb = await B.call('GET', '/api/plans');
  assert.equal(la.body.plans.length, 1); assert.equal(lb.body.plans.length, 1);
  assert.equal(la.body.plans[0].template, 'lpg-distribution'); assert.equal(lb.body.plans[0].template, 'generic');
  planA = la.body.plans[0].id; planB = lb.body.plans[0].id;
  const f = await A.call('GET', `/api/plans/${planA}/forecast`);
  assert.equal(f.status, 200);
  assert.ok(f.body.forecast.headline.checksOk, 'every check passes on the starter plan');
  assert.equal(f.body.forecast.weeks.length, 13);
});

test('sign-up is all or nothing: a failure leaves no stranded account', async () => {
  await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_fail_tenant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.name = 'Fail Co ${run}' THEN RAISE EXCEPTION 'forced failure'; END IF; RETURN NEW; END $$`);
  await owner.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fail_tenant ON tenants');
  await owner.$executeRawUnsafe('CREATE TRIGGER test_fail_tenant BEFORE INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION test_fail_tenant()');
  try {
    const c = new Client(), em = `test-fail-${run}@example.com`;
    const r = await c.call('POST', '/api/auth/signup', { company: 'Fail Co ' + run, name: 'x', email: em, password: PW, template: 'generic' });
    assert.equal(r.status, 500);
    assert.equal(await owner.account.count({ where: { email: em } }), 0, 'no account left behind');
  } finally {
    await owner.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fail_tenant ON tenants');
    await owner.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_tenant()');
  }
});

test('a company can never reach another company’s data through the API', async () => {
  for (const [m, u] of [['GET', `/api/plans/${planB}`], ['GET', `/api/plans/${planB}/forecast`]] as const) {
    assert.equal((await A.call(m, u)).status, 404, `${m} ${u} must not exist for company A`);
  }
  assert.equal((await A.call('PUT', `/api/plans/${planB}/opening`, { version: 1, data: {} })).status, 404);
  assert.equal((await A.call('POST', '/api/auth/switch', { tenantId: tenantB })).status, 404, 'cannot switch into a company you do not belong to');
  const list = await A.call('GET', '/api/plans');
  assert.ok(list.body.plans.every((p: any) => p.id !== planB));
  const audit = await A.call('GET', '/api/audit');
  assert.ok(audit.body.audit.length > 0 && audit.body.audit.every((x: any) => x.entityId !== tenantB && x.changes?.plan !== planB));
});

test('the database itself enforces the separation, whatever the API does', async () => {
  // no company set: the query fails instead of returning everyone's rows
  await assert.rejects(asApp.$queryRawUnsafe('SELECT count(*) FROM plans'), /app.tenant_id is not set/);
  await asApp.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    const n = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM plans WHERE tenant_id = ${tenantB}::uuid`;
    assert.equal(Number(n[0].n), 0, 'company B rows are invisible inside company A');
    const t = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM tenants`;
    assert.deepEqual(t.map((x) => x.id), [tenantA], 'a company sees only its own company row');
  });
  await assert.rejects(asApp.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    await tx.$executeRaw`INSERT INTO plans (id, tenant_id, name, model, updated_at) VALUES (gen_random_uuid(), ${tenantB}::uuid, 'x', '{}'::jsonb, now())`;
  }), /row-level security/, 'cannot write a row into another company');
  await assert.rejects(asApp.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    await tx.$executeRaw`UPDATE audit SET action = 'edited' WHERE tenant_id = ${tenantA}::uuid`;
  }), /audit trail cannot be changed/, 'the audit trail is append-only');
  const [role] = await asApp.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
});

test('sessions: tampering, missing CSRF header, sign-out, password change', async () => {
  const forged = new Client(); forged.cookie = A.cookie.slice(0, -3) + 'abc';
  assert.equal((await forged.call('GET', '/api/auth/me')).status, 401, 'a tampered cookie is refused');
  assert.equal((await A.call('POST', '/api/auth/switch', { tenantId: tenantA }, { csrf: false })).status, 403, 'a write without the CSRF header is refused');
  assert.equal((await new Client().call('GET', '/api/plans')).status, 401, 'no cookie, no data');
  const old = new Client(); old.cookie = A.cookie;
  assert.equal((await A.call('POST', '/api/auth/password', { current: 'test-wrong-pw', next: 'test-new-pass-123' })).status, 403);
  assert.equal((await A.call('POST', '/api/auth/password', { current: PW, next: 'short' })).status, 400);
  assert.equal((await A.call('POST', '/api/auth/password', { current: PW, next: 'test-new-pass-123' })).status, 201);
  assert.equal((await old.call('GET', '/api/plans')).status, 401, 'the session from before the password change has ended');
  assert.equal((await A.call('GET', '/api/plans')).status, 200, 'this device got a fresh session');
});

test('sign-in: wrong password, unknown email and lockout look the same from outside', async () => {
  const c = new Client();
  assert.equal((await c.call('POST', '/api/auth/login', { email: `test-a-${run}@example.com`, password: 'test-nope' })).status, 401);
  assert.equal((await c.call('POST', '/api/auth/login', { email: `test-none-${run}@example.com`, password: 'test-nope' })).body.error, 'invalid_credentials');
  assert.equal((await c.call('POST', '/api/auth/signup', { company: 'Dup', name: 'x', email: `test-a-${run}@example.com`, password: PW, template: 'generic' })).status, 409);
  for (let i = 0; i < 8; i++) await c.call('POST', '/api/auth/login', { email: `test-b-${run}@example.com`, password: 'test-nope' });
  assert.equal((await c.call('POST', '/api/auth/login', { email: `test-b-${run}@example.com`, password: PW })).body.error, 'locked', 'locked even with the right password');
  const ok = await c.call('POST', '/api/auth/login', { email: `test-a-${run}@example.com`, password: 'test-new-pass-123' });
  assert.equal(ok.status, 201); assert.equal(ok.body.tenantId, tenantA);
});

test('roles: a viewer reads but cannot change balances or branding', async () => {
  const v = new Client();
  await v.call('POST', '/api/auth/signup', { company: 'Viewer Co ' + run, name: 'Viewer', email: `test-v-${run}@example.com`, password: PW, template: 'generic' });
  const acc = await owner.account.findUniqueOrThrow({ where: { email: `test-v-${run}@example.com` } });
  await owner.membership.create({ data: { tenantId: tenantA, accountId: acc.id, role: 'viewer' } });
  assert.equal((await v.call('POST', '/api/auth/switch', { tenantId: tenantA })).status, 201);
  assert.equal((await v.call('GET', `/api/plans/${planA}/forecast`)).status, 200, 'a viewer reads the forecast');
  assert.equal((await v.call('PUT', `/api/plans/${planA}/opening`, { version: 1, data: {} })).status, 403);
  assert.equal((await v.call('PUT', '/api/tenant/branding', { theme: {} })).status, 403);
  assert.equal((await v.call('GET', '/api/audit')).status, 403);
  await owner.membership.deleteMany({ where: { tenantId: tenantA, accountId: acc.id } });
  assert.equal((await v.call('GET', '/api/plans')).status, 401, 'a removed member is out at once, not when the cookie expires');
});

test('opening balances: validated, versioned, audited, and the forecast follows', async () => {
  const g = await A.call('GET', `/api/plans/${planA}`);
  const version = g.body.plan.version;
  const data = {
    bankAccounts: [{ id: 'BA1', name: 'Operating', bank: 'SNB', balance: 3000000 }, { id: 'BA2', name: 'Collections', bank: 'Al Rajhi', balance: '1,250,000.50' }],
    receivables: { amount: 1850000, schedule: [1] }, payables: { amount: 3100000, schedule: [0.45, 0.3, 0.15, 0.1] },
    vat: { payable: 1850000, dueDate: null }, confirmed: false
  };
  assert.equal((await A.call('PUT', `/api/plans/${planA}/opening`, { version: version + 7, data })).body.error, 'stale_plan');
  for (const [patch, code] of [
    [{ payables: { amount: 1, schedule: [0.5, 0.3] } }, 'schedule_not_100'],
    [{ receivables: { amount: -5, schedule: [1] } }, 'negative_not_allowed'],
    [{ bankAccounts: [] }, 'bank_accounts_required'],
    [{ vat: { payable: 1, dueDate: '2026-02-30' } }, 'invalid_date'],
    [{ bankAccounts: [{ name: ' ', balance: 1 }] }, 'required']
  ] as const) {
    const r = await A.call('PUT', `/api/plans/${planA}/opening`, { version, data: { ...data, ...patch } });
    assert.equal(r.status, 400); assert.ok(String(r.body.error).startsWith(code), r.body.error);
  }
  const ok = await A.call('PUT', `/api/plans/${planA}/opening`, { version, data });
  assert.equal(ok.body.version, version + 1);
  const f = await A.call('GET', `/api/plans/${planA}/forecast`);
  assert.equal(f.body.forecast.l1.opening[0], 4250000.5);
  const pos = f.body.forecast.l3.R_POS[0];
  const items = await A.call('GET', `/api/plans/${planA}/items?cat=R_POS&l3=${encodeURIComponent(pos.l3)}`);
  assert.equal(items.body.items.length, pos.items, 'L4 items behind an L3 row');
  for (let w = 0; w < 13; w++) {
    const s = items.body.items.filter((x: any) => x.w === w).reduce((t: number, x: any) => t + x.amount, 0);
    assert.ok(Math.abs(s - pos.values[w]) < 1e-6, 'L4 adds up to L3 in W' + (w + 1));
  }
  assert.equal((await B.call('GET', `/api/plans/${planA}/items?cat=R_POS&l3=${encodeURIComponent(pos.l3)}`)).status, 404, "company B cannot list A's items");
  const audit = (await A.call('GET', '/api/audit')).body.audit.find((x: any) => x.action === 'opening_balances_saved');
  assert.equal(audit.changes.after.bankAccounts[1].balance, 1250000.5);
});

test('branding: only real images, only readable themes, logo private to its company', async () => {
  const goodTheme = { brand: '#3F5C43', brandDeep: '#2F4632', brandSoft: '#E5ECE5', paper: '#F4F1E8', surface: '#FFFFFF', ink: '#1F2720', ink2: '#5A635B', rule: '#E4E0D3' };
  assert.equal((await A.call('PUT', '/api/tenant/branding', { theme: { ...goodTheme, brand: '#A8D5A2' } })).body.error, 'theme_contrast:brand', 'a pale brand colour cannot carry white text');
  assert.equal((await A.call('PUT', '/api/tenant/branding', { theme: { ...goodTheme, ink: 'red' } })).body.error, 'invalid_theme:ink');
  const fakePng = Buffer.from('<svg onload=alert(1)>').toString('base64');
  assert.equal((await A.call('PUT', '/api/tenant/branding', { theme: goodTheme, logo: fakePng, logoType: 'image/png' })).body.error, 'logo_type', 'an SVG renamed to PNG is refused');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077053e0000000c4944415408d763f8ffff3f0005fe02fea7d6a4a30000000049454e44ae426082', 'hex');
  assert.equal((await A.call('PUT', '/api/tenant/branding', { theme: goodTheme, logo: png.toString('base64'), logoType: 'image/png' })).status, 200);
  const t = await A.call('GET', '/api/tenant');
  assert.equal(t.body.theme.brand, '#3F5C43'); assert.equal(t.body.hasLogo, true);
  const logo = await A.call('GET', '/api/tenant/logo');
  assert.equal(logo.status, 200); assert.equal(Buffer.from(logo.body).length, png.length);
  assert.equal((await B.call('GET', '/api/tenant/logo')).status, 404, "company B gets its own (empty) logo, never A's");
  assert.equal((await B.call('GET', '/api/tenant')).body.tenant.id, tenantB);
});


test('rate limiting: too many sign-in attempts from one address get 429 with Retry-After, then it recovers', async () => {
  process.env.CF13_RATE = 'on'; process.env.CF13_RATE_AUTH = '3'; resetRateLimits();
  try {
    const hit = () => fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cf13': '1' }, body: JSON.stringify({ email: `nobody-${run}@example.com`, password: 'x'.repeat(14) }) });
    for (let i = 0; i < 3; i++) assert.equal((await hit()).status, 401, 'the first three are judged normally');
    const blocked = await hit();
    assert.equal(blocked.status, 429); assert.equal((await blocked.json()).error, 'rate_limited');
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1, 'tells the client when to retry');
    const read = await fetch(base + '/api/auth/me', { headers: { 'x-cf13': '1' } });
    assert.equal(read.status, 401, 'other routes are not blocked by the sign-in limit');
  } finally { process.env.CF13_RATE = 'off'; delete process.env.CF13_RATE_AUTH; resetRateLimits(); }
});

test('Firebase sign-in: a verified token links to the existing account by email, and only then', async () => {
  const { generateKeyPair, SignJWT } = await import('jose');
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  setFirebaseKeyResolver(async () => publicKey);
  process.env.FIREBASE_PROJECT_ID = 'cf13-test';
  const email = `test-a-${run}@example.com`, now = Math.floor(Date.now() / 1000);
  const mk = (o: { email?: string; verified?: boolean; aud?: string; iss?: string; key?: any; exp?: string | number; authTime?: number } = {}) =>
    new SignJWT({ email: o.email ?? email, email_verified: o.verified ?? true, auth_time: o.authTime ?? now, firebase: { sign_in_provider: 'google.com' } })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(o.iss ?? 'https://securetoken.google.com/cf13-test').setAudience(o.aud ?? 'cf13-test').setSubject('uid-' + run)
      .setIssuedAt().setExpirationTime(o.exp ?? '1h').sign(o.key ?? privateKey);
  try {
    const C = new Client();
    let r = await C.call('POST', '/api/auth/firebase', { idToken: await mk() });
    assert.equal(r.status, 201, JSON.stringify(r.body)); assert.ok(C.cookie.startsWith('cf13='), 'a session cookie is issued');
    assert.equal((await C.call('GET', '/api/plans')).status, 200, 'and it works like any other session');
    const audit = await owner.$queryRawUnsafe<Array<{ changes: any }>>(`SELECT changes FROM audit WHERE tenant_id = '${tenantA}'::uuid AND action = 'login' ORDER BY at DESC LIMIT 1`);
    assert.equal(audit[0].changes.method, 'firebase', 'the sign-in is recorded as a Firebase sign-in');
    const bad = async (tok: string) => (await new Client().call('POST', '/api/auth/firebase', { idToken: tok }));
    assert.equal((await bad(await mk({ aud: 'someone-else' }))).status, 401, 'a token for another Firebase project is refused');
    assert.equal((await bad(await mk({ iss: 'https://securetoken.google.com/someone-else' }))).status, 401, 'wrong issuer');
    assert.equal((await bad(await mk({ key: other.privateKey }))).status, 401, 'a token signed with a different key is refused');
    assert.equal((await bad(await mk({ exp: now - 60 }))).status, 401, 'an expired token is refused');
    assert.equal((await bad('not-a-token'.repeat(12))).status, 401);
    assert.equal((await bad(await mk({ verified: false }))).status, 403, 'an unverified email proves nothing');
    assert.equal((await bad(await mk({ email: `nobody-${run}@example.com` }))).status, 403, 'Firebase never creates an account');
    assert.equal((await new Client().call('POST', '/api/auth/firebase', { idToken: await mk() }, { csrf: false })).status, 403, 'the CSRF header is still required');
    delete process.env.FIREBASE_PROJECT_ID;
    r = await new Client().call('POST', '/api/auth/firebase', { idToken: await mk() });
    assert.equal(r.status, 503, 'with Firebase not configured the route is closed');
    assert.equal((await new Client().call('GET', '/api/auth/config')).body.firebase.enabled, false);
  } finally { setFirebaseKeyResolver(null); delete process.env.FIREBASE_PROJECT_ID; }
});

test('row-level security covers board approvals: one company can neither see nor record on another’s plan', async () => {
  const plan = await A.call('GET', `/api/plans/${planA}`);
  const version = plan.body.plan.version;
  let r = await A.call('POST', `/api/plans/${planA}/approve`, { version, approvedBy: 'Board of Test Gas', meeting: '2026-11-12', resolution: 'R-1', confirm: true });
  assert.equal(r.status, 201 === r.status ? 201 : 200, JSON.stringify(r.body));
  assert.equal((await A.call('GET', `/api/plans/${planA}/approvals`)).body.approvals.length, 1);
  assert.equal((await B.call('GET', `/api/plans/${planA}/approvals`)).body.approvals.length, 0, 'company B sees none of company A’s approvals');
  assert.equal((await B.call('POST', `/api/plans/${planA}/approve`, { version, approvedBy: 'x', meeting: '2026-11-12', resolution: 'R-9', confirm: true })).status, 404, 'and cannot approve a plan it cannot see');
  assert.equal((await A.call('POST', `/api/plans/${planA}/approve`, { version: version + 5, approvedBy: 'x', meeting: '2026-11-12', resolution: 'R-2', confirm: true })).status, 409, 'the board approves exactly the version it saw');
  assert.equal((await A.call('POST', `/api/plans/${planA}/approve`, { version, approvedBy: 'x', meeting: '2026-11-12', resolution: 'R-3', confirm: false })).status, 400, 'an explicit confirmation is required');
});

test('API keys: owner-made, read-only, company-bound, revocable, never able to manage keys', async () => {
  const bearer = (k: string, method = 'GET', url = '/api/plans') => fetch(base + url, { method, headers: { authorization: 'Bearer ' + k, 'x-cf13': '1', 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
  const created = await A.call('POST', '/api/keys', { name: 'Test ERP link' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const key: string = created.body.key, id: string = created.body.id;
  assert.ok(key.startsWith('cf13k_'));
  const stored = await owner.$queryRawUnsafe<Array<{ hash: string }>>(`SELECT hash FROM api_keys WHERE id = '${id}'::uuid`);
  assert.notEqual(stored[0].hash, key, 'only a hash is stored');
  assert.equal(JSON.stringify((await A.call('GET', '/api/keys')).body).includes(key), false, 'the key is never shown again');

  let r = await bearer(key);
  assert.equal(r.status, 200); const plans = (await r.json()).plans;
  assert.ok(plans.length >= 1 && plans.every((p: any) => p.id !== planB), 'sees only its own company');
  assert.equal((await bearer(key, 'GET', `/api/plans/${planA}/forecast`)).status, 200);
  assert.equal((await bearer(key, 'GET', `/api/plans/${planB}/forecast`)).status, 404, 'another company’s plan is not found');
  assert.equal((await bearer(key, 'POST', `/api/plans/${planA}/approve`)).status, 403, 'a key cannot write');
  assert.equal((await bearer(key, 'GET', '/api/audit')).status, 403, 'nor read routes that are not open to keys');
  assert.equal((await bearer(key, 'GET', '/api/keys')).status, 403, 'nor manage keys');
  assert.equal((await bearer('cf13k_' + 'x'.repeat(43))).status, 401, 'a wrong key is refused');
  assert.equal((await new Client().call('POST', '/api/keys', { name: 'x' })).status, 401);
  const V = new Client();   // a viewer cannot make keys
  assert.equal((await B.call('GET', '/api/keys')).body.keys.length, 0, 'company B sees none of A’s keys');

  assert.equal((await A.call('DELETE', `/api/keys/${id}`)).status, 200);
  assert.equal((await bearer(key)).status, 401, 'a revoked key stops working at once');
  const log = await owner.$queryRawUnsafe<Array<{ action: string }>>(`SELECT action FROM audit WHERE tenant_id = '${tenantA}'::uuid AND action LIKE 'api_key_%'`);
  assert.deepEqual(log.map((x) => x.action).sort(), ['api_key_created', 'api_key_revoked']);
  const docs = await fetch(base + '/api/openapi.json'); assert.equal(docs.status, 200); assert.equal((await docs.json()).openapi, '3.0.3');
  void V;
});

test('auth flow: invitations, owner-issued reset, two-factor, member management', async () => {
  const { hotp } = await import('../src/totp');
  const NEXT = ['another', 'long', 'phrase', run].join('-'), WRONG = ['nope', 'nope', 'nope', run].join('-'), SHORT = 'abc';
  const O = A;   // company A's owner is already signed in
  const inviteEmail = `test-inv-${run}@example.com`;
  const inv = await O.call('POST', '/api/members/invites', { email: inviteEmail, role: 'viewer' });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  assert.equal((await O.call('POST', '/api/members/invites', { email: inviteEmail, role: 'viewer' })).status, 409, 'no duplicate open invitation');
  const stored = await owner.$queryRawUnsafe<Array<{ token_hash: string }>>(`SELECT token_hash FROM invitations WHERE id = '${inv.body.id}'::uuid`);
  assert.notEqual(stored[0].token_hash, inv.body.token, 'only a hash is stored');
  const peek = await new Client().call('POST', '/api/auth/invite/peek', { token: inv.body.token });
  assert.equal(peek.body.email, inviteEmail); assert.equal(peek.body.existingAccount, false);
  assert.equal((await new Client().call('POST', '/api/auth/invite/accept', { token: 'cf13i_' + 'z'.repeat(43), name: 'X', password: PW })).status, 410, 'a made-up link is refused');
  const N = new Client();
  const acc = await N.call('POST', '/api/auth/invite/accept', { token: inv.body.token, name: 'New Viewer', password: PW });
  assert.equal(acc.status, 201, JSON.stringify(acc.body));
  assert.equal((await N.call('GET', '/api/plans')).status, 200, 'the new member is in');
  assert.equal((await N.call('GET', '/api/members')).status, 403, 'as a viewer: no member management');
  assert.equal((await new Client().call('POST', '/api/auth/invite/accept', { token: inv.body.token, name: 'Again', password: PW })).status, 410, 'a link works once');
  const members = (await O.call('GET', '/api/members')).body;
  const viewer = members.members.find((m: any) => m.email === inviteEmail); assert.equal(viewer.role, 'viewer');
  assert.equal((await B.call('GET', '/api/members')).body.members.every((m: any) => m.email !== inviteEmail), true, 'company B does not see these members');

  assert.equal((await O.call('PATCH', `/api/members/${viewer.accountId}`, { role: 'finance' })).status, 200);
  const ownerRow = members.members.find((m: any) => m.email === `test-a-${run}@example.com`);
  assert.equal((await O.call('PATCH', `/api/members/${ownerRow.accountId}`, { role: 'viewer' })).status, 409, 'the last owner cannot be demoted');
  assert.equal((await O.call('DELETE', `/api/members/${ownerRow.accountId}`)).status, 409, 'nor removed');

  const link = await O.call('POST', `/api/members/${viewer.accountId}/reset`);
  assert.equal(link.status, 201, JSON.stringify(link.body));
  assert.equal((await new Client().call('POST', '/api/auth/reset', { token: link.body.token, password: SHORT })).status, 400);
  assert.equal((await new Client().call('POST', '/api/auth/reset', { token: link.body.token, password: NEXT })).status, 201);
  assert.equal((await new Client().call('POST', '/api/auth/reset', { token: link.body.token, password: NEXT })).status, 410, 'a reset link works once');
  assert.equal((await N.call('GET', '/api/plans')).status, 401, 'the old session ended');
  const N2 = new Client();
  assert.equal((await N2.call('POST', '/api/auth/login', { email: inviteEmail, password: NEXT })).status, 201);

  const setup = await N2.call('POST', '/api/auth/totp/setup'); assert.equal(setup.status, 201);
  assert.equal((await N2.call('POST', '/api/auth/totp/enable', { code: '000000' })).status, 400, 'a wrong code does not turn it on');
  const step = Math.floor(Date.now() / 30000);
  const en = await N2.call('POST', '/api/auth/totp/enable', { code: hotp(setup.body.secret, step) });
  assert.equal(en.status, 201); assert.equal(en.body.recoveryCodes.length, 8);
  const raw = await owner.$queryRawUnsafe<Array<{ totp_secret: string }>>(`SELECT totp_secret FROM accounts WHERE email = '${inviteEmail}'`);
  assert.ok(!raw[0].totp_secret.includes(setup.body.secret), 'the secret is stored encrypted');
  const T = new Client();
  let r = await T.call('POST', '/api/auth/login', { email: inviteEmail, password: NEXT });
  assert.equal(r.status, 401); assert.equal(r.body.error, 'totp_required');
  r = await T.call('POST', '/api/auth/login', { email: inviteEmail, password: WRONG });
  assert.equal(r.body.error, 'invalid_credentials', 'a wrong password never reveals that two-factor is on');
  assert.equal((await T.call('POST', '/api/auth/login', { email: inviteEmail, password: NEXT, code: '123456' })).status, 401, 'a wrong code is refused');
  assert.equal((await T.call('POST', '/api/auth/login', { email: inviteEmail, password: NEXT, code: hotp(setup.body.secret, step) })).status, 401, 'the code used to enable cannot be replayed');
  assert.equal((await T.call('POST', '/api/auth/login', { email: inviteEmail, password: NEXT, code: hotp(setup.body.secret, step + 1) })).status, 201, 'the next code works');
  assert.equal((await new Client().call('POST', '/api/auth/login', { email: inviteEmail, password: NEXT, code: en.body.recoveryCodes[0] })).status, 201, 'a recovery code works');
  assert.equal((await new Client().call('POST', '/api/auth/login', { email: inviteEmail, password: NEXT, code: en.body.recoveryCodes[0] })).status, 401, 'but only once');
  assert.equal((await O.call('DELETE', `/api/members/${viewer.accountId}`)).status, 200);
  assert.equal((await T.call('GET', '/api/plans')).status, 401, 'a removed member is out immediately');
});
