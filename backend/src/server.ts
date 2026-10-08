import { serve } from '@hono/node-server';
import { loadEnv } from './env.ts';
import { createPgDb } from './db.ts';
import { runMigrations } from './migrate.ts';
import { createApp } from './app.ts';

const env = loadEnv();
const db = createPgDb(env.databaseUrl, { ssl: env.databaseSsl, max: env.databasePoolMax });

if (env.autoMigrate) {
  const applied = await runMigrations(db);
  if (applied.length) console.log(`[migrate] aplicadas: ${applied.join(', ')}`);
}

const app = createApp(db, {
  allowedOrigins: env.allowedOrigins,
  adminToken: env.adminToken,
  admins: env.admins,
});
const server = serve({ fetch: app.fetch, port: env.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[api] ouvindo na porta ${info.port}`);
});

const shutdown = () => {
  console.log('[api] encerrando…');
  server.close(() => {
    db.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
