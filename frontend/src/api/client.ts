// Cliente da API (backend na Railway).
//
// - Um id de sessão aleatório por aba (sessionStorage), sem dado pessoal.
// - POST /api/scan ao abrir a página, com a identidade da unidade.
// - Eventos via sendBeacon com text/plain (sem preflight de CORS e sobrevive
//   ao fechamento da aba). Os eventos esperam o scan terminar (até 2 s) para
//   o backend já conhecer a unidade da sessão.

import { config } from '../config.ts';
import type { ProductIdentity } from '../identity/resolver.ts';
import { setAnalyticsAdapter, type AnalyticsEvent } from '../analytics/analytics.ts';

const SESSION_KEY = 'iw:session';
const base = config.api.baseUrl;
let memoryId: string | null = null;

/** UUID v4; crypto.randomUUID só existe em contexto seguro (HTTPS/localhost). */
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = uuid();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // storage bloqueado (aba anônima restrita): id só em memória
    return (memoryId ??= uuid());
  }
}

function send(path: string, body: unknown) {
  const data = JSON.stringify(body);
  const url = `${base}${path}`;
  const blob = new Blob([data], { type: 'text/plain;charset=UTF-8' });
  if (navigator.sendBeacon?.(url, blob)) return;
  fetch(url, { method: 'POST', body: data, keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(
    () => {},
  );
}

export interface UnitInfo {
  status: 'seen' | 'verified' | 'blocked';
  scanCount: number;
  firstSeenAt: string;
}

let scanDone: Promise<unknown> = Promise.resolve();

/** Registra a abertura da página. Nunca rejeita: a página funciona sem API. */
export function registerScan(id: ProductIdentity, tier: string): Promise<UnitInfo | null> {
  if (!base) return Promise.resolve(null);
  const req = fetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({
      sessionId: sessionId(),
      productId: id.productId,
      lotId: id.lotId,
      unitId: id.unitId,
      source: id.source,
      campaign: id.campaign,
      origin: id.origin,
      tier,
    }),
  })
    .then((r) => (r.ok ? (r.json() as Promise<{ unit: UnitInfo | null }>) : null))
    .then((j) => j?.unit ?? null)
    .catch(() => null);
  scanDone = Promise.race([req, new Promise((r) => setTimeout(r, 2000))]);
  return req;
}

/** Liga o analytics da página à API (só se VITE_API_URL estiver definida). */
export function connectAnalytics() {
  if (!base) return;
  setAnalyticsAdapter((event: AnalyticsEvent, payload) => {
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) data[k] = v;
    }
    scanDone.then(() => send('/api/events', { sessionId: sessionId(), name: event, data }));
  });
}
