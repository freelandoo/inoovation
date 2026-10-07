// Eventos da página. O envio fica a cargo de um adapter: por padrão, a API
// própria (src/api/client.ts). Sem API configurada, só aparecem no console em dev.
// Os ids da unidade não vão nos eventos: o backend liga o evento à unidade pela sessão.

import type { ProductIdentity } from '../identity/resolver.ts';

export type AnalyticsEvent =
  | 'innovation_page_view'
  | 'identity_detected'
  | 'label_viewed'
  | 'label_exploded_viewed'
  | 'digital_id_viewed'
  | 'qr_structure_viewed'
  | 'ar_cta_viewed'
  | 'ar_cta_clicked'
  | 'ar_experience_started'
  | 'ar_experience_failed'
  | 'unit_scan_opened'
  | 'unit_scan_succeeded'
  | 'unit_scan_failed'
  | 'signup_viewed'
  | 'signup_submitted'
  | 'signup_dismissed'
  | 'member_viewed'
  | 'member_link_shared'
  | 'character_collected'
  | 'collection_viewed'
  | 'character_viewed';

export type AnalyticsAdapter = (event: AnalyticsEvent, payload: Record<string, unknown>) => void;

let adapter: AnalyticsAdapter | null = null;
let identity: ProductIdentity | null = null;
const once = new Set<AnalyticsEvent>();

export function setAnalyticsAdapter(a: AnalyticsAdapter | null) {
  adapter = a;
}

export function setAnalyticsIdentity(id: ProductIdentity) {
  identity = id;
}

export function track(event: AnalyticsEvent, data: Record<string, unknown> = {}, opts: { once?: boolean } = {}) {
  if (opts.once) {
    if (once.has(event)) return;
    once.add(event);
  }
  const payload: Record<string, unknown> = { ...data };
  if (identity) {
    payload.source = identity.source;
    payload.campaign = identity.campaign;
    payload.hasIdentity = !!(identity.productId || identity.unitId);
  }
  if (import.meta.env.DEV) console.debug('[analytics]', event, payload);
  try {
    adapter?.(event, payload);
  } catch {
    /* analytics nunca derruba a página */
  }
}
