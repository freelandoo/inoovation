// Preenche o DOM com a identidade. Só textContent (nunca innerHTML com dados da URL).
// Sem ids: mostra textos genéricos, sem inventar números.

import { display, hasIds, type ProductIdentity } from '../identity/resolver.ts';

const GENERIC = {
  product: 'PRODUTO DETECTADO',
  lot: 'LOTE VERIFICADO',
  unit: 'UNIDADE ÚNICA',
};

export function renderIdentity(id: ProductIdentity) {
  const known = hasIds(id);
  const values: Record<string, { text: string; generic: boolean }> = {
    product: { text: id.productId ?? GENERIC.product, generic: !id.productId },
    lot: { text: display(id.lotId, GENERIC.lot), generic: !id.lotId },
    unit: { text: display(id.unitId, GENERIC.unit), generic: !id.unitId },
    status: { text: known ? 'IDENTIFICADA' : 'EXPERIÊNCIA LIBERADA', generic: false },
  };

  document.querySelectorAll<HTMLElement>('[data-field]').forEach((el) => {
    const v = values[el.dataset.field!];
    if (!v) return;
    el.textContent = v.text;
    el.classList.toggle('generic', v.generic);
  });

  // HUD
  const hudId = document.getElementById('hud-identity');
  if (hudId) hudId.textContent = known ? 'DETECTADA' : 'EM ESPERA';
  const unitRow = document.getElementById('hud-unit-row');
  const unit = document.getElementById('hud-unit');
  if (unitRow && unit && id.unitId) {
    unit.textContent = id.unitId;
    unitRow.hidden = false;
  }

  // Linha de identidade no RG
  const inline = document.querySelector<HTMLElement>('[data-identity-inline]');
  if (inline) {
    inline.replaceChildren();
    const parts: [string, string | null][] = [
      ['PRODUTO', id.productId],
      ['LOTE', id.lotId],
      ['UNIDADE', id.unitId],
    ];
    const shown = parts.filter(([, v]) => v);
    if (shown.length) {
      for (const [k, v] of shown) {
        const b = document.createElement('b');
        b.textContent = `${k} // ${v}`;
        inline.appendChild(b);
      }
    } else {
      inline.textContent = 'IDENTIDADE DIGITAL // PRONTA';
    }
  }

  const lead = document.getElementById('ar-lead');
  if (lead && !known) lead.textContent = 'Sua experiência foi desbloqueada. Sua identidade digital está pronta.';

  const heroVerified = document.getElementById('hero-verified');
  if (heroVerified && !known) {
    heroVerified.replaceChildren('EXPERIÊNCIA // ', Object.assign(document.createElement('b'), { textContent: 'LIBERADA' }));
  }
}

/**
 * Resultado da validação da unidade na API (lista oficial da Realizse).
 *   pending      consultando
 *   verified     serial está na lista
 *   unregistered serial não está na lista (a experiência continua liberada)
 *   blocked      unidade bloqueada manualmente
 *   offline      API indisponível ou não configurada: não afirma nada
 */
export type Verification = 'pending' | 'verified' | 'unregistered' | 'blocked' | 'offline';

const VERIFICATION: Record<Verification, { status: string; hero: string; hud: string; seal: string; lead: string }> = {
  pending: {
    status: 'VERIFICANDO',
    hero: 'VERIFICANDO',
    hud: 'CONSULTANDO',
    seal: 'ID DIGITAL ÚNICO',
    lead: 'Verificando sua unidade…',
  },
  verified: {
    status: 'VERIFICADA',
    hero: 'VERIFICADA',
    hud: 'VERIFICADA',
    seal: 'UNIDADE OFICIAL',
    lead: 'Sua unidade foi reconhecida. Sua identidade digital está pronta.',
  },
  unregistered: {
    status: 'NÃO RECONHECIDA',
    hero: 'NÃO RECONHECIDA',
    hud: 'DESCONHECIDA',
    seal: 'ID NÃO CADASTRADO',
    lead: 'Não encontramos este código na base oficial da campanha. A experiência continua liberada.',
  },
  blocked: {
    status: 'BLOQUEADA',
    hero: 'BLOQUEADA',
    hud: 'BLOQUEADA',
    seal: 'ID BLOQUEADO',
    lead: 'Este código foi bloqueado na base oficial da campanha.',
  },
  offline: {
    status: 'IDENTIFICADA',
    hero: 'DETECTADA',
    hud: 'DETECTADA',
    seal: 'ID DIGITAL ÚNICO',
    lead: 'Sua identidade digital está pronta.',
  },
};

export function renderVerification(state: Verification) {
  const t = VERIFICATION[state];
  document.documentElement.dataset.unit = state;
  document.querySelectorAll<HTMLElement>('[data-field="status"]').forEach((el) => {
    el.textContent = t.status;
    el.classList.remove('generic');
  });
  const hero = document.querySelector('#hero-verified b');
  if (hero) hero.textContent = t.hero;
  const hud = document.getElementById('hud-identity');
  if (hud) hud.textContent = t.hud;
  const seal = document.querySelector('#passport .seal');
  if (seal) seal.textContent = t.seal;
  const lead = document.getElementById('ar-lead');
  if (lead) lead.textContent = t.lead;
}
