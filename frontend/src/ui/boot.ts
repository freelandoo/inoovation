// Sequência de inicialização (SCAN → IDENTIFY → AUTHENTICATE → UNLOCK) e
// entrada cinematográfica do hero. Curta (~0,7 s de overlay + ~1,3 s de cena)
// e pulada em visitas repetidas na sessão, movimento reduzido ou aparelho fraco.

import { gsap } from 'gsap';
import { config } from '../config.ts';
import type { ProductIdentity } from '../identity/resolver.ts';

export interface BootTarget {
  intro: number;
}

function seen(): boolean {
  try {
    return sessionStorage.getItem(config.bootSeenKey) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(config.bootSeenKey, '1');
  } catch {
    /* ignore */
  }
}

export function runBoot(opts: { identity: ProductIdentity; target: BootTarget | null; fast: boolean; reduced: boolean }) {
  const html = document.documentElement;
  const boot = document.getElementById('boot')!;
  const line = document.getElementById('boot-line')!;
  const sub = document.getElementById('boot-sub')!;
  const bar = document.getElementById('boot-bar')!;
  const kicker = document.getElementById('hero-kicker')!;
  const title = document.getElementById('t-innovation')!;
  const skipOverlay = opts.fast || opts.reduced || seen();
  const hasUnit = !!(opts.identity.productId || opts.identity.unitId);

  const finish = () => {
    html.classList.remove('intro');
    if (opts.target) opts.target.intro = 1;
    kicker.textContent = hasUnit ? 'UNIQUE UNIT READY' : 'EXPERIENCE UNLOCKED';
    markSeen();
  };

  if (opts.reduced) {
    html.classList.add('no-boot');
    finish();
    return;
  }

  html.classList.add('intro');
  const tl = gsap.timeline({ onComplete: finish });

  if (skipOverlay) {
    html.classList.add('no-boot');
  } else {
    const steps: [string, string, number][] = [
      ['SCANNING IDENTITY…', 'PHYSICAL ID // SEARCHING', 0.35],
      ['IDENTITY FOUND', hasUnit ? 'LABEL ID // FOUND' : 'PHYSICAL PRODUCT // DETECTED', 0.7],
      ['ACCESS GRANTED', 'UNIQUE UNIT // READY', 1],
    ];
    steps.forEach(([l, s, p], i) => {
      tl.call(
        () => {
          line.textContent = l;
          sub.textContent = s;
          line.classList.toggle('ok', i === 2);
        },
        [],
        i * 0.24,
      );
      tl.to(bar, { '--boot': p, duration: 0.22, ease: 'power2.out' }, i * 0.24);
    });
    tl.call(() => boot.classList.add('done'), [], 0.75);
  }

  const start = skipOverlay ? 0 : 0.7;
  const dur = skipOverlay ? 0.9 : 1.3;
  if (opts.target) tl.to(opts.target, { intro: 1, duration: dur, ease: 'none' }, start);
  else tl.to({}, { duration: dur }, start);

  tl.call(() => (kicker.textContent = 'PHYSICAL PRODUCT DETECTED'), [], start);
  tl.call(() => (kicker.textContent = 'LABEL ID FOUND'), [], start + dur * 0.45);
  tl.call(
    () => {
      html.classList.remove('intro');
      title.classList.add('glitching');
      setTimeout(() => title.classList.remove('glitching'), 450);
    },
    [],
    start + dur * 0.6,
  );
}
