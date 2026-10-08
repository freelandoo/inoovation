// Apresentação THE NEXT LABEL (/admin/apresentacao), só para admin logado.
//
// Slides em tela cheia controlados pelo passador (que funciona como teclado:
// PageDown/PageUp, setas, F5/Esc, B/.). Cada slide pode ter "passos" (como as
// animações do PowerPoint): avançar revela o próximo passo antes de trocar de slide.
// A cena 3D do site (rótulo, portal, partículas) e o holograma do astronauta são
// dirigidos pelo roteiro em slides.ts, por tempo: nada depende de mouse ou rolagem.

import * as THREE from 'three';
import { gsap } from 'gsap';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import qrcode from 'qrcode-generator';
import { config } from '../config.ts';
import { detectPerf } from '../perf/tier.ts';
import { Stage } from '../scene/Stage.ts';
import { EnergyPortal } from '../scene/EnergyPortal.ts';
import { ParticleField } from '../scene/ParticleField.ts';
import { DigitalLabelTwin } from '../label/DigitalLabelTwin.ts';
import { Director } from '../story/Director.ts';
import { Hologram } from '../ar/hologram.ts';
import { readAdmin, checkAdmin } from '../admin/session.ts';
import { DEMO, HOOKS, demoUrl, type DeckCtx, type HoloTarget, type SlideHooks } from './slides.ts';
import './tabloid.css';
import './present.css';

const html = document.documentElement;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const params = new URLSearchParams(location.search);

// ------------------------------------------------------------------ acesso

async function gate(): Promise<boolean> {
  if (import.meta.env.DEV && params.has('preview')) return true;
  if (readAdmin() && (await checkAdmin())) return true;
  location.replace('/admin?next=apresentacao');
  return false;
}

// ------------------------------------------------------------------ boot

const perf = detectPerf();
const reduced = perf.reducedMotion;
const slides = [...document.querySelectorAll<HTMLElement>('.slide')];
const deck = $('#deck');
const unitPx = () => deck.clientWidth / 100;

let stage: Stage | null = null;
let label: DigitalLabelTwin | null = null;
let director: Director | null = null;
let holo: Hologram | null = null;

let index = -1;
let step = 0;
let tSlide = 0;
let hooks: SlideHooks = {};

const holoState = { x: 0, y: 0, h: 0, on: false, since: 0 };

// Vitrine 3D: o renderer é criado na tela de carregamento (criar um contexto WebGL
// no meio do slide trava a transição) e reaproveitado a cada visita.
const turntable = (() => {
  let tt: import('../collection/SlotTurntable.ts').SlotTurntable | null = null;
  return {
    async init() {
      const [{ SlotTurntable }, { loadModel }] = await Promise.all([
        import('../collection/SlotTurntable.ts'),
        import('../collection/model.ts'),
      ]);
      await loadModel(config.hero.modelGlb);
      tt = new SlotTurntable(reduced);
    },
    attach(canvas: HTMLCanvasElement, onReady: () => void) {
      if (!tt) return;
      tt.clear();
      tt.add(canvas, config.hero.modelGlb, onReady).catch(() => {});
    },
    detach() {
      tt?.clear();
    },
  };
})();

const ctx: DeckCtx = {
  get label() {
    return label;
  },
  reduced,
  u: unitPx,
  holo: {
    solidify: () => holo?.solidify(),
    take: () => holo?.take(),
    reset: () => holo?.resetSolid(),
  },
  turntable,
};

