// Telão do evento (/telao): total de tripulantes e de embalagens devolvidas ao
// vivo, últimos cadastros e uma chegada animada (com som) a cada novo tripulante. Consulta GET /api/live a
// cada 3 s. ?demo=1 simula chegadas sem API, para ensaio.

import { gsap } from 'gsap';
import { config } from '../config.ts';
import { initSfx, play } from '../audio/sfx.ts';
import './screen.css';

interface Crew {
  crew: number;
  name: string;
  at: string;
}
interface Live {
  crew: number;
  units: number;
  ar: number;
  /** Embalagens devolvidas (leitor da área admin). */
  returns?: number;
  recent: Crew[];
}

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const pad = (n: number) => String(n).padStart(4, '0');
const demo = new URLSearchParams(location.search).has('demo');
const POLL_MS = 3000;
const ARRIVAL_MS = 5200;

initSfx();

// ---------------------------------------------------------------- relógio, poeira, ticker

const clock = $('#tv-clock');
setInterval(() => (clock.textContent = new Date().toLocaleTimeString('pt-BR')), 1000);

const dust = $('#tv-dust');
for (let i = 0; i < 60; i++) {
  const d = document.createElement('i');
  d.style.left = `${Math.random() * 100}%`;
  d.style.top = `${Math.random() * 100}%`;
  d.style.animationDelay = `${-Math.random() * 20}s`;
  d.style.animationDuration = `${14 + Math.random() * 14}s`;
  d.style.opacity = String(0.2 + Math.random() * 0.6);
  dust.appendChild(d);
}

const tickerText = ['ESCANEIE O QR DO SEU POTE', 'ATIVE SUA UNIDADE', 'ENTRE PARA A TRIPULAÇÃO', 'ABRA O HOLOGRAMA EM RA'];
const ticker = $('#tv-ticker');
for (let k = 0; k < 2; k++) {
  const run = document.createElement('span');
  for (const t of tickerText) {
    const s = document.createElement('span');
    s.textContent = t;
    const dot = document.createElement('b');
    dot.textContent = '◆';
    run.append(s, dot);
  }
  ticker.appendChild(run);
}

// ---------------------------------------------------------------- contador (odômetro)

/** Odômetro de 4+ dígitos que rola até o número novo e pulsa quando sobe. */
function odometer(odo: HTMLElement) {
  let shown = -1;
  return (n: number) => {
    if (n === shown) return;
    const digits = pad(n).split('');
    while (odo.children.length < digits.length) {
      const col = document.createElement('span');
      col.className = 'tv-digit';
      const strip = document.createElement('span');
      for (let d = 0; d <= 9; d++) {
        const i = document.createElement('i');
        i.textContent = String(d);
        strip.appendChild(i);
      }
      col.appendChild(strip);
      odo.prepend(col);
    }
    [...odo.children].forEach((col, i) => {
      const d = Number(digits[i]);
      gsap.to(col.firstElementChild, { yPercent: -d * 10, duration: shown < 0 ? 0 : 1.2, ease: 'expo.out', delay: i * 0.05 });
    });
    if (shown >= 0) gsap.fromTo(odo, { scale: 1.06, textShadow: '0 0 60px rgba(255,22,22,1)' }, { scale: 1, textShadow: '0 0 30px rgba(255,22,22,0.35)', duration: 1.2 });
    shown = n;
  };
}
const setCount = odometer($('#tv-odo'));
const setReturns = odometer($('#tv-returns'));

function setStat(el: HTMLElement, n: number) {
  const from = Number(el.dataset.v ?? 0);
  if (from === n) return;
  const o = { v: from };
  gsap.to(o, { v: n, duration: 1, ease: 'power2.out', onUpdate: () => (el.textContent = Math.round(o.v).toLocaleString('pt-BR')) });
  el.dataset.v = String(n);
}

// ---------------------------------------------------------------- lista

