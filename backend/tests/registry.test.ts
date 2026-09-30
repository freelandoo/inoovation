import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.ts';
import { parseLink, parseRegistry, importRegistry } from '../src/registry.ts';
import type { Db } from '../src/db.ts';
import { createTestDb } from './helpers.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

before(async () => {
  db = await createTestDb();
  app = createApp(db, { allowedOrigins: [], adminToken: null });
});
after(() => db.close());

const GTIN = '7898693620895';
const link = (serial: string, lot = 'W4') => `https://ri3.ai/01/${GTIN}/10/${lot}/21/${serial}`;

const scan = async (unitId: string, productId = GTIN, lotId = 'W4') => {
  const r = await app.request('/api/scan', {
    method: 'POST',
    body: JSON.stringify({ sessionId: randomUUID(), productId, lotId, unitId }),
  });
  return ((await r.json()) as { unit: { status: string } | null }).unit?.status;
};

test('lê o link GS1 da Realizse', () => {
  assert.deepEqual(parseLink(link('qZ')), { productId: `0${GTIN}`, lotId: 'W4', unitId: 'qZ' });
  assert.deepEqual(parseLink(`https://ri3.ai/01/${GTIN}/10/W4/21/qZ/17/261231`)?.unitId, 'qZ');
  assert.equal(parseLink('https://ri3.ai/01/abc/10/W4/21/qZ'), null);
  assert.equal(parseLink('qualquer coisa'), null);
});

test('arquivo: duplicadas, inválidas e seriais que só diferem na caixa', () => {
  const text = ['﻿link', link('qZ'), link('7Hk'), link('7hk'), link('qZ'), 'lixo 123', '', link('Tm')].join('\r\n');
  const r = parseRegistry(text);
  assert.deepEqual(
    r.units.map((u) => u.unitId),
    ['qZ', '7Hk', '7hk', 'Tm'],
  );
  assert.equal(r.duplicates, 1);
  assert.equal(r.caseVariants, 1);
  assert.deepEqual(r.invalid, [{ line: 6, text: 'lixo 123' }]);
});

test('scan valida contra a lista, respeitando maiúsculas', async () => {
  // Lida antes do import: fica `seen` e é promovida no import.
  assert.equal(await scan('Tm'), 'seen');

  const { units } = parseRegistry([link('qZ'), link('7Hk'), link('Tm')].join('\n'));
  const r = await importRegistry(db, units, 'teste.csv');
  assert.deepEqual(r, { inserted: 3, skipped: 0, promoted: 1 });
  assert.equal(await scan('Tm'), 'verified');

  assert.equal(await scan('qZ'), 'verified');
  assert.equal(await scan('7Hk'), 'verified');
  assert.equal(await scan('7hk'), 'seen', 'caixa diferente é outra unidade');
  assert.equal(await scan('QZ'), 'seen');
  assert.equal(await scan('qZ', GTIN, 'W5'), 'seen', 'lote errado');
  assert.equal(await scan('qZ', `0${GTIN}`), 'verified', 'GTIN-14 casa com GTIN-13');

  // Reimportar o mesmo arquivo não duplica.
  assert.deepEqual(await importRegistry(db, units, 'teste.csv'), { inserted: 0, skipped: 3, promoted: 0 });
});

test('unidade bloqueada continua bloqueada', async () => {
  await scan('qZ');
  await db.query(`update units set status = 'blocked' where unit_id = 'qZ' and lot_id = 'W4' and product_id = $1`, [GTIN]);
  assert.equal(await scan('qZ'), 'blocked');
});

test('import pela API exige ADMIN_TOKEN e devolve o resumo', async () => {
  const admin = createApp(db, { allowedOrigins: [], adminToken: 'test-admin-token-123456' });
  const body = [link('Rr1'), link('Rr2'), link('Rr1'), 'lixo 9'].join('\n');
  const send = (auth?: string) =>
    admin.request('/api/admin/registry?batch=lote-teste', {
      method: 'POST',
      body,
      headers: auth ? { Authorization: `Bearer ${auth}` } : {},
    });

  assert.equal((await send()).status, 401);
  assert.equal((await send('errado-errado-errado')).status, 401);
  assert.equal((await app.request('/api/admin/registry', { method: 'POST', body })).status, 404, 'sem token configurado a rota não existe');

  const r = await send('test-admin-token-123456');
  assert.equal(r.status, 200);
  const j = (await r.json()) as Record<string, unknown>;
  assert.equal(j.units, 2);
  assert.equal(j.inserted, 2);
  assert.equal(j.duplicates, 1);
  assert.equal(j.invalid, 1);
  assert.deepEqual(j.lots, { [`0${GTIN}/W4`]: 2 });
  assert.equal(await scan('Rr2'), 'verified');
});
