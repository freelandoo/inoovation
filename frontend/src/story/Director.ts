// Director: traduz a rolagem em estado de cena para o objeto persistente
// (rótulo), o portal, o astronauta e as partículas.
//
// Cada seção declara âncoras (estado desejado em um ponto do seu progresso
// local). As âncoras viram uma lista global por posição de scroll e o estado é
// interpolado entre elas; o estado exibido é amortecido para parecer físico.
// Valores de posição são calculados a partir do tamanho visível da câmera,
// então a composição é responsiva por construção.

import * as THREE from 'three';
import type { Stage } from '../scene/Stage.ts';
import type { DigitalLabelTwin } from '../label/DigitalLabelTwin.ts';
import type { EnergyPortal } from '../scene/EnergyPortal.ts';
import type { ParticleField } from '../scene/ParticleField.ts';
import type { Astronaut } from '../scene/Astronaut.ts';
import { LABEL_WORLD, QR_UV } from '../label/labelConfig.ts';

export interface SceneState {
  labelX: number;
  labelY: number;
  labelW: number;
  labelRotX: number;
  labelRotY: number;
  labelRotZ: number;
  labelOpacity: number;
  reveal: number;
  explode: number;
  qrFocus: number;
  ambient: number;
  scan: number;
  scanI: number;
  portalX: number;
  portalY: number;
  portalR: number;
  portalI: number;
  astroO: number;
  astroX: number;
  astroY: number;
  astroH: number;
  partConverge: number;
  partMorph: number;
  partOpacity: number;
  partTX: number;
  partTY: number;
  partTS: number;
  cardO: number;
}

type Keys = keyof SceneState;
const KEYS = [
  'labelX', 'labelY', 'labelW', 'labelRotX', 'labelRotY', 'labelRotZ', 'labelOpacity', 'reveal', 'explode',
  'qrFocus', 'ambient', 'scan', 'scanI', 'portalX', 'portalY', 'portalR', 'portalI', 'astroO', 'astroX', 'astroY',
  'astroH', 'partConverge', 'partMorph', 'partOpacity', 'partTX', 'partTY', 'partTS', 'cardO',
] as const satisfies readonly Keys[];

/** Contexto para calcular âncoras: tamanho visível e medições de DOM. */
export interface Ctx {
  vw: number; // largura visível em z=0 (mundo)
  vh: number;
  mobile: boolean;
  /** Converte um retângulo de DOM (px) em centro/largura de mundo. */
  rect(el: Element | null): { x: number; y: number; w: number } | null;
}

type AnchorFn = (c: Ctx) => Partial<SceneState>;
interface SectionDef {
  id: string;
  anchors: { p: number; s: AnchorFn }[];
}

const deg = THREE.MathUtils.degToRad;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};

const QR_LOCAL = {
  x: ((QR_UV.x0 + QR_UV.x1) / 2 - 0.5) * LABEL_WORLD.width,
  y: ((QR_UV.y0 + QR_UV.y1) / 2 - 0.5) * LABEL_WORLD.height,
  size: (QR_UV.x1 - QR_UV.x0) * LABEL_WORLD.width,
};

const DEFAULTS: SceneState = {
  labelX: 0,
  labelY: 0,
  labelW: 3,
  labelRotX: 0,
  labelRotY: 0,
  labelRotZ: 0,
  labelOpacity: 1,
  reveal: 1,
  explode: 0,
  qrFocus: 0,
  ambient: 1,
  scan: -1,
  scanI: 0,
  portalX: 0,
  portalY: 0,
  portalR: 1.5,
  portalI: 1,
  astroO: 0,
  astroX: 0,
  astroY: -1,
  astroH: 3,
  partConverge: 0,
  partMorph: 0,
  partOpacity: 0.9,
  partTX: 0,
  partTY: 0,
  partTS: 1,
  cardO: 0,
};

/** Largura "frontal" padrão do rótulo. */
const frontW = (c: Ctx, mobile = 0.9, desktop = 0.56) =>
  c.mobile ? c.vw * mobile : Math.min(c.vw * desktop, c.vh * 0.62 * 2.727);

