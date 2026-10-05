import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.ts';
import type { Db } from '../src/db.ts';
import { createTestDb } from './helpers.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

const UNIT = { productId: '7898693620895', lotId: 'W4', unitId: '1Gp' };
const CONSENT = '2026-10-v1';

before(async () => {
  db = await createTestDb();
  app = createApp(db, { allowedOrigins: [], adminToken: null });
  await db.query(`insert into registry_units (product_id, lot_id, unit_id, batch) values ('07898693620895', 'W4', '1Gp', 't')`);
});
after(() => db.close());

const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });

const form = (over: Record<string, unknown> = {}) => ({
  sessionId: randomUUID(),
  ...UNIT,
  name: 'Ana Souza',
  email: 'Ana@Example.com',
  phone: '(11) 98765-4321',
  consent: CONSENT,
  marketing: true,
  ...over,
});

test('cadastro numa unidade verificada; repetir o e-mail atualiza', async () => {
  const s = randomUUID();
  await post('/api/scan', { sessionId: s, ...UNIT });
  let r = await post('/api/signup', form({ sessionId: s }));
  assert.equal(r.status, 200);
  const first = (await r.json()) as { crew: number };
  assert.ok(first.crew >= 1);

  r = await post('/api/signup', form({ name: 'Ana S.', email: 'ana@example.com', phone: '', marketing: false }));
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { crew: number }).crew, first.crew);

  const { rows } = await db.query<{ name: string; email: string; phone: string; marketing_opt_in: boolean; session_id: string }>(
    'select name, email, phone, marketing_opt_in, session_id from signups',
  );
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0] }, { name: 'Ana S.', email: 'ana@example.com', phone: '11987654321', marketing_opt_in: false, session_id: s });
});

test('unidade fora da lista oficial não aceita cadastro', async () => {
  const other = { ...UNIT, unitId: 'ZZZZ' };
  await post('/api/scan', { sessionId: randomUUID(), ...other });
  const r = await post('/api/signup', form(other));
  assert.equal(r.status, 409);
});

test('valida nome, e-mail, WhatsApp e consentimento', async () => {
  for (const [over, msg] of [
    [{ name: 'A' }, 'nome inválido'],
    [{ name: '<script>' }, 'nome inválido'],
    [{ email: 'ana@' }, 'e-mail inválido'],
    [{ phone: '123' }, 'WhatsApp inválido'],
    [{ consent: undefined }, 'consentimento obrigatório'],
    [{ unitId: undefined, lotId: undefined, productId: undefined }, 'unidade inválida'],
  ] as const) {
    const r = await post('/api/signup', form(over));
    assert.equal(r.status, 400, msg);
    assert.equal(((await r.json()) as { error: string }).error, msg);
  }
});
