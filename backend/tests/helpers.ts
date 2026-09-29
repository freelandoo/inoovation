// Banco de teste: PGlite (Postgres em WASM, em memória) atrás da mesma interface Db.

import { PGlite } from '@electric-sql/pglite';
import type { Db, Queryable } from '../src/db.ts';
import { runMigrations } from '../src/migrate.ts';

export async function createTestDb(): Promise<Db> {
  const pg = new PGlite();
  const wrap = (c: Pick<PGlite, 'query' | 'exec'>): Queryable => ({
    query: async <T>(sql: string, params?: unknown[]) => {
      const r = await c.query<T>(sql, params as unknown[] | undefined);
      return { rows: r.rows };
    },
    exec: async (sql: string) => {
      await c.exec(sql);
    },
  });
  const db: Db = {
    ...wrap(pg),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
    close: () => pg.close(),
  };
  await runMigrations(db);
  return db;
}