function heroState(c: Ctx): Partial<SceneState> {
  const portalY = c.mobile ? -c.vh * 0.02 : -c.vh * 0.1;
  const portalR = c.mobile ? c.vw * 0.4 : c.vh * 0.3;
  const astroH = c.mobile ? c.vh * 0.42 : c.vh * 0.47;
  const feet = c.mobile ? -c.vh * 0.27 : -c.vh * 0.41;
  return {
    labelW: c.mobile ? c.vw * 0.86 : Math.min(c.vw * 0.3, c.vh * 0.44 * 2.727),
    labelX: c.mobile ? 0 : c.vw * 0.1,
    labelY: c.mobile ? -c.vh * 0.2 : -c.vh * 0.25,
    labelRotX: deg(-14),
    labelRotY: deg(c.mobile ? -8 : -14),
    labelRotZ: deg(c.mobile ? 0 : -3),
    portalY,
    portalR,
    portalI: 1,
    astroO: 1,
    astroH,
    astroY: feet,
    astroX: c.mobile ? 0 : -c.vw * 0.05,
    partOpacity: 0.8,
  };
}

function qrZoom(c: Ctx, extra = 1): Partial<SceneState> {
  const target = Math.min(c.vw, c.vh) * (c.mobile ? 0.5 : 0.36) * extra;
  const scale = target / QR_LOCAL.size;
  const cx = c.mobile ? 0 : c.vw * 0.2;
  const cy = c.mobile ? c.vh * 0.01 : -c.vh * 0.05;
  return {
    labelW: LABEL_WORLD.width * scale,
    labelX: cx - QR_LOCAL.x * scale,
    labelY: cy - QR_LOCAL.y * scale,
    labelRotX: 0,
    labelRotY: 0,
    labelRotZ: 0,
    qrFocus: 1,
    portalI: 0.22,
    portalR: c.vh * 0.55,
  };
}

function cardTarget(c: Ctx, el: Element | null): Partial<SceneState> {
  const r = c.rect(el);
  if (!r) return c.mobile ? { partTX: 0, partTY: c.vh * 0.01, partTS: c.vw * 0.4 } : { partTX: c.vw * 0.2, partTY: -c.vh * 0.05, partTS: c.vh * 0.28 };
  return { partTX: r.x, partTY: r.y, partTS: r.w / 2 };
}

