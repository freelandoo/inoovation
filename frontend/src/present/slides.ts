// Roteiro da apresentação: o que a cena 3D, o holograma e o DOM fazem em cada slide.
//
// Posições em unidades de mundo, relativas ao quadro 16:9 (W × H) visível no plano
// z = 0, então a composição acompanha qualquer projetor. `t` = segundos desde a
// entrada no slide: tudo anima sozinho, sem mouse e sem rolagem.

import * as THREE from 'three';
import { gsap } from 'gsap';
import type { Ctx, SceneState } from '../story/Director.ts';
import type { DigitalLabelTwin } from '../label/DigitalLabelTwin.ts';
import { LABEL_WORLD, QR_UV, SURFACE_ZONES, explodedOrder } from '../label/labelConfig.ts';
import { config } from '../config.ts';
import { fetchStats, fmtInt, funnelRows } from '../admin/stats.ts';
import { readAdmin } from '../admin/session.ts';

export interface HoloTarget {
  x: number;
  /** pés do personagem */
  y: number;
  /** altura em unidades de mundo */
  h: number;
}

export interface DeckCtx {
  label: DigitalLabelTwin | null;
  reduced: boolean;
  /** px por unidade do quadro (1% da largura) */
  u(): number;
  holo: {
    solidify(): void;
    take(): void;
    reset(): void;
  };
  turntable: {
    attach(canvas: HTMLCanvasElement, onReady: () => void): void;
    detach(): void;
  };
}

export interface SlideHooks {
  scene?: (c: Ctx, t: number, step: number) => Partial<SceneState>;
  holo?: (c: Ctx, step: number) => HoloTarget | null;
  /** segundos até o holograma aparecer depois de entrar no slide */
  holoDelay?: number;
  enter?: (el: HTMLElement, d: DeckCtx) => void;
  /** `instant`: voltando de slide (estado final, sem animação) */
  step?: (el: HTMLElement, step: number, d: DeckCtx, instant: boolean) => void;
  tick?: (el: HTMLElement, t: number, d: DeckCtx) => void;
  leave?: (el: HTMLElement, d: DeckCtx) => void;
}

// ------------------------------------------------------------------ dados de demonstração

/** Unidade oficial da lista da Realizse (lote W4) usada no QR ao vivo e nas telas de identidade. */
export const DEMO = { product: '07898693620895', lot: 'W4', unit: 'Pg' };
export const demoUrl = () => `${location.origin}/01/${DEMO.product}/10/${DEMO.lot}/21/${DEMO.unit}?src=apresentacao`;

// ------------------------------------------------------------------ helpers de cena

const deg = THREE.MathUtils.degToRad;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};
/** Quadro 16:9 dentro da área visível. */
const box = (c: Ctx) => ({ W: Math.min(c.vw, (c.vh * 16) / 9), H: Math.min(c.vh, (c.vw * 9) / 16) });

const quiet = (c: Ctx, o: Partial<SceneState> = {}): Partial<SceneState> => {
  const { H } = box(c);
  return { labelOpacity: 0, labelW: 0.6, labelY: -H * 0.2, portalI: 0.22, portalR: H * 0.42, portalY: -H * 0.04, partOpacity: 0.3, ...o };
};

const QR_LOCAL = {
  x: ((QR_UV.x0 + QR_UV.x1) / 2 - 0.5) * LABEL_WORLD.width,
  y: ((QR_UV.y0 + QR_UV.y1) / 2 - 0.5) * LABEL_WORLD.height,
  size: (QR_UV.x1 - QR_UV.x0) * LABEL_WORLD.width,
};
function qrZoom(cx: number, cy: number, size: number): Partial<SceneState> {
  const s = size / QR_LOCAL.size;
  return {
    labelW: LABEL_WORLD.width * s,
    labelX: cx - QR_LOCAL.x * s,
    labelY: cy - QR_LOCAL.y * s,
    labelRotX: 0,
    labelRotY: 0,
    labelRotZ: 0,
    qrFocus: 1,
  };
}

/** Rótulo "vivo": balança devagar e recebe uma varredura de luz periódica. */
function alive(t: number, o: Partial<SceneState>, period = 5.5): Partial<SceneState> {
  const p = (t % period) / 2.2;
  return {
    labelRotY: deg(-14 + Math.sin(t * 0.45) * 16),
    labelRotX: deg(8 + Math.sin(t * 0.31) * 5),
    labelRotZ: deg(Math.sin(t * 0.23) * 2),
    scan: p <= 1 ? -0.2 + p * 1.4 : -1,
    scanI: p <= 1 ? Math.sin(p * Math.PI) : 0,
    ...o,
  };
}

