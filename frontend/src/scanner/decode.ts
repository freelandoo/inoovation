// Interpreta o texto lido de um QR pelo leitor da página.
//
// O QR impresso no pote traz o link GS1 completo (https://ri3.ai/01/<gtin>/10/<lote>/21/<serial>).
// Lendo o QR aqui dentro, os ids chegam mesmo quando o redirecionamento os perde.
// Só aceita links http(s) com produto (01) e unidade (21) válidos; o resto é
// "QR que não é de uma unidade". Quem decide se a unidade é oficial é o backend.

import { parseGs1Path, sanitizeCode, sanitizeProduct } from '../identity/resolver.ts';

export interface ScannedUnit {
  productId: string;
  lotId: string | null;
  unitId: string;
}

export function unitFromQrText(text: string): ScannedUnit | null {
  if (typeof text !== 'string' || text.length > 512) return null;
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const raw = parseGs1Path(url.pathname);
  const productId = sanitizeProduct(raw.product);
  const unitId = sanitizeCode(raw.unit);
  if (!productId || !unitId) return null;
  return { productId, lotId: sanitizeCode(raw.lot), unitId };
}

/** Caminho GS1 da página para a unidade lida (mantém maiúsculas/minúsculas). */
export function unitPath(u: ScannedUnit): string {
  const e = encodeURIComponent;
  return `/01/${e(u.productId)}${u.lotId ? `/10/${e(u.lotId)}` : ''}/21/${e(u.unitId)}`;
}
