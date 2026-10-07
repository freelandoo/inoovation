// Coleção da área do membro: vitrine (#colecao) e personagem na câmara branca
// (#colecao/<id>). O personagem entra na coleção quando a pessoa o "pega" na RA.
//
// Fonte da verdade: a API (POST /api/member/<token>/collect). Uma cópia fica no
// aparelho para a vitrine responder na hora e para reenviar se a rede falhar.

import { gsap } from 'gsap';
import { config } from '../config.ts';
import { track } from '../analytics/analytics.ts';
import { play } from '../audio/sfx.ts';
import { CHAMBER_BG, CHARACTERS, COLLECTION_SLOTS, characterById, type Character } from '../collection/catalog.ts';

export interface Collected {
  character: string;
  collectedAt: string;
}

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');

export function initCollection(opts: { token: string; server: Collected[]; reduced: boolean; onChange: (n: number) => void }) {
  const { token, reduced } = opts;
  const storeKey = `iw:collection:${token}`;
  const vault = $('#vault');
  const grid = $('#vault-grid');
  const cv = $('#cv');
  const items = new Map<string, Collected>();
  let fresh: string | null = null;
  let viewer: import('../collection/CharacterViewer.ts').CharacterViewer | null = null;
  let turntable: import('../collection/SlotTurntable.ts').SlotTurntable | null = null;

  const readLocal = (): Collected[] => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? '[]') as Collected[];
    } catch {
      return [];
    }
  };
  const writeLocal = () => {
    try {
      localStorage.setItem(storeKey, JSON.stringify([...items.values()]));
    } catch {
      /* storage indisponível */
    }
  };

  const send = (id: string) =>
    fetch(`${config.api.baseUrl}/api/member/${encodeURIComponent(token)}/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character: id }),
    })
      .then((r) => r.ok)
      .catch(() => false);

  for (const c of opts.server) items.set(c.character, c);
  // Pegou num aparelho sem rede: reenviar.
  for (const c of readLocal()) {
    if (items.has(c.character) || !characterById(c.character)) continue;
    items.set(c.character, c);
    send(c.character);
  }
  writeLocal();

  // ------------------------------------------------------------ vitrine

  function renderVault() {
    const have = CHARACTERS.filter((c) => items.has(c.id)).length;
    $('[data-m="vault-have"]').textContent = String(have);
    $('[data-m="vault-total"]').textContent = String(COLLECTION_SLOTS);
    $('[data-m="vault-lead"]').textContent =
      have === 0
        ? 'Cada personagem é liberado por uma missão. O primeiro já está disponível: colete-o na RA e abra a sua vitrine.'
        : 'Você saiu na frente. Novos personagens chegam nas próximas missões; volte pelo seu link de membro para completar a vitrine.';
    grid.innerHTML = '';
    for (let i = 0; i < COLLECTION_SLOTS; i++) {
      const c: Character | undefined = CHARACTERS[i];
      const li = document.createElement('li');
      const num = String(i + 1).padStart(3, '0');
      if (c && items.has(c.id)) {
        li.className = 'vault-slot is-owned' + (fresh === c.id ? ' is-new' : '');
        li.innerHTML = `
          <a href="#colecao/${c.id}" aria-label="Ver ${c.name} em 3D">
            <img src="${c.card}" alt="" loading="lazy" decoding="async" />
            <canvas class="vault-3d" data-model="${c.model}" aria-hidden="true"></canvas>
            <span class="vault-new mono">NOVO</span>
            <span class="vault-meta"><span class="mono">Nº ${c.number}</span><b></b><span class="mono vault-cta">VER EM 3D ›</span></span>
          </a>`;
        li.querySelector('b')!.textContent = c.name;
      } else if (c) {
        li.className = 'vault-slot is-available';
        li.innerHTML = `
          <a href="#" data-go-ar aria-label="Coletar ${c.name} na RA">
            <img src="${c.card}" alt="" loading="lazy" decoding="async" />
            <span class="vault-meta"><span class="mono">Nº ${c.number}</span><b>Disponível agora</b><span class="mono vault-cta">COLETAR NA RA ›</span></span>
          </a>`;
      } else {
        li.className = 'vault-slot is-locked';
        li.innerHTML = `
          <div>
            <span class="vault-q" aria-hidden="true">?</span>
            <span class="vault-meta"><span class="mono">Nº ${num}</span><b>???</b><span class="mono">PRÓXIMA MISSÃO</span></span>
          </div>`;
      }
      grid.appendChild(li);
    }
    grid.querySelectorAll<HTMLElement>('[data-go-ar]').forEach((a) =>
      a.addEventListener('click', (e) => {
        e.preventDefault();
        history.replaceState(null, '', location.pathname);
        route();
        document.getElementById('mb-ar-btn')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      }),
    );
    opts.onChange(have);
    if (!vault.hidden) attach3d();
  }

  /** Personagens coletados girando nos slots (um renderer para todos). */
  async function attach3d() {
    const canvases = [...grid.querySelectorAll<HTMLCanvasElement>('canvas.vault-3d')];
    if (!canvases.length) return;
    try {
      const { SlotTurntable } = await import('../collection/SlotTurntable.ts');
      if (vault.hidden) return;
      turntable ??= new SlotTurntable(reduced);
      turntable.clear();
      for (const cnv of canvases) {
        const slot = cnv.closest('.vault-slot')!;
        turntable.add(cnv, cnv.dataset.model!, () => slot.classList.add('is-3d')).catch(() => {});
      }
    } catch {
      /* sem WebGL: fica a arte 2D do card */
    }
  }

  // ------------------------------------------------------------ câmara branca

  async function openViewer(c: Character) {
    const own = items.get(c.id);
    $('[data-cv="number"]').textContent = `Nº ${c.number}`;
    $('[data-cv="rarity"]').textContent = c.rarity;
    $('[data-cv="name"]').textContent = c.name;
    $('[data-cv="title"]').textContent = c.title;
    $('[data-cv="date"]').textContent = own ? `COLETADO EM ${fmtDate(own.collectedAt)}` : '';
    cv.style.setProperty('--cv-bg', `url("${CHAMBER_BG}")`);
    cv.hidden = false;
    turntable?.setPaused(true);
    track('character_viewed', { character: c.id });
    if (!reduced) gsap.fromTo(cv, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' });
    try {
      const { CharacterViewer } = await import('../collection/CharacterViewer.ts');
      if (cv.hidden) return;
      viewer ??= new CharacterViewer(cv.querySelector('canvas')!, reduced);
      await viewer.show(c.model);
      play('lock');
    } catch {
      $('[data-cv="title"]').textContent = 'Não foi possível abrir o 3D neste aparelho.';
    }
  }

  function closeViewer() {
    cv.hidden = true;
    viewer?.dispose();
    viewer = null;
    turntable?.setPaused(false);
  }

  // ------------------------------------------------------------ rotas

  function route() {
    const m = location.hash.match(/^#colecao(?:\/([a-z0-9-]+))?$/);
    const inVault = !!m;
    const c = m?.[1] ? characterById(m[1]) : null;
    document.documentElement.classList.toggle('vault-open', inVault);
    if (inVault && vault.hidden) {
      vault.hidden = false;
      renderVault();
      track('collection_viewed', { have: items.size });
      if (!reduced) {
        gsap.fromTo(vault, { opacity: 0 }, { opacity: 1, duration: 0.4 });
        gsap.from('.vault-slot', { y: 30, opacity: 0, stagger: 0.07, duration: 0.6, ease: 'power3.out', delay: 0.1 });
      }
      window.scrollTo(0, 0);
    }
    if (!inVault && !vault.hidden) {
      vault.hidden = true;
      turntable?.dispose();
      turntable = null;
    }
    if (c && items.has(c.id)) {
      if (cv.hidden) openViewer(c);
    } else if (!cv.hidden) closeViewer();
  }
  window.addEventListener('hashchange', route);

  renderVault();
  route();

  return {
    /** Chamado pela RA ao "pegar": grava, envia e leva para a vitrine com o novo destacado. */
    collect(id: string) {
      const isNew = !items.has(id);
      if (isNew) items.set(id, { character: id, collectedAt: new Date().toISOString() });
      writeLocal();
      send(id);
      track('character_collected', { character: id, new: isNew });
      fresh = id;
      vault.hidden = true;
      location.hash = '#colecao';
      route();
      play('success', 0.3);
    },
    count: () => items.size,
  };
}
