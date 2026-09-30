// Sincronização das seções de DOM com a rolagem e com a cena 3D.

import * as THREE from 'three';
import type { ProductIdentity } from '../identity/resolver.ts';
import type { DigitalLabelTwin } from '../label/DigitalLabelTwin.ts';
import { SURFACE_ZONES, explodedOrder, LABEL_WORLD } from '../label/labelConfig.ts';
import { track } from '../analytics/analytics.ts';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function sectionProgress(el: HTMLElement | null): number {
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  return clamp01(-r.top / Math.max(1, el.offsetHeight - window.innerHeight));
}

/** Seção visível (topo acima do meio, fundo abaixo do meio). */
function inView(el: HTMLElement | null) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.top < window.innerHeight * 0.6 && r.bottom > window.innerHeight * 0.4;
}

// ------------------------------------------------------------ Hero → RG
/** INNOVATION se fragmenta em linhas horizontais que viram a interface do RG. */
function initHeroSlices(reduced: boolean) {
  const word = document.getElementById('t-innovation')!;
  const inner = word.firstElementChild as HTMLElement;
  const N = 7;
  const slices: HTMLElement[] = [];
  if (!reduced) {
    for (let i = 0; i < N; i++) {
      const s = inner.cloneNode(true) as HTMLElement;
      s.classList.add('t-slice');
      s.setAttribute('aria-hidden', 'true');
      s.style.clipPath = `inset(${(i / N) * 100}% 0 ${100 - ((i + 1) / N) * 100}% 0)`;
      word.appendChild(s);
      slices.push(s);
    }
  }
  const rgLines = document.getElementById('rg-lines')!;
  const lines: HTMLElement[] = [];
  for (let i = 0; i < N; i++) {
    const l = document.createElement('i');
    l.style.top = `${22 + i * 9}%`;
    rgLines.appendChild(l);
    lines.push(l);
  }
  const hero = document.getElementById('hero')!;
  return () => {
    const p = clamp01(window.scrollY / hero.offsetHeight);
    const frag = clamp01((p - 0.08) / 0.6);
    if (slices.length) {
      inner.style.opacity = frag > 0.001 ? '0' : '1';
      slices.forEach((s, i) => {
        const dir = i % 2 ? 1 : -1;
        const x = dir * frag * (18 + i * 6);
        s.style.transform = `translate3d(${x}vw, 0, 0) scaleY(${1 - frag * 0.85})`;
        s.style.opacity = String(1 - frag * 0.9);
      });
    }
    const lp = clamp01((p - 0.35) / 0.65);
    lines.forEach((l, i) => {
      l.style.transform = `scaleX(${clamp01(lp * 1.4 - i * 0.06)})`;
      l.style.opacity = String(0.9 * lp * (1 - clamp01((p - 1) * 2)));
    });
  };
}

// ------------------------------------------------------------ Surface / Lights
function initSurface(label: DigitalLabelTwin) {
  const sec = document.getElementById('surface');
  const tags = [...document.querySelectorAll<HTMLElement>('#surface-tags li')];
  const pct = document.getElementById('scan-pct');
  return () => {
    const p = sectionProgress(sec);
    const active = inView(sec);
    const scan = label.state.scan;
    for (const li of tags) {
      const z = SURFACE_ZONES.find((s) => s.key === li.dataset.zone);
      li.classList.toggle('hit', active && !!z && scan >= z.at);
    }
    if (pct) pct.textContent = String(Math.round(p * 100)).padStart(3, '0');
  };
}

function initLights() {
  const sec = document.getElementById('lights');
  const status = document.getElementById('light-status');
  const steps = [...document.querySelectorAll<HTMLElement>('#light-steps li')];
  return () => {
    const p = sectionProgress(sec);
    const idx = p < 0.18 ? 0 : p < 0.32 ? 1 : p < 0.82 ? 2 : 3;
    steps.forEach((li, i) => {
      li.classList.toggle('on', i === idx);
      li.classList.toggle('past', i < idx);
    });
    if (status) status.textContent = idx === 3 ? 'COMPLETE' : '01';
  };
}

