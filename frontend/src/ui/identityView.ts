// Preenche o DOM com a identidade. Só textContent (nunca innerHTML com dados da URL).
// Sem ids: mostra textos genéricos, sem inventar números.

import { display, hasIds, type ProductIdentity } from '../identity/resolver.ts';

const GENERIC = {
  product: 'PRODUCT DETECTED',
  lot: 'LOT VERIFIED',
  unit: 'UNIQUE UNIT',
};

export function renderIdentity(id: ProductIdentity) {
  const known = hasIds(id);
  const values: Record<string, { text: string; generic: boolean }> = {
    product: { text: id.productId ?? GENERIC.product, generic: !id.productId },
    lot: { text: display(id.lotId, GENERIC.lot), generic: !id.lotId },
    unit: { text: display(id.unitId, GENERIC.unit), generic: !id.unitId },
    status: { text: known ? 'IDENTIFIED' : 'EXPERIENCE UNLOCKED', generic: false },
  };

  document.querySelectorAll<HTMLElement>('[data-field]').forEach((el) => {
    const v = values[el.dataset.field!];
    if (!v) return;
    el.textContent = v.text;
    el.classList.toggle('generic', v.generic);
  });

  // HUD
  const hudId = document.getElementById('hud-identity');
  if (hudId) hudId.textContent = known ? 'DETECTED' : 'STANDBY';
  const unitRow = document.getElementById('hud-unit-row');
  const unit = document.getElementById('hud-unit');
  if (unitRow && unit && id.unitId) {
    unit.textContent = id.unitId.toUpperCase();
    unitRow.hidden = false;
  }

  // Linha de identidade no RG
  const inline = document.querySelector<HTMLElement>('[data-identity-inline]');
  if (inline) {
    inline.replaceChildren();
    const parts: [string, string | null][] = [
      ['PRODUCT', id.productId],
      ['LOT', id.lotId],
      ['UNIT', id.unitId],
    ];
    const shown = parts.filter(([, v]) => v);
    if (shown.length) {
      for (const [k, v] of shown) {
        const b = document.createElement('b');
        b.textContent = `${k} // ${v!.toUpperCase()}`;
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
    heroVerified.replaceChildren('EXPERIENCE // ', Object.assign(document.createElement('b'), { textContent: 'UNLOCKED' }));
  }
}
