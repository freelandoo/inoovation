// Login dos admins (usuário + senha) e sessão assinada.
//
// A senha nunca fica em texto: cada admin tem `scrypt:<sal>:<hash>` (base64url),
// gerado por `npm run admin:hash -- <senha>`. A sessão é um token
// `<expira-ms>.<usuário>.<hmac>` assinado com o ADMIN_TOKEN, sem estado no banco:
// trocar o ADMIN_TOKEN derruba todas as sessões; tirar um admin da lista derruba as dele.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 32;
/** Uma tarde de apresentação com folga. */
export const SESSION_MS = 12 * 60 * 60 * 1000;

const b64 = (b: Buffer) => b.toString('base64url');

export function hashPassword(password: string, salt = randomBytes(16)): string {
  return `scrypt:${b64(salt)}:${b64(scryptSync(password, salt, KEYLEN))}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split(':');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  if (expected.length !== KEYLEN) return false;
  const got = scryptSync(password, Buffer.from(salt, 'base64url'), KEYLEN);
  return timingSafeEqual(got, expected);
}

function sign(secret: string, user: string, exp: number) {
  return createHmac('sha256', secret).update(`admin:${user}:${exp}`).digest('base64url');
}

export function issueSession(secret: string, user: string, now = Date.now()) {
  const exp = now + SESSION_MS;
  return { token: `${exp}.${b64(Buffer.from(user))}.${sign(secret, user, exp)}`, expiresAt: new Date(exp).toISOString() };
}

/** Usuário da sessão, ou null se o token for inválido ou expirado. */
export function verifySession(secret: string, token: string, now = Date.now()): string | null {
  const m = /^(\d{13})\.([A-Za-z0-9_-]{1,80})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return null;
  const exp = Number(m[1]);
  if (exp <= now) return null;
  const user = Buffer.from(m[2], 'base64url').toString();
  const a = Buffer.from(m[3]);
  const b = Buffer.from(sign(secret, user, exp));
  return a.length === b.length && timingSafeEqual(a, b) ? user : null;
}

/**
 * Lista de admins a partir das variáveis: ADMIN_USERS=`usuario=scrypt:...,outro=scrypt:...`
 * e, por compatibilidade, o par ADMIN_USER + ADMIN_PASSWORD_HASH. Usuário em minúsculas.
 */
export function parseAdmins(list?: string, user?: string, hash?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of (list ?? '').split(',')) {
    const i = item.indexOf('=');
    const name = item.slice(0, i).trim().toLowerCase();
    const h = item.slice(i + 1).trim();
    if (i > 0 && name && h.startsWith('scrypt:')) out[name] = h;
  }
  const u = user?.trim().toLowerCase();
  if (u && hash?.startsWith('scrypt:') && !out[u]) out[u] = hash;
  return out;
}

// `node src/auth.ts <senha>`: imprime o hash da senha (para ADMIN_USERS).
if (import.meta.main) {
  const pw = process.argv[2];
  if (!pw || pw.length < 10) {
    console.error('uso: npm run admin:hash -- <senha com 10+ caracteres>');
    process.exit(1);
  }
  console.log(hashPassword(pw));
}