// ------------------------------------------------------------ Layers
function initLayerTags(label: DigitalLabelTwin, camera: THREE.Camera) {
  const list = document.getElementById('layer-tags')!;
  const sec = document.getElementById('layers');
  const items = explodedOrder.map((l) => {
    const li = document.createElement('li');
    li.append(l.label, ' ');
    const small = document.createElement('small');
    small.textContent = l.tech;
    li.appendChild(small);
    list.appendChild(li);
    return li;
  });
  const v = new THREE.Vector3();
  let tracked = false;
  return () => {
    const explode = label.state.explode;
    const on = inView(sec) && explode > 0.02;
    if (on && explode > 0.8 && !tracked) {
      tracked = true;
      track('label_exploded_viewed', {}, { once: true });
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const n = label.layerCount();
    // âncora vertical: canto do rótulo base; tags distribuídas sem sobreposição
    label.worldPointForUv(1.0, 0.92, LABEL_WORLD.thickness / 2, v);
    v.project(camera);
    const y0 = Math.min((-v.y * 0.5 + 0.5) * H, H - items.length * 30 - 90);
    items.forEach((li, i) => {
      if (!on) {
        li.style.opacity = '0';
        return;
      }
      const z = i === 0 ? LABEL_WORLD.thickness / 2 : label.layerOffset(i - 1);
      label.worldPointForUv(1.0, 0.92, z, v);
      v.project(camera);
      let x = (v.x * 0.5 + 0.5) * W + 10;
      const y = y0 + i * 30;
      x = Math.min(x, W - li.offsetWidth - 12);
      const e = i === 0 ? 1 : clamp01(explode * (n + 1) - (i - 1));
      li.style.setProperty('--x', `${x.toFixed(1)}px`);
      li.style.setProperty('--y', `${y.toFixed(1)}px`);
      li.style.opacity = String(clamp01(e * 1.4));
    });
  };
}

// ------------------------------------------------------------ QR → Data
const EXAMPLE = { product: '1845678901001', lot: 'l1', unit: 'AO' };

function initQr(id: ProductIdentity) {
  const sec = document.getElementById('qr');
  const lines = [...document.querySelectorAll<HTMLElement>('[data-qr-line]')];
  const urlEl = document.getElementById('qr-url')!;
  const caption = document.getElementById('qr-caption')!;
  const partsEl = [...document.querySelectorAll<HTMLElement>('#qr-parts > div')];
  const svg = document.getElementById('qr-links') as unknown as SVGSVGElement;
  const viz = document.getElementById('qr-viz')!;

  const real = !!(id.productId && id.lotId && id.unitId);
  const vals = real ? { product: id.productId!, lot: id.lotId!, unit: id.unitId! } : EXAMPLE;
  caption.textContent = real ? 'LINK DESTA UNIDADE' : 'ESTRUTURA DE EXEMPLO';

  const segs: { key: string; text: string; cls: string }[] = [
    { key: 'host', text: 'ri3.ai', cls: '' },
    { key: 'product', text: '/01/', cls: 'seg-ai' },
    { key: 'product', text: vals.product, cls: 'seg-product' },
    { key: 'lot', text: '/10/', cls: 'seg-ai' },
    { key: 'lot', text: vals.lot, cls: '' },
    { key: 'unit', text: '/21/', cls: 'seg-ai' },
    { key: 'unit', text: vals.unit, cls: '' },
  ];
  const groups: Record<string, HTMLElement> = {};
  const chars: { el: HTMLElement; dx: number; dy: number; th: number }[] = [];
  for (const s of segs) {
    let g = groups[s.key];
    if (!g) {
      g = document.createElement('span');
      g.style.display = 'inline-block';
      g.dataset.group = s.key;
      urlEl.appendChild(g);
      groups[s.key] = g;
    }
    for (const c of s.text) {
      const span = document.createElement('span');
      span.className = `ch ${s.cls}`;
      span.textContent = c;
      g.appendChild(span);
      chars.push({ el: span, dx: (Math.random() - 0.5) * 120, dy: -20 - Math.random() * 90, th: Math.random() });
    }
  }
  partsEl.forEach((d) => {
    const key = d.dataset.part as keyof typeof vals;
    d.querySelector('[data-part-value]')!.textContent = vals[key];
  });

  const paths = partsEl.map(() => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.appendChild(p);
    return p;
  });
  const layoutLinks = () => {
    const vr = viz.getBoundingClientRect();
    partsEl.forEach((d, i) => {
      const g = groups[d.dataset.part!];
      const a = g.getBoundingClientRect();
      const b = d.getBoundingClientRect();
      const x1 = a.left + a.width / 2 - vr.left;
      const y1 = a.bottom - vr.top + 2;
      const x2 = b.left + b.width / 2 - vr.left;
      const y2 = b.top - vr.top;
      const my = (y1 + y2) / 2;
      paths[i].setAttribute('d', `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`);
      const len = paths[i].getTotalLength?.() || 200;
      paths[i].style.strokeDasharray = String(len);
      paths[i].dataset.len = String(len);
    });
  };
  let tracked = false;

  return () => {
    const p = sectionProgress(sec);
    lines.forEach((l, i) => l.classList.toggle('in', p > 0.02 + i * 0.12));
    const spread = clamp01((p - 0.32) / 0.2);
    groups.product.style.transform = `translate3d(${spread * 8}px, 0, 0)`;
    groups.lot.style.transform = `translate3d(${spread * 18}px, 0, 0)`;
    groups.unit.style.transform = `translate3d(${spread * 28}px, 0, 0)`;
    const partsIn = p > 0.48;
    partsEl.forEach((d, i) => d.classList.toggle('in', p > 0.48 + i * 0.05));
    if (partsIn && !tracked) {
      tracked = true;
      track('qr_structure_viewed', {}, { once: true });
    }
    layoutLinks();
    const draw = clamp01((p - 0.5) / 0.15);
    paths.forEach((path) => {
      const len = Number(path.dataset.len || 200);
      path.style.strokeDashoffset = String(len * (1 - draw));
      path.style.opacity = String(draw * (1 - clamp01((p - 0.9) / 0.1)));
    });
    // Desintegração dos caracteres (as partículas 3D assumem a forma da identidade).
    const dis = clamp01((p - 0.7) / 0.22);
    for (const c of chars) {
      const k = clamp01((dis - c.th * 0.6) / 0.4);
      c.el.style.transform = k > 0 ? `translate3d(${c.dx * k}px, ${c.dy * k}px, 0) scale(${1 - k * 0.6})` : '';
      c.el.style.opacity = String(1 - k);
    }
    const urlShow = clamp01((p - 0.22) / 0.1);
    urlEl.style.opacity = String(urlShow);
    caption.style.opacity = String(urlShow * (1 - dis));
  };
}

