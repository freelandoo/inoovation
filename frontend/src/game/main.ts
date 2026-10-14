// Astronaut Jetpack — página /jogo.
//
// Estados da página (html[data-state]): loading -> menu -> ready -> playing
// (-> paused -> countdown -> playing) -> over -> ready ... ; error se o 3D ou o
// modelo não carregarem. A simulação (sim/) roda em passos fixos de 1/120 s; o
// desenho interpola entre os dois últimos passos.

import * as THREE from 'three';
import './game.css';
import { detectPerf } from '../perf/tier.ts';
import { World, type GameEvent } from './sim/world.ts';
import { randomSeed } from './sim/rng.ts';
import { TUNING } from './sim/tuning.ts';
import { Stage } from './render/stage.ts';
import { Environment } from './render/environment.ts';
import { ObstacleRenderer, PickupRenderer } from './render/obstacles.ts';
import { AstronautView } from './render/astronaut.ts';
import { Particles, glowTexture } from './render/particles.ts';
import { Input } from './input.ts';
import { GameAudio } from './audio.ts';
import * as api from './api.ts';

type PageState = 'loading' | 'menu' | 'ready' | 'playing' | 'paused' | 'countdown' | 'over' | 'error';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const html = document.documentElement;
const frame = $('jg-frame');
const surface = $('jg-surface');
const canvas = $<HTMLCanvasElement>('jg-canvas');
const ui = {
  dist: $('jg-dist'),
  best: $('jg-best'),
  fuelBar: $('jg-fuel-bar'),
  fuelPct: $('jg-fuel-pct'),
  fuel: $('jg-fuel'),
  powerBar: $('jg-power-bar'),
  hint: $('jg-hint'),
  toast: $('jg-toast'),
  progress: $('jg-progress'),
  menuBest: $('jg-menu-best'),
  overDist: $('jg-over-dist'),
  overBest: $('jg-over-best'),
  overFuel: $('jg-over-fuel'),
  overRecord: $('jg-over-record'),
  overNet: $('jg-over-net'),
  overTop: $('jg-over-top'),
  count: $('jg-count'),
  errorMsg: $('jg-error-msg'),
  net: $('jg-net'),
};
const debug = new URLSearchParams(location.search).has('debug');

const perf = detectPerf();
const audio = new GameAudio();
const input = new Input(surface);
let state: PageState = 'loading';

function setState(s: PageState) {
  state = s;
  html.dataset.state = s;
}

// ---------------------------------------------------------------- 3D

if (!perf.webgl2) {
  ui.errorMsg.textContent = 'Este aparelho ou navegador não tem suporte a gráficos 3D (WebGL 2).';
  html.dataset.noRetry = '1';
  setState('error');
  throw new Error('sem WebGL 2');
}

const stage = new Stage(canvas, frame, perf);
const glow = glowTexture();
const env = new Environment(stage, perf.tier === 'high' ? 'high' : 'medium');
const fire = new Particles(stage.scene, perf.tier === 'high' ? 420 : 240, glow, true);
const smoke = new Particles(stage.scene, perf.tier === 'high' ? 200 : 110, glow, false);
const obstacles = new ObstacleRenderer(stage.scene);
const potTexture = new THREE.TextureLoader().load('/innovation-week/deck/pot.webp');
potTexture.colorSpace = THREE.SRGBColorSpace;
const pickups = new PickupRenderer(stage.scene, glow, fire, potTexture);
const astro = new AstronautView(stage.scene, fire, smoke, glow);
const world = new World(randomSeed());

function onResize() {
  stage.resize();
  env.setPixelRatio(stage.renderer.getPixelRatio());
  const h = stage.renderer.domElement.height;
  fire.setViewport(h, stage.camera.fov);
  smoke.setViewport(h, stage.camera.fov);
}
new ResizeObserver(onResize).observe(frame);
onResize();

// Caixa de colisão visível em ?debug.
const hitbox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(TUNING.hitW, TUNING.hitH)),
  new THREE.LineBasicMaterial({ color: 0x00ff88 }),
);
hitbox.visible = debug;
stage.scene.add(hitbox);

// ---------------------------------------------------------------- partida

let ticket: api.RunTicket | null = null;
let ticketReq: Promise<api.RunTicket | null> | null = null;
let runId: string | null = null;
let acc = 0;
let prevX = 0;
let prevY = TUNING.startY;
let deathY = 0;
let deathVy = 0;
let deathAt = 0;
let shownDist = -1;
let shownFuel = -1;
let countdownEnd = 0;
let overTimer = 0;