function setup3d() {
  if (perf.tier === 'low') {
    html.classList.add('no3d');
    return;
  }
  try {
    stage = new Stage($<HTMLCanvasElement>('#stage'), perf);
  } catch {
    stage = null;
    html.classList.add('no3d');
    return;
  }
  const s = stage;
  const pmrem = new THREE.PMREMGenerator(s.renderer);
  s.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const portal = new EnergyPortal(perf.tier === 'high' ? 5 : 3);
  s.scene.add(portal.mesh);
  const particles = new ParticleField(Math.max(perf.particles, 900), Math.min(window.devicePixelRatio, perf.maxDpr), reduced ? 0.15 : 1);
  s.scene.add(particles.points);
  label = new DigitalLabelTwin(s.renderer, { autoLight: false });
  s.scene.add(label.group);

  holo = new Hologram({ color: config.ar.color, accent: config.ar.accent, heightMeters: 1 });
  holo.group.rotation.x = 0.14;
  s.scene.add(holo.group);

  director = new Director(s, label, portal, particles, null, reduced);
  director.intro = 1;
  director.drift = !reduced;
  director.source = (c) => hooks.scene?.(c, tSlide, step) ?? {};
  s.add(director);
  s.add(label);
  s.add(portal);
  s.add(particles);
  s.add({ update: (dt) => updateHolo(dt) });
  s.onResize = () => director?.measure();
  if (import.meta.env.DEV) Object.assign(window, { __deck: { stage: s, holo, label, director, holoState } });
}

function updateHolo(dt: number) {
  if (!holo || !director) return;
  holoState.since += dt;
  const v = stage!.view;
  const c = { vw: v.width, vh: v.height, mobile: false, rect: () => null };
  const target: HoloTarget | null =
    hooks.holo && holoState.since >= (hooks.holoDelay ?? 0) ? hooks.holo(c, step) : null;
  html.classList.toggle('pz-holo-on', !!hooks.holo?.(c, step));
  const k = reduced ? 1 : 1 - Math.exp(-dt * 5);
  if (target) {
    if (!holoState.on) {
      holoState.on = true;
      holoState.x = target.x;
      holoState.y = target.y;
      holoState.h = target.h;
      holo.appear();
    }
    holoState.x += (target.x - holoState.x) * k;
    holoState.y += (target.y - holoState.y) * k;
    holoState.h += (target.h - holoState.h) * k;
  } else if (holoState.on) {
    holoState.h *= Math.exp(-dt * 9);
    if (holoState.h < 0.02) {
      holoState.on = false;
      holo.hide();
    }
  }
  if (holoState.on) {
    holo.heightMeters = Math.max(0.001, holoState.h);
    holo.setUserScale(1);
    holo.group.position.set(holoState.x, holoState.y, -0.8);
  }
  holo.update(dt);
}

function fillDemo() {
  const map: Record<string, string> = { product: DEMO.product, lot: DEMO.lot, unit: DEMO.unit };
  for (const el of document.querySelectorAll<HTMLElement>('[data-gs1]')) {
    el.textContent = map[el.dataset.gs1!] ?? '';
    el.dataset.full = el.textContent;
  }
  const url = $('#gs1-url');
  url.innerHTML = 'ri3.ai/<b>01</b>/<span></span>/<b>10</b>/<span></span>/<b>21</b>/<span></span>';
  const spans = url.querySelectorAll('span');
  spans[0].textContent = DEMO.product;
  spans[1].textContent = DEMO.lot;
  spans[2].textContent = DEMO.unit;

  // QR real da unidade de demonstração (abre a experiência verificada).
  const qr = qrcode(0, 'M');
  qr.addData(demoUrl());
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  $('#scan-qr').innerHTML = `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="QR Code da experiência"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#050505"/></svg>`;

  // Microtexto (lente da missão Segurança).
  const micro = document.querySelector<HTMLElement>('.micro-zoom span');
  if (micro) micro.textContent = 'INNOVATIONWEEK2026·INDEMETAL·THENEXTLABEL·'.repeat(60);
}

