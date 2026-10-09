// Lista oficial de unidades (tabela registry_units).
//
// A Realizse envia um arquivo com um link GS1 por linha, ex.:
//   https://ri3.ai/01/7898693620895/10/W4/21/<serial>
// O import lê produto (01), lote (10) e serial (21) de cada linha, valida com as
// mesmas regras da API e grava em lotes. Rodar de novo o mesmo arquivo não duplica.
//
//   npm run registry:import -- caminho/do/arquivo.csv

import path from 'node:path';
import type { Db, Queryable } from './db.ts';
import * as v from './validate.ts';

export interface RegistryUnit {
  productId: string;
  lotId: string;
  unitId: string;
}

export interface ParseReport {
  units: RegistryUnit[];
  invalid: { line: number; text: string }[];
  duplicates: number;
  /** Seriais que só diferem na caixa (ex.: 7Hk e 7hk). São unidades distintas. */
  caseVariants: number;
}

/** GTIN com zeros à esquerda até 14 dígitos, para 13 e 14 dígitos casarem. */
export const gtin14 = (p: string) => p.padStart(14, '0');

const AI: Record<string, keyof RegistryUnit> = { '01': 'productId', '10': 'lotId', '21': 'unitId' };

/** Lê os pares GS1 de um link (ou caminho) de uma linha. */
export function parseLink(line: string): RegistryUnit | null {
  const cell = line.split(/[,;\t]/).find((c) => /\/01\//.test(c));
  if (!cell) return null;
  let pathname: string;
  try {
    pathname = new URL(cell.trim().replace(/^"|"$/g, ''), 'https://x.invalid').pathname;
  } catch {
    return null;
  }
  const parts = pathname.split('/').filter(Boolean);
  const raw: Partial<Record<keyof RegistryUnit, string>> = {};
  // Pares AI/valor; outros AIs (ex.: 17 validade) são ignorados.
  for (let i = 0; i < parts.length - 1; i += 2) {
    const key = AI[parts[i]];
    if (!key) continue;
    try {
      raw[key] = decodeURIComponent(parts[i + 1]);
    } catch {
      return null;
    }
  }
  const productId = v.product(raw.productId);
  const lotId = v.code(raw.lotId);
  const unitId = v.code(raw.unitId);
  if (!productId || !lotId || !unitId) return null;
  return { productId: gtin14(productId), lotId, unitId };
}

export function parseRegistry(text: string): ParseReport {
  const units: RegistryUnit[] = [];
  const invalid: ParseReport['invalid'] = [];
  const seen = new Set<string>();
  const folded = new Map<string, number>();
  let duplicates = 0;
  let caseVariants = 0;

  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      const u = parseLink(line);
      if (!u) {
        // Cabeçalho comum na 1ª linha não é erro.
        if (!(i === 0 && !/\d/.test(line))) invalid.push({ line: i + 1, text: line.slice(0, 120) });
        return;
      }
      const key = `${u.productId}|${u.lotId}|${u.unitId}`;
      if (seen.has(key)) {
        duplicates++;
        return;
      }
      seen.add(key);
      const f = key.toLowerCase();
      const n = folded.get(f) ?? 0;
      if (n) caseVariants++;
      folded.set(f, n + 1);
      units.push(u);
    });

  return { units, invalid, duplicates, caseVariants };
}

const CHUNK = 1000;

/** Grava as unidades e promove a `verified` as que já tinham sido lidas. */
export async function importRegistry(db: Db, units: RegistryUnit[], batch: string) {
  let inserted = 0;
  for (let i = 0; i < units.length; i += CHUNK) {
    const part = units.slice(i, i + CHUNK);
    const r = await db.query<{ n: number }>(
      `with ins as (
         insert into registry_units (product_id, lot_id, unit_id, batch)
         select p, l, u, $4 from unnest($1::text[], $2::text[], $3::text[]) as t(p, l, u)
         on conflict do nothing
         returning 1
       )
       select count(*)::int as n from ins`,
      [part.map((u) => u.productId), part.map((u) => u.lotId), part.map((u) => u.unitId), batch],
    );
    inserted += r.rows[0].n;
  }
  const promoted = await promoteVerified(db);
  return { inserted, skipped: units.length - inserted, promoted };
}

/** Condição SQL: a unidade `units` (alias u) está na lista oficial. */
export const REGISTERED_SQL = `exists (
  select 1 from registry_units r
  where r.product_id = lpad(u.product_id, 14, '0') and r.lot_id = u.lot_id and r.unit_id = u.unit_id
)`;

/** Expressão SQL da unidade como na lista oficial (GTIN-14|lote|serial): a chave de `signups.unit_code`. */
export const unitCodeSql = (alias: string) =>
  `lpad(${alias}.product_id, 14, '0') || '|' || ${alias}.lot_id || '|' || ${alias}.unit_id`;

async function promoteVerified(db: Queryable): Promise<number> {
  const r = await db.query<{ n: number }>(
    `with up as (
       update units u set status = 'verified'
       where u.status = 'seen' and ${REGISTERED_SQL}
       returning 1
     )
     select count(*)::int as n from up`,
  );
  return r.rows[0].n;
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) {
    console.error('uso: npm run registry:import -- <arquivo.csv>');
    process.exit(1);
  }
  const { readFile } = await import('node:fs/promises');
  const { loadEnv } = await import('./env.ts');
  const { createPgDb } = await import('./db.ts');
  const { runMigrations } = await import('./migrate.ts');

  const report = parseRegistry(await readFile(file, 'utf8'));
  const lots = new Map<string, number>();
  for (const u of report.units) lots.set(`${u.productId} / ${u.lotId}`, (lots.get(`${u.productId} / ${u.lotId}`) ?? 0) + 1);

  console.log(`[registry] ${report.units.length} unidades válidas`);
  for (const [lot, n] of lots) console.log(`  produto/lote ${lot}: ${n}`);
  if (report.duplicates) console.log(`  duplicadas no arquivo (ignoradas): ${report.duplicates}`);
  if (report.caseVariants) console.log(`  seriais que só diferem na caixa (mantidos, são distintos): ${report.caseVariants}`);
  if (report.invalid.length) {
    console.log(`  linhas inválidas: ${report.invalid.length}`);
    for (const x of report.invalid.slice(0, 10)) console.log(`    linha ${x.line}: ${x.text}`);
  }

  const env = loadEnv();
  const db = createPgDb(env.databaseUrl, { ssl: env.databaseSsl, max: 1 });
  try {
    await runMigrations(db);
    const r = await importRegistry(db, report.units, path.basename(file).slice(0, 200));
    console.log(`[registry] gravadas ${r.inserted}, já existiam ${r.skipped}, unidades já lidas promovidas a verified: ${r.promoted}`);
  } finally {
    await db.close();
  }
}
