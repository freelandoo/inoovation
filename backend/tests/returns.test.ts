// Devolução de embalagens (POST/GET /api/admin/returns): só admins.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/auth.ts';
import type { Db } from '../src/db.ts';
import { createTestDb } from './helpers.ts';

const ADMIN = 'test-admin-token-123456';
const PASSWORD = 'senha-de-teste-forte';
const UNIT = { productId: '7898693620895', lotId: 'W4', unitId: 'p4G' };
let db: Db;
let app: ReturnType<typeof createApp>;

before(async () => {
  db = await createTestDb();
  app = createApp(db, { allowedOrigins: [], adminToken: ADMIN, admins: { tenka: hashPassword(PASSWORD) } });
  await db.query(
    `insert into registry_units (product_id, lot_id, unit_id, batch)
     select '07898693620895', 'W4', u, 't' from unnest(array['p4G', 'P4G']) as u`,
  );
});
after(() => db.close());

const post = (path: string, body: unknown, token?: string) =>
  app.request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'text/plain', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

const login = async () =>
  ((await (await post('/api/admin/login', { user: 'tenka', password: PASSWORD })).json()) as { token: string }).token;

test('devolução: sem login de admin não registra nem lista', async () => {
  assert.equal((await post('/api/admin/returns', UNIT)).status, 401);
  assert.equal((await post('/api/admin/returns', UNIT, 'errado')).status, 401);
  assert.equal((await app.request('/api/admin/returns')).status, 401);
  const off = createApp(db, { allowedOrigins: [], adminToken: null });
  assert.equal((await off.request('/api/admin/returns', { method: 'POST', body: JSON.stringify(UNIT) })).status, 404);
});

test('devolução: conta uma vez por pote, guarda quem leu e liga ao tripulante', async () => {
  const token = await login();
  // O pote foi ativado por um tripulante.
  const s = randomUUID();
  await post('/api/scan', { sessionId: s, ...UNIT });
  const { crew } = (await (
    await post('/api/signup', { sessionId: s, ...UNIT, name: 'Ana Souza', email: 'ana@example.com', consent: '2026-10-v2' })
  ).json()) as { crew: number };

  let r = await post('/api/admin/returns', UNIT, token);
  assert.equal(r.status, 200);
  const first = (await r.json()) as { ok: boolean; total: number; crew: number; returnedBy: string; unit: { productId: string } };
  assert.deepEqual([first.ok, first.total, first.crew, first.returnedBy, first.unit.productId], [true, 1, crew, 'tenka', '07898693620895']);

  // De novo (inclusive com GTIN de 14 dígitos): já devolvida, não soma.
  r = await post('/api/admin/returns', { ...UNIT, productId: '07898693620895' }, token);
  assert.equal(r.status, 409);
  const again = (await r.json()) as { code: string; total: number; returnedBy: string };
  assert.deepEqual([again.code, again.total, again.returnedBy], ['already_returned', 1, 'tenka']);

  // Serial com outra caixa é outro pote; sem tripulante.
  r = await post('/api/admin/returns', { ...UNIT, unitId: 'P4G' }, ADMIN);
  assert.equal(r.status, 200);
  assert.deepEqual(((await r.json()) as { crew: null; returnedBy: string }).crew, null);

  const list = (await (await app.request('/api/admin/returns', { headers: { Authorization: `Bearer ${token}` } })).json()) as {
    total: number;
    recent: { unit: { unitId: string }; returnedBy: string }[];
  };
  assert.equal(list.total, 2);
  assert.deepEqual(list.recent.map((x) => [x.unit.unitId, x.returnedBy]).sort(), [['P4G', 'admin'], ['p4G', 'tenka']]);
});

test('devolução: pote fora da lista oficial ou QR inválido é recusado', async () => {
  const token = await login();
  const r = await post('/api/admin/returns', { ...UNIT, unitId: 'ZZZ' }, token);
  assert.equal(r.status, 404);
  assert.equal(((await r.json()) as { code: string }).code, 'not_registered');
  assert.equal((await post('/api/admin/returns', { ...UNIT, lotId: undefined }, token)).status, 400);
});
