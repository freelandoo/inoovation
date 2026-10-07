// Reset dos dados de teste (POST /api/admin/reset).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.ts';
import { importRegistry } from '../src/registry.ts';
import type { Db } from '../src/db.ts';
import { createTestDb } from './helpers.ts';

const ADMIN = 'test-admin-token-123456';
const GTIN = '7898693620895';
let db: Db;
let app: ReturnType<typeof createApp>;

before(async () => {
  db = await createTestDb();
  app = createApp(db, { allowedOrigins: [], adminToken: ADMIN });
  await importRegistry(db, [{ productId: `0${GTIN}`, lotId: 'W4', unitId: 'p4G' }], 'test');
});
after(() => db.close());

const json = (path: string, body: unknown, auth?: string) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  });

const scan = async () =>
  ((await (await json('/api/scan', { sessionId: randomUUID(), productId: GTIN, lotId: 'W4', unitId: 'p4G' })).json()) as {
    unit: { scanCount: number };
  }).unit.scanCount;

const signup = async (email: string) =>
  ((await (
    await json('/api/signup', {
      sessionId: randomUUID(),
      productId: GTIN,
      lotId: 'W4',
      unitId: 'p4G',
      name: 'Alex Teste',
      email,
      consent: '2026-10-v2',
    })
  ).json()) as { crew: number }).crew;

const count = async (table: string) => Number((await db.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0].n);

test('reset: recusa sem token, com token errado e sem a frase, sem apagar nada', async () => {
  await scan();
  await signup('a@example.com');
  assert.equal((await json('/api/admin/reset', { confirm: 'ZERAR TUDO' })).status, 401);
  assert.equal((await json('/api/admin/reset', { confirm: 'ZERAR TUDO' }, 'errado')).status, 401);
  assert.equal((await json('/api/admin/reset', { confirm: 'zerar' }, ADMIN)).status, 400);
  assert.equal(await count('signups'), 1);
});

test('reset: zera os dados de teste, mantém a lista oficial e a numeração volta a 1', async () => {
  await scan();
  await signup('b@example.com');
  const r = await json('/api/admin/reset', { confirm: 'ZERAR TUDO' }, ADMIN);
  assert.equal(r.status, 200);
  const body = (await r.json()) as { remaining: Record<string, number> };
  assert.deepEqual(body.remaining, { signups: 0, collectibles: 0, units: 0, sessions: 0, events: 0, registry: 1 });
  assert.equal(await scan(), 1);
  assert.equal(await signup('c@example.com'), 1);
});

test('reset: sem ADMIN_TOKEN configurado a rota não existe', async () => {
  const open = createApp(db, { allowedOrigins: [], adminToken: null });
  const r = await open.request('/api/admin/reset', { method: 'POST', body: '{"confirm":"ZERAR TUDO"}' });
  assert.equal(r.status, 404);
});
