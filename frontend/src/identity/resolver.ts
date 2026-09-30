// ProductIdentityResolver: interpreta os identificadores que chegam do
// redirecionamento da Realizse, sem assumir ainda o formato definitivo.
//
// Formatos aceitos (em ordem):
//   1. Query:        ?product=1845678901001&lot=l1&unit=AO   (ou gtin/lot/serial, 01/10/21…)
//   2. Link GS1:     ?dl=https://ri3.ai/01/1845678901001/10/l1/21/AO
//   3. Caminho GS1:  /01/1845678901001/10/l1/21/AO
//   4. Caminho curto:/innovation/1845678901001/l1/AO
//
// Regras de segurança: nada daqui vai para innerHTML. Todos os valores passam por
// whitelist de caracteres e limite de tamanho; o que não passa é descartado.
// Isto NÃO autentica a unidade: validação real (assinatura/token) é no backend.

export interface ProductIdentity {
  productId: string | null;
  lotId: string | null;
  unitId: string | null;
  source: string | null;
  campaign: string | null;
  /** De onde vieram os ids: query, digital-link, gs1-path, route ou session. */
  origin: 'query' | 'digital-link' | 'gs1-path' | 'route' | 'session' | 'none';
  /** GTIN com dígito verificador válido (só informativo, nunca bloqueia). */
  productChecksumValid: boolean;
}

export interface ParamNames {
  product: readonly string[];
  lot: readonly string[];
  unit: readonly string[];
  source: readonly string[];
  campaign: readonly string[];
  digitalLink: readonly string[];
}

const LIMITS = { product: 14, lot: 20, unit: 20, tag: 40, url: 512 } as const;
const RE_PRODUCT = /^\d{8,14}$/;
const RE_CODE = /^[A-Za-z0-9._-]+$/; // GS1 AI 10/21 permitem mais, mas o suficiente aqui
const RE_TAG = /^[A-Za-z0-9._-]+$/;
const AI = { '01': 'product', '10': 'lot', '21': 'unit' } as const;

export function gtinChecksumValid(gtin: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(gtin)) return false;
  const d = gtin.split('').map(Number);
  const check = d.pop()!;
  let sum = 0;
  for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += d[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function sanitizeProduct(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length > LIMITS.product || !RE_PRODUCT.test(s)) return null;
  return s;
}

export function sanitizeCode(v: unknown, max: number = LIMITS.lot): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > max || !RE_CODE.test(s)) return null;
  return s;
}

function sanitizeTag(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > LIMITS.tag || !RE_TAG.test(s)) return null;
  return s;
}

function first(q: URLSearchParams, names: readonly string[]): string | undefined {
  for (const n of names) {
    const v = q.get(n);
    if (v != null && v !== '') return v;
  }
  return undefined;
}

interface RawIds {
  product?: string;
  lot?: string;
  unit?: string;
}

/** Lê pares GS1 (01/…/10/…/21/…) de um caminho. */
export function parseGs1Path(pathname: string): RawIds {
  const parts = pathname.split('/').filter(Boolean).map(decode);
  const out: RawIds = {};
  for (let i = 0; i < parts.length - 1; i++) {
    const key = AI[parts[i] as keyof typeof AI];
    if (key && out[key] === undefined) {
      out[key] = parts[i + 1];
      i++;
    }
  }
  return out;
}

/** /innovation/<produto>/<lote>/<unidade> */
function parseRoute(pathname: string, prefixes: readonly string[]): RawIds {
  const parts = pathname.split('/').filter(Boolean).map(decode);
  const idx = parts.findIndex((p) => prefixes.includes(p.toLowerCase()));
  if (idx < 0) return {};
  const [product, lot, unit] = parts.slice(idx + 1, idx + 4);
  return { product, lot, unit };
}

function build(raw: RawIds, q: URLSearchParams, names: ParamNames, origin: ProductIdentity['origin']): ProductIdentity {
  const productId = sanitizeProduct(raw.product);
  return {
    productId,
    lotId: sanitizeCode(raw.lot, LIMITS.lot),
    unitId: sanitizeCode(raw.unit, LIMITS.unit),
    source: sanitizeTag(first(q, names.source)),
    campaign: sanitizeTag(first(q, names.campaign)),
    origin,
    productChecksumValid: productId ? gtinChecksumValid(productId.padStart(14, '0')) : false,
  };
}

export const EMPTY_IDENTITY: ProductIdentity = {
  productId: null,
  lotId: null,
  unitId: null,
  source: null,
  campaign: null,
  origin: 'none',
  productChecksumValid: false,
};

export function hasIds(id: ProductIdentity): boolean {
  return !!(id.productId || id.lotId || id.unitId);
}

export function resolveIdentity(href: string, names: ParamNames, routePrefixes: readonly string[] = []): ProductIdentity {
  let url: URL;
  try {
    url = new URL(href.slice(0, 2048));
  } catch {
    return EMPTY_IDENTITY;
  }
  const q = url.searchParams;

  const fromQuery: RawIds = { product: first(q, names.product), lot: first(q, names.lot), unit: first(q, names.unit) };
  let id = build(fromQuery, q, names, 'query');
  if (hasIds(id)) return id;

  const dl = first(q, names.digitalLink);
  if (dl && dl.length <= LIMITS.url) {
    try {
      id = build(parseGs1Path(new URL(dl, url.origin).pathname), q, names, 'digital-link');
      if (hasIds(id)) return id;
    } catch {
      /* link inválido */
    }
  }

  id = build(parseGs1Path(url.pathname), q, names, 'gs1-path');
  if (hasIds(id)) return id;

  id = build(parseRoute(url.pathname, routePrefixes), q, names, 'route');
  if (hasIds(id)) return id;

  // Mesmo sem ids, source/campaign podem existir.
  return { ...build({}, q, names, 'none'), origin: 'none' };
}

/**
 * Texto seguro para exibir (sempre string, nunca "undefined"/"null").
 * Mantém a caixa: seriais GS1 diferenciam maiúsculas (7Hk e 7hk são unidades distintas).
 */
export function display(v: string | null, fallback: string): string {
  return v || fallback;
}
