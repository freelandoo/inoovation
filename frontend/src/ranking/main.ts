// Ranking do Astronaut Jetpack (/ranking). Todo mundo vê o ranking; quem tem
// um pote ativado neste aparelho (link de membro salvo) vê a própria posição,
// e quem não tem recebe o convite para ler o QR do pote e se cadastrar.
// Pódio: o 1º no centro e maior, entrada em cascata 3 -> 2 -> 1.

import './ranking.css';
import { memberToken, myRank, online, topScores, type TopEntry } from '../game/api.ts';
import { requestCamera } from '../scanner/camera.ts';
import { unitPath } from '../scanner/decode.ts';
import { config } from '../config.ts';

const $ = (id: string) => document.getElementById(id)!;
const html = document.documentElement;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const token = memberToken();
let myCrew: number | null = null;
let shownKey = '';

const initials = (name: string) => name.trim().charAt(0) || '?';
const fmt = (n: number) => n.toLocaleString('pt-BR');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Conta de 0 até o valor (respeita reduced-motion). */
function countUp(el: HTMLElement, value: number, delay = 0) {
  if (reduced) {
    el.textContent = fmt(value);
    return;
  }
  const dur = 1100;
  const t0 = performance.now() + delay;
  el.textContent = '0';
  const tick = (now: number) => {
    const k = Math.min(1, Math.max(0, (now - t0) / dur));
    el.textContent = fmt(Math.round(value * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const CROWN = `<svg class="rk-crown" viewBox="0 0 64 40" aria-hidden="true"><path d="M4 34 8 8l14 14L32 4l10 18L56 8l4 26z"/><rect x="4" y="34" width="56" height="5" rx="1"/></svg>`;

function podiumCol(e: TopEntry, rank: 1 | 2 | 3) {
  const me = e.crew === myCrew ? ' is-me' : '';
  return `
    <div class="rk-col r${rank}${me}" style="--d:${(3 - rank) * 160}ms">
      <div class="rk-card">
        ${rank === 1 ? CROWN : ''}
        <span class="rk-seal mono">${rank}</span>
        <div class="rk-avatar"><span>${esc(initials(e.name))}</span></div>
        <p class="rk-name">${esc(e.name)}${me ? ' <em>VOCÊ</em>' : ''}</p>
        <p class="rk-crew mono">TRIPULANTE #${e.crew}</p>
        <p class="rk-dist"><b class="mono" data-count="${e.best}">0</b><small class="mono">METROS</small></p>
      </div>
      <div class="rk-pedestal"><span>${rank}</span></div>
    </div>`;
}

function render(top: TopEntry[], total: number) {
  const key = JSON.stringify([top, myCrew]);
  if (key === shownKey) return;
  const first = !shownKey;
  shownKey = key;
  $('rk-count').textContent = total ? `${fmt(total)} ${total === 1 ? 'TRIPULANTE' : 'TRIPULANTES'} NO RANKING` : '';
  $('rk-empty').hidden = top.length > 0;

  const podium = $('rk-podium');
  const order: [number, 1 | 2 | 3][] = [
    [1, 2],
    [0, 1],
    [2, 3],
  ];
  podium.innerHTML = order
    .filter(([i]) => top[i])
    .map(([i, r]) => podiumCol(top[i], r))
    .join('');
  podium.classList.toggle('animate', first && !reduced);

  const lead = top[0]?.best || 1;
  $('rk-list').innerHTML = top
    .slice(3)
    .map((e, i) => {
      const me = e.crew === myCrew ? ' class="is-me"' : '';
      return `<li${me} style="--i:${i}">
        <span class="rk-pos mono">${i + 4}</span>
        <span class="rk-mini"><span>${esc(initials(e.name))}</span></span>
        <span class="rk-who"><b>${esc(e.name)}${me ? ' <em>VOCÊ</em>' : ''}</b><small class="mono">#${e.crew}</small></span>
        <span class="rk-bar" style="--w:${Math.max(4, (e.best / lead) * 100)}%"><i></i></span>
        <span class="rk-m mono">${fmt(e.best)} m</span>
      </li>`;
    })
    .join('');

  podium.querySelectorAll<HTMLElement>('[data-count]').forEach((el, i) => {
    const v = Number(el.dataset.count);
    if (first) countUp(el, v, 300 + i * 160);
    else el.textContent = fmt(v);
  });
}

async function loadMe() {
  if (!token) {
    $('rk-join').hidden = false;
    return;
  }
  const me = await myRank();
  if (!me) {
    // Link salvo mas não reconhecido (banco zerado?): trata como sem pote.
    $('rk-join').hidden = false;
    return;
  }
  myCrew = me.crew;
  $('rk-me').hidden = false;
  $('rk-me-name').textContent = `${me.name} · TRIPULANTE #${me.crew}`;
  $('rk-me-rank').textContent = me.rank ? `${me.rank}º` : '—';
  $('rk-me-best').textContent = me.best ? `Seu recorde: ${fmt(me.best)} m` : 'Você ainda não tem partidas no ranking. Jogue para entrar!';
}

async function loadTop() {
  const r = await topScores(50);
  $('rk-error').hidden = !!r;
  if (!r) return;
  render(r.top, r.total);
  html.dataset.state = 'ready';
}

// ---------------------------------------------------------------- leitor de QR

let scanning = false;
$('rk-scan').addEventListener('click', () => {
  if (scanning) return;
  scanning = true;
  const stream = requestCamera();
  stream.catch(() => {});
  import('../scanner/UnitScanner.ts')
    .then((m) =>
      m.openUnitScanner({
        stream,
        onUnit: (unit) => {
          // Mesmo caminho de quem chega pelo link do pote: verificação, cadastro e link de membro.
          const q = new URLSearchParams({ [config.scanner.viaParam]: config.scanner.viaValue, source: 'ranking' });
          window.setTimeout(() => window.location.replace(`${unitPath(unit)}?${q}`), 700);
        },
        onInvalid: () => {},
        onError: () => {},
        onClose: () => (scanning = false),
      }),
    )
    .catch(() => {
      stream.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
      scanning = false;
    });
});

// Voltar: para o jogo, ou para a página de onde veio.
$('rk-back').addEventListener('click', (e) => {
  try {
    if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) {
      e.preventDefault();
      history.back();
    }
  } catch {
    /* referrer inválido */
  }
});

if (!online()) {
  $('rk-error').textContent = 'Ranking indisponível neste ambiente.';
  $('rk-error').hidden = false;
  $('rk-join').hidden = !!token;
} else {
  await loadMe();
  await loadTop();
  setInterval(() => {
    if (!document.hidden) void loadTop();
  }, 30000);
}
