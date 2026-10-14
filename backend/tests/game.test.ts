// Jogo (POST /api/game/start, POST /api/game/finish, GET /api/game/top).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.ts';
import type { Db } from '../src/db.ts';
import { createTestDb } from './helpers.ts';

let db: Db;
let app: ReturnType<typeof createApp>;
const members: { token: string; crew: number }[] = [];

before(async () => {
  db = await createTestDb();
  app = createApp(db, { allowedOrigins: [], adminToken: null, rateLimit: 1000 });
  await db.query(
    `insert into registry_units (product_id, lot_id, unit_id, batch)
     select '07898693620895', 'W4', u, 't' from unnest(array['g1', 'g2', 'g3']) as u`,
  );
  for (const [unitId, name] of [
    ['g1', 'Ana Souza'],
    ['g2', 'Bruno Lima'],
  ]) {
    const s = randomUUID();
    const unit = { productId: '7898693620895', lotId: 'W4', unitId };
    await post('/api/scan', { sessionId: s, ...unit });
    const r = (await (
      await post('/api/signup', { sessionId: s, ...unit, name, email: `${unitId}@example.com`, consent: '2026-10-v2' })
    ).json()) as { crew: number; member: string };
    members.push({ token: r.member, crew: r.crew });
  }
});
after(() => db.close());

function post(path: string, body: unknown) {
  return app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' } });
}
async function start(member?: string) {
  const r = await post('/api/game/start', { sessionId: randomUUID(), member });
  assert.equal(r.status, 200);
  return (await r.json()) as { runId: string; seed: number; member: boolean };
}
/** Simula que a partida começou há `s` segundos. */
const age = (runId: string, s: number) =>
  db.query(`update game_runs set started_at = now() - ($2::int * interval '1 second') where id = $1`, [runId, s]);
const finish = (runId: string, distance: number, fuel = 0, pickups = 0) =>
  post('/api/game/finish', { runId, distance, fuel, pickups });

test('start devolve uma partida com seed do servidor; sessionId é obrigatório', async () => {
  const a = await start();
  const b = await start();
  assert.match(a.runId, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isInteger(a.seed) && a.seed > 0);
  assert.notEqual(a.runId, b.runId);
  assert.equal(a.member, false);
  assert.equal((await post('/api/game/start', {})).status, 400);
  // Link de membro inválido não bloqueia o jogo, só deixa fora do ranking.
  assert.equal((await start('x'.repeat(30))).member, false);
  assert.equal((await start(members[0].token)).member, true);
});

test('finish aceita uma distância possível uma única vez', async () => {
  const run = await start(members[0].token);
  await age(run.runId, 60);
  const r = await finish(run.runId, 300, 90, 3);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, best: 300, rank: 1 });
  const again = await finish(run.runId, 300, 90, 3);
  assert.equal(again.status, 409);
});

test('finish recusa distância impossível para o tempo e combustível impossível', async () => {
  const run = await start(members[0].token);
  await age(run.runId, 10);
  // 10 s a no máximo 6,8 m/s (+ folga) não chega a 200 m.
  const r = await finish(run.runId, 200);
  assert.equal(r.status, 422);
  assert.equal(((await r.json()) as { code: string }).code, 'implausible');
  // Mais combustível do que cabe nas cápsulas pegas.
  assert.equal((await finish(run.runId, 20, 500, 2)).status, 422);
  // A partida continua aberta: um resultado honesto ainda entra.
  assert.equal((await finish(run.runId, 60)).status, 200);
});

test('finish valida o corpo e partidas inexistentes ou expiradas', async () => {
  assert.equal((await finish('nao-e-uuid', 10)).status, 400);
  assert.equal((await post('/api/game/finish', { runId: randomUUID(), distance: -1, fuel: 0, pickups: 0 })).status, 400);
  assert.equal((await post('/api/game/finish', { runId: randomUUID(), distance: 1.5, fuel: 0, pickups: 0 })).status, 400);
  assert.equal((await finish(randomUUID(), 10)).status, 404);
  const old = await start();
  await age(old.runId, 3 * 60 * 60);
  assert.equal((await finish(old.runId, 10)).status, 410);
});

test('ranking: melhor de cada membro, só nº e primeiro nome; anônimos ficam fora', async () => {
  const anon = await start();
  await age(anon.runId, 600);
  assert.deepEqual(await (await finish(anon.runId, 4000)).json(), { ok: true, best: 4000, rank: null });

  const b = await start(members[1].token);
  await age(b.runId, 120);
  assert.deepEqual(await (await finish(b.runId, 500)).json(), { ok: true, best: 500, rank: 1 });
  // Ana fez 300 antes; uma partida pior não baixa o recorde dela.
  const a = await start(members[0].token);
  await age(a.runId, 30);
  assert.deepEqual(await (await finish(a.runId, 100)).json(), { ok: true, best: 300, rank: 2 });

  const top = (await (await app.request('/api/game/top')).json()) as { top: { crew: number; name: string; best: number }[] };
  assert.deepEqual(top.top, [
    { crew: members[1].crew, name: 'BRUNO', best: 500 },
    { crew: members[0].crew, name: 'ANA', best: 300 },
  ]);
  assert.ok(!JSON.stringify(top).includes('example.com'));
});
