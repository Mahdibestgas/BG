// The built web app is served for every page address, so a reload or a shared link never lands on an API 404.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
process.env.CF13_QUIET = '1';
process.env.CF13_RATE = 'off';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf13-web-'));
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>app</title>');
fs.mkdirSync(path.join(dir, 'assets'));
fs.writeFileSync(path.join(dir, 'assets', 'a.js'), 'console.log(1)');
process.env.CF13_WEB_DIR = dir;
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app';

let app: INestApplication, base = '';
before(async () => { app = await createApp(); await app.listen(0, '127.0.0.1'); base = 'http://127.0.0.1:' + (app.getHttpServer().address() as any).port; });
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('page addresses get the web app; the API and missing files keep their own answers', async () => {
  for (const p of ['/', '/budget', '/budget/abc/company', '/account', '/reports/compare']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p); assert.match(await r.text(), /<title>app<\/title>/, p);
  }
  assert.equal(await (await fetch(base + '/assets/a.js')).text(), 'console.log(1)');
  const api = await fetch(base + '/api/nope');
  assert.equal(api.status, 404); assert.equal((await api.json()).error, 'not_found');
  assert.equal((await fetch(base + '/assets/missing.js')).status, 404, 'a missing file is not answered with the page');
});