async function preload() {
  const bar = $('#pz-boot-bar');
  const pct = $('#pz-boot-pct');
  const urls = new Set<string>(['/innovation-week/deck/planet.webp', '/innovation-week/deck/astronaut.webp']);
  document.querySelectorAll<HTMLImageElement>('.deck img, .chrome img').forEach((i) => urls.add(i.getAttribute('src')!));
  const jobs: Promise<unknown>[] = [...urls].map(
    (u) =>
      new Promise((res) => {
        const im = new Image();
        im.onload = im.onerror = res;
        im.src = u;
      }),
  );
  jobs.push(document.fonts?.ready ?? Promise.resolve());
  if (label) jobs.push(label.load(true).then(() => label!.loadMasks()).catch((e) => console.warn('[label]', e)));
  if (holo) jobs.push(holo.load(config.hero.modelGlb).catch((e) => console.warn('[holo]', e)));
  if (stage) jobs.push(turntable.init().catch(() => {}));
  let done = 0;
  const total = jobs.length;
  const tick = () => {
    const p = Math.round((++done / total) * 100);
    pct.textContent = String(p).padStart(3, '0');
    bar.style.transform = `scaleX(${p / 100})`;
  };
  await Promise.race([Promise.all(jobs.map((j) => j.then(tick, tick))), new Promise((r) => setTimeout(r, 15000))]);
}

// ------------------------------------------------------------------ animação de entrada dos elementos

type Kind = 'up' | 'left' | 'right' | 'scale' | 'mask' | 'back' | 'fade' | 'none';

function from(kind: Kind, u: number): gsap.TweenVars {
  switch (kind) {
    case 'left':
      return { x: -6 * u, opacity: 0 };
    case 'right':
      return { x: 6 * u, opacity: 0 };
    case 'scale':
      return { scale: 0.82, opacity: 0 };
    case 'mask':
      return { clipPath: 'inset(-10% 100% -10% 0%)', x: -2 * u, opacity: 1 };
    case 'back':
      return { x: 14 * u, opacity: 0, letterSpacing: '0.14em' };
    case 'fade':
      return { opacity: 0 };
    case 'none':
      return { opacity: 1 };
    default:
      return { y: 4 * u, opacity: 0 };
  }
}

function to(kind: Kind): gsap.TweenVars {
  if (kind === 'mask') return { clipPath: 'inset(-10% -2% -10% 0%)', x: 0, opacity: 1, duration: 0.9, ease: 'expo.out' };
  if (kind === 'back') return { x: 0, opacity: 1, letterSpacing: '-0.02em', duration: 1.6, ease: 'expo.out' };
  return { x: 0, y: 0, scale: 1, opacity: 1, duration: 0.8, ease: 'expo.out' };
}

function reveal(els: HTMLElement[], base = 0, instant = false) {
  const u = unitPx();
  els.forEach((el, i) => {
    const kind = (el.dataset.a as Kind) || 'up';
    const delay = base + (el.dataset.d !== undefined ? Number(el.dataset.d) : i * 0.08);
    if (instant || reduced) {
      gsap.set(el, { ...to(kind), opacity: 1, x: 0, y: 0, scale: 1, clipPath: 'none' });
      return;
    }
    gsap.fromTo(el, from(kind, u), { ...to(kind), delay, onComplete: () => kind === 'mask' && gsap.set(el, { clipPath: 'none' }) });
  });
}

function resetSlide(el: HTMLElement) {
  const anim = el.querySelectorAll<HTMLElement>('[data-a], [data-step]');
  gsap.killTweensOf(anim);
  // Só o que as animações mexem: o tamanho de fonte ajustado (fitBackType) fica.
  gsap.set(anim, { clearProps: 'transform,opacity,clipPath,letterSpacing,filter,visibility' });
}

// ------------------------------------------------------------------ navegação

const stepsOf = (el: HTMLElement) => Number(el.dataset.steps ?? 0);
const hooksOf = (el: HTMLElement) => HOOKS[el.dataset.id!] ?? {};

