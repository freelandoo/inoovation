// Recordes: local (sempre) e no backend (quando há API e o aparelho tem um
// tripulante cadastrado). O jogo nunca espera a rede: tudo aqui tem tempo
// limite e falha em silêncio, devolvendo null.
//
//   POST /api/game/start   { sessionId, member? }              -> { runId, seed }
//   POST /api/game/finish  { runId, distance, fuel, pickups }  -> { ok, best, rank }
//   GET  /api/game/top                                          -> { top: [{ crew, name, best }] }
//
// O servidor sorteia a seed e marca o início; no fim confere se a distância é
// possível para o tempo decorrido. O cliente não decide recordes sozinho.

import { config } from '../config.ts';
import { sessionId } from '../api/client.ts';

const base = config.api.baseUrl;
const BEST_KEY = 'iw:game:best';
const PLAYS_KEY = 'iw:game:plays';

export interface RunTicket {
  runId: string;
  seed: number;
}
export interface RunResult {
  best: number;
  rank: number | null;
}
export interface TopEntry {
  crew: number;
  name: string;
  best: number;
}

/** Link de membro salvo neste aparelho (área do membro ou cadastro pelo QR). */
export function memberToken(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem('iw:members') ?? '[]') as { token?: string }[];
    if (saved[0]?.token) return saved[0].token;
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('iw:signup:')) continue;
      const r = JSON.parse(localStorage.getItem(k) ?? 'null') as { member?: string } | null;
      if (r?.member) return r.member;
    }
  } catch {
    /* storage indisponível */
  }
  return null;
}

async function call<T>(path: string, body?: unknown, timeout = 3000): Promise<T | null> {
  if (!base) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const online = () => !!base;

export function startRun(): Promise<RunTicket | null> {
  return call<RunTicket>('/api/game/start', { sessionId: sessionId(), member: memberToken() ?? undefined }, 2500).then((r) =>
    r && typeof r.runId === 'string' && Number.isInteger(r.seed) ? r : null,
  );
}

export function finishRun(runId: string, distance: number, fuel: number, pickups: number): Promise<RunResult | null> {
  return call<RunResult & { ok: boolean }>('/api/game/finish', { runId, distance, fuel, pickups }, 5000).then((r) =>
    r?.ok ? { best: r.best, rank: r.rank ?? null } : null,
  );
}

export function topScores(): Promise<TopEntry[] | null> {
  return call<{ top: TopEntry[] }>('/api/game/top', undefined, 4000).then((r) => r?.top ?? null);
}

export function localBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Grava o recorde local; devolve true se foi um novo recorde. */
export function saveLocalBest(distance: number): boolean {
  const best = localBest();
  if (distance <= best) return false;
  try {
    localStorage.setItem(BEST_KEY, String(distance));
  } catch {
    /* storage indisponível */
  }
  return true;
}

/** Quantas partidas este aparelho já começou (a dica de controle some depois de 3). */
export function countPlay(): number {
  try {
    const n = (Number(localStorage.getItem(PLAYS_KEY)) || 0) + 1;
    localStorage.setItem(PLAYS_KEY, String(n));
    return n;
  } catch {
    return 1;
  }
}

export function plays(): number {
  try {
    return Number(localStorage.getItem(PLAYS_KEY)) || 0;
  } catch {
    return 0;
  }
}
