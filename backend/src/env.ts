// Variáveis de ambiente (ver .env.example).

export interface Env {
  port: number;
  databaseUrl: string;
  databaseSsl: boolean;
  databasePoolMax: number;
  /** Origens liberadas no CORS. Vazio = qualquer origem (a API não tem dados sensíveis). */
  allowedOrigins: string[];
  /** Token para GET /api/stats. Sem token, a rota fica desativada. */
  adminToken: string | null;
  /** Login da área admin (/admin). Precisa também do ADMIN_TOKEN, que assina a sessão. */
  adminUser: string | null;
  /** `scrypt:<sal>:<hash>` gerado por `npm run admin:hash -- <senha>`. */
  adminPasswordHash: string | null;
  autoMigrate: boolean;
}

export function loadEnv(src: NodeJS.ProcessEnv = process.env): Env {
  const databaseUrl = src.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não definida');
  return {
    port: Number(src.PORT) || 3000,
    databaseUrl,
    databaseSsl: src.DATABASE_SSL === 'true',
    databasePoolMax: Math.max(1, Number(src.DATABASE_POOL_MAX) || 10),
    allowedOrigins: (src.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean),
    adminToken: src.ADMIN_TOKEN && src.ADMIN_TOKEN.length >= 16 ? src.ADMIN_TOKEN : null,
    adminUser: src.ADMIN_USER?.trim().toLowerCase() || null,
    adminPasswordHash: src.ADMIN_PASSWORD_HASH?.startsWith('scrypt:') ? src.ADMIN_PASSWORD_HASH : null,
    autoMigrate: src.AUTO_MIGRATE !== 'false',
  };
}
