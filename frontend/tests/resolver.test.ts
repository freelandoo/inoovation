import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentity, gtinChecksumValid, display, hasIds } from '../src/identity/resolver.ts';

const P = {
  product: ['product', 'productId', 'gtin', '01'],
  lot: ['lot', 'lotId', 'lote', '10'],
  unit: ['unit', 'unitId', 'serial', 'sn', '21'],
  source: ['source', 'utm_source', 'src'],
  campaign: ['campaign', 'utm_campaign', 'cmp'],
  digitalLink: ['dl', 'link'],
};
const R = ['innovation', 'iw'];
const ids = (href: string) => {
  const id = resolveIdentity(href, P, R);
  return [id.productId, id.lotId, id.unitId, id.origin];
};

test('query do prompt', () => {
  assert.deepEqual(ids('https://x.com/innovation?product=1845678901001&lot=l1&unit=AO'), ['1845678901001', 'l1', 'AO', 'query']);
});

test('rota curta do prompt', () => {
  assert.deepEqual(ids('https://x.com/innovation/1845678901001/l1/AO'), ['1845678901001', 'l1', 'AO', 'route']);
});

test('caminho GS1 igual ao QR impresso', () => {
  assert.deepEqual(ids('https://x.com/01/1845678901001/10/l1/21/AO'), ['1845678901001', 'l1', 'AO', 'gs1-path']);
});

test('link GS1 inteiro em ?dl=', () => {
  const dl = encodeURIComponent('https://ri3.ai/01/1845678901001/10/l1/21/AO');
  assert.deepEqual(ids(`https://x.com/?dl=${dl}`), ['1845678901001', 'l1', 'AO', 'digital-link']);
});

test('source e campaign', () => {
  const id = resolveIdentity('https://x.com/?unit=AO&utm_source=qr&utm_campaign=iw26', P, R);
  assert.equal(id.source, 'qr');
  assert.equal(id.campaign, 'iw26');
});

test('parâmetros parciais continuam funcionando', () => {
  assert.deepEqual(ids('https://x.com/?unit=AO'), [null, null, 'AO', 'query']);
});

test('sem parâmetros não quebra', () => {
  const id = resolveIdentity('https://x.com/', P, R);
  assert.equal(hasIds(id), false);
  assert.equal(id.origin, 'none');
});

test('caracteres inválidos são descartados', () => {
  assert.deepEqual(ids('https://x.com/?product=<script>&lot=l1&unit=A%22O'), [null, 'l1', null, 'query']);
  assert.deepEqual(ids('https://x.com/?product=12345678901234567890'), [null, null, null, 'none']);
  assert.deepEqual(ids('https://x.com/?unit=' + 'A'.repeat(50)), [null, null, null, 'none']);
  assert.deepEqual(ids('https://x.com/innovation/%E0%A4%A/l1/AO'), [null, 'l1', 'AO', 'route']);
});

test('dígito verificador GTIN', () => {
  assert.equal(gtinChecksumValid('01845678901001'), true);
  assert.equal(gtinChecksumValid('01845678901002'), false);
});

test('display nunca mostra null/undefined', () => {
  assert.equal(display(null, 'UNIQUE UNIT'), 'UNIQUE UNIT');
  assert.equal(display('l1', '—'), 'L1');
});