/** Pede ao servidor a seed da próxima partida, sem esperar por ela. */
function prefetchTicket() {
  if (!api.online() || ticketReq) return;
  ticketReq = api.startRun().then((t) => {
    ticketReq = null;
    ticket = t;
    return t;
  });
}

function prepareRun() {
  clearTimeout(overTimer);
  const t = ticket;
  ticket = null;
  runId = t?.runId ?? null;
  world.reset(t?.seed ?? randomSeed());
  obstacles.reset();
  pickups.reset();
  fire.clear();
  smoke.clear();
  acc = 0;
  prevX = world.x;
  prevY = world.y;
  shownDist = shownFuel = -1;
  ui.fuel.classList.remove('low');
  delete html.dataset.power;
  astro.setPower(0);
  astro.play('idle', 0.3);
  astro.setTimeScale(1);
  ui.hint.hidden = api.plays() >= 3;
  updateHud();
  setState('ready');
  prefetchTicket();
}

function handle(e: GameEvent) {
  switch (e.type) {
    case 'start':
      api.countPlay();
      astro.play('fly', 0.2);
      setState('playing');
      setTimeout(() => (ui.hint.hidden = true), 2500);
      break;
    case 'thrust_on':
      audio.setJet(true);
      break;
    case 'thrust_off':
      audio.setJet(false);
      if (world.alive) audio.play('off');
      astro.puff();
      break;
    case 'pickup':
      if (e.kind === 'vulcan') {
        audio.play('vulcan');
        burst(e.x, e.y, [1, 0.12, 0.04], 70);
        stage.addShake(0.35);
        toast('EVORA VULCAN · QUEBRE AS PILASTRAS', 'power');
      } else {
        audio.play(e.kind === 'big' ? 'pickup_big' : 'pickup');
        burst(e.x, e.y, e.kind === 'big' ? [1, 0.8, 0.35] : [0.3, 0.95, 1], e.kind === 'big' ? 40 : 24);
        toast(`+${Math.round(e.added)} COMBUSTÍVEL`, 'fuel');
      }
      ui.fuel.classList.remove('pulse');
      void ui.fuel.offsetWidth;
      ui.fuel.classList.add('pulse');
      break;
    case 'fuel_low':
      audio.play('low');
      break;
    case 'fuel_empty':
      toast('SEM COMBUSTÍVEL', 'warn');
      break;
    case 'power_on':
      html.dataset.power = '1';
      break;
    case 'power_off':
      delete html.dataset.power;
      if (world.alive) audio.play('power_off');
      break;
    case 'smash':
      audio.play('smash');
      stage.addShake(0.55);
      debris(e.x, e.y);
      if ('vibrate' in navigator) navigator.vibrate?.(40);
      break;
    case 'pass':
      audio.play('pass');
      break;
    case 'phase':
      toast(`FASE ${e.phase}`, 'phase');
      break;
    case 'dead':
      die();
      break;
  }
}

function die() {
  audio.setJet(false);
  audio.play('crash');
  stage.addShake(1);
  frame.classList.remove('hit');
  void frame.offsetWidth;
  frame.classList.add('hit');
  astro.play('impact', 0.08);
  deathY = world.y;
  deathVy = Math.max(world.vy, 2);
  deathAt = performance.now();
  const p = astro.packWorld(new THREE.Vector3());
  burst(p.x, p.y, [1, 0.45, 0.1], 46);
  if ('vibrate' in navigator) navigator.vibrate?.(120);
  overTimer = window.setTimeout(gameOver, 1150);
}

function burst(x: number, y: number, c: [number, number, number], n: number) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 1.5 + Math.random() * 4;
    fire.emit({
      x, y, z: 0.2,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: (Math.random() - 0.5) * 2,
      life: 0.35 + Math.random() * 0.35, size: 0.12 + Math.random() * 0.12,
      c0: [1, 1, 1], c1: c, drag: 3.5, gy: -4,
    });
  }
}

/** Pilastra quebrada: estilhaços de metal caindo + faíscas vermelhas. */
function debris(x: number, y: number) {
  for (let i = 0; i < 26; i++) {
    const a = (Math.random() - 0.5) * Math.PI * 1.4;
    const s = 3 + Math.random() * 5;
    smoke.emit({
      x, y: y + (Math.random() - 0.5) * 0.6, z: (Math.random() - 0.5) * 0.8,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s + 1.5, vz: (Math.random() - 0.5) * 3,
      life: 0.6 + Math.random() * 0.5, size: 0.1 + Math.random() * 0.14,
      c0: [0.62, 0.64, 0.68], c1: [0.2, 0.2, 0.22], drag: 0.8, gy: -14,
    });
  }
  burst(x, y, [1, 0.15, 0.05], 36);
}

