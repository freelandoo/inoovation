// Testa a RA em modo câmera com câmera simulada. Uso (com `npx vite --port 5181` rodando): node scripts/ar-camera.mjs saida.png
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:5181/?unit=AO', { waitUntil: 'load' });
await p.waitForTimeout(3000);
await p.evaluate(() => document.getElementById('ar').scrollIntoView());
await p.waitForTimeout(1200);
await p.click('#ar-button');
await p.waitForTimeout(6000);
console.log(await p.evaluate(() => ({ mode: document.getElementById('arx')?.dataset.mode, videoZ: getComputedStyle(document.querySelector('.arx-video')).zIndex, stageZ: getComputedStyle(document.getElementById('stage')).zIndex })), errs);
await p.screenshot({ path: process.argv[2] });
await b.close();