const opener = (c: Ctx, t: number): Partial<SceneState> => {
  const { W, H } = box(c);
  return quiet(c, { portalX: W * 0.27, portalY: -H * 0.02, portalR: H * 0.34, portalI: 0.75 + Math.sin(t * 1.4) * 0.12, partOpacity: 0.7, partConverge: 0.35 });
};

const openingLabel = (c: Ctx, t: number): Partial<SceneState> => {
  const { W, H } = box(c);
  return alive(t, {
    labelW: W * 0.3,
    labelX: 0,
    labelY: -H * 0.3,
    portalY: H * 0.05,
    portalR: H * 0.4,
    portalI: 0.8,
    partOpacity: 0.75,
  });
};

// ------------------------------------------------------------------ helpers de DOM

const $$ = (el: HTMLElement, s: string) => [...el.querySelectorAll<HTMLElement>(s)];

function countTo(el: HTMLElement, value: number, reduced: boolean, dur = 1.6, fmt: (n: number) => string = fmtInt) {
  if (reduced) {
    el.textContent = fmt(value);
    return;
  }
  const o = { v: Number(el.dataset.v ?? 0) };
  el.dataset.v = String(value);
  gsap.to(o, { v: value, duration: dur, ease: 'power3.out', onUpdate: () => (el.textContent = fmt(Math.round(o.v))) });
}
const crewFmt = (n: number) => String(n).padStart(4, '0');

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
function decode(el: HTMLElement, text: string, delay = 0) {
  const start = performance.now() + delay * 1000;
  const dur = 500 + text.length * 60;
  const tick = (now: number) => {
    const p = clamp01((now - start) / dur);
    const settled = Math.floor(p * text.length);
    let out = text.slice(0, settled);
    if (now >= start) for (let i = settled; i < text.length; i++) out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
    el.textContent = out;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let livePoll = 0;
let trackPoll = 0;
let serialTimer = 0;
let countTl: gsap.core.Timeline | null = null;

interface Live {
  crew: number;
  recent: { crew: number; name: string }[];
}
async function pollLive(el: HTMLElement, d: DeckCtx) {
  if (!config.api.baseUrl) return;
  try {
    const r = await fetch(`${config.api.baseUrl}/api/live`);
    if (!r.ok) return;
    const live = (await r.json()) as Live;
    const crewEl = el.querySelector<HTMLElement>('#scan-crew')!;
    const before = Number(crewEl.dataset.v ?? 0);
    if (live.crew !== before) {
      countTo(crewEl, live.crew, d.reduced, 1, crewFmt);
      if (before && live.crew > before && !d.reduced) gsap.fromTo(crewEl, { color: '#ff3030', scale: 1.15 }, { color: '#f5f5f3', scale: 1, duration: 0.9 });
    }
    const list = el.querySelector<HTMLElement>('#scan-recent')!;
    list.replaceChildren(
      ...live.recent.slice(0, 4).map((r) => {
        const li = document.createElement('li');
        const b = document.createElement('b');
        b.textContent = `Nº ${String(r.crew).padStart(4, '0')}`;
        li.append(b, ` ${r.name}`);
        return li;
      }),
    );
  } catch {
    /* rede instável: tenta no próximo ciclo */
  }
}

/** Linha de status do slide: ao vivo com a hora, ou o motivo de não atualizar. */
function trackingStatus(el: HTMLElement, text: string, off: boolean) {
  const st = el.querySelector<HTMLElement>('[data-trk-status]');
  if (!st) return;
  st.textContent = text;
  st.closest('.kicker')?.classList.toggle('is-off', off);
}

async function pollTracking(el: HTMLElement, d: DeckCtx) {
  const s = await fetchStats();
  // Falhou: mantém os últimos números na tela (nunca volta a zero) e diz o porquê.
  if (!s) {
    trackingStatus(el, readAdmin() ? 'SEM CONEXÃO // TENTANDO DE NOVO' : 'SESSÃO EXPIRADA // ENTRE DE NOVO NO ADMIN', true);
    return;
  }
  trackingStatus(el, `DADOS REAIS // AO VIVO ${new Date().toLocaleTimeString('pt-BR')}`, false);
  const rows = funnelRows(s);
  const vals: Record<string, number> = {
    scans: s.totals.scans,
    verified: s.totals.verified,
    signups: s.totals.signups,
    ar: rows.find((r) => r.event === 'ar_experience_started')?.value ?? 0,
  };
  for (const b of $$(el, '[data-trk]')) countTo(b, vals[b.dataset.trk!] ?? 0, d.reduced, 1.4);
  const list = el.querySelector<HTMLElement>('#trk-funnel')!;
  if (!list.children.length) {
    for (const r of rows) {
      const li = document.createElement('li');
      li.innerHTML = '<span></span><i><b></b></i><em></em>';
      li.querySelector('span')!.textContent = r.label;
      list.appendChild(li);
    }
  }
  rows.forEach((r, i) => {
    const li = list.children[i] as HTMLElement;
    li.querySelector('em')!.textContent = fmtInt(r.value);
    li.querySelector<HTMLElement>('i b')!.style.transform = `scaleX(${Math.max(0.02, r.pct).toFixed(3)})`;
  });
}

// ------------------------------------------------------------------ roteiro

export const HOOKS: Record<string, SlideHooks> = {
  abertura: { scene: openingLabel },

  missao: {
    scene: (c, t) => {
      const { H } = box(c);
      return quiet(c, { portalY: -H * 0.02, portalR: H * 0.4, portalI: 0.9 + Math.sin(t * 1.2) * 0.1, partOpacity: 0.85, partConverge: 0.5 });
    },
    holo: (c) => {
      const { H } = box(c);
      return { x: 0, y: -H * 0.47, h: H * 0.82 };
    },
    holoDelay: 0.3,
  },

  contagem: {
    scene: (c, t) => {
      const { H } = box(c);
      const ign = smooth((t - 4.4) / 0.5);
      return quiet(c, {
        portalY: 0,
        portalR: H * (0.3 + ign * 0.12),
        portalI: 0.7 + Math.abs(Math.sin(t * Math.PI * 1.18)) * 0.5 + ign * 0.8,
        partOpacity: 0.6 + ign * 0.4,
        partConverge: ign,
      });
    },
    enter: (el, d) => {
      const n = el.querySelector<HTMLElement>('#count-n')!;
      const tl = el.querySelector<HTMLElement>('#count-t')!;
      const go = el.querySelector<HTMLElement>('#count-go')!;
      const arc = el.querySelector<SVGCircleElement>('.count-arc')!;
      countTl?.kill();
      gsap.set(go, { opacity: 0, scale: 0.9 });
      gsap.set(n, { opacity: 1 });
      const STEP = 0.88;
      countTl = gsap.timeline();
      for (let i = 5; i >= 1; i--) {
        const at = (5 - i) * STEP;
        countTl.call(() => {
          n.textContent = String(i);
          tl.textContent = `T-0${i}`;
        }, [], at);
        countTl.fromTo(n, { scale: 1.35, opacity: 0, filter: 'blur(8px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.4, ease: 'expo.out' }, at);
        countTl.fromTo(arc, { strokeDashoffset: 100 }, { strokeDashoffset: 0, duration: STEP * 0.95, ease: 'none' }, at);
      }
      countTl.to(n, { scale: 0.6, opacity: 0, duration: 0.3 }, 5 * STEP - 0.1);
      countTl.call(() => (tl.textContent = 'T-00'), [], 5 * STEP);
      countTl.fromTo(go, { opacity: 0, scale: 1.4, letterSpacing: '0.3em' }, { opacity: 1, scale: 1, letterSpacing: '0em', duration: 0.7, ease: 'expo.out' }, 5 * STEP);
      if (d.reduced) countTl.progress(1);
    },
    leave: () => countTl?.kill(),
  },

  houston: {
    scene: (c) => quiet(c),
    step: (el, _s, _d, instant) => {
      const strike = el.querySelector('.h-strike');
      const old = el.querySelector('.h-old');
      if (instant) {
        gsap.set(strike, { scaleX: 1 });
        gsap.set(old, { opacity: 0.22 });
        return;
      }
      gsap.fromTo(strike, { scaleX: 0 }, { scaleX: 1, duration: 0.45, ease: 'power3.inOut' });
      gsap.to(old, { opacity: 0.22, duration: 0.5, delay: 0.45 });
    },
  },

  frasco: {
    scene: (c, t, step) => {
      const { H } = box(c);
      return quiet(c, { portalX: 0, portalY: -H * 0.04, portalR: H * (step ? 0.46 : 0.28), portalI: step ? 0.3 : 0.75 + Math.sin(t) * 0.1, partOpacity: 0.5 });
    },
    step: (el, _s, _d, instant) => {
      const pot = el.querySelector('.pot');
      gsap.to(pot, { opacity: 0, scale: 0.8, duration: instant ? 0 : 0.5, ease: 'power2.in' });
    },
    leave: (el) => gsap.set(el.querySelector('.pot'), { clearProps: 'opacity,scale' }),
  },

  m1: { scene: opener },
  m2: { scene: opener },
  m3: { scene: opener },
  m4: { scene: opener },

  decreto: {
    scene: (c) => {
      const { W, H } = box(c);
      return quiet(c, { portalX: W * 0.2, portalR: H * 0.42, portalI: 0.4 });
    },
    enter: (el, d) => {
      const first = el.querySelector<HTMLElement>('.orb:not([data-step]) [data-count]')!;
      first.textContent = '0';
      first.dataset.v = '0';
      setTimeout(() => countTo(first, 22, d.reduced), 450);
    },
    step: (el, _s, d, instant) => {
      const second = el.querySelector<HTMLElement>('.orb[data-step] [data-count]')!;
      if (instant) second.textContent = '32';
      else {
        second.dataset.v = '0';
        countTo(second, 32, d.reduced);
      }
    },
  },

  antes: {
    scene: (c) => quiet(c, { portalI: 0.1 }),
    step: (el, _s, _d, instant) => {
      const b = el.querySelector('.split-b');
      gsap.fromTo(
        b,
        { clipPath: 'polygon(100% 0%, 100% 0%, 100% 100%, 100% 100%)' },
        { clipPath: 'polygon(64% 0%, 100% 0%, 100% 100%, 42% 100%)', duration: instant ? 0 : 0.9, ease: 'expo.inOut' },
      );
    },
  },

  onde: {
    scene: (c, t) => {
      const { W, H } = box(c);
      return alive(t, { labelW: W * 0.4, labelX: W * 0.22, labelY: -H * 0.18, portalX: W * 0.22, portalY: -H * 0.12, portalR: H * 0.32, portalI: 0.65, partOpacity: 0.55 });
    },
  },

  processo: { scene: (c) => quiet(c, { portalI: 0.15 }) },

  loop: {
    scene: (c, t, step) => {
      const { H } = box(c);
      return quiet(c, {
        portalY: -H * 0.02,
        portalR: H * 0.33,
        portalI: (step ? 1.2 : 0.7) + Math.sin(t * 1.6) * 0.12,
        partOpacity: 1,
        partConverge: step ? 1 : 0.5,
      });
    },
  },

  elo: {
    scene: (c, t, step) => {
      const { W, H } = box(c);
      return {
        ...qrZoom(W * 0.28, -H * 0.04, H * (step ? 0.34 : 0.3)),
        portalX: W * 0.28,
        portalY: -H * 0.04,
        portalR: H * 0.4,
        portalI: 0.5 + Math.sin(t * 1.3) * 0.08,
        partOpacity: 0.6,
      };
    },
  },

  scan: {
    scene: (c, t) => {
      const { W, H } = box(c);
      return quiet(c, { portalX: -W * 0.22, portalY: -H * 0.02, portalR: H * 0.36, portalI: 0.8 + Math.sin(t * 2) * 0.15, partOpacity: 0.7, partConverge: 0.4 });
    },
    enter: (el, d) => {
      pollLive(el, d);
      clearInterval(livePoll);
      livePoll = window.setInterval(() => pollLive(el, d), 3000);
    },
    leave: () => clearInterval(livePoll),
  },

  ciclo: {
    scene: (c, t) => {
      const { W, H } = box(c);
      return alive(t, { labelW: W * 0.5, labelX: W * 0.14, labelY: -H * 0.06, portalX: W * 0.14, portalY: -H * 0.06, portalR: H * 0.4, portalI: 0.85, partOpacity: 0.8, partConverge: 0.25 }, 4.5);
    },
  },

  luz: {
    scene: (c, t) => {
      const { W, H } = box(c);
      const p = t % 9;
      const base = { labelW: W * 0.48, labelX: W * 0.2, labelY: -H * 0.12, labelRotX: deg(6), labelRotY: deg(-16), portalX: W * 0.2, portalY: -H * 0.12, portalR: H * 0.38 };
      if (p < 1.8) return { ...base, ambient: 1, scan: -0.25 + (p / 1.8) * 1.5, scanI: 0.9, portalI: 0.5, partOpacity: 0.5 };
      if (p < 7) return { ...base, ambient: 0.04, portalI: 0.05, partOpacity: 0.1 };
      return { ...base, ambient: 1, portalI: 0.5, partOpacity: 0.5 };
    },
    tick: (el, t) => {
      const p = t % 9;
      const idx = p < 1.8 ? 0 : p < 2.6 ? 1 : p < 7 ? 2 : 3;
      $$(el, '#luz-steps li').forEach((li, i) => {
        li.classList.toggle('on', i === idx);
        li.classList.toggle('past', i < idx);
      });
      document.documentElement.classList.toggle('pz-dark', p >= 1.8 && p < 7);
    },
    leave: () => document.documentElement.classList.remove('pz-dark'),
  },

  camadas: {
    scene: (c, t) => {
      const { W, H } = box(c);
      const e = smooth((t - 0.6) / 3);
      return {
        labelW: W * 0.3,
        labelX: W * 0.1,
        labelY: -H * 0.12,
        labelRotX: deg(26 - Math.sin(t * 0.4) * 4),
        labelRotY: deg(-38 + Math.sin(t * 0.3) * 6),
        labelRotZ: deg(4),
        explode: e,
        portalX: W * 0.1,
        portalY: -H * 0.12,
        portalR: H * 0.42,
        portalI: 0.4,
        partOpacity: 0.5,
      };
    },
    enter: (el) => {
      const list = el.querySelector<HTMLElement>('#camadas-list')!;
      if (list.children.length) return;
      explodedOrder.forEach((l, i) => {
        const li = document.createElement('li');
        const n = document.createElement('b');
        n.textContent = String(i + 1).padStart(2, '0');
        const name = document.createElement('span');
        name.textContent = l.label;
        const small = document.createElement('small');
        small.textContent = l.tech;
        li.append(n, name, small);
        list.appendChild(li);
      });
    },
    tick: (el, _t, d) => {
      const e = d.label?.state.explode ?? 1;
      const n = explodedOrder.length;
      $$(el, '#camadas-list li').forEach((li, i) => li.classList.toggle('on', e * (n + 0.2) > i + 0.15));
    },
  },

  superficie: {
    scene: (c, t) => {
      const { W, H } = box(c);
      const p = (t % 4.8) / 4.2;
      return {
        labelW: W * 0.5,
        labelX: W * 0.16,
        labelY: -H * 0.1,
        labelRotX: deg(4),
        labelRotY: deg(-10),
        ambient: 0.45,
        scan: p <= 1 ? -0.25 + p * 1.5 : -1,
        scanI: p <= 1 ? 1 : 0,
        portalX: W * 0.16,
        portalY: -H * 0.1,
        portalR: H * 0.42,
        portalI: 0.3,
        partOpacity: 0.4,
      };
    },
    tick: (el, t, d) => {
      const scan = d.label?.state.scan ?? -1;
      for (const li of $$(el, '#surface-tags li')) {
        const z = SURFACE_ZONES.find((s) => s.key === li.dataset.zone);
        li.classList.toggle('hit', !!z && scan >= z.at && scan < 1.25);
      }
      const p = clamp01(((t % 4.8) / 4.2));
      el.querySelector('#surface-pct')!.textContent = String(Math.round(p * 100)).padStart(3, '0');
    },
  },

  umqr: {
    scene: (c, t, step) => {
      const { W, H } = box(c);
      if (step === 0) return alive(t, { labelW: W * 0.42, labelX: W * 0.22, labelY: -H * 0.04, portalX: W * 0.22, portalR: H * 0.36, portalI: 0.6, partOpacity: 0.5 });
      const zoom = qrZoom(W * 0.24, H * 0.02, H * (step === 1 ? 0.4 : 0.46));
      return {
        ...zoom,
        labelOpacity: step === 2 ? 0 : 1,
        portalX: W * 0.24,
        portalY: H * 0.02,
        portalR: H * 0.42,
        portalI: 0.3,
        partMorph: step === 2 ? 2 : 1,
        partOpacity: 1,
        partTX: W * 0.24,
        partTY: H * 0.02,
        partTS: H * 0.22,
      };
    },
  },

  passaporte: {
    scene: (c, t) => {
      const { H } = box(c);
      return quiet(c, { portalY: -H * 0.02, portalR: H * 0.36, portalI: 0.45 + Math.sin(t) * 0.08, partOpacity: 0.55 });
    },
    enter: (el) => {
      $$(el, '[data-decode]').forEach((dd, i) => decode(dd, dd.dataset.decode || dd.dataset.full || dd.textContent || '', 0.5 + i * 0.15));
    },
  },

  micro: { scene: (c) => quiet(c, { portalI: 0.15 }) },

  serial: {
    scene: (c) => quiet(c, { portalI: 0.2 }),
    enter: (el, d) => {
      const odo = el.querySelector<HTMLElement>('#serial-odo')!;
      let n = 1;
      const render = (value: number, animate: boolean) => {
        const s = String(value).padStart(5, '0');
        if (odo.children.length !== s.length) {
          odo.replaceChildren(
            ...[...s].map(() => {
              const w = document.createElement('span');
              const col = document.createElement('i');
              col.textContent = '0123456789'.split('').join('\n');
              w.appendChild(col);
              return w;
            }),
          );
        }
        [...s].forEach((ch, i) => {
          const col = odo.children[i].firstElementChild as HTMLElement;
          gsap.to(col, { yPercent: -Number(ch) * 10, duration: animate && !d.reduced ? 0.9 + (s.length - i) * 0.12 : 0, ease: 'power3.out' });
        });
      };
      render(0, false);
      setTimeout(() => render(n, true), 500);
      clearInterval(serialTimer);
      serialTimer = window.setInterval(() => render(++n, true), 2600);
    },
    leave: () => clearInterval(serialTimer),
  },

  tracking: {
    scene: (c) => quiet(c, { portalI: 0.2 }),
    enter: (el, d) => {
      pollTracking(el, d);
      clearInterval(trackPoll);
      trackPoll = window.setInterval(() => pollTracking(el, d), 3000);
    },
    leave: () => clearInterval(trackPoll),
  },

  ra: {
    scene: (c, t) => {
      const { H } = box(c);
      return quiet(c, { portalY: H * 0.02, portalR: H * 0.36, portalI: 1.15 + Math.sin(t * 1.5) * 0.12, partConverge: 1, partOpacity: 1 });
    },
    holo: (c) => {
      const { H } = box(c);
      return { x: 0, y: -H * 0.3, h: H * 0.6 };
    },
    holoDelay: 0.6,
  },

  membros: { scene: (c) => quiet(c) },

  coleta: {
    scene: (c, t) => {
      const { W, H } = box(c);
      return quiet(c, { portalX: W * 0.2, portalY: -H * 0.04, portalR: H * 0.38, portalI: 0.7 + Math.sin(t * 1.3) * 0.1, partOpacity: 0.7, partConverge: 0.5 });
    },
    holo: (c, step) => {
      const { W, H } = box(c);
      return step >= 2 ? null : { x: W * 0.2, y: -H * 0.42, h: H * 0.78 };
    },
    holoDelay: 0.4,
    enter: (_el, d) => d.holo.reset(),
    step: (el, s, d, instant) => {
      $$(el, '.col-steps li').forEach((li, i) => li.classList.toggle('on', i === s));
      if (instant) return;
      if (s === 1) d.holo.solidify();
      if (s === 2) d.holo.take();
    },
  },

  vitrine: {
    scene: (c) => quiet(c),
    enter: (el, d) => {
      const slot = el.querySelector<HTMLElement>('.vit-slot.owned')!;
      d.turntable.attach(slot.querySelector('canvas')!, () => slot.classList.add('is-3d'));
    },
    leave: (_el, d) => d.turntable.detach(),
  },

  drops: { scene: (c) => quiet(c, { portalI: 0.18 }) },

  quatro: {
    scene: (c, t) => {
      const { W, H } = box(c);
      return alive(t, { labelW: W * 0.24, labelY: -H * 0.02, portalY: -H * 0.02, portalR: H * 0.36, portalI: 1.1 + Math.sin(t * 1.4) * 0.15, partOpacity: 1, partConverge: 0.7 }, 3.6);
    },
  },

  prontos: {
    scene: (c, t) => {
      const { H } = box(c);
      return quiet(c, { portalY: 0, portalR: H * 0.42, portalI: 0.95 + Math.sin(t * 1.1) * 0.1, partOpacity: 0.9, partConverge: 0.6 });
    },
    holo: (c) => {
      const { H } = box(c);
      return { x: 0, y: -H * 0.5, h: H * 0.92 };
    },
  },

  obrigado: { scene: openingLabel },
};