let toastTimer = 0;
function toast(text: string, kind: 'fuel' | 'warn' | 'phase' | 'net' | 'power') {
  ui.toast.textContent = text;
  ui.toast.dataset.kind = kind;
  ui.toast.classList.remove('show');
  void ui.toast.offsetWidth;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.remove('show'), 1300);
}

const pad = (n: number) => String(Math.floor(n)).padStart(6, '0');

function updateHud() {
  const d = Math.floor(world.distance);
  if (d !== shownDist) {
    shownDist = d;
    ui.dist.textContent = pad(d);
  }
  if (world.powered) ui.powerBar.style.transform = `scaleX(${world.powerLeft / TUNING.powerTime})`;
  const f = Math.ceil(world.fuel.ratio * 100);
  if (f !== shownFuel) {
    shownFuel = f;
    ui.fuelBar.style.transform = `scaleX(${world.fuel.ratio})`;
    ui.fuelPct.textContent = `${f}%`;
    ui.fuel.classList.toggle('low', world.fuel.isLow);
    ui.fuel.classList.toggle('empty', world.fuel.empty);
  }
}

function showBest() {
  const b = api.localBest();
  ui.best.textContent = b ? `RECORDE ${pad(b)} m` : '';
  ui.menuBest.textContent = b ? `Seu recorde: ${b} m` : 'Segure para subir. Solte para cair.';
}

async function gameOver() {
  const distance = Math.floor(world.distance);
  const record = api.saveLocalBest(distance);
  if (record && distance > 0) audio.play('record');
  ui.overDist.textContent = `${distance} m`;
  ui.overBest.textContent = `${api.localBest()} m`;
  ui.overFuel.textContent = `${Math.round(world.fuelCollected)} (${world.pickupsTaken} cápsulas)`;
  ui.overRecord.hidden = !(record && distance > 0);
  ui.overTop.replaceChildren();
  showBest();
  setState('over');

  if (!api.online()) {
    ui.overNet.textContent = 'Recorde salvo neste aparelho.';
    return;
  }
  const token = api.memberToken();
  ui.overNet.textContent = token && runId ? 'Enviando para o ranking…' : 'Recorde salvo neste aparelho. Ative um pote para entrar no ranking.';
  if (token && runId) {
    const r = await api.finishRun(runId, distance, Math.round(world.fuelCollected), world.pickupsTaken);
    if (state !== 'over') return;
    ui.overNet.textContent = r
      ? `Ranking: seu melhor é ${r.best} m${r.rank ? ` · ${r.rank}º lugar` : ''}.`
      : 'Sem conexão com o ranking agora. O recorde ficou salvo neste aparelho.';
  } else if (runId) {
    void api.finishRun(runId, distance, Math.round(world.fuelCollected), world.pickupsTaken);
  }
  const top = (await api.topScores(5))?.top;
  if (state !== 'over' || !top?.length) return;
  for (const t of top) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="n">#${t.crew}</span><span class="who"></span><b>${t.best} m</b>`;
    (li.querySelector('.who') as HTMLElement).textContent = t.name;
    ui.overTop.append(li);
  }
}

function pause() {
  if ((state !== 'playing' && state !== 'countdown') || !world.alive) return;
  input.releaseAll();
  audio.setJet(false);
  audio.suspend(true);
  setState('paused');
}

function resume() {
  audio.unlock();
  audio.suspend(false);
  countdownEnd = performance.now() + 1500;
  setState('countdown');
}

function goBack() {
  const token = api.memberToken();
  try {
    if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) {
      history.back();
      return;
    }
  } catch {
    /* referrer inválido */
  }
  location.href = token ? `/membro/${token}` : '/';
}

// ---------------------------------------------------------------- controles da página

input.onPress = () => audio.unlock();
input.onPause = () => (state === 'paused' ? resume() : pause());
input.onConfirm = () => {
  if (state === 'menu' || (state === 'over' && performance.now() - deathAt > 1600)) {
    audio.unlock();
    prepareRun();
  } else if (state === 'paused') resume();
};

const click = (id: string, fn: () => void) =>
  $(id).addEventListener('click', () => {
    audio.unlock();
    audio.play('ui');
    fn();
  });
