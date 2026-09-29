// Acesso ao Postgres. A interface Db é mínima para poder rodar os testes com
// PGlite (Postgres em WASM) sem precisar de um servidor.

import pg from 'pg';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Executa SQL com vários comandos (migrações). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createPgDb(connectionString: string, opts: { ssl?: boolean; max?: number } = {}): Db {
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    idleTimeoutMillis: 30_000,
    ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
  });
  // Sem isto, um erro de conexão ociosa derruba o processo.
  pool.on('error', (err) => console.error('[db] erro no pool:', err.message));

  const wrap = (c: pg.Pool | pg.PoolClient): Queryable => ({
    query: async <T>(sql: string, params?: unknown[]) => {
      const r = await c.query(sql, params as unknown[] | undefined);
      return { rows: r.rows as T[] };
    },
    exec: async (sql: string) => {
      await c.query(sql);
    },
  });

  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn(wrap(client));
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
