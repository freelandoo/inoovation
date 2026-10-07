// Área do membro (/membro/<token>): identidade branca. Mostra o tripulante, o
// suplemento ativado (unidade verificada), a missão, a RA que coleta o personagem
// e a vitrine da coleção (#colecao).

import { gsap } from 'gsap';
import type * as THREE from 'three';
import { config } from '../config.ts';
import { setAnalyticsIdentity, track } from '../analytics/analytics.ts';
import { connectAnalytics } from '../api/client.ts';
import { initSfx, play, soundToggle } from '../audio/sfx.ts';
import { launchARExperience, prepareAR } from '../ar/launch.ts';
import { EMPTY_IDENTITY, type ProductIdentity } from '../identity/resolver.ts';
import { COLLECTION_SLOTS, latestCharacter } from '../collection/catalog.ts';
import { initCollection, type Collected } from './collection.ts';
import './member.css';

interface Member {
  crew: number;
  name: string;
  email: string;
  memberSince: string;
  arStarted: boolean;
  collection?: Collected[];
  unit: {
    productId: string | null;
    lotId: string | null;
    unitId: string | null;
    status: 'seen' | 'verified' | 'blocked';
    scanCount: number;
    firstSeenAt: string;
  };
}

const html = document.documentElement;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const field = (k: string) => $(`[data-m="${k}"]`);

initSfx();
$('#mb-head-right').appendChild(soundToggle('mono'));

