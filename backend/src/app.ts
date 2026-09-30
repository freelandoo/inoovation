// API da página Innovation Week.
//
//   GET  /api/health          saúde (inclui ping no banco)
//   POST /api/scan            abertura da página com a identidade da unidade
//   POST /api/events          eventos da jornada (um ou lote de até 20)
//   GET  /api/stats           métricas (Authorization: Bearer ADMIN_TOKEN)
//   POST /api/admin/registry  importa a lista de IDs da Realizse (um link GS1 por linha; ADMIN_TOKEN)
//
// O corpo é lido como texto e interpretado como JSON independentemente do
// Content-Type: o navegador envia eventos via sendBeacon com text/plain, o que
// evita preflight de CORS.

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { timingSafeEqual } from 'node:crypto';
import type { Db } from './db.ts';
import * as v from './validate.ts';
import { createRateLimiter } from './rateLimit.ts';
import { parseRegistry, importRegistry } from './registry.ts';

const MAX_BODY = 8 * 1024;
/** Lista de IDs: ~45 bytes por link, 200 mil ≈ 9 MB. */
const MAX_REGISTRY_BODY = 32 * 1024 * 1024;

export interface AppOptions {
  allowedOrigins: string[];
  adminToken: string | null;
  /** Requisições por minuto por IP em /api/scan e /api/events. */
  rateLimit?: number;
}

