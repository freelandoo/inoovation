import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.ts';
import type { Db } from '../src/db.ts';
import { hashPassword, issueSession, verifyPassword, verifySession } from '../src/auth.ts';
import { createTestDb } from './helpers.ts';

const ADMIN = 'test-admin-token-123456';
const PASSWORD = 'senha-de-teste-forte';
const UNIT = { productId: '7898693620895', lotId: 'W4', unitId: '1Gp' };

let db: Db;
let app: ReturnType<typeof createApp>;

before(async () => {
  db = await createTestDb();
  app = createApp(db, { allowedOrigins: [], adminToken: ADMIN, adminUser: 'tenka', adminPasswordHash: hashPassword(PASSWORD) });
  await db.query(`insert into registry_units (product_id, lot_id, unit_id, batch) values ('07898693620895', 'W4', '1Gp', 't')`);
});
after(() => db.close());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain', ...headers } });

test('hash e sessão: confere a senha certa e recusa a errada, expirada ou de outro usuário', () => {
  const h = hashPassword(PASSWORD);
  assert.ok(verifyPassword(PASSWORD, h));
  assert.ok(!verifyPassword('outra-senha', h));
  assert.ok(!verifyPassword(PASSWORD, 'texto-solto'));
  const { token } = issueSession(ADMIN, 'tenka', 1_000_000_000_000);
  assert.ok(verifySession(ADMIN, 'tenka', token, 1_000_000_000_001));
  assert.ok(!verifySession(ADMIN, 'outro', token, 1_000_000_000_001));
  assert.ok(!verifySession('outro-segredo-123456', 'tenka', token, 1_000_000_000_001));
  assert.ok(!verifySession(ADMIN, 'tenka', token, 1_000_000_000_000 + 13 * 3600_000));
});

test('login do admin: sessão vale nas rotas de admin', async () => {
  let r = await post('/api/admin/login', { user: 'Tenka ', password: 'errada' });
  assert.equal(r.status, 401);
  r = await post('/api/admin/login', { user: 'outro', password: PASSWORD });
  assert.equal(r.status, 401);

  r = await post('/api/admin/login', { user: 'Tenka ', password: PASSWORD });
  assert.equal(r.status, 200);
  const { token } = (await r.json()) as { token: string };

  const auth = { Authorization: `Bearer ${token}` };
  assert.equal((await app.request('/api/admin/me', { headers: auth })).status, 200);
  assert.equal((await app.request('/api/stats', { headers: auth })).status, 200);
  assert.equal((await app.request('/api/admin/me', { headers: { Authorization: 'Bearer 1.abc' } })).status, 401);
  // O token fixo continua valendo.
  assert.equal((await app.request('/api/stats', { headers: { Authorization: `Bearer ${ADMIN}` } })).status, 200);
});

test('sem usuário/senha configurados o login não existe', async () => {
  const off = createApp(db, { allowedOrigins: [], adminToken: ADMIN });
  const r = await off.request('/api/admin/login', { method: 'POST', body: JSON.stringify({ user: 'tenka', password: PASSWORD }) });
  assert.equal(r.status, 404);
});

test('login do membro: e-mail + nº de tripulante devolve o link', async () => {
  const s = randomUUID();
  await post('/api/scan', { sessionId: s, ...UNIT });
  const signup = await post('/api/signup', {
    sessionId: s,
    ...UNIT,
    name: 'Bia Lima',
    email: 'bia@example.com',
    consent: '2026-10-v1',
  });
  const { crew, member } = (await signup.json()) as { crew: number; member: string };

  let r = await post('/api/member/login', { email: 'BIA@example.com', crew: `Nº ${String(crew).padStart(4, '0')}` });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { member: string }).member, member);

  r = await post('/api/member/login', { email: 'bia@example.com', crew: crew + 1 });
  assert.equal(r.status, 404);
  r = await post('/api/member/login', { email: 'outra@example.com', crew });
  assert.equal(r.status, 404);
  r = await post('/api/member/login', { email: 'x', crew: 'abc' });
  assert.equal(r.status, 400);
});

test('login tem limite de tentativas', async () => {
  const strict = createApp(db, { allowedOrigins: [], adminToken: ADMIN, adminUser: 'tenka', adminPasswordHash: hashPassword(PASSWORD) });
  let last = 0;
  for (let i = 0; i < 11; i++) {
    const r = await strict.request('/api/member/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'ninguem@example.com', crew: 1 }),
      headers: { 'x-forwarded-for': '10.0.0.9' },
    });
    last = r.status;
  }
  assert.equal(last, 429);
});
