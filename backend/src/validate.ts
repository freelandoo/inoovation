// Validação de entrada. Mesmas regras do frontend (src/identity/resolver.ts):
// whitelist de caracteres e limite de tamanho; o que não passa vira null.

const RE_PRODUCT = /^\d{8,14}$/;
const RE_CODE = /^[A-Za-z0-9._-]{1,20}$/;
const RE_TAG = /^[A-Za-z0-9._-]{1,40}$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EVENT_NAMES = new Set([
  'innovation_page_view',
  'identity_detected',
  'label_viewed',
  'label_exploded_viewed',
  'digital_id_viewed',
  'qr_structure_viewed',
  'ar_cta_viewed',
  'ar_cta_clicked',
  'ar_experience_started',
  'ar_experience_failed',
  'unit_scan_opened',
  'unit_scan_succeeded',
  'unit_scan_failed',
  'signup_viewed',
  'signup_submitted',
  'signup_dismissed',
  'member_viewed',
  'member_link_shared',
  'character_collected',
  'collection_viewed',
  'character_viewed',
]);

/** Versões do texto de consentimento do modal de cadastro (v2: TENKAGROUP + telão). */
export const CONSENT_VERSIONS = new Set(['2026-10-v1', '2026-10-v2']);

/** Personagens colecionáveis que existem hoje (frontend: src/collection/catalog.ts). */
export const CHARACTERS = new Set(['astronauta']);
export const character = (v: unknown) => (CHARACTERS.has(str(v)) ? str(v) : null);

/** Token do link de membro (base64url). */
export const memberToken = (v: unknown) => (/^[A-Za-z0-9_-]{20,64}$/.test(str(v)) ? str(v) : null);

/** Primeiro nome para exibição pública (telão). */
export const firstName = (name: string) => name.split(' ')[0].toLocaleUpperCase('pt-BR');

const TIERS = new Set(['high', 'medium', 'low']);
const ORIGINS = new Set(['query', 'digital-link', 'gs1-path', 'route', 'session', 'scanner', 'none']);

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export const product = (v: unknown) => (RE_PRODUCT.test(str(v)) ? str(v) : null);
export const code = (v: unknown) => (RE_CODE.test(str(v)) ? str(v) : null);
export const tag = (v: unknown) => (RE_TAG.test(str(v)) ? str(v) : null);
export const uuid = (v: unknown) => (RE_UUID.test(str(v)) ? str(v).toLowerCase() : null);
export const tier = (v: unknown) => (TIERS.has(str(v)) ? str(v) : null);
export const origin = (v: unknown) => (ORIGINS.has(str(v)) ? str(v) : null);

// Cadastro (dado pessoal): formato estrito e tamanho limitado.
const RE_NAME = /^[\p{L}][\p{L}\p{M} '.-]{1,79}$/u;
const RE_EMAIL = /^[^\s@<>()[\],;:"]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export const personName = (v: unknown) => {
  const s = str(v).replace(/\s+/g, ' ');
  return RE_NAME.test(s) ? s : null;
};
export const email = (v: unknown) => {
  const s = str(v).toLowerCase();
  return s.length <= 120 && RE_EMAIL.test(s) ? s : null;
};
/** Telefone brasileiro: só dígitos, com DDD (10–11) e opcionalmente o 55. */
export const phone = (v: unknown) => {
  const d = str(v).replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  return /^[1-9]{2}\d{8,9}$/.test(d) ? d : null;
};

/** Chave única da unidade; null se nenhum id veio. */
export function unitKey(p: string | null, l: string | null, u: string | null): string | null {
  if (!p && !l && !u) return null;
  return `${p ?? ''}|${l ?? ''}|${u ?? ''}`;
}

/** Só primitivos, até 20 chaves, 2 KB. Evita guardar lixo ou dados grandes. */
export function eventData(v: unknown): Record<string, string | number | boolean | null> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, val] of Object.entries(v).slice(0, 20)) {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
    if (typeof val === 'string') out[k] = val.slice(0, 120);
    else if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
    else if (typeof val === 'boolean' || val === null) out[k] = val;
  }
  return JSON.stringify(out).length <= 2048 ? out : {};
}

/** Tipo de aparelho grosseiro a partir do user agent (o UA em si não é guardado). */
export function deviceFromUa(ua: string | undefined): string {
  if (!ua) return 'other';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'desktop';
  return 'other';
}