class HttpError extends Error {
  status: 400 | 413;
  constructor(status: 400 | 413, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(c: Context): Promise<unknown> {
  const len = Number(c.req.header('content-length') ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, 'payload grande demais');
  const text = await c.req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'payload grande demais');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

function clientIp(c: Context): string {
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return c.req.header('x-real-ip') ?? 'local';
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createApp(db: Db, opts: AppOptions) {
  const app = new Hono();
  const allow = createRateLimiter(opts.rateLimit ?? 120, 60_000);

  app.use(
    '/api/*',
    cors({
      origin: (origin) => {
        if (!opts.allowedOrigins.length) return origin || '*';
        return opts.allowedOrigins.includes(origin) ? origin : null;
      },
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    }),
  );

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error('[api]', err);
    return c.json({ error: 'erro interno' }, 500);
  });

  app.get('/', (c) => c.json({ service: 'innovation-week-api', ok: true }));

  app.get('/api/health', async (c) => {
    try {
      await db.query('select 1');
      return c.json({ ok: true, db: 'up' });
    } catch {
      return c.json({ ok: false, db: 'down' }, 503);
    }
  });

  app.post('/api/scan', async (c) => {
    if (!allow(clientIp(c))) return c.json({ error: 'muitas requisições' }, 429);
    const body = (await readJson(c)) as Record<string, unknown>;
    const sessionId = v.uuid(body?.sessionId);
    if (!sessionId) throw new HttpError(400, 'sessionId inválido');

    const productId = v.product(body.productId);
    const lotId = v.code(body.lotId);
    const unitId = v.code(body.unitId);
    const key = v.unitKey(productId, lotId, unitId);

    const result = await db.transaction(async (tx) => {
      let unit: { id: string; status: string; scan_count: number; first_seen_at: string } | null = null;
      if (key) {
        const r = await tx.query<{ id: string; status: string; scan_count: number; first_seen_at: string }>(
          // Nasce `verified` se estiver na lista oficial (registry_units); uma
          // unidade `seen` é promovida quando a lista chega depois. `blocked` nunca muda.
          `insert into units (product_id, lot_id, unit_id, unit_key, status)
           values ($1::text, $2::text, $3::text, $4, case when exists (
             select 1 from registry_units r
             where r.product_id = lpad($1::text, 14, '0') and r.lot_id = $2::text and r.unit_id = $3::text
           ) then 'verified' else 'seen' end)
           on conflict (unit_key) do update
             set last_seen_at = now(),
                 status = case when units.status = 'seen' then excluded.status else units.status end
           returning id, status, scan_count, first_seen_at`,
          [productId, lotId, unitId, key],
        );
        unit = r.rows[0];
      }
      // A sessão acompanha a última unidade lida (o leitor de QR da página pode
      // vincular uma unidade a uma sessão que começou sem nenhuma).
      const s = await tx.query<{ prev_ref: string | null }>(
        `with prev as (select unit_ref from sessions where id = $1)
         insert into sessions (id, unit_ref, source, campaign, origin, tier, device)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update
           set last_seen_at = now(),
               unit_ref = coalesce(excluded.unit_ref, sessions.unit_ref),
               origin = case when excluded.unit_ref is distinct from sessions.unit_ref and excluded.unit_ref is not null
                             then excluded.origin else sessions.origin end
         returning (select unit_ref from prev) as prev_ref`,
        [
          sessionId,
          unit?.id ?? null,
          v.tag(body.source),
          v.tag(body.campaign),
          v.origin(body.origin),
          v.tier(body.tier),
          v.deviceFromUa(c.req.header('user-agent')),
        ],
      );
      // Conta o scan quando a sessão passa a esta unidade (recarregar a página não infla o número).
      if (unit && s.rows[0]?.prev_ref !== unit.id) {
        const u = await tx.query<{ scan_count: number }>(
          'update units set scan_count = scan_count + 1 where id = $1 returning scan_count',
          [unit.id],
        );
        unit.scan_count = u.rows[0].scan_count;
      }
      return unit;
    });

    return c.json({
      ok: true,
      unit: result
        ? { status: result.status, scanCount: Number(result.scan_count), firstSeenAt: result.first_seen_at }
        : null,
    });
  });

  app.post('/api/events', async (c) => {
    if (!allow(clientIp(c))) return c.json({ error: 'muitas requisições' }, 429);
    const body = await readJson(c);
    const list = (Array.isArray(body) ? body : [body]).slice(0, 20) as Record<string, unknown>[];
    let stored = 0;
    for (const ev of list) {
      const sessionId = v.uuid(ev?.sessionId);
      const name = typeof ev?.name === 'string' && v.EVENT_NAMES.has(ev.name) ? ev.name : null;
      if (!sessionId || !name) continue;
      await db.query('insert into sessions (id, device) values ($1, $2) on conflict (id) do nothing', [
        sessionId,
        v.deviceFromUa(c.req.header('user-agent')),
      ]);
      await db.query(
        `insert into events (session_id, unit_ref, name, data)
         select s.id, s.unit_ref, $2, $3::jsonb from sessions s where s.id = $1`,
        [sessionId, name, JSON.stringify(v.eventData(ev.data))],
      );
      stored++;
    }
    if (!stored) throw new HttpError(400, 'nenhum evento válido');
    return c.json({ ok: true, stored });
  });

  /** Sem ADMIN_TOKEN as rotas de admin nem existem (404). */
  const adminDenied = (c: Context) => {
    if (!opts.adminToken) return c.json({ error: 'não encontrado' }, 404);
    const auth = c.req.header('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!safeEqual(token, opts.adminToken)) return c.json({ error: 'não autorizado' }, 401);
    return null;
  };

  app.post('/api/admin/registry', async (c) => {
    const denied = adminDenied(c);
    if (denied) return denied;
    if (Number(c.req.header('content-length') ?? 0) > MAX_REGISTRY_BODY) throw new HttpError(413, 'arquivo grande demais');
    const text = await c.req.text();
    if (text.length > MAX_REGISTRY_BODY) throw new HttpError(413, 'arquivo grande demais');

    const report = parseRegistry(text);
    if (!report.units.length) throw new HttpError(400, 'nenhum link GS1 válido no arquivo');
    const lots: Record<string, number> = {};
    for (const u of report.units) lots[`${u.productId}/${u.lotId}`] = (lots[`${u.productId}/${u.lotId}`] ?? 0) + 1;

    const batch = v.tag(c.req.query('batch')) ?? `api-${new Date().toISOString().slice(0, 10)}`;
    const result = await importRegistry(db, report.units, batch);
    return c.json({
      ok: true,
      batch,
      units: report.units.length,
      lots,
      duplicates: report.duplicates,
      caseVariants: report.caseVariants,
      invalid: report.invalid.length,
      invalidSample: report.invalid.slice(0, 10),
      ...result,
    });
  });

  app.get('/api/stats', async (c) => {
    const denied = adminDenied(c);
    if (denied) return denied;

    const [units, sessions, events, lots, recent] = await Promise.all([
      db.query(
        `select count(*)::int as units,
                coalesce(sum(scan_count), 0)::int as scans,
                (count(*) filter (where status = 'verified'))::int as verified,
                (select count(*)::int from registry_units) as registered
         from units`,
      ),
      db.query(
        `select count(*)::int as sessions,
                (count(*) filter (where unit_ref is not null))::int as with_unit
         from sessions`,
      ),
      db.query(
        `select name, count(*)::int as total, count(distinct session_id)::int as sessions
         from events group by name order by total desc`,
      ),
      db.query(
        `select product_id, lot_id, count(*)::int as units, coalesce(sum(scan_count), 0)::int as scans
         from units group by product_id, lot_id order by scans desc limit 50`,
      ),
      db.query(
        `select product_id, lot_id, unit_id, status, scan_count, first_seen_at, last_seen_at
         from units order by last_seen_at desc limit 50`,
      ),
    ]);
    return c.json({
      totals: { ...units.rows[0], ...sessions.rows[0] },
      funnel: events.rows,
      lots: lots.rows,
      recentUnits: recent.rows,
    });
  });

  app.notFound((c) => c.json({ error: 'não encontrado' }, 404));
  return app;
}
