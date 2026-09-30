import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitFromQrText, unitPath } from '../src/scanner/decode.ts';
import { resolveIdentity } from '../src/identity/resolver.ts';

const P = {
  product: ['product', 'productId', 'gtin', '01'],
  lot: ['lot', 'lotId', 'lote', '10'],
  unit: ['unit', 'unitId', 'serial', 'sn', '21'],
  source: ['source', 'utm_source', 'src'],
  campaign: ['campaign', 'utm_campaign', 'cmp'],
  digitalLink: ['dl', 'link'],
};

test('link do QR impresso da Realizse', () => {
  assert.deepEqual(unitFromQrText('https://ri3.ai/01/7898693620895/10/W4/21/Pg'), {
    productId: '7898693620895',
    lotId: 'W4',
    unitId: 'Pg',
  });
});

test('mantém maiúsculas/minúsculas do serial', () => {
  assert.equal(unitFromQrText('https://ri3.ai/01/7898693620895/10/W4/21/7hk')?.unitId, '7hk');
  assert.equal(unitFromQrText('https://ri3.ai/01/7898693620895/10/W4/21/7Hk')?.unitId, '7Hk');
});

test('espaços e quebra de linha em volta são ignorados; lote é opcional', () => {
  assert.deepEqual(unitFromQrText('  https://ri3.ai/01/7898693620895/21/QRRd\n'), {
    productId: '7898693620895',
    lotId: null,
    unitId: 'QRRd',
  });
});

test('recusa QR que não é de unidade', () => {
  for (const t of [
    'https://instagram.com/realizse',
    'https://ri3.ai/01/7898693620895/10/W4',
    'https://ri3.ai/01/abc/10/W4/21/Pg',
    'https://ri3.ai/01/7898693620895/10/W4/21/<script>',
    'javascript:alert(1)//01/7898693620895/21/Pg',
    'texto qualquer',
    '7898693620895',
    '',
    'https://ri3.ai/01/7898693620895/21/' + 'x'.repeat(600),
  ]) {
    assert.equal(unitFromQrText(t), null, t);
  }
});

test('o caminho gerado volta à mesma unidade no resolver da página', () => {
  const u = unitFromQrText('https://ri3.ai/01/7898693620895/10/W4/21/K665')!;
  assert.equal(unitPath(u), '/01/7898693620895/10/W4/21/K665');
  const id = resolveIdentity(`https://x.com${unitPath(u)}?via=scanner`, P);
  assert.deepEqual([id.productId, id.lotId, id.unitId], ['7898693620895', 'W4', 'K665']);
  assert.equal(unitPath({ productId: '7898693620895', lotId: null, unitId: 'a.b' }), '/01/7898693620895/21/a.b');
});