function go(i: number, toStep = 0) {
  i = Math.max(0, Math.min(slides.length - 1, i));
  const prev = slides[index];
  const next = slides[i];
  if (prev === next && toStep === step) return;
  const dir = i >= index ? 1 : -1;

  if (prev && prev !== next) {
    hooksOf(prev).leave?.(prev, ctx);
    prev.classList.remove('active');
    gsap.killTweensOf(prev);
    if (reduced) gsap.set(prev, { opacity: 0, visibility: 'hidden' });
    else
      gsap.to(prev, {
        opacity: 0,
        x: -3 * unitPx() * dir,
        duration: 0.45,
        ease: 'power2.in',
        onComplete: () => gsap.set(prev, { visibility: 'hidden', x: 0 }),
      });
  }

  index = i;
  hooks = hooksOf(next);
  tSlide = 0;
  holoState.since = 0;
  resetSlide(next);
  gsap.killTweensOf(next);
  gsap.set(next, { visibility: 'visible', opacity: 1, x: 0 });
  next.classList.add('active');
  html.classList.toggle('pz-paper-on', next.dataset.theme === 'paper');
  html.dataset.slide = next.dataset.id;

  const intro = [...next.querySelectorAll<HTMLElement>('[data-a]:not([data-step])')];
  reveal(intro, prev && prev !== next ? 0.25 : 0.1);
  hooks.enter?.(next, ctx);
  step = 0;
  for (let s = 1; s <= toStep; s++) revealStep(next, s, true);
  step = toStep;
  html.dataset.step = String(step);

  $('#ch-n').textContent = String(i + 1).padStart(2, '0');
  $('#ch-section').textContent = next.dataset.section ?? '';
  $('#ch-bar').style.transform = `scaleX(${(i + 1) / slides.length})`;
  history.replaceState(null, '', `#${i + 1}`);
  document.title = `${String(i + 1).padStart(2, '0')} · ${next.dataset.title ?? ''} · THE NEXT LABEL`;
  if (prev && prev !== next && !reduced) sweep(dir);
}

function revealStep(el: HTMLElement, s: number, instant: boolean) {
  const els = [...el.querySelectorAll<HTMLElement>(`[data-step="${s}"]`)];
  reveal(els, 0, instant);
  hooks.step?.(el, s, ctx, instant);
}

function nextAction() {
  const el = slides[index];
  if (step < stepsOf(el)) {
    step++;
    html.dataset.step = String(step);
    revealStep(el, step, false);
    return;
  }
  go(index + 1);
}

function prevAction() {
  if (index === 0) return;
  const p = slides[index - 1];
  go(index - 1, stepsOf(p));
}

function sweep(dir: number) {
  const el = $('.pz-sweep');
  gsap.fromTo(el, { yPercent: dir > 0 ? -100 : 100, opacity: 1 }, { yPercent: dir > 0 ? 100 : -100, duration: 0.6, ease: 'power2.inOut' });
}

// ------------------------------------------------------------------ passador / teclado

let typed = '';
let typedTimer = 0;
const gotoEl = $('#pz-goto');
function showTyped() {
  gotoEl.textContent = typed ? `→ ${typed}` : '';
  html.classList.toggle('pz-typing', !!typed);
  clearTimeout(typedTimer);
  typedTimer = window.setTimeout(() => {
    typed = '';
    showTyped();
  }, 2500);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

function onKey(e: KeyboardEvent) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const k = e.key;
  if (/^[0-9]$/.test(k)) {
    typed = (typed + k).slice(-2);
    showTyped();
    return;
  }
  if (k === 'Enter' && typed) {
    e.preventDefault();
    go(Number(typed) - 1);
    typed = '';
    showTyped();
    return;
  }
  if (html.classList.contains('pz-blackout') && !['b', 'B', '.', 'Escape'].includes(k)) {
    html.classList.remove('pz-blackout');
    e.preventDefault();
    return;
  }
  switch (k) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
    case ' ':
    case 'Enter':
    case 'n':
    case 'N':
      e.preventDefault();
      nextAction();
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
    case 'Backspace':
    case 'p':
    case 'P':
      e.preventDefault();
      prevAction();
      break;
    case 'Home':
      e.preventDefault();
      go(0);
      break;
    case 'End':
      e.preventDefault();
      go(slides.length - 1);
      break;
    case 'b':
    case 'B':
    case '.':
      e.preventDefault();
      html.classList.toggle('pz-blackout');
      break;
    case 'f':
    case 'F':
    case 'F5':
      e.preventDefault();
      toggleFullscreen();
      break;
  }
}