function tokenFromUrl(): string | null {
  const m = location.pathname.match(/^\/membro\/([A-Za-z0-9_-]{20,64})\/?$/);
  return m?.[1] ?? new URLSearchParams(location.search).get('t');
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');

function decode(el: HTMLElement, text: string, delay = 0) {
  if (reduced) {
    el.textContent = text;
    return;
  }
  const start = performance.now() + delay;
  const dur = 420 + text.length * 50;
  const tick = (now: number) => {
    const p = Math.max(0, Math.min(1, (now - start) / dur));
    const settled = Math.floor(p * text.length);
    let out = text.slice(0, settled);
    for (let i = settled; i < text.length; i++) out += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    el.textContent = out;
    if (now >= start && p < 1) play('tick');
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function load() {
  const token = tokenFromUrl();
  const base = config.api.baseUrl;
  if (!token || !base) return fail();
  let m: Member;
  try {
    const r = await fetch(`${base}/api/member/${encodeURIComponent(token)}`);
    if (!r.ok) return fail();
    m = (await r.json()) as Member;
  } catch {
    return fail();
  }
  render(m, token);
}

function fail() {
  html.dataset.state = 'error';
  if (!reduced) gsap.from('.mb-error > *', { opacity: 0, y: 16, stagger: 0.08, duration: 0.6, ease: 'power3.out' });
}

function render(m: Member, token: string) {
  const identity: ProductIdentity = {
    ...EMPTY_IDENTITY,
    productId: m.unit.productId,
    lotId: m.unit.lotId,
    unitId: m.unit.unitId,
    source: 'member',
    origin: 'session',
  };
  setAnalyticsIdentity(identity);
  connectAnalytics();
  track('member_viewed');

  const verified = m.unit.status === 'verified';

  field('name').textContent = m.name;
  field('since').textContent = fmtDate(m.memberSince);
  field('email').textContent = m.email;
  field('status').textContent = verified ? 'VERIFICADA' : m.unit.status === 'blocked' ? 'BLOQUEADA' : 'EM ANÁLISE';
  field('status-word').textContent = verified ? 'ATIVADO' : 'EM ANÁLISE';
  field('scans').textContent = String(m.unit.scanCount).padStart(3, '0');
  field('first').textContent = fmtDate(m.unit.firstSeenAt);
  field('step-verified').textContent = fmtDate(m.unit.firstSeenAt);
  field('step-crew').textContent = `Nº ${String(m.crew).padStart(4, '0')} · ${fmtDate(m.memberSince)}`;
  html.classList.toggle('mb-unverified', !verified);

  const setMission = (collected: number) => {
    const steps = [verified, true, collected > 0];
    document.querySelectorAll<HTMLElement>('.mb-steps li').forEach((li, i) => li.classList.toggle('done', steps[i]));
    field('step-ar').textContent = collected > 0 ? `${collected}/${COLLECTION_SLOTS} NA COLEÇÃO` : 'PENDENTE';
    field('vault-count').textContent = `${collected}/${COLLECTION_SLOTS}`;
    const pct = Math.round((steps.filter(Boolean).length / steps.length) * 100);
    field('mission-pct').textContent = `${pct}%`;
    $('#mb-progress').style.transform = `scaleX(${pct / 100})`;
    return pct;
  };
  const collection = initCollection({ token, server: m.collection ?? [], reduced, onChange: setMission });
  const pct = setMission(collection.count());

  html.dataset.state = 'ready';

  const texts: [string, string][] = [
    ['crew', String(m.crew).padStart(4, '0')],
    ['product', m.unit.productId ?? '—'],
    ['lot', m.unit.lotId ?? '—'],
    ['unit', m.unit.unitId ?? '—'],
  ];

  if (reduced) {
    for (const [k, t] of texts) field(k).textContent = t;
    $('#mb-progress').style.transform = `scaleX(${pct / 100})`;
  } else {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.from('.mb-head', { y: -20, opacity: 0, duration: 0.6 })
      .from('[data-reveal]', { y: 40, opacity: 0, duration: 0.8, stagger: 0.12 }, 0.1)
      .from('.mb-crew-label', { '--w': 62, letterSpacing: '0.3em', duration: 1.1, ease: 'expo.out' }, 0.2)
      .call(() => decode(field('crew'), texts[0][1]), [], 0.35)
      .call(() => texts.slice(1).forEach(([k, t], i) => decode(field(k), t, i * 120)), [], 0.7)
      .fromTo('.mb-supp .mb-ring', { strokeDashoffset: 100 }, { strokeDashoffset: 0, duration: 1, ease: 'power2.inOut' }, 0.6)
      .call(() => play('charge'), [], 0.6)
      .fromTo('.mb-supp .mb-check', { strokeDashoffset: 100 }, { strokeDashoffset: 0, duration: 0.35 }, 1.5)
      .call(() => play('lock'), [], 1.5)
      .fromTo('.mb-stamp', { scale: 2.2, opacity: 0, rotate: -24 }, { scale: 1, opacity: 1, rotate: -8, duration: 0.45, ease: 'back.out(2.2)' }, 1.6)
      .fromTo('.mb-label', { '--scan': 0 }, { '--scan': 1, duration: 1.3, ease: 'power2.inOut' }, 0.5)
      .fromTo('#mb-progress', { scaleX: 0 }, { scaleX: pct / 100, duration: 1.2, ease: 'expo.out' }, 1.2)
      .from('.mb-steps li', { x: -14, opacity: 0, stagger: 0.12, duration: 0.5 }, 1.1);
  }

  // Inclinação do rótulo com o ponteiro (desktop).
  const label = $('#mb-label');
  if (!reduced && window.matchMedia('(hover: hover)').matches) {
    label.addEventListener('pointermove', (e) => {
      const r = label.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      gsap.to(label, { rotateY: x * 14, rotateX: -y * 14, '--mx': `${(x + 0.5) * 100}%`, duration: 0.5, ease: 'power2.out' });
    });
    label.addEventListener('pointerleave', () => gsap.to(label, { rotateY: 0, rotateX: 0, duration: 0.8, ease: 'elastic.out(1, 0.5)' }));
  }

  initAr(identity, (id) => collection.collect(id));
  initShare(token);
}

// ---------------------------------------------------------------- RA

function initAr(identity: ProductIdentity, onCollect: (id: string) => void) {
  const btn = $<HTMLButtonElement>('#mb-ar-btn');
  const err = $('#mb-ar-error');
  const canvas = $<HTMLCanvasElement>('#stage');
  let renderer: THREE.WebGLRenderer | null = null;

  // A RA reaproveita um renderer da página; aqui ele é criado em segundo plano.
  const ready = import('three')
    .then((T) => {
      renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = T.SRGBColorSpace;
      prepareAR().catch(() => {});
    })
    .catch(() => {});

  btn.addEventListener('pointerenter', () => btn.classList.add('hot'));
  btn.addEventListener('pointerleave', () => btn.classList.remove('hot'));

  let busy = false;
  btn.addEventListener('click', () => {
    if (busy) return;
    if (!renderer) {
      err.textContent = 'Preparando o holograma… toque de novo em instantes.';
      err.hidden = false;
      ready.then(() => (err.hidden = true));
      return;
    }
    busy = true;
    err.hidden = true;
    btn.classList.add('firing');
    play('laser');
    play('charge', 0.1);
    launchARExperience(identity, {
      renderer,
      pauseLanding: () => {},
      resumeLanding: () => {
        btn.classList.remove('firing');
        busy = false;
      },
      collect: { onTake: () => onCollect(latestCharacter().id) },
    })
      .catch(() => {
        err.textContent = 'Não foi possível iniciar a RA neste aparelho. Tente no celular, pelo navegador padrão.';
        err.hidden = false;
        btn.classList.remove('firing');
        play('error');
        busy = false;
      });
  });
}

// ---------------------------------------------------------------- link

function initShare(token: string) {
  const btn = $<HTMLButtonElement>('#mb-share');
  const url = `${location.origin}/membro/${token}`;
  btn.addEventListener('click', async () => {
    track('member_link_shared');
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Meu perfil Innovation Week', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      btn.textContent = 'LINK COPIADO ✓';
      play('beep');
      setTimeout(() => (btn.textContent = 'SALVAR MEU LINK'), 2200);
    } catch {
      /* compartilhamento cancelado */
    }
  });
}

load();
