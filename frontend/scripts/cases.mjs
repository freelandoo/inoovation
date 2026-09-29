import { chromium } from 'playwright';
// Testa fallbacks e casos-limite. Uso: node scripts/cases.mjs <pastaDeSaida>
import { mkdirSync } from 'node:fs';
const out = process.argv[2] || 'shots';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const cases = [
  ['low', '/?tier=low&product=1845678901001&lot=l1&unit=AO', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['reduced', '/?reduced&unit=AO', { width: 1440, height: 900 }],
  ['noparams', '/', { width: 1440, height: 900 }],
  ['invalid', '/?product=%3Cscript%3Ealert(1)%3C/script%3E&lot=l1&unit=' + 'x'.repeat(80), { width: 1440, height: 900 }],
  ['route', '/innovation/1845678901001/l1/AO', { width: 1440, height: 900 }],
];
for (const [name, url, vp] of cases) {
  const p = await b.newPage({ viewport: { width: vp.width, height: vp.height }, ...vp });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:5173' + url, { waitUntil: 'load' });
  await p.waitForTimeout(3500);
  const info = await p.evaluate(() => ({
    tier: document.documentElement.dataset.tier,
    fields: [...document.querySelectorAll('.passport [data-field]')].map((e) => e.textContent),
    hud: document.getElementById('hud-identity').textContent,
    inline: document.querySelector('[data-identity-inline]').textContent,
    bad: /undefined|null|<script/i.test(document.body.innerText),
    qr: document.getElementById('qr-url').textContent,
  }));
  await p.screenshot({ path: `${out}/case-${name}.png` });
  if (name === 'noparams') {
    await p.evaluate(() => document.getElementById('ar').scrollIntoView());
    await p.waitForTimeout(1200);
    await p.click('#ar-button');
    await p.waitForTimeout(4500);
    info.arOpen = await p.evaluate(() => ({ open: document.documentElement.classList.contains('ar-open'), mode: document.getElementById('arx')?.dataset.mode, hint: document.querySelector('.arx-hint')?.textContent }));
    await p.screenshot({ path: `${out}/case-ar-open.png` });
    await p.click('[data-a="close"]');
    await p.waitForTimeout(1000);
    info.arClosed = await p.evaluate(() => !document.documentElement.classList.contains('ar-open'));
    await p.screenshot({ path: `${out}/case-ar-closed.png` });
  }
  console.log(name, JSON.stringify(info), 'errors:', errs);
  await p.close();
}
await b.close();
