// Migrações SQL versionadas (migrations/NNN_nome.sql), aplicadas em ordem,
// cada uma numa transação. O advisory lock evita que duas instâncias subindo
// ao mesmo tempo apliquem a mesma migração.

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from './db.ts';

const LOCK_ID = 7_202_609; // arbitrário, fixo para este projeto
export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function runMigrations(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`
    create table if not exists schema_migrations (
      version    text primary key,
      applied_at timestamptz not null default now()
    )`);
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const sql = await readFile(path.join(dir, file), 'utf8');
    const did = await db.transaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock($1)', [LOCK_ID]);
      const { rows } = await tx.query('select 1 from schema_migrations where version = $1', [version]);
      if (rows.length) return false;
      await tx.exec(sql);
      await tx.query('insert into schema_migrations (version) values ($1)', [version]);
      return true;
    });
    if (did) applied.push(version);
  }
  return applied;
}

if (import.meta.main) {
  const { loadEnv } = await import('./env.ts');
  const { createPgDb } = await import('./db.ts');
  const env = loadEnv();
  const db = createPgDb(env.databaseUrl, { ssl: env.databaseSsl, max: 1 });
  try {
    const applied = await runMigrations(db);
    console.log(applied.length ? `[migrate] aplicadas: ${applied.join(', ')}` : '[migrate] nada a aplicar');
  } finally {
    await db.close();
  }
}
