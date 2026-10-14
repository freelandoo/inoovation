// Teste de ponta a ponta do jogo num navegador real (Chromium + SwiftShader).
//
//   node scripts/game-check.mjs [baseUrl] [outDir]
//
// Celular (390x844, toque): menu -> JOGAR -> toque real (CDP) pilotado pelo
// autopiloto da simulação -> coleta -> morte -> fim de partida -> reinício.
// Computador: mouse e tecla Espaço. Salva screenshots e falha com código 1 se
// algo não acontecer ou se houver erro no console.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:5199';
const out = process.argv[3] || 'shots/game';
mkdirSync(out, { recursive: true });
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails.push(msg);
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(vp) {
  const page = await browser.newPage(vp);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/jogo?debug`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.state === 'menu', null, { timeout: 60000 });
  return { page, errors };
}
const state = (page) => page.evaluate(() => document.documentElement.dataset.state);
const snap = (page) =>
  page.evaluate(() => {
    const g = window.__game;
    return {
      state: g.state,
      x: g.world.x,
      y: g.world.y,
      fuel: g.world.fuel.value,
      pickups: g.world.pickupsTaken,
      obstacles: g.world.obstacles.length,
      alive: g.world.alive,
      thrusting: g.world.thrusting,
    };
  });

// ------------------------------------------------------------ celular
{
  const { page, errors } = await open({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await page.screenshot({ path: `${out}/m1-menu.png` });
  await page.tap('#jg-play');
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
  check((await snap(page)).state === 'ready', 'JOGAR leva ao estado READY');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/m2-ready.png` });
  const s0 = await snap(page);
  check(s0.x === 0, 'READY não avança sem toque');

  // Toque tocando no HUD (pausa) não pode ligar o jetpack — testado depois.
  const cdp = await page.context().newCDPSession(page);
  const touch = (type) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 200, y: 520, id: 1 }] });

  // Autopiloto da própria simulação decide; o toque é real (CDP).
  await page.evaluate(async () => {
    const m = await import('/src/game/sim/autopilot.ts');
    window.__auto = () => m.autopilot(window.__game.world);
  });
  // Pausa pelo botão do HUD: tocar nele não liga o jetpack.
  await touch('touchStart');
  await page.waitForFunction(() => window.__game.world.x > 2, null, { timeout: 10000 });
  await touch('touchEnd');
  await page.tap('#jg-pause');
  check((await state(page)) === 'paused', 'botão de pausa pausa');
  check(!(await snap(page)).thrusting, 'tocar no HUD não liga o jetpack');
  const px = (await snap(page)).x;
  await page.waitForTimeout(500);
  check((await snap(page)).x === px, 'pausado não avança');
  await page.screenshot({ path: `${out}/m5-pause.png` });
  await page.tap('#jg-resume');
  await page.waitForFunction(() => document.documentElement.dataset.state === 'playing', null, { timeout: 5000 });

  // O screenshot no SwiftShader trava o teste ~1 s: enquanto ele acontece, o
  // autopiloto assume dentro da página (sem latência) e depois devolve ao toque.
  const shoot = async (path) => {
    await page.evaluate(() =>
      Object.defineProperty(window.__game.input, 'held', { configurable: true, get: () => window.__auto() }),
    );
    await page.screenshot({ path });
    await page.evaluate(() => delete window.__game.input.held);
  };
  let holding = false;
  let shots = 0;
  let thrustSeen = false;
  let started = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const want = await page.evaluate(() => window.__auto());
    if (want !== holding) {
      await touch(want ? 'touchStart' : 'touchEnd');
      holding = want;
    }
    const s = await snap(page);
    if (s.state === 'playing') started = true;
    if (s.thrusting) thrustSeen = true;
    if (started && s.thrusting && shots === 0 && s.x > 6) {
      await shoot(`${out}/m3-thrust.png`);
      shots++;
    }
    if (started && shots === 1 && s.x > 60) {
      await shoot(`${out}/m4-run.png`);
      shots++;
    }
    if (!s.alive || s.x > 120) break;
  }
  const mid = await snap(page);
  check(started || mid.x > 0, 'primeiro toque inicia a partida');
  check(thrustSeen, 'segurar liga o jetpack');
  check(mid.x > 30, `o astronauta avançou (${mid.x.toFixed(0)} m)`);
  check(mid.pickups > 0, `coletou cápsulas (${mid.pickups})`);
  check(mid.obstacles > 0 && mid.obstacles < 12, `obstáculos ativos limitados (${mid.obstacles})`);

  // Solta e deixa cair: morte no chão ou num obstáculo.
  if (holding) await touch('touchEnd');
  await page.waitForFunction(() => !window.__game.world.alive, null, { timeout: 20000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/m6-crash.png` });
  await page.waitForFunction(() => document.documentElement.dataset.state === 'over', null, { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/m7-over.png` });
  check(true, 'colisão leva ao fim de partida');
  const dist = await page.textContent('#jg-over-dist');
  check(/\d+ m/.test(dist ?? ''), `fim mostra a distância (${dist})`);

  // Reinício: mesmo número de objetos visuais na cena.
  const count = () =>
    page.evaluate(() => {
      let n = 0;
      window.__game.scene.traverse(() => n++);
      return n;
    });
  const before = await count();
  await page.tap('#jg-again');
  check((await state(page)) === 'ready', 'JOGAR DE NOVO volta ao READY');
  const r = await snap(page);
  check(r.x === 0 && r.fuel === 100 && r.alive, 'reinício zera distância e combustível');
  check((await count()) === before, `reinício não duplica objetos da cena (${before})`);
  check(errors.length === 0, `sem erros no console (${errors.join(' | ')})`);
  await page.close();
}

// ------------------------------------------------------------ computador
{
  const { page, errors } = await open({ viewport: { width: 1280, height: 800 } });
  await page.screenshot({ path: `${out}/d1-menu.png` });
  await page.keyboard.press('Enter');
  check((await state(page)) === 'ready', 'Enter abre a partida');
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__game.world.thrusting, null, { timeout: 5000 });
  check(true, 'Espaço liga o jetpack');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/d2-space.png` });
  await page.keyboard.up('Space');
  await page.waitForFunction(() => !window.__game.world.thrusting, null, { timeout: 2000 });
  check(true, 'soltar Espaço desliga');
  // O screenshot no SwiftShader é lento: se ele já caiu, começa outra partida.
  if (!(await page.evaluate(() => window.__game.world.alive))) {
    await page.waitForFunction(() => document.documentElement.dataset.state === 'over', null, { timeout: 5000 });
    await page.waitForTimeout(1700);
    await page.keyboard.press('Enter');
  }
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.waitForFunction(() => window.__game.world.thrusting, null, { timeout: 2000 });
  check(true, 'mouse pressionado liga o jetpack');
  // Perder o foco solta o jetpack.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(() => !window.__game.world.thrusting, null, { timeout: 2000 });
  check(true, 'perder o foco solta o jetpack');
  await page.mouse.up();
  check(errors.length === 0, `sem erros no console (${errors.join(' | ')})`);
  await page.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} falha(s)` : '\ntudo ok');
process.exit(fails.length ? 1 : 0);