click('jg-play', prepareRun);
click('jg-again', prepareRun);
click('jg-resume', resume);
click('jg-restart', () => {
  audio.suspend(false);
  prepareRun();
});
click('jg-pause', () => (state === 'paused' ? resume() : pause()));
click('jg-quit', goBack);
click('jg-back', goBack);
click('jg-ranking', () => (location.href = '/ranking'));
click('jg-menu-back', goBack);
click('jg-retry', () => location.reload());
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-sound]')) {
  b.addEventListener('click', () => {
    audio.unlock();
    audio.setEnabled(!audio.enabled);
    syncSound();
  });
}
function syncSound() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-sound]')) {
    b.setAttribute('aria-pressed', String(!audio.enabled));
    b.title = audio.enabled ? 'Desligar som' : 'Ligar som';
  }
  html.dataset.sound = audio.enabled ? 'on' : 'off';
}
syncSound();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
window.addEventListener('online', () => html.removeAttribute('data-offline'));
window.addEventListener('offline', () => (html.dataset.offline = '1'));
if (!navigator.onLine) html.dataset.offline = '1';

// ---------------------------------------------------------------- laço

let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;

function frameLoop(now: number) {
  requestAnimationFrame(frameLoop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const time = now / 1000;
  input.pollGamepad();

  if (state === 'countdown') {
    const left = Math.ceil((countdownEnd - now) / 500);
    ui.count.textContent = String(Math.max(1, left));
    if (now >= countdownEnd) {
      acc = 0;
      setState('playing');
    }
  }

  if (state === 'ready' || state === 'playing') {
    acc += dt;
    let n = 0;
    while (acc >= TUNING.step && n < 24) {
      prevX = world.x;
      prevY = world.y;
      world.step(input.held);
      acc -= TUNING.step;
      n++;
      for (const e of world.drain()) handle(e);
      if (state !== 'playing' && state !== 'ready') break;
      if (world.state === 'ready') {
        acc = 0;
        break;
      }
    }
    if (n === 24) acc = 0; // aparelho travou: não tenta recuperar o atraso
  }

  // Posição desenhada (interpolada entre passos).
  const alpha = state === 'playing' ? acc / TUNING.step : 1;
  const x = prevX + (world.x - prevX) * alpha;
  let y = prevY + (world.y - prevY) * alpha;
  if (!world.alive) {
    // Depois da batida: cai até o chão.
    deathVy -= TUNING.gravity * dt;
    deathY = Math.max(TUNING.floor + 0.25, deathY + deathVy * dt);
    y = deathY;
  }
  astro.root.position.set(x, y, 0);
  hitbox.position.set(world.x, world.y, 0.6);
  const mode = state === 'ready' || state === 'menu' || state === 'loading' ? 'ready' : !world.alive ? 'dead' : world.fuel.empty ? 'empty' : 'play';
  astro.setTimeScale(mode === 'empty' ? 0.45 : 1);
  const frozen = state === 'paused' || state === 'countdown';
  astro.setPower(world.alive ? world.powerLeft : 0);
  astro.update(frozen ? 0 : dt, time, world.thrusting && !frozen, world.vy, mode);
  if (!frozen) {
    fire.update(dt);
    smoke.update(dt);
  }
  obstacles.update(world.obstacles, world.t, time);
  pickups.update(world.pickups, time, frozen ? 0 : dt);
  env.update(stage.camera.position.x, time);
  stage.render(x, dt, time);
  updateHud();

  if (debug) {
    fpsAcc += dt;
    fpsN++;
    if (fpsAcc > 0.5) {
      ui.net.textContent = `${Math.round(fpsN / fpsAcc)} fps · ${stage.renderer.info.render.calls} draws${stage.bloomOn ? ' · bloom' : ''}`;
      fpsAcc = fpsN = 0;
    }
  }
}

// ---------------------------------------------------------------- início

setState('loading');
showBest();
if (debug) (window as unknown as { __game: unknown }).__game = { world, input, scene: stage.scene, get state() { return state; } };

astro
  .load('/models/astronaut-rig.glb', (r) => (ui.progress.style.transform = `scaleX(${r})`))
  .then(() => {
    // Primeiro desenho fora da tela: compila os shaders antes do menu aparecer.
    stage.renderer.compile(stage.scene, stage.camera);
    prefetchTicket();
    setState('menu');
  })
  .catch((err) => {
    console.error('[jogo]', err);
    ui.errorMsg.textContent = 'Não foi possível carregar o astronauta. Confira a conexão e tente de novo.';
    setState('error');
  });
requestAnimationFrame(frameLoop);
