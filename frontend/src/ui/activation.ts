// "Unidade ativada": modal que abre quando a API confirma que a unidade está na
// lista oficial. Celebra a ativação (selo, título, ids decodificando) e pede o
// cadastro (nome, e-mail, WhatsApp opcional, consentimento LGPD).
//
// Abre sozinho uma vez por sessão depois da entrada do hero; quem fecha pode
// reabrir pelo botão do hero. Cadastro feito fica salvo no aparelho e o hero
// passa a mostrar o número de tripulante.

import { gsap } from 'gsap';
import { track } from '../analytics/analytics.ts';
import { config } from '../config.ts';
import { submitSignup, type UnitInfo } from '../api/client.ts';
import { play } from '../audio/sfx.ts';
import type { ProductIdentity } from '../identity/resolver.ts';
import './activation.css';

/** Versão do texto de consentimento abaixo (o backend aceita só versões conhecidas). */
const CONSENT_VERSION = '2026-10-v2';
const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';

export interface ActivationOptions {
  identity: ProductIdentity;
  unit: UnitInfo;
  reduced: boolean;
  pauseLanding: () => void;
  resumeLanding: () => void;
}

interface Registered {
  crew: number;
  name: string;
  /** Token do link secreto da área do membro. */
  member?: string;
}

export const memberUrl = (token: string) => `/membro/${encodeURIComponent(token)}`;

const unitKey = (id: ProductIdentity) => `${id.productId ?? ''}|${id.lotId ?? ''}|${id.unitId ?? ''}`;
const crewLabel = (n: number) => String(n).padStart(4, '0');