export function buildSections(): SectionDef[] {
  const passport = () => document.getElementById('passport');
  return [
    { id: 'hero', anchors: [{ p: 0, s: heroState }] },
    {
      id: 'rg',
      anchors: [
        {
          p: 0,
          s: (c) => ({
            labelW: frontW(c, 0.92, 0.5),
            labelY: c.mobile ? -c.vh * 0.02 : -c.vh * 0.03,
            labelRotX: deg(10),
            labelRotY: deg(-18),
            portalR: (c.mobile ? c.vw * 0.5 : c.vh * 0.42),
            portalY: c.vh * 0.04,
            portalI: 0.7,
            astroO: 0,
            astroH: c.mobile ? c.vh * 0.38 : c.vh * 0.52,
            astroY: -c.vh * 0.7,
            partOpacity: 0.8,
          }),
        },
      ],
    },
    {
      id: 'surface',
      anchors: [
        { p: 0, s: (c) => ({ labelW: frontW(c), labelY: c.vh * 0.02, ambient: 0.5, scan: -0.25, scanI: 1, portalI: 0.35, portalR: c.vh * 0.45, partOpacity: 0.45 }) },
        { p: 1, s: (c) => ({ labelW: frontW(c), labelY: c.vh * 0.02, ambient: 0.5, scan: 1.25, scanI: 1, portalI: 0.35, portalR: c.vh * 0.45, partOpacity: 0.45 }) },
      ],
    },
    {
      id: 'lights',
      anchors: [
        { p: 0, s: (c) => ({ labelW: frontW(c), labelY: c.vh * 0.02, ambient: 1, scan: -0.25, scanI: 0.9, portalI: 0.45, portalR: c.vh * 0.45, partOpacity: 0.5 }) },
        { p: 0.18, s: (c) => ({ labelW: frontW(c), labelY: c.vh * 0.02, ambient: 1, scan: 1.25, scanI: 0.9, portalI: 0.45, portalR: c.vh * 0.45, partOpacity: 0.5 }) },
        { p: 0.32, s: (c) => ({ labelW: frontW(c), labelY: c.vh * 0.02, ambient: 0.04, portalI: 0.06, portalR: c.vh * 0.45, partOpacity: 0.12 }) },
        { p: 0.82, s: (c) => ({ labelW: frontW(c), labelY: c.vh * 0.02, ambient: 0.04, portalI: 0.06, portalR: c.vh * 0.45, partOpacity: 0.12 }) },
        { p: 1, s: (c) => ({ labelW: frontW(c), labelY: c.vh * 0.02, ambient: 1, portalI: 0.45, portalR: c.vh * 0.45, partOpacity: 0.5 }) },
      ],
    },
    {
      id: 'layers',
      anchors: [
        { p: 0, s: (c) => ({ labelW: frontW(c), labelY: c.vh * 0.02, portalI: 0.4, portalR: c.vh * 0.45, partOpacity: 0.5 }) },
        {
          p: 0.2,
          s: (c) => ({
            labelW: frontW(c, 0.66, 0.4),
            labelX: c.mobile ? -c.vw * 0.06 : -c.vw * 0.06,
            labelY: -c.vh * 0.02,
            labelRotX: deg(26),
            labelRotY: deg(-38),
            labelRotZ: deg(4),
            explode: 0,
            portalI: 0.4,
            portalR: c.vh * 0.45,
            partOpacity: 0.5,
          }),
        },
        {
          p: 0.85,
          s: (c) => ({
            labelW: frontW(c, 0.66, 0.4),
            labelX: c.mobile ? -c.vw * 0.06 : -c.vw * 0.06,
            labelY: -c.vh * 0.02,
            labelRotX: deg(26),
            labelRotY: deg(-38),
            labelRotZ: deg(4),
            explode: 1,
            portalI: 0.4,
            portalR: c.vh * 0.45,
            partOpacity: 0.5,
          }),
        },
        {
          p: 1,
          s: (c) => ({
            labelW: frontW(c, 0.66, 0.4),
            labelX: -c.vw * 0.06,
            labelY: -c.vh * 0.02,
            labelRotX: deg(22),
            labelRotY: deg(-34),
            labelRotZ: deg(4),
            explode: 1,
            portalI: 0.4,
            portalR: c.vh * 0.45,
            partOpacity: 0.5,
          }),
        },
      ],
    },
    {
      id: 'qr',
      anchors: [
        { p: 0, s: (c) => ({ labelW: frontW(c), labelY: c.vh * 0.02, explode: 0, portalI: 0.4, portalR: c.vh * 0.45 }) },
        { p: 0.3, s: (c) => ({ ...qrZoom(c), partMorph: 0 }) },
        { p: 0.5, s: (c) => ({ ...qrZoom(c, 1.08), partMorph: 1, partOpacity: 1, ...cardTarget(c, null) }) },
        { p: 0.8, s: (c) => ({ ...qrZoom(c, 1.5), labelOpacity: 0, qrFocus: 1, partMorph: 2, partOpacity: 1, ...cardTarget(c, null) }) },
        { p: 1, s: (c) => ({ ...qrZoom(c, 1.6), labelOpacity: 0, partMorph: 2, partOpacity: 1, ...cardTarget(c, null) }) },
      ],
    },
    {
      id: 'identity',
      anchors: [
        { p: 0, s: (c) => ({ ...qrZoom(c, 1.6), labelOpacity: 0, partMorph: 2, partOpacity: 1, cardO: 0.15, portalI: 0.3, portalR: c.vh * 0.62, ...cardTarget(c, passport()) }) },
        { p: 0.6, s: (c) => ({ ...qrZoom(c, 1.6), labelOpacity: 0, partMorph: 2, partOpacity: 0, cardO: 1, qrFocus: 0, portalI: 0.3, portalR: c.vh * 0.62, ...cardTarget(c, passport()) }) },
        { p: 1, s: (c) => ({ labelOpacity: 0, labelW: frontW(c) * 0.3, partOpacity: 0.5, cardO: 1, portalI: 0.3, portalR: c.vh * 0.62 }) },
      ],
    },
    {
      id: 'orbit',
      anchors: [{ p: 0, s: (c) => ({ labelOpacity: 0, labelW: frontW(c) * 0.3, cardO: 1, portalI: 0.28, portalR: c.vh * 0.62, partOpacity: 0.6, partConverge: 0.1 }) }],
    },
    {
      id: 'physical',
      anchors: [
        { p: 0, s: (c) => ({ labelOpacity: 0, labelW: frontW(c) * 0.3, cardO: 1, portalI: 0.3, portalR: c.vh * 0.55, portalX: c.mobile ? 0 : c.vw * 0.22, partConverge: 0.2 }) },
        { p: 1, s: (c) => ({ labelOpacity: 0, labelW: frontW(c) * 0.3, cardO: 1, portalI: 0.45, portalR: c.vh * 0.46, portalX: c.mobile ? 0 : c.vw * 0.22, partConverge: 0.45 }) },
      ],
    },
    {
      id: 'tech',
      anchors: [
        {
          p: 0,
          s: (c) => ({
            labelOpacity: 1,
            labelW: c.mobile ? c.vw * 0.78 : Math.min(c.vw * 0.32, c.vh * 0.42 * 2.727),
            labelX: c.mobile ? 0 : c.vw * 0.29,
            labelY: c.mobile ? -c.vh * 0.3 : 0,
            labelRotX: deg(8),
            labelRotY: deg(-22),
            cardO: 1,
            portalI: 0.65,
            portalR: c.vh * 0.42,
            portalX: c.mobile ? 0 : c.vw * 0.26,
            partConverge: 0.55,
          }),
        },
      ],
    },
    {
      id: 'ar',
      anchors: [
        {
          p: 0,
          s: (c) => {
            const py = c.mobile ? c.vh * 0.06 : c.vh * 0.02;
            return {
              labelOpacity: 0,
              labelW: 0.2,
              labelX: 0,
              labelY: py,
              labelRotY: deg(40),
              cardO: 1,
              portalY: py,
              portalR: c.mobile ? c.vw * 0.46 : c.vh * 0.36,
              portalI: 1.15,
              partConverge: 1,
              partOpacity: 1,
            };
          },
        },
      ],
    },
  ];
}

