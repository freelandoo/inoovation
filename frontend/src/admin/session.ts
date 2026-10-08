// Sessão do admin (/admin e /admin/apresentacao): token assinado pela API,
// válido por 12 h, guardado neste aparelho.

import { config } from '../config.ts';

export interface AdminSession {
  token: string;
  expiresAt: string;
  user: string;
}

const KEY = 'iw:admin';

export function readAdmin(): AdminSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as AdminSession | null;
    if (!s?.token || Date.parse(s.expiresAt) <= Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function clearAdmin() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage indisponível */
  }
}

export async function loginAdmin(user: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!config.api.baseUrl) return { ok: false, error: 'API não configurada.' };
  try {
    const r = await fetch(`${config.api.baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, password }),
    });
    const body = (await r.json().catch(() => ({}))) as Partial<AdminSession> & { error?: string };
    if (!r.ok || !body.token || !body.expiresAt) {
      return {
        ok: false,
        error:
          r.status === 401
            ? 'Usuário ou senha incorretos.'
            : r.status === 429
              ? 'Muitas tentativas. Aguarde um minuto.'
              : r.status === 404
                ? 'Login de admin não configurado na API.'
                : 'Não foi possível entrar agora.',
      };
    }
    localStorage.setItem(KEY, JSON.stringify({ token: body.token, expiresAt: body.expiresAt, user: body.user ?? user }));
    return { ok: true };
  } catch {
    return { ok: false, error: 'Sem conexão com a API.' };
  }
}

/** GET autenticado em rota de admin; sessão recusada = sai do aparelho. */
export async function adminGet<T>(path: string): Promise<T | null> {
  const s = readAdmin();
  if (!s || !config.api.baseUrl) return null;
  try {
    const r = await fetch(`${config.api.baseUrl}${path}`, { headers: { Authorization: `Bearer ${s.token}` } });
    if (r.status === 401) clearAdmin();
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Confere a sessão salva na API. */
export async function checkAdmin(): Promise<boolean> {
  return !!(await adminGet<{ ok: boolean }>('/api/admin/me'))?.ok;
}
