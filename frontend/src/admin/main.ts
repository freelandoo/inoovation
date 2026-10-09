// Área admin (/admin): login com usuário e senha, números ao vivo, leitor de
// devolução de embalagens e o botão que abre a apresentação (/admin/apresentacao).

import { gsap } from 'gsap';
import '../present/tabloid.css';
import './admin.css';
import { checkAdmin, clearAdmin, loginAdmin, readAdmin } from './session.ts';
import { fetchStats, fmtInt, funnelRows, type Stats } from './stats.ts';
import { initReturns, refreshReturns } from './returns.ts';

const html = document.documentElement;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;

let timer = 0;

async function boot() {
  if (readAdmin() && (await checkAdmin())) return showPanel();
  clearAdmin();
  showLogin();
}

function showLogin() {
  html.dataset.state = 'login';
  $('#ad-user').hidden = true;
  $('#ad-logout').hidden = true;
  if (!reduced) gsap.from('.ad-login > *', { opacity: 0, y: 24, stagger: 0.1, duration: 0.8, ease: 'power3.out' });
  const form = $<HTMLFormElement>('#ad-form');
  const err = $('#ad-error');
  const btn = form.querySelector<HTMLButtonElement>('button')!;
  form.querySelector<HTMLInputElement>('input')?.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    btn.disabled = true;
    err.hidden = true;
    const r = await loginAdmin(String(data.get('user') ?? ''), String(data.get('password') ?? ''));
    btn.disabled = false;
    if (!r.ok) {
      err.textContent = r.error;
      err.hidden = false;
      if (!reduced) gsap.fromTo('.ad-login-card', { x: -8 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.3)' });
      return;
    }
    form.reset();
    // Veio da apresentação sem sessão: volta para ela.
    const next = new URLSearchParams(location.search).get('next');
    if (next === 'apresentacao') {
      location.href = '/admin/apresentacao';
      return;
    }
    showPanel();
  };
}

function showPanel() {
  html.dataset.state = 'ready';
  const s = readAdmin();
  $('#ad-user').textContent = `@${s?.user ?? 'admin'}`;
  $('#ad-user').hidden = false;
  const out = $('#ad-logout');
  out.hidden = false;
  out.onclick = () => {
    clearAdmin();
    clearInterval(timer);
    showLogin();
  };
  if (!reduced) {
    gsap.from('.ad-hero > *', { opacity: 0, y: 30, stagger: 0.12, duration: 0.9, ease: 'power3.out' });
    gsap.from('.ad-mega', { letterSpacing: '0.2em', duration: 1.2, ease: 'expo.out' });
  }
  initReturns();
  refresh(true);
  clearInterval(timer);
  timer = window.setInterval(() => refresh(false), 10_000);
}

async function refresh(first: boolean) {
  const s = await fetchStats();
  if (!s) {
    if (!readAdmin()) return showLogin();
    $('#ad-updated').textContent = 'SEM CONEXÃO COM A API';
    return;
  }
  render(s, first);
  refreshReturns();
  $('#ad-updated').textContent = `ATUALIZADO ${new Date().toLocaleTimeString('pt-BR')}`;
}

function render(s: Stats, first: boolean) {
  const t = s.totals;
  const cards: [string, number, string][] = [
    ['LEITURAS DO QR', t.scans, 'cada sessão que abriu uma unidade'],
    ['UNIDADES VERIFICADAS', t.verified, `de ${fmtInt(t.registered)} na lista oficial`],
    ['TRIPULANTES', t.signups, 'cadastros com consentimento LGPD'],
    ['SESSÕES', t.sessions, `${fmtInt(t.with_unit)} com unidade identificada`],
  ];
  const list = $('#ad-cards');
  if (first || list.children.length !== cards.length) {
    list.innerHTML = '';
    cards.forEach(([label, , sub], i) => {
      const li = document.createElement('li');
      li.className = 'tb-frame ad-card';
      li.innerHTML = `<div class="tb-frame-in"><span class="ad-card-n tb-wide tb-outline">0${i + 1}</span><b class="ad-card-v tb-wide" data-v="0">0</b><span class="tb-type ad-card-l"></span><span class="tb-type ad-card-s"></span><i class="tb-stripes ad-card-stripes"></i></div>`;
      li.querySelector('.ad-card-l')!.textContent = label;
      li.querySelector('.ad-card-s')!.textContent = sub;
      list.appendChild(li);
    });
    if (!reduced) gsap.from('.ad-card', { y: 30, opacity: 0, stagger: 0.08, duration: 0.7, ease: 'power3.out' });
  }
  cards.forEach(([, value, sub], i) => {
    const li = list.children[i] as HTMLElement;
    li.querySelector('.ad-card-s')!.textContent = sub;
    const el = li.querySelector<HTMLElement>('.ad-card-v')!;
    const from = Number(el.dataset.v);
    el.dataset.v = String(value);
    if (reduced || from === value) {
      el.textContent = fmtInt(value);
      return;
    }
    const o = { v: from };
    gsap.to(o, { v: value, duration: 1.2, ease: 'power3.out', onUpdate: () => (el.textContent = fmtInt(Math.round(o.v))) });
  });

  const funnel = $('#ad-funnel');
  funnel.innerHTML = '';
  for (const r of funnelRows(s)) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="ad-f-l"></span><span class="ad-f-bar"><i style="transform: scaleX(${r.pct.toFixed(3)})"></i></span><b></b>`;
    li.querySelector('.ad-f-l')!.textContent = r.label;
    li.querySelector('b')!.textContent = fmtInt(r.value);
    funnel.appendChild(li);
  }

  const body = $('#ad-recent');
  body.innerHTML = '';
  for (const u of s.recentUnits.slice(0, 8)) {
    const tr = document.createElement('tr');
    const status = u.status === 'verified' ? 'VERIFICADA' : u.status === 'blocked' ? 'BLOQUEADA' : 'NÃO RECONHECIDA';
    for (const v of [u.unit_id ?? '—', u.lot_id ?? '—', status, String(u.scan_count), new Date(u.last_seen_at).toLocaleString('pt-BR')]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    tr.dataset.status = u.status;
    body.appendChild(tr);
  }
  if (!s.recentUnits.length) body.innerHTML = '<tr><td colspan="5">Nenhuma leitura ainda.</td></tr>';
}

boot();
