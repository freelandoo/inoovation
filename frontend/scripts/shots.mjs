// Captura screenshots das cenas principais (inspeção visual).
// Uso: node scripts/shots.mjs [baseUrl] [outDir] [desktop|mobile|all] [query]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || 'shots';
const which = process.argv[4] || 'all';
const query = process.argv[5] ?? '?product=1845678901001&lot=l1&unit=AO';
mkdirSync(out, { recursive: true });

const scenes = [
  ['01-hero', 'hero', 0],
  ['02-rg', 'rg', 0],
  ['03-surface', 'surface', 0.45],
  ['04-lights-off', 'lights', 0.6],
  ['05-exploded', 'layers', 0.92],
  ['06-qr-zoom', 'qr', 0.32],
  ['07-qr-data', 'qr', 0.62],
  ['08-qr-card', 'qr', 0.95],
  ['09-identity', 'identity', 0.6],
  ['10-orbit', 'orbit', 0.4],
  ['11-physical', 'physical', 0.5],
  ['12-tech', 'tech', 0],
  ['13-ar', 'ar', 0],
];

const viewports = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [name, vp] of Object.entries(viewports)) {
  if (which !== 'all' && which !== name) continue;
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, ...vp });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + '/' + query, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  for (const [file, id, p] of scenes) {
    await page.evaluate(
      ([id, p]) => {
        const el = document.getElementById(id);
        const top = el.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, top + p * Math.max(0, el.offsetHeight - window.innerHeight));
      },
      [id, p],
    );
    await page.waitForTimeout(file === '04-lights-off' ? 1400 : 1600);
    await page.screenshot({ path: `${out}/${name}-${file}.png` });
  }
  console.log(name, 'errors:', errors.length ? errors : 'none');
  await page.close();
}
await browser.close();