function readStore<T>(store: () => Storage, key: string): T | null {
  try {
    const raw = store().getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function removeStore(store: () => Storage, key: string) {
  try {
    store().removeItem(key);
  } catch {
    /* storage indisponível */
  }
}

/**
 * O cadastro salvo no aparelho só vale se o perfil ainda existir na API (o banco pode
 * ter sido zerado ou o cadastro removido). Sem rede, mantém o que está salvo.
 */
async function storedStillValid(reg: Registered): Promise<boolean> {
  if (!reg.member || !config.api.baseUrl) return !!reg.member;
  try {
    const r = await fetch(`${config.api.baseUrl}/api/member/${encodeURIComponent(reg.member)}`);
    return r.status !== 404;
  } catch {
    return true;
  }
}

function writeStore(store: () => Storage, key: string, value: unknown) {
  try {
    store().setItem(key, JSON.stringify(value));
  } catch {
    /* storage indisponível */
  }
}

const TEMPLATE = `
  <div class="act-backdrop" data-close></div>
  <div class="act-card" tabindex="-1">
    <i class="act-corner act-tl"></i><i class="act-corner act-tr"></i><i class="act-corner act-bl"></i><i class="act-corner act-br"></i>
    <i class="act-sweep" aria-hidden="true"></i>
    <header class="act-head mono">
      <span>IW-26 // PROTOCOLO DE ATIVAÇÃO</span>
      <button class="act-close" type="button" aria-label="Fechar" data-close>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </header>

    <div class="act-hero">
      <div class="act-seal" aria-hidden="true">
        <svg viewBox="0 0 120 120">
          <circle class="act-ticks" cx="60" cy="60" r="56" />
          <circle class="act-track" cx="60" cy="60" r="46" />
          <circle class="act-ring" cx="60" cy="60" r="46" pathLength="100" />
          <circle class="act-core" cx="60" cy="60" r="36" />
          <path class="act-check" d="M44 61l11 11 22-24" pathLength="100" />
          <g class="act-orbit"><circle cx="60" cy="4" r="2.6" /></g>
        </svg>
        <span class="act-sparks"></span>
      </div>
      <div class="act-heading">
        <p class="act-kicker mono">STATUS // <b>VERIFICADA</b></p>
        <h2 class="act-title" id="act-title"><span class="act-line">UNIDADE</span><span class="act-line act-line-red">ATIVADA</span></h2>
      </div>
    </div>

    <dl class="act-data mono">
      <div><dt>GTIN</dt><dd data-act="product"></dd></div>
      <div><dt>LOTE</dt><dd data-act="lot"></dd></div>
      <div><dt>SERIAL</dt><dd data-act="unit"></dd></div>
      <div><dt>LEITURA</dt><dd data-act="scan"></dd></div>
    </dl>

    <section class="act-step" data-step="form">
      <p class="act-lead">Registre esta unidade no seu nome e entre para a <b>tripulação Innovation Week</b>.</p>
      <form class="act-form" novalidate>
        <label class="act-field">
          <input name="name" type="text" autocomplete="name" maxlength="80" placeholder=" " required />
          <span>Nome</span>
        </label>
        <label class="act-field">
          <input name="email" type="email" autocomplete="email" inputmode="email" maxlength="120" placeholder=" " required />
          <span>E-mail</span>
        </label>
        <label class="act-field">
          <input name="phone" type="tel" autocomplete="tel-national" inputmode="tel" maxlength="16" placeholder=" " />
          <span>WhatsApp <em>(opcional)</em></span>
        </label>
        <label class="act-check-row">
          <input name="consent" type="checkbox" required />
          <i aria-hidden="true"></i>
          <span>Autorizo a <b>TENKAGROUP</b> a usar meus dados para registrar esta unidade, mostrar meu primeiro nome no telão do evento e falar comigo sobre a campanha Innovation Week, conforme a LGPD. <a href="/privacidade" target="_blank" rel="noopener">Política de privacidade</a></span>
        </label>
        <label class="act-check-row">
          <input name="marketing" type="checkbox" />
          <i aria-hidden="true"></i>
          <span>Quero receber novidades e convites dos próximos eventos.</span>
        </label>
        <p class="act-error" role="alert" aria-live="assertive"></p>
        <button class="act-submit" type="submit"><span class="act-submit-label">REGISTRAR MINHA UNIDADE</span><i class="act-submit-bar"></i></button>
        <button class="act-later mono" type="button" data-close>AGORA NÃO</button>
      </form>
    </section>

    <section class="act-step act-done" data-step="done" hidden>
      <p class="act-crew mono">TRIPULANTE Nº <b data-act="crew"></b></p>
      <p class="act-welcome">Bem-vindo(a) a bordo, <b data-act="first-name"></b>.</p>
      <p class="act-lead">Esta unidade agora está registrada no seu nome. Seu perfil de membro já está no ar.</p>
      <a class="act-submit act-submit-link" data-member-link href="#"><span class="act-submit-label">ABRIR MEU PERFIL DE MEMBRO</span></a>
      <button class="act-later mono" type="button" data-go-ar>VER O HOLOGRAMA EM RA</button>
    </section>
  </div>
`;

function formatPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Mesmas regras do backend (backend/src/validate.ts). */
function validate(f: FormData): { name: string; email: string; phone: string } | string {
  const name = String(f.get('name') ?? '').trim().replace(/\s+/g, ' ');
  const email = String(f.get('email') ?? '').trim().toLowerCase();
  const phone = String(f.get('phone') ?? '').replace(/\D/g, '');
  if (!/^[\p{L}][\p{L}\p{M} '.-]{1,79}$/u.test(name)) return 'Digite seu nome.';
  if (!/^[^\s@<>()[\],;:"]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(email)) return 'Confira o e-mail.';
  if (phone && !/^[1-9]{2}\d{8,9}$/.test(phone)) return 'Confira o WhatsApp, com DDD.';
  if (!f.get('consent')) return 'Marque a autorização para continuar.';
  return { name, email, phone };
}

/** Texto "decodificando": caracteres aleatórios que assentam da esquerda para a direita. */
function decode(el: HTMLElement, text: string, delay: number, reduced: boolean, sound = true) {
  if (reduced) {
    el.textContent = text;
    return;
  }
  el.textContent = '';
  const start = performance.now() + delay;
  const dur = 380 + text.length * 45;
  const tick = (now: number) => {
    const p = Math.max(0, Math.min(1, (now - start) / dur));
    const settled = Math.floor(p * text.length);
    let out = text.slice(0, settled);
    if (now >= start) for (let i = settled; i < text.length; i++) out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
    el.textContent = out;
    if (sound && now >= start && p < 1) play('tick');
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function initActivation(opts: ActivationOptions) {
  const { identity, unit, reduced } = opts;
  const key = unitKey(identity);
  const regKey = `iw:signup:${key}`;
  const dismissKey = `iw:signup-dismissed:${key}`;
  const html = document.documentElement;

  // Botão no hero, no lugar do "ativar unidade" (que só existe sem serial).
  const hero = document.getElementById('hero');
  const heroBtn = document.createElement('button');
  heroBtn.type = 'button';
  heroBtn.className = 'scan-cta scan-cta-hero mono act-hero-cta';
  hero?.appendChild(heroBtn);

  const renderHero = () => {
    const reg = readStore<Registered>(() => localStorage, regKey);
    heroBtn.replaceChildren();
    const dot = document.createElement('i');
    dot.className = 'act-dot';
    const label = document.createElement('span');
    label.textContent = reg ? `TRIPULANTE Nº ${crewLabel(reg.crew)} // PERFIL` : 'REGISTRAR MINHA UNIDADE';
    heroBtn.append(dot, label);
    heroBtn.classList.toggle('is-registered', !!reg);
  };
  renderHero();

  let root: HTMLDivElement | null = null;
  let lastFocus: HTMLElement | null = null;
  let tl: gsap.core.Timeline | null = null;

  const close = (reason: 'dismiss' | 'done' | 'ar') => {
    if (!root) return;
    const el = root;
    root = null;
    tl?.kill();
    if (reason === 'dismiss') {
      track('signup_dismissed');
      writeStore(() => sessionStorage, dismissKey, 1);
    }
    document.removeEventListener('keydown', onKey, true);
    const finish = () => {
      el.remove();
      html.classList.remove('act-open');
      opts.resumeLanding();
      renderHero();
      if (reason === 'ar') document.getElementById('ar')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
      else lastFocus?.focus?.();
    };
    if (reduced) finish();
    else
      gsap
        .timeline({ onComplete: finish })
        .to(el.querySelector('.act-card'), { y: 24, opacity: 0, scale: 0.97, duration: 0.32, ease: 'power2.in' })
        .to(el.querySelector('.act-backdrop'), { opacity: 0, duration: 0.3 }, '<0.1');
  };

  const onKey = (e: KeyboardEvent) => {
    if (!root) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close('dismiss');
      return;
    }
    if (e.key !== 'Tab') return;
    // Foco preso dentro do modal.
    const items = [...root.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex="-1"]')].filter(
      (n) => !n.closest('[hidden]') && n.tabIndex >= 0,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const open = () => {
    if (root) return;
    lastFocus = document.activeElement as HTMLElement | null;
    const el = document.createElement('div');
    el.className = 'act';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'act-title');
    el.innerHTML = TEMPLATE; // estático; dados da URL entram só por textContent
    root = el;
    document.body.appendChild(el);
    html.classList.add('act-open');
    opts.pauseLanding();
    track('signup_viewed');

    const $ = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
    const card = $('.act-card');
    const form = $<HTMLFormElement>('.act-form');
    const error = $('.act-error');
    const submit = $<HTMLButtonElement>('.act-form .act-submit');
    const phone = $<HTMLInputElement>('input[name="phone"]');

    el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close('dismiss')));
    $('[data-go-ar]').addEventListener('click', () => close('ar'));
    document.addEventListener('keydown', onKey, true);
    phone.addEventListener('input', () => (phone.value = formatPhone(phone.value)));
    el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) =>
      cb.addEventListener('change', () => play(cb.checked ? 'beep' : 'unbeep')),
    );

    const sparks = $('.act-sparks');
    for (let i = 0; i < 14; i++) sparks.appendChild(document.createElement('i'));

    // Já registrado neste aparelho: abre direto no estado final.
    const reg = readStore<Registered>(() => localStorage, regKey);
    if (reg) showDone(reg, false);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = validate(new FormData(form));
      if (typeof v === 'string') {
        error.textContent = v;
        play('error');
        if (!reduced) gsap.fromTo(card, { x: -6 }, { x: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)' });
        return;
      }
      error.textContent = '';
      submit.disabled = true;
      el.dataset.state = 'sending';
      $('.act-submit-label').textContent = 'TRANSMITINDO…';
      play('transmit');
      const fd = new FormData(form);
      const res = await submitSignup(identity, {
        ...v,
        consent: CONSENT_VERSION,
        marketing: fd.get('marketing') === 'on',
      });
      if (!root) return;
      submit.disabled = false;
      delete el.dataset.state;
      $('.act-submit-label').textContent = 'REGISTRAR MINHA UNIDADE';
      if (!res.ok) {
        error.textContent = res.error;
        play('error');
        return;
      }
      track('signup_submitted', { marketing: fd.get('marketing') === 'on', phone: !!v.phone });
      const done = { crew: res.crew, name: v.name.split(' ')[0], member: res.member };
      writeStore(() => localStorage, regKey, done);
      showDone(done, true);
    });

    function showDone(r: Registered, animate: boolean) {
      $('[data-act="crew"]').textContent = crewLabel(r.crew);
      $('[data-act="first-name"]').textContent = r.name;
      const link = $<HTMLAnchorElement>('[data-member-link]');
      if (r.member) link.href = memberUrl(r.member);
      else link.hidden = true;
      $('.act-kicker b').textContent = 'REGISTRADA';
      const formStep = $('[data-step="form"]');
      const doneStep = $('[data-step="done"]');
      if (!animate || reduced) {
        formStep.hidden = true;
        doneStep.hidden = false;
        return;
      }
      gsap
        .timeline()
        .to(formStep, { opacity: 0, y: -12, duration: 0.25, ease: 'power2.in' })
        .call(() => {
          formStep.hidden = true;
          doneStep.hidden = false;
          burst();
          play('success');
          decode($('[data-act="crew"]'), crewLabel(r.crew), 0, false);
        })
        .fromTo(doneStep.children, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: 'power3.out' });
    }

    function burst() {
      if (reduced) return;
      sparks.querySelectorAll('i').forEach((s, i) => {
        const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
        const d = 54 + Math.random() * 40;
        gsap.fromTo(
          s,
          { x: 0, y: 0, opacity: 1, scale: 1 },
          { x: Math.cos(a) * d, y: Math.sin(a) * d, opacity: 0, scale: 0.3, duration: 0.9 + Math.random() * 0.4, ease: 'expo.out' },
        );
      });
      gsap.fromTo($('.act-seal'), { scale: 1.12 }, { scale: 1, duration: 0.7, ease: 'elastic.out(1, 0.4)' });
    }

    // Dados da unidade.
    const fields: [string, string][] = [
      ['product', identity.productId ?? '—'],
      ['lot', identity.lotId ?? '—'],
      ['unit', identity.unitId ?? '—'],
      ['scan', `Nº ${String(unit.scanCount).padStart(3, '0')}`],
    ];

    if (reduced) {
      for (const [k, t] of fields) $(`[data-act="${k}"]`).textContent = t;
      el.classList.add('is-static');
      card.focus({ preventScroll: true });
      return;
    }

    // Sequência: rasgo de luz → selo carrega → check → título → ids decodificam → formulário.
    const lines = el.querySelectorAll('.act-line');
    tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.call(() => play('whoosh'), [], 0)
      .call(() => play('charge'), [], 0.5)
      .call(() => play('lock'), [], 1.4)
      .call(() => play('sparkle'), [], 1.5)
      .fromTo($('.act-backdrop'), { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0)
      .fromTo(card, { clipPath: 'inset(49.5% 0 49.5% 0)', opacity: 1 }, { clipPath: 'inset(0% 0 0% 0)', duration: 0.7, ease: 'expo.inOut' }, 0.1)
      .fromTo(el.querySelectorAll('.act-corner'), { scale: 2.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, stagger: 0.05 }, 0.45)
      .fromTo($('.act-sweep'), { xPercent: -120, opacity: 1 }, { xPercent: 120, duration: 1.1, ease: 'power2.inOut' }, 0.5)
      .set($('.act-sweep'), { opacity: 0 })
      .fromTo($('.act-ring'), { strokeDashoffset: 100 }, { strokeDashoffset: 0, duration: 0.9, ease: 'power2.inOut' }, 0.55)
      .fromTo($('.act-check'), { strokeDashoffset: 100 }, { strokeDashoffset: 0, duration: 0.35, ease: 'power2.out' }, 1.4)
      .call(burst, [], 1.5)
      .fromTo($('.act-kicker'), { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.4 }, 1.0)
      .fromTo(
        lines,
        { yPercent: 110, '--w': 62, filter: 'blur(8px)' },
        { yPercent: 0, '--w': 125, filter: 'blur(0px)', duration: 0.9, stagger: 0.12, ease: 'expo.out', clearProps: 'filter' },
        1.1,
      )
      .call(() => fields.forEach(([k, t], i) => decode($(`[data-act="${k}"]`), t, i * 110, false)), [], 1.35)
      .fromTo(el.querySelectorAll('.act-data > div'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.08 }, 1.3)
      .fromTo(
        $(reg ? '[data-step="done"]' : '[data-step="form"]').children,
        { opacity: 0, y: 18 },
        { opacity: 1, y: 0, duration: 0.55, stagger: 0.07 },
        1.9,
      )
      .call(() => card.focus({ preventScroll: true }), [], 0.8);
    if (reg) tl.call(() => decode($('[data-act="crew"]'), crewLabel(reg.crew), 0, false), [], 1.9);
  };

  heroBtn.addEventListener('click', () => {
    const reg = readStore<Registered>(() => localStorage, regKey);
    if (reg?.member) window.location.href = memberUrl(reg.member);
    else open();
  });

  // Abre sozinho: só depois da entrada do hero, uma vez por sessão, e se ninguém
  // estiver com a RA ou o leitor abertos.
  const tryOpen = () => {
    if (html.classList.contains('intro') || html.classList.contains('ar-open') || html.classList.contains('usc-open')) {
      window.setTimeout(tryOpen, 400);
      return;
    }
    window.setTimeout(open, reduced ? 0 : 700);
  };
  const stored = readStore<Registered>(() => localStorage, regKey);
  (stored ? storedStillValid(stored) : Promise.resolve(false)).then((valid) => {
    if (stored && !valid) {
      removeStore(() => localStorage, regKey);
      removeStore(() => sessionStorage, dismissKey);
      renderHero();
    }
    if (valid || readStore(() => sessionStorage, dismissKey)) return;
    tryOpen();
  });
}
