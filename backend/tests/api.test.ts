import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.ts';
import { runMigrations } from '../src/migrate.ts';
import type { Db } from '../src/db.ts';
import { createTestDb } from './helpers.ts';

const ADMIN = 'test-admin-token-123456';
let db: Db;
let app: ReturnType<typeof createApp>;

before(async () => {
  db = await createTestDb();
  app = createApp(db, { allowedOrigins: [], adminToken: ADMIN });
});
after(() => db.close());

const post = (path: string, body: unknown, type = 'application/json') =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': type } });

const ID = { productId: '1845678901001', lotId: 'l1', unitId: 'AO' };

test('health', async () => {
  const r = await app.request('/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, db: 'up' });
});

test('migrações são idempotentes', async () => {
  assert.deepEqual(await runMigrations(db), []);
});

test('scan cria a unidade e conta uma vez por sessão', async () => {
  const s1 = randomUUID();
  let r = await post('/api/scan', { sessionId: s1, ...ID, source: 'qr', tier: 'high', origin: 'query' });
  assert.equal(r.status, 200);
  let j = (await r.json()) as { unit: { scanCount: number; status: string } };
  assert.equal(j.unit.scanCount, 1);
  assert.equal(j.unit.status, 'seen');

  // recarregar a página (mesma sessão) não conta de novo
  r = await post('/api/scan', { sessionId: s1, ...ID });
  j = (await r.json()) as typeof j;
  assert.equal(j.unit.scanCount, 1);

  // outra pessoa/sessão conta
  r = await post('/api/scan', { sessionId: randomUUID(), ...ID });
  j = (await r.json()) as typeof j;
  assert.equal(j.unit.scanCount, 2);
});

test('scan sem identidade registra só a sessão', async () => {
  const r = await post('/api/scan', { sessionId: randomUUID() });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { unit: unknown }).unit, null);
});

test('valores inválidos são descartados, sessionId é obrigatório', async () => {
  let r = await post('/api/scan', { sessionId: 'nope', ...ID });
  assert.equal(r.status, 400);
  const s = randomUUID();
  r = await post('/api/scan', { sessionId: s, productId: '<script>', lotId: 'l1', unitId: 'x'.repeat(50) });
  assert.equal(r.status, 200);
  const { rows } = await db.query<{ unit_key: string }>(
    'select u.unit_key from sessions s join units u on u.id = s.unit_ref where s.id = $1',
    [s],
  );
  assert.equal(rows[0].unit_key, '|l1|');
});

test('eventos via sendBeacon (text/plain), em lote, ligados à unidade', async () => {
  const s = randomUUID();
  await post('/api/scan', { sessionId: s, ...ID });
  const r = await post(
    '/api/events',
    [
      { sessionId: s, name: 'innovation_page_view', data: { tier: 'high' } },
      { sessionId: s, name: 'ar_cta_clicked' },
      { sessionId: s, name: 'evento_inventado' },
    ],
    'text/plain;charset=UTF-8',
  );
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { stored: number }).stored, 2);
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from events e join units u on u.id = e.unit_ref
     where e.session_id = $1 and u.unit_key = $2`,
    [s, '1845678901001|l1|AO'],
  );
  assert.equal(rows[0].n, 2);
});

test('evento de sessão desconhecida cria a sessão', async () => {
  const r = await post('/api/events', { sessionId: randomUUID(), name: 'label_viewed' });
  assert.equal(r.status, 200);
});

test('JSON inválido e corpo grande', async () => {
  let r = await app.request('/api/events', { method: 'POST', body: '{nope' });
  assert.equal(r.status, 400);
  r = await app.request('/api/events', { method: 'POST', body: 'x'.repeat(9000) });
  assert.equal(r.status, 413);
});

test('stats exige token', async () => {
  let r = await app.request('/api/stats');
  assert.equal(r.status, 401);
  r = await app.request('/api/stats', { headers: { Authorization: `Bearer ${ADMIN}` } });
  assert.equal(r.status, 200);
  const j = (await r.json()) as { totals: { units: number; scans: number }; funnel: { name: string }[] };
  assert.ok(j.totals.units >= 1);
  assert.ok(j.totals.scans >= 2);
  assert.ok(j.funnel.some((f) => f.name === 'ar_cta_clicked'));
});

test('CORS restrito quando ALLOWED_ORIGINS existe', async () => {
  const strict = createApp(db, { allowedOrigins: ['https://iw.example.com'], adminToken: null });
  const ok = await strict.request('/api/health', { headers: { Origin: 'https://iw.example.com' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://iw.example.com');
  const bad = await strict.request('/api/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});
