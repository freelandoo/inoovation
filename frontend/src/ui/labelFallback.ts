// Fallback sem WebGL: o rótulo real em HTML/CSS, com tilt, scanner, brilho
// luminescente e holográfico por máscara CSS. O conceito sobrevive sem 3D.

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function initLabelFallback(reduced: boolean) {
  const card = document.querySelector<HTMLElement>('.lf-card')!;
  let nx = 0;
  let ny = 0;
  if (!reduced) {
    window.addEventListener('pointermove', (e) => {
      nx = (e.clientX / window.innerWidth) * 2 - 1;
      ny = (e.clientY / window.innerHeight) * 2 - 1;
    });
  }
  const tag = (id: string) => document.getElementById(id);
  const surfaceTags = [...document.querySelectorAll<HTMLElement>('#surface-tags li')];

  return () => {
    const vh = window.innerHeight;
    const top = (id: string) => tag(id)?.getBoundingClientRect().top ?? 0;
    // hero: rótulo embaixo; depois centralizado; some a partir do QR.
    const heroP = clamp01(window.scrollY / vh);
    const qrTop = top('qr');
    const fadeOut = clamp01((vh * 0.3 - qrTop) / (vh * 0.8));
    const techTop = top('tech');
    const techIn = clamp01((vh - techTop) / vh) * (1 - clamp01((vh * 0.2 - top('ar')) / vh));
    const o = Math.max(1 - fadeOut, techIn);
    card.style.setProperty('--lf-y', `${(1 - heroP) * 22}vh`);
    card.style.setProperty('--lf-s', String(0.85 + heroP * 0.15));
    card.style.setProperty('--lf-o', o.toFixed(3));
    card.style.setProperty('--lf-rx', `${(-ny * 4).toFixed(2)}deg`);
    card.style.setProperty('--lf-ry', `${(nx * 7).toFixed(2)}deg`);
    card.style.setProperty('--lf-holo', `${(50 + nx * 40 + window.scrollY * 0.02) % 100}%`);
    const surf = tag('surface')?.getBoundingClientRect();
    const inSurface = !!surf && surf.top < vh * 0.6 && surf.bottom > vh * 0.4;
    surfaceTags.forEach((li) => li.classList.toggle('hit', inSurface));
  };
}
