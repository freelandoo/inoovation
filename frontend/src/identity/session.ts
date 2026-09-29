// Sessão da identidade: garante que os ids recebidos da Realizse não se percam
// durante a navegação interna (mudança de rota/hash, reload, abertura da RA).

import { config } from '../config.ts';
import { resolveIdentity, hasIds, EMPTY_IDENTITY, type ProductIdentity } from './resolver.ts';

const KEY = 'iw:identity';

function readStored(): ProductIdentity | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProductIdentity>;
    // Revalida o que estava salvo, como se viesse da URL.
    const q = new URLSearchParams();
    if (parsed.productId) q.set('product', parsed.productId);
    if (parsed.lotId) q.set('lot', parsed.lotId);
    if (parsed.unitId) q.set('unit', parsed.unitId);
    if (parsed.source) q.set('source', parsed.source);
    if (parsed.campaign) q.set('campaign', parsed.campaign);
    const id = resolveIdentity(`https://x.invalid/?${q}`, config.params);
    return hasIds(id) ? { ...id, origin: 'session' } : null;
  } catch {
    return null;
  }
}

let current: ProductIdentity = EMPTY_IDENTITY;

export function initIdentity(href = window.location.href): ProductIdentity {
  const fromUrl = resolveIdentity(href, config.params, config.routePrefixes);
  if (hasIds(fromUrl)) {
    current = fromUrl;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(fromUrl));
    } catch {
      /* storage indisponível */
    }
  } else {
    const stored = readStored();
    current = stored ? { ...stored, source: fromUrl.source ?? stored.source, campaign: fromUrl.campaign ?? stored.campaign } : fromUrl;
  }
  return current;
}

export function getIdentity(): ProductIdentity {
  return current;
}

/** Query string com os ids, para propagar à RA ou a outra rota. */
export function identityQuery(id: ProductIdentity = current): string {
  const q = new URLSearchParams();
  if (id.productId) q.set('product', id.productId);
  if (id.lotId) q.set('lot', id.lotId);
  if (id.unitId) q.set('unit', id.unitId);
  if (id.source) q.set('source', id.source);
  if (id.campaign) q.set('campaign', id.campaign);
  return q.toString();
}
