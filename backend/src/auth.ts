// Login do admin (usuário + senha) e sessão assinada.
//
// A senha nunca fica em texto: ADMIN_PASSWORD_HASH guarda `scrypt:<sal>:<hash>`
// (base64url), gerado por `npm run admin:hash -- <senha>`. A sessão é um token
// `<expira-ms>.<hmac>` assinado com o ADMIN_TOKEN, sem estado no banco: trocar o
// ADMIN_TOKEN derruba todas as sessões.

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
  return { token: `${exp}.${sign(secret, user, exp)}`, expiresAt: new Date(exp).toISOString() };
}

export function verifySession(secret: string, user: string, token: string, now = Date.now()): boolean {
  const m = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp <= now) return false;
  const a = Buffer.from(m[2]);
  const b = Buffer.from(sign(secret, user, exp));
  return a.length === b.length && timingSafeEqual(a, b);
}

// `node src/auth.ts <senha>`: imprime o valor para ADMIN_PASSWORD_HASH.
if (import.meta.main) {
  const pw = process.argv[2];
  if (!pw || pw.length < 10) {
    console.error('uso: npm run admin:hash -- <senha com 10+ caracteres>');
    process.exit(1);
  }
  console.log(hashPassword(pw));
}