function bindInput() {
  window.addEventListener('keydown', onKey);
  // Clique/toque: lado direito avança, quarto esquerdo volta.
  window.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    if (e.clientX < window.innerWidth * 0.25) prevAction();
    else nextAction();
  });
  let sx = 0;
  window.addEventListener('touchstart', (e) => (sx = e.touches[0].clientX), { passive: true });
  window.addEventListener(
    'touchend',
    (e) => {
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) (dx < 0 ? nextAction : prevAction)();
    },
    { passive: true },
  );
  // Cursor some parado (projetor limpo).
  let idle = 0;
  window.addEventListener('pointermove', () => {
    html.classList.remove('pz-idle');
    clearTimeout(idle);
    idle = window.setTimeout(() => html.classList.add('pz-idle'), 2200);
  });
}

/** Manchete gigante do fundo: ocupa a largura do quadro, qualquer que seja a palavra. */
function fitBackType() {
  const target = deck.clientWidth * 1.04;
  const u = unitPx();
  for (const span of document.querySelectorAll<HTMLElement>('.back > span:not(.back-num)')) {
    span.style.fontSize = '';
    const w = span.scrollWidth;
    if (!w) continue;
    const size = (parseFloat(getComputedStyle(span).fontSize) * target) / w;
    span.style.fontSize = `calc(var(--u) * ${(Math.min(size, deck.clientHeight * 0.5) / u).toFixed(2)})`;
  }
  // Títulos que só podem crescer até data-fit (em unidades do quadro).
  for (const el of document.querySelectorAll<HTMLElement>('[data-fit]')) {
    el.style.fontSize = '';
    const max = Number(el.dataset.fit) * u;
    const w = el.scrollWidth;
    if (w > max) el.style.fontSize = `calc(var(--u) * ${((parseFloat(getComputedStyle(el).fontSize) * max) / w / u).toFixed(2)})`;
  }
}

// ------------------------------------------------------------------ laço do DOM (parallax por tempo + ganchos)

function domLoop() {
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    tSlide += dt;
    if (!reduced) {
      const t = now / 1000;
      html.style.setProperty('--px', (Math.sin(t * 0.21) * 0.6).toFixed(4));
      html.style.setProperty('--py', (Math.sin(t * 0.13 + 1.3) * 0.4).toFixed(4));
    }
    const el = slides[index];
    if (el) hooks.tick?.(el, tSlide, ctx);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function keepAwake() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<unknown> } };
    await nav.wakeLock?.request('screen');
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') nav.wakeLock?.request('screen').catch(() => {});
    });
  } catch {
    /* sem wake lock */
  }
}

async function main() {
  if (!(await gate())) return;
  $('#ch-total').textContent = String(slides.length).padStart(2, '0');
  fillDemo();
  setup3d();
  await preload();
  // Mede com a fonte final já carregada.
  fitBackType();
  window.addEventListener('resize', fitBackType);
  html.classList.remove('pz-booting');
  gsap.to('#pz-boot', { opacity: 0, duration: 0.6, onComplete: () => $('#pz-boot').remove() });
  stage?.start();
  domLoop();
  bindInput();
  keepAwake();

  const fromHash = Number(location.hash.slice(1));
  const start = Number.isInteger(fromHash) && fromHash >= 1 ? fromHash - 1 : 0;
  if (start === 0 && director && !reduced) {
    director.intro = 0;
    gsap.to(director, { intro: 1, duration: 2.8, ease: 'power2.inOut', delay: 0.2 });
  }
  go(start);
  const hint = $('#pz-hint');
  gsap.fromTo(hint, { opacity: 0 }, { opacity: 1, duration: 0.6, delay: 0.8 });
  gsap.to(hint, { opacity: 0, duration: 0.8, delay: 6 });
}

main();
