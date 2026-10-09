// API da página Innovation Week.
//
//   GET  /api/health          saúde (inclui ping no banco)
//   POST /api/scan            abertura da página com a identidade da unidade
//   POST /api/events          eventos da jornada (um ou lote de até 20)
//   POST /api/signup          cadastro de quem ativou uma unidade verificada (devolve o link de membro)
//   GET  /api/member/:token   área do membro (link secreto)
//   POST /api/member/login    entrar na área do membro com e-mail + nº de tripulante (devolve o link)
//   GET  /api/live            números e últimos tripulantes, para o telão (só primeiro nome)
//   POST /api/admin/login     usuário + senha da área admin (devolve uma sessão de 12 h)
//   GET  /api/admin/me        confere a sessão do admin
//   GET  /api/stats           métricas (Authorization: Bearer ADMIN_TOKEN ou sessão do admin)
//   POST /api/admin/returns   registra a devolução de uma embalagem (leitor da área admin)
//   GET  /api/admin/returns   total e últimas devoluções
//   POST /api/admin/registry  importa a lista de IDs da Realizse (um link GS1 por linha; ADMIN_TOKEN)
//   POST /api/admin/reset     zera os dados de teste, mantém a lista oficial (ADMIN_TOKEN + {"confirm":"ZERAR TUDO"})
//
// O corpo é lido como texto e interpretado como JSON independentemente do
// Content-Type: o navegador envia eventos via sendBeacon com text/plain, o que
// evita preflight de CORS.

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.ts';
import * as v from './validate.ts';
import { createRateLimiter } from './rateLimit.ts';
import { gtin14, parseRegistry, importRegistry, unitCodeSql } from './registry.ts';
import { issueSession, verifyPassword, verifySession } from './auth.ts';

const MAX_BODY = 8 * 1024;
/** Lista de IDs: ~45 bytes por link, 200 mil ≈ 9 MB. */
const MAX_REGISTRY_BODY = 32 * 1024 * 1024;