interface Resolved {
  y: number; // scrollY em que a âncora vale
  s: AnchorFn;
}

export class Director {
  readonly target: SceneState = { ...DEFAULTS };
  readonly shown: SceneState = { ...DEFAULTS };
  private anchors: Resolved[] = [];
  private sections = buildSections();
  private pointer = new THREE.Vector2();
  private pointerTarget = new THREE.Vector2();
  /** 0..1 progresso da entrada cinematográfica do hero. */
  intro = 0;
  private idleScanT = 0;
  private first = true;
  private ctx: Ctx;

  constructor(
    private stage: Stage,
    private label: DigitalLabelTwin,
    private portal: EnergyPortal,
    private particles: ParticleField,
    private astro: Astronaut | null,
    private reduced: boolean,
  ) {
    this.ctx = {
      vw: 1,
      vh: 1,
      mobile: false,
      rect: (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const W = window.innerWidth;
        const H = window.innerHeight;
        return {
          x: ((r.left + r.width / 2) / W - 0.5) * this.ctx.vw,
          y: -((r.top + r.height / 2) / H - 0.5) * this.ctx.vh,
          w: (r.width / W) * this.ctx.vw,
        };
      },
    };
    this.measure();
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.pointerTarget.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    });
    this.bindTouch();
  }

  /** Arrasto horizontal curto no toque inclina o rótulo (sem bloquear a rolagem). */
  private bindTouch() {
    let sx = 0;
    let sy = 0;
    window.addEventListener(
      'touchstart',
      (e) => {
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
      },
      { passive: true },
    );
    window.addEventListener(
      'touchmove',
      (e) => {
        const dx = e.touches[0].clientX - sx;
        const dy = e.touches[0].clientY - sy;
        if (Math.abs(dx) > Math.abs(dy)) this.pointerTarget.x = THREE.MathUtils.clamp(dx / 140, -1, 1);
      },
      { passive: true },
    );
    window.addEventListener('touchend', () => this.pointerTarget.set(0, 0), { passive: true });
  }

  measure() {
    const v = this.stage.view;
    this.ctx.vw = v.width;
    this.ctx.vh = v.height;
    this.ctx.mobile = v.aspect < 0.8;
    this.particles.setView(v.width, v.height);
    const vhPx = window.innerHeight;
    const list: Resolved[] = [];
    for (const sec of this.sections) {
      const el = document.getElementById(sec.id);
      if (!el) continue;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const range = Math.max(1, el.offsetHeight - vhPx);
      for (const a of sec.anchors) list.push({ y: top + a.p * range, s: a.s });
    }
    list.sort((a, b) => a.y - b.y);
    this.anchors = list;
  }

  /** Progresso local (0..1) de uma seção pela rolagem atual. */
  sectionProgress(id: string): number {
    const el = document.getElementById(id);
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return clamp01(-r.top / Math.max(1, el.offsetHeight - window.innerHeight));
  }

  private computeTarget() {
    const y = window.scrollY;
    const A = this.anchors;
    if (!A.length) return;
    let i = 0;
    while (i < A.length - 1 && A[i + 1].y <= y) i++;
    const a = A[i];
    const b = A[Math.min(i + 1, A.length - 1)];
    const t = b.y > a.y ? smooth((y - a.y) / (b.y - a.y)) : 0;
    const sa = { ...DEFAULTS, ...a.s(this.ctx) };
    const sb = y <= a.y ? sa : { ...DEFAULTS, ...b.s(this.ctx) };
    for (const k of KEYS) this.target[k] = sa[k] + (sb[k] - sa[k]) * t;
  }

  update(dt: number, t: number) {
    this.computeTarget();
    const T = this.target;

    // Entrada cinematográfica: rótulo de perfil -> gira -> arte revelada; portal acende.
    if (this.intro < 1) {
      const e = smooth(this.intro);
      T.labelRotY = THREE.MathUtils.lerp(deg(88), T.labelRotY, 1 - Math.pow(1 - this.intro, 3));
      T.reveal = Math.min(T.reveal, clamp01((this.intro - 0.35) / 0.55));
      T.portalI *= e;
      T.astroO *= clamp01(this.intro * 1.6 - 0.4);
      T.scan = THREE.MathUtils.lerp(-0.2, 1.2, clamp01((this.intro - 0.3) / 0.6));
      T.scanI = Math.max(T.scanI, this.intro > 0.3 && this.intro < 0.95 ? 1 : 0);
    } else if (!this.reduced && window.scrollY < window.innerHeight * 0.5) {
      // Varredura ocasional no hero: a luz vermelha percorre a superfície.
      this.idleScanT = (this.idleScanT + dt) % 7;
      const p = this.idleScanT / 2.2;
      if (p <= 1) {
        T.scan = -0.2 + p * 1.4;
        T.scanI = Math.sin(p * Math.PI) * 0.9;
      }
    }

    const S = this.shown;
    const k = this.first || this.reduced ? 1 : 1 - Math.exp(-dt * 6.5);
    const kFast = this.first || this.reduced ? 1 : 1 - Math.exp(-dt * 14);
    for (const key of KEYS) {
      const kk = key === 'scan' || key === 'scanI' || key === 'cardO' ? kFast : k;
      S[key] += (T[key] - S[key]) * kk;
    }
    this.first = false;

    this.pointer.lerp(this.pointerTarget, 1 - Math.exp(-dt * 4));
    this.apply(t);
  }

  private apply(t: number) {
    const S = this.shown;
    const { camera } = this.stage;
    const px = this.reduced ? 0 : this.pointer.x;
    const py = this.reduced ? 0 : this.pointer.y;

    // Câmera: parallax sutil.
    camera.position.x = px * 0.18;
    camera.position.y = -py * 0.12;
    camera.lookAt(0, 0, 0);

    // Rótulo.
    const lg = this.label.group;
    lg.position.set(S.labelX, S.labelY + (this.reduced ? 0 : Math.sin(t * 0.8) * 0.02), 0);
    lg.rotation.set(S.labelRotX, S.labelRotY, S.labelRotZ);
    lg.scale.setScalar(Math.max(0.0001, S.labelW / LABEL_WORLD.width));
    const ls = this.label.state;
    ls.reveal = S.reveal;
    ls.explode = S.explode;
    ls.qrFocus = S.qrFocus;
    ls.ambient = S.ambient;
    ls.scan = S.scan;
    ls.scanIntensity = S.scanI;
    ls.opacity = S.labelOpacity;
    this.label.setPointer(px, py);

    // Portal (movimento independente, mais lento que o objeto central).
    this.portal.radius = S.portalR;
    this.portal.intensity = S.portalI;
    this.portal.mesh.position.set(S.portalX - px * 0.35, S.portalY + py * 0.2, -6);
    // Compensa a perspectiva: o portal fica em z=-6, então escala para parecer do raio pedido em z=0.
    const depthK = (camera.position.z + 6) / camera.position.z;
    this.portal.radius = S.portalR * depthK;
    this.portal.mesh.position.x *= depthK;
    this.portal.mesh.position.y *= depthK;

    // Astronauta.
    if (this.astro) {
      this.astro.opacity = S.astroO;
      const g = this.astro.group;
      g.position.set(S.astroX, S.astroY, -1.6);
      g.scale.setScalar(S.astroH * ((camera.position.z + 1.6) / camera.position.z));
      g.position.y *= (camera.position.z + 1.6) / camera.position.z;
      this.astro.setPointer(px, py);
    }

    // Partículas.
    const pf = this.particles;
    pf.converge = S.partConverge;
    pf.morph = S.partMorph;
    pf.opacity = S.partOpacity;
    pf.portal.copy(this.portal.mesh.position);
    pf.portalRadius = this.portal.radius * 1.05;
    this.label.qrWorldCenter(pf.qrPoint);
    pf.targetCenter.set(S.partTX, S.partTY, 0.5);
    pf.targetSize = S.partTS;

    // DOM: luz ambiente e opacidade do card.
    const root = document.documentElement.style;
    root.setProperty('--ambient', S.ambient.toFixed(3));
    const card = document.getElementById('passport');
    card?.style.setProperty('--card-o', S.cardO.toFixed(3));
  }
}
