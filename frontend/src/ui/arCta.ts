// Botão INICIAR RA: hover expande os anéis (e o portal reage); clique faz a
// energia colapsar para o centro e então inicia a experiência.

import { gsap } from 'gsap';
import { launchARExperience, prepareAR, type LaunchOptions } from '../ar/launch.ts';
import { getIdentity } from '../identity/session.ts';
import { track } from '../analytics/analytics.ts';
import { play } from '../audio/sfx.ts';
import type { EnergyPortal } from '../scene/EnergyPortal.ts';

export function initArCta(opts: LaunchOptions & { portal: EnergyPortal | null; reduced: boolean }) {
  const btn = document.getElementById('ar-button') as HTMLButtonElement;
  const err = document.getElementById('ar-error')!;
  const section = document.getElementById('ar')!;

  // Pré-carrega o módulo RA quando a seção se aproxima, e registra a visualização do CTA.
  const io = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        prepareAR().catch(() => {});
        track('ar_cta_viewed', {}, { once: true });
      }
    },
    { rootMargin: '0px 0px 60% 0px' },
  );
  io.observe(section);

  const hover = (v: boolean) => opts.portal?.setHover(v);
  btn.addEventListener('pointerenter', () => hover(true));
  btn.addEventListener('pointerleave', () => hover(false));
  btn.addEventListener('focus', () => hover(true));
  btn.addEventListener('blur', () => hover(false));

  let busy = false;
  btn.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    err.hidden = true;
    btn.classList.add('firing');
    play('laser');
    play('charge', 0.1);

    // Pede permissões dentro do gesto; a animação de colapso roda em paralelo.
    const launching = launchARExperience(getIdentity(), {
      ...opts,
      pauseLanding: () => opts.pauseLanding(),
      resumeLanding: () => {
        opts.resumeLanding();
        if (opts.portal) gsap.to(opts.portal, { collapse: 0, duration: 0.6, ease: 'power2.out' });
        btn.classList.remove('firing');
        busy = false;
      },
    });

    const collapse = opts.portal && !opts.reduced
      ? gsap.to(opts.portal, { collapse: 1, duration: 0.8, ease: 'power3.in' }).then(() => {})
      : Promise.resolve();

    Promise.all([launching, collapse]).catch(() => {
      err.textContent = 'Não foi possível iniciar a RA neste aparelho. Tente no celular, pelo navegador padrão.';
      err.hidden = false;
      btn.classList.remove('firing');
      if (opts.portal) gsap.to(opts.portal, { collapse: 0, duration: 0.5 });
      busy = false;
    });
  });
}
