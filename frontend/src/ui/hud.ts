// HUD (relógio de sessão, coordenadas), barra SYSTEM PROGRESS e scanline
// que revela microinformações quando cruza cards.

const STEP_LABEL = ['ID', 'TRACE', 'CONNECT', 'AUGMENT'];

export function initHud(reduced: boolean) {
  const session = document.getElementById('hud-session');
  const passportSession = document.getElementById('passport-session');
  const t0 = Date.now();
  const tickClock = () => {
    const s = Math.floor((Date.now() - t0) / 1000);
    const txt = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
    if (session) session.textContent = txt;
    if (passportSession) passportSession.textContent = `SESSION ${txt}`;
  };
  tickClock();
  setInterval(tickClock, 1000);

  const fill = document.getElementById('progress-fill')!;
  const items = [...document.querySelectorAll<HTMLElement>('.progress li')];
  const coordY = document.getElementById('coord-y');
  const coordSec = document.getElementById('coord-sec');
  const sections = [...document.querySelectorAll<HTMLElement>('[data-step]')].filter((el) => el.tagName === 'SECTION');

  const scanline = document.getElementById('scanline')!;
  const reactive = [...document.querySelectorAll<HTMLElement>('.scan-reactive')];
  let scanT = 0;
  let last = performance.now();

  return function update() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? window.scrollY / max : 0;
    fill.parentElement!.style.setProperty('--progress', p.toFixed(4));

    // passo atual = última seção cujo topo passou do meio da tela
    let step = 1;
    for (const s of sections) {
      if (s.getBoundingClientRect().top < window.innerHeight * 0.5) step = Number(s.dataset.step);
    }
    items.forEach((li) => {
      const n = Number(li.dataset.step);
      li.classList.toggle('active', n === step);
      li.classList.toggle('done', n < step);
    });
    if (coordY) coordY.textContent = String(Math.round(window.scrollY)).padStart(4, '0');
    if (coordSec) coordSec.textContent = STEP_LABEL[step - 1];

    // Scanline lenta: atravessa a tela a cada ~14 s e "lê" os cards por onde passa.
    if (reduced) return;
    const now = performance.now();
    scanT = (scanT + (now - last) / 1000) % 14;
    last = now;
    const active = scanT < 6;
    scanline.classList.toggle('on', active);
    if (!active) return;
    const y = (scanT / 6) * window.innerHeight;
    scanline.style.setProperty('--scan-y', `${y.toFixed(1)}px`);
    for (const el of reactive) {
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom && !el.classList.contains('scanned')) {
        el.classList.add('scanned');
        setTimeout(() => el.classList.remove('scanned'), 1600);
      }
    }
  };
}