const list = $('#tv-list');
function row(c: Crew): HTMLLIElement {
  const li = document.createElement('li');
  const num = document.createElement('span');
  num.className = 'mono';
  num.textContent = `Nº ${pad(c.crew)}`;
  const name = document.createElement('b');
  name.textContent = c.name;
  const time = document.createElement('span');
  time.className = 'mono tv-time';
  time.textContent = new Date(c.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  li.append(num, name, time);
  li.dataset.crew = String(c.crew);
  return li;
}
function pushRow(c: Crew, animate: boolean) {
  const li = row(c);
  list.prepend(li);
  if (animate) gsap.fromTo(li, { x: 80, opacity: 0, backgroundColor: 'rgba(255,22,22,0.5)' }, { x: 0, opacity: 1, backgroundColor: 'rgba(255,22,22,0)', duration: 1.1, ease: 'expo.out' });
  while (list.children.length > 8) list.lastElementChild!.remove();
}

// ---------------------------------------------------------------- chegada

const arrival = $('#tv-arrival');
const queue: Crew[] = [];
let busy = false;

function nextArrival() {
  const c = queue.shift();
  if (!c) {
    busy = false;
    return;
  }
  busy = true;
  $('#tv-arrival-name').textContent = c.name;
  $('#tv-arrival-num').textContent = pad(c.crew);
  arrival.hidden = false;
  play('arrival');
  gsap
    .timeline({
      onComplete: () => {
        arrival.hidden = true;
        pushRow(c, true);
        setTimeout(nextArrival, 400);
      },
    })
    .fromTo(arrival, { opacity: 0 }, { opacity: 1, duration: 0.25 })
    .fromTo('.tv-laser', { scaleX: 0, opacity: 1 }, { scaleX: 1, duration: 0.45, stagger: 0.12, ease: 'expo.out' }, 0)
    .to('.tv-laser', { opacity: 0, duration: 0.6 }, 0.7)
    .fromTo('.tv-arrival-ring i', { scale: 0.2, opacity: 1 }, { scale: 1.6, opacity: 0, duration: 1.4, stagger: 0.2, ease: 'expo.out' }, 0.4)
    .fromTo('.tv-arrival .tv-kicker', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 0.35)
    .fromTo(
      '#tv-arrival-name',
      { '--w': 62, scale: 1.4, opacity: 0, filter: 'blur(20px)' },
      { '--w': 125, scale: 1, opacity: 1, filter: 'blur(0px)', duration: 1, ease: 'expo.out' },
      0.45,
    )
    .fromTo('.tv-arrival-num', { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.8)
    .to(arrival, { opacity: 0, duration: 0.5 }, ARRIVAL_MS / 1000 - 0.5);
}

// ---------------------------------------------------------------- dados

let lastCrew = -1;
function apply(live: Live) {
  setStat($('#tv-units'), live.units);
  setStat($('#tv-ar'), live.ar);
  setReturns(live.returns ?? 0);
  const fresh = live.recent.filter((c) => c.crew > lastCrew).sort((a, b) => a.crew - b.crew);
  if (lastCrew < 0) {
    // primeira leitura: monta a lista sem festa
    [...live.recent].reverse().forEach((c) => pushRow(c, false));
    setCount(live.crew);
  } else if (fresh.length) {
    queue.push(...fresh);
    // o total sobe junto com a chegada
    setTimeout(() => setCount(live.crew), 900);
    if (!busy) nextArrival();
  } else setCount(live.crew);
  if (live.recent.length) lastCrew = Math.max(lastCrew, ...live.recent.map((c) => c.crew));
  else lastCrew = Math.max(lastCrew, 0);
}

async function poll() {
  try {
    const r = await fetch(`${config.api.baseUrl}/api/live`, { cache: 'no-store' });
    if (r.ok) apply((await r.json()) as Live);
  } catch {
    /* rede instável: tenta de novo no próximo ciclo */
  }
  setTimeout(poll, POLL_MS);
}

function runDemo() {
  const names = ['ANA', 'BRUNO', 'CAROL', 'DIEGO', 'ELISA', 'FELIPE', 'GABI', 'HUGO', 'ISA', 'JOÃO'];
  const live: Live = { crew: 41, units: 128, ar: 37, returns: 6, recent: [] };
  for (let i = 0; i < 6; i++) live.recent.push({ crew: 41 - i, name: names[i], at: new Date(Date.now() - i * 60000).toISOString() });
  apply(live);
  setInterval(() => {
    live.crew++;
    live.units += 1 + Math.round(Math.random() * 2);
    live.ar += Math.random() > 0.5 ? 1 : 0;
    live.returns! += Math.random() > 0.6 ? 1 : 0;
    live.recent = [{ crew: live.crew, name: names[live.crew % names.length], at: new Date().toISOString() }, ...live.recent].slice(0, 12);
    apply(live);
  }, 8000);
}

// ---------------------------------------------------------------- início

$('#tv-start-btn').addEventListener('click', () => {
  document.documentElement.requestFullscreen?.().catch(() => {});
  play('boot');
  gsap.to('#tv-start', { opacity: 0, duration: 0.6, onComplete: () => $('#tv-start').remove() });
  gsap.from('.tv-top, .tv-count > *, .tv-feed, .tv-ticker', { y: 30, opacity: 0, duration: 0.9, stagger: 0.08, ease: 'expo.out', delay: 0.2 });
});

if (demo || !config.api.baseUrl) runDemo();
else poll();