export interface AppOptions {
  allowedOrigins: string[];
  adminToken: string | null;
  /** Admins (usuário -> hash scrypt); sem nenhum (ou sem adminToken), o login fica desativado. */
  admins?: Record<string, string>;
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
  // Tentativas de login (admin e membro): poucas por minuto, para frear força bruta.
  const allowLogin = createRateLimiter(10, 60_000);

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
      let unit: { id: string; status: string; scan_count: number; first_seen_at: string; activated: boolean } | null = null;
      if (key) {
        const r = await tx.query<{ id: string; status: string; scan_count: number; first_seen_at: string; activated: boolean }>(
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
           returning id, status, scan_count, first_seen_at,
                     exists (select 1 from signups s where s.unit_code = ${unitCodeSql('units')}) as activated`,
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
        ? { status: result.status, scanCount: Number(result.scan_count), firstSeenAt: result.first_seen_at, activated: result.activated }
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

  // Cadastro do modal "Unidade ativada". Só para unidade verificada (está na
  // lista oficial), o que impede cadastro com ids inventados.
  app.post('/api/signup', async (c) => {
    if (!allow(clientIp(c))) return c.json({ error: 'muitas requisições' }, 429);
    const body = (await readJson(c)) as Record<string, unknown>;
    const sessionId = v.uuid(body?.sessionId);
    const key = v.unitKey(v.product(body?.productId), v.code(body?.lotId), v.code(body?.unitId));
    if (!sessionId || !key) throw new HttpError(400, 'unidade inválida');
    const name = v.personName(body.name);
    if (!name) throw new HttpError(400, 'nome inválido');
    const email = v.email(body.email);
    if (!email) throw new HttpError(400, 'e-mail inválido');
    const hasPhone = typeof body.phone === 'string' && body.phone.trim() !== '';
    const phone = hasPhone ? v.phone(body.phone) : null;
    if (hasPhone && !phone) throw new HttpError(400, 'WhatsApp inválido');
    const consent = typeof body.consent === 'string' && v.CONSENT_VERSIONS.has(body.consent) ? body.consent : null;
    if (!consent) throw new HttpError(400, 'consentimento obrigatório');

    const unit = await db.query<{ id: string; code: string }>(
      `select id, ${unitCodeSql('u')} as code from units u where unit_key = $1 and status = 'verified'`,
      [key],
    );
    if (!unit.rows[0]) return c.json({ error: 'unidade não verificada' }, 409);

    // Um QR code ativa um tripulante só. O mesmo e-mail pode repetir (atualiza e
    // devolve o mesmo link); outro e-mail no mesmo pote é recusado.
    const r = await db.query<{ id: string; member_token: string }>(
      `insert into signups (unit_ref, unit_code, session_id, name, email, phone, consent_version, marketing_opt_in, member_token)
       values ($1, $2, (select id from sessions where id = $3), $4, $5, $6, $7, $8, $9)
       on conflict (unit_code) do update
         set name = excluded.name,
             phone = coalesce(excluded.phone, signups.phone),
             consent_version = excluded.consent_version,
             marketing_opt_in = excluded.marketing_opt_in,
             updated_at = now()
         where signups.email = excluded.email
       returning id, member_token`,
      [unit.rows[0].id, unit.rows[0].code, sessionId, name, email, phone, consent, body.marketing === true, randomBytes(18).toString('base64url')],
    );
    if (!r.rows[0]) return c.json({ error: 'qrcode já ativado', code: 'already_activated' }, 409);
    return c.json({ ok: true, crew: Number(r.rows[0].id), member: r.rows[0].member_token });
  });

  app.get('/api/member/:token', async (c) => {
    if (!allow(clientIp(c))) return c.json({ error: 'muitas requisições' }, 429);
    c.header('Cache-Control', 'no-store');
    const token = v.memberToken(c.req.param('token'));
    if (!token) return c.json({ error: 'não encontrado' }, 404);
    const r = await db.query<{
      id: string;
      name: string;
      email: string;
      created_at: string;
      product_id: string | null;
      lot_id: string | null;
      unit_id: string | null;
      status: string;
      scan_count: number;
      first_seen_at: string;
      ar_started: boolean;
      collection: { character: string; collectedAt: string }[];
    }>(
      `select s.id, s.name, s.email, s.created_at,
              u.product_id, u.lot_id, u.unit_id, u.status, u.scan_count, u.first_seen_at,
              exists (select 1 from events e where e.unit_ref = u.id and e.name = 'ar_experience_started') as ar_started,
              coalesce((select json_agg(json_build_object('character', k.character, 'collectedAt', k.collected_at) order by k.collected_at)
                        from collectibles k where k.signup_ref = s.id), '[]'::json) as collection
       from signups s join units u on u.id = s.unit_ref
       where s.member_token = $1`,
      [token],
    );
    const m = r.rows[0];
    if (!m) return c.json({ error: 'não encontrado' }, 404);
    const [user, domain] = m.email.split('@');
    return c.json({
      crew: Number(m.id),
      name: m.name,
      email: `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}`,
      memberSince: m.created_at,
      arStarted: m.ar_started,
      collection: m.collection,
      unit: {
        productId: m.product_id,
        lotId: m.lot_id,
        unitId: m.unit_id,
        status: m.status,
        scanCount: Number(m.scan_count),
        firstSeenAt: m.first_seen_at,
      },
    });
  });

  // Botão MEMBROS do site: quem já se cadastrou volta ao perfil com o e-mail e o
  // nº de tripulante (os dois juntos; o número sozinho aparece no telão).
  app.post('/api/member/login', async (c) => {
    if (!allowLogin(clientIp(c))) return c.json({ error: 'muitas tentativas, aguarde um minuto' }, 429);
    c.header('Cache-Control', 'no-store');
    const body = (await readJson(c)) as Record<string, unknown>;
    const email = v.email(body?.email);
    const crew = Number(String(body?.crew ?? '').replace(/\D/g, ''));
    if (!email || !Number.isSafeInteger(crew) || crew < 1) throw new HttpError(400, 'dados inválidos');
    const r = await db.query<{ member_token: string }>('select member_token from signups where id = $1 and email = $2', [
      crew,
      email,
    ]);
    if (!r.rows[0]) return c.json({ error: 'não encontramos esse tripulante' }, 404);
    return c.json({ ok: true, member: r.rows[0].member_token });
  });

  // "Pegar" o personagem na RA: entra na coleção do membro (repetir não duplica).
  app.post('/api/member/:token/collect', async (c) => {
    if (!allow(clientIp(c))) return c.json({ error: 'muitas requisições' }, 429);
    const token = v.memberToken(c.req.param('token'));
    const body = (await readJson(c)) as Record<string, unknown>;
    const character = v.character(body?.character);
    if (!token) return c.json({ error: 'não encontrado' }, 404);
    if (!character) throw new HttpError(400, 'personagem inválido');
    const r = await db.query<{ collected_at: string; created: boolean }>(
      `with m as (select id from signups where member_token = $1),
            ins as (insert into collectibles (signup_ref, character) select id, $2 from m
                    on conflict do nothing returning collected_at)
       select collected_at, true as created from ins
       union all
       select k.collected_at, false from collectibles k join m on k.signup_ref = m.id where k.character = $2`,
      [token, character],
    );
    const row = r.rows[0];
    if (!row) return c.json({ error: 'não encontrado' }, 404);
    return c.json({ ok: true, character, collectedAt: row.collected_at, new: row.created });
  });

  app.get('/api/live', async (c) => {
    if (!allow(clientIp(c))) return c.json({ error: 'muitas requisições' }, 429);
    const [totals, recent] = await Promise.all([
      db.query<{ crew: number; units: number; ar: number }>(
        `select (select count(*)::int from signups) as crew,
                (select count(*)::int from units where status = 'verified') as units,
                (select count(distinct session_id)::int from events where name = 'ar_experience_started') as ar`,
      ),
      db.query<{ id: string; name: string; created_at: string }>(
        'select id, name, created_at from signups order by id desc limit 12',
      ),
    ]);
    c.header('Cache-Control', 'public, max-age=2');
    return c.json({
      ...totals.rows[0],
      recent: recent.rows.map((r) => ({ crew: Number(r.id), name: v.firstName(r.name), at: r.created_at })),
    });
  });

  const admins = new Map(Object.entries(opts.admins ?? {}));
  const loginEnabled = !!opts.adminToken && admins.size > 0;
  const bearer = (c: Context) => {
    const auth = c.req.header('authorization') ?? '';
    return auth.startsWith('Bearer ') ? auth.slice(7) : '';
  };
  /** Admin dono da sessão, se ela for válida e ele ainda estiver na lista. */
  const sessionUser = (token: string) => {
    if (!loginEnabled) return null;
    const user = verifySession(opts.adminToken!, token);
    return user && admins.has(user) ? user : null;
  };

  /** Sem ADMIN_TOKEN as rotas de admin nem existem (404). Aceita o token ou a sessão do login. */
  const adminDenied = (c: Context) => {
    if (!opts.adminToken) return c.json({ error: 'não encontrado' }, 404);
    const token = bearer(c);
    if (!safeEqual(token, opts.adminToken) && !sessionUser(token)) return c.json({ error: 'não autorizado' }, 401);
    return null;
  };

  app.post('/api/admin/login', async (c) => {
    if (!loginEnabled) return c.json({ error: 'não encontrado' }, 404);
    if (!allowLogin(clientIp(c))) return c.json({ error: 'muitas tentativas, aguarde um minuto' }, 429);
    c.header('Cache-Control', 'no-store');
    const body = (await readJson(c)) as Record<string, unknown>;
    const user = typeof body?.user === 'string' ? body.user.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    // A senha é sempre conferida (usuário inexistente: contra um hash qualquer) para o
    // tempo de resposta não dizer se errou o usuário ou a senha.
    const hash = admins.get(user);
    const passOk =
      password.length > 0 && password.length <= 200 && verifyPassword(password, hash ?? admins.values().next().value!);
    if (!passOk || !hash) return c.json({ error: 'usuário ou senha incorretos' }, 401);
    return c.json({ ok: true, user, ...issueSession(opts.adminToken!, user) });
  });

  app.get('/api/admin/me', (c) => {
    const denied = adminDenied(c);
    if (denied) return denied;
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, user: sessionUser(bearer(c)) ?? 'admin' });
  });

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

  // Devolução de embalagem: só admins, pelo leitor da área admin. O pote precisa
  // estar na lista oficial e conta uma vez só.
  app.post('/api/admin/returns', async (c) => {
    const denied = adminDenied(c);
    if (denied) return denied;
    const body = (await readJson(c)) as Record<string, unknown>;
    const productId = v.product(body?.productId);
    const lotId = v.code(body?.lotId);
    const unitId = v.code(body?.unitId);
    if (!productId || !lotId || !unitId) throw new HttpError(400, 'unidade inválida');
    const gtin = gtin14(productId);
    const unit = { productId: gtin, lotId, unitId };

    const reg = await db.query(
      'select 1 from registry_units where product_id = $1 and lot_id = $2 and unit_id = $3',
      [gtin, lotId, unitId],
    );
    if (!reg.rows[0]) return c.json({ error: 'embalagem fora da lista oficial', code: 'not_registered', unit }, 404);

    const code = `${gtin}|${lotId}|${unitId}`;
    const by = sessionUser(bearer(c)) ?? 'admin';
    const ins = await db.query<{ returned_at: string }>(
      `insert into returns (unit_code, product_id, lot_id, unit_id, returned_by) values ($1, $2, $3, $4, $5)
       on conflict (unit_code) do nothing
       returning returned_at`,
      [code, gtin, lotId, unitId, by],
    );
    const info = await db.query<{ returned_at: string; returned_by: string; crew: string | null; total: number }>(
      `select r.returned_at, r.returned_by,
              (select s.id from signups s where s.unit_code = r.unit_code) as crew,
              (select count(*)::int from returns) as total
       from returns r where r.unit_code = $1`,
      [code],
    );
    const i = info.rows[0];
    const out = {
      unit,
      returnedAt: i.returned_at,
      returnedBy: i.returned_by,
      crew: i.crew == null ? null : Number(i.crew),
      total: i.total,
    };
    if (!ins.rows[0]) return c.json({ error: 'embalagem já devolvida', code: 'already_returned', ...out }, 409);
    return c.json({ ok: true, ...out });
  });

  app.get('/api/admin/returns', async (c) => {
    const denied = adminDenied(c);
    if (denied) return denied;
    c.header('Cache-Control', 'no-store');
    const r = await db.query<{
      product_id: string;
      lot_id: string;
      unit_id: string;
      returned_by: string;
      returned_at: string;
      crew: string | null;
      total: number;
    }>(
      `select r.product_id, r.lot_id, r.unit_id, r.returned_by, r.returned_at,
              (select s.id from signups s where s.unit_code = r.unit_code) as crew,
              count(*) over ()::int as total
       from returns r order by r.returned_at desc limit 30`,
    );
    const total = r.rows[0]?.total ?? 0;
    return c.json({
      total,
      recent: r.rows.map((x) => ({
        unit: { productId: x.product_id, lotId: x.lot_id, unitId: x.unit_id },
        returnedBy: x.returned_by,
        returnedAt: x.returned_at,
        crew: x.crew == null ? null : Number(x.crew),
      })),
    });
  });

  // Zera os dados de teste (cadastros, coleção, leituras, sessões, eventos) e reinicia a
  // numeração. A lista oficial (registry_units) e as migrações ficam.
  app.post('/api/admin/reset', async (c) => {
    const denied = adminDenied(c);
    if (denied) return denied;
    const body = (await readJson(c)) as Record<string, unknown>;
    if (body?.confirm !== 'ZERAR TUDO') throw new HttpError(400, 'confirmação ausente');
    await db.transaction(async (tx) => {
      await tx.exec('truncate collectibles, signups, events, sessions, units, returns restart identity cascade');
    });
    const r = await db.query<Record<string, string>>(
      `select (select count(*) from signups) as signups, (select count(*) from collectibles) as collectibles,
              (select count(*) from units) as units, (select count(*) from sessions) as sessions,
              (select count(*) from events) as events, (select count(*) from returns) as returns,
              (select count(*) from registry_units) as registry`,
    );
    const remaining = Object.fromEntries(Object.entries(r.rows[0]).map(([k, n]) => [k, Number(n)]));
    return c.json({ ok: true, remaining });
  });

  app.get('/api/stats', async (c) => {
    const denied = adminDenied(c);
    if (denied) return denied;

    const [units, sessions, events, lots, recent] = await Promise.all([
      db.query(
        `select count(*)::int as units,
                coalesce(sum(scan_count), 0)::int as scans,
                (count(*) filter (where status = 'verified'))::int as verified,
                (select count(*)::int from registry_units) as registered,
                (select count(*)::int from signups) as signups
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
