// Compila os alvos de rastreamento da RA (MindAR) a partir da arte do rótulo.
// Uso: node scripts/build_ar_target.mjs   ->  public/ar/label.mind
//
// Alvos (recortes em pixels de label-2048.jpg, 2048x762):
//   0      rótulo inteiro (rótulo plano / impresso / numa tela)
//   1..4   faixas verticais sobrepostas de ~1/3 da largura: no pote o rótulo é curvo e a
//          câmera só vê uma parte dele de cada vez; cada faixa é quase plana.
// A área do QR e do número de série é pintada com a cor do painel: muda a cada unidade.
// A ordem dos alvos não importa para o app (a posição do astronauta é relativa a cada alvo).

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const ORIGIN = 'http://ar-build.local';
const files = {
  '/label.jpg': ['public/innovation-week/label/base/label-2048.jpg', 'image/jpeg'],
  '/mindar/mindar-image.prod.js': ['public/ar/mindar/mindar-image.prod.js', 'text/javascript'],
  '/mindar/controller-mGt1s8dJ.js': ['public/ar/mindar/controller-mGt1s8dJ.js', 'text/javascript'],
  '/mindar/ui-fBadYuor.js': ['public/ar/mindar/ui-fBadYuor.js', 'text/javascript'],
};

const STRIP_W = 680;
const STRIP_STEP = 456;
const MASK = { x: 1835, y: 512, w: 127, h: 168, color: 'rgb(35,31,32)' };
// Os alvos são compilados em escala reduzida: o MindAR rastreia bem com ~500-1000 px e
// o arquivo .mind cresce rápido com a resolução.
const SCALE = 0.5;

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
p.on('console', (m) => console.log('[page]', m.text()));
await p.route(`${ORIGIN}/**`, async (route) => {
  const path = new URL(route.request().url()).pathname;
  const f = files[path];
  if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8">' });
  if (!f) return route.fulfill({ status: 404, body: '' });
  route.fulfill({ contentType: f[1], body: await readFile(root + f[0]) });
});
await p.goto(ORIGIN + '/');

const b64 = await p.evaluate(
  async ({ STRIP_W, STRIP_STEP, MASK, SCALE }) => {
    const { Compiler } = await import('/mindar/mindar-image.prod.js');
    const img = new Image();
    img.src = '/label.jpg';
    await img.decode();
    const W = img.naturalWidth;
    const H = img.naturalHeight;

    const masked = document.createElement('canvas');
    masked.width = W;
    masked.height = H;
    const g = masked.getContext('2d');
    g.drawImage(img, 0, 0);
    g.fillStyle = MASK.color;
    g.fillRect(MASK.x, MASK.y, MASK.w, MASK.h);

    const regions = [[0, W]];
    for (let x = 0; x + STRIP_W <= W; x += STRIP_STEP) regions.push([x, STRIP_W]);
    if (regions.at(-1)[0] + STRIP_W < W) regions.push([W - STRIP_W, STRIP_W]);

    const targets = [];
    for (const [x, w] of regions) {
      const c = document.createElement('canvas');
      c.width = Math.round(w * SCALE);
      c.height = Math.round(H * SCALE);
      const cg = c.getContext('2d');
      cg.imageSmoothingQuality = 'high';
      cg.drawImage(masked, x, 0, w, H, 0, 0, c.width, c.height);
      const t = new Image();
      t.src = c.toDataURL('image/png');
      await t.decode();
      targets.push(t);
    }
    console.log(`alvos: ${regions.map(([x, w]) => `${x}+${w}`).join(', ')}`);

    const compiler = new Compiler();
    let last = -10;
    await compiler.compileImageTargets(targets, (pct) => {
      if (pct - last >= 10) console.log(`compilando ${pct.toFixed(0)}%`), (last = pct);
    });
    const data = compiler.exportData();
    let s = '';
    for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return btoa(s);
  },
  { STRIP_W, STRIP_STEP, MASK, SCALE },
);
await b.close();

const out = Buffer.from(b64, 'base64');
await writeFile(root + 'public/ar/label.mind', out);
console.log(`public/ar/label.mind (${(out.length / 1024).toFixed(0)} KB)`);