// ------------------------------------------------------------ Orbit
function initOrbit(reduced: boolean) {
  const sec = document.getElementById('orbit');
  const cards = [...document.querySelectorAll<HTMLElement>('.orbit-card')];
  const mq = window.matchMedia('(max-width: 760px)');
  return () => {
    if (reduced || mq.matches) return;
    const p = sectionProgress(sec);
    const active = p * (cards.length - 1);
    cards.forEach((c, i) => {
      const d = i - active;
      const ad = Math.abs(d);
      c.style.setProperty('--ox', `${(d * 86).toFixed(2)}%`);
      c.style.setProperty('--oy', `${(ad * 4).toFixed(2)}%`);
      c.style.setProperty('--oz', `${(-ad * 320).toFixed(1)}px`);
      c.style.setProperty('--ory', `${(-d * 28).toFixed(2)}deg`);
      c.style.setProperty('--oo', String(clamp01(1 - ad * 0.5)));
      c.style.zIndex = String(10 - Math.round(ad * 2));
      c.classList.toggle('active', ad < 0.5);
    });
  };
}

// ------------------------------------------------------------ Physical → Digital
function initTimeline() {
  const items = [...document.querySelectorAll<HTMLElement>('#timeline li')];
  const tl = document.getElementById('timeline')!;
  const energy = document.getElementById('timeline-energy')!;
  const title = document.getElementById('physical-title')!;
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('in')),
    { rootMargin: '0px 0px -35% 0px' },
  );
  items.forEach((li) => io.observe(li));
  let glitched = false;
  const tio = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !glitched) {
      glitched = true;
      title.classList.add('glitching');
      setTimeout(() => title.classList.remove('glitching'), 450);
    }
  });
  tio.observe(title);
  return () => {
    const r = tl.getBoundingClientRect();
    const secTop = (tl.offsetParent as HTMLElement | null)?.getBoundingClientRect().top ?? 0;
    energy.style.top = `${r.top - secTop + 6}px`;
    energy.style.height = `${r.height - 12}px`;
    const p = clamp01((window.innerHeight * 0.65 - r.top) / r.height);
    energy.style.setProperty('--energy', p.toFixed(3));
  };
}

// ------------------------------------------------------------ Passport
function initPassport() {
  const card = document.getElementById('passport')!;
  let seen = false;
  const io = new IntersectionObserver((e) => {
    if (e[0].isIntersecting && !seen) {
      seen = true;
      track('digital_id_viewed', {}, { once: true });
    }
  }, { threshold: 0.6 });
  io.observe(card);
  card.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const r = card.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    card.style.setProperty('--ry', `${(nx * 12).toFixed(2)}deg`);
    card.style.setProperty('--rx', `${(-ny * 8).toFixed(2)}deg`);
    card.style.setProperty('--gx', `${((nx + 0.5) * 100).toFixed(1)}%`);
    card.style.setProperty('--gy', `${((ny + 0.5) * 100).toFixed(1)}%`);
  });
  card.addEventListener('pointerleave', () => {
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  });
}

export function initSections(opts: {
  identity: ProductIdentity;
  label: DigitalLabelTwin | null;
  camera: THREE.Camera | null;
  reduced: boolean;
}) {
  const updaters: (() => void)[] = [initHeroSlices(opts.reduced), initLights(), initQr(opts.identity), initOrbit(opts.reduced), initTimeline()];
  if (opts.label && opts.camera) {
    updaters.push(initSurface(opts.label), initLayerTags(opts.label, opts.camera));
  }
  initPassport();
  return () => updaters.forEach((u) => u());
}
