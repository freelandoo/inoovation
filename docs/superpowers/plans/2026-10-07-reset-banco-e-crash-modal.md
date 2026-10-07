# Reset do banco de produção e crash do modal no iPhone — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Endpoint protegido que zera os dados de teste de produção (mantendo os ids oficiais) e um modal de cadastro que não derruba o Safari do iPhone.

**Architecture:** Rota de admin nova no Hono (`backend/src/app.ts`), no mesmo esquema de `adminDenied` das rotas existentes, com teste em PGlite. No frontend, só em telas de toque e só com o modal aberto: som desligado (`sfx.ts`), framebuffer do palco reduzido a 1×1 (`main.ts`) e efeitos contínuos do modal desligados (`activation.css`).

**Tech Stack:** Node 24 + Hono + Postgres (PGlite nos testes, `node --test`); Vite + TypeScript + three.js no frontend.

Spec: `docs/superpowers/specs/2026-10-07-reset-banco-e-crash-modal-design.md`

---

## Arquivos

- Modify: `backend/src/app.ts` — rota `POST /api/admin/reset` (depois de `POST /api/admin/registry`) e linha no cabeçalho de rotas.
- Create: `backend/tests/reset.test.ts` — testes da rota.
- Modify: `frontend/src/audio/sfx.ts` — `play()` e o destravamento do áudio ignoram toques com o modal aberto em tela de toque.
- Modify: `frontend/src/main.ts` — `releaseLanding` (para o loop e reduz o canvas a 1×1 em tela de toque), usado só pelo modal.
- Modify: `frontend/src/ui/activation.css` — bloco de toque: sem animações infinitas, `filter` e transições no modal.

---

### Task 1: Rota de reset (TDD)

**Files:**
- Create: `backend/tests/reset.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/tests/reset.test.ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.ts';
import { importRegistry } from '../src/registry.ts';
import type { Db } from '../src/db.ts';
import { createTestDb } from './helpers.ts';

const ADMIN = 'test-admin-token-123456';
const GTIN = '7898693620895';
let db: Db;
let app: ReturnType<typeof createApp>;

before(async () => {
  db = await createTestDb();
  app = createApp(db, { allowedOrigins: [], adminToken: ADMIN });
  await importRegistry(db, [{ productId: `0${GTIN}`, lotId: 'W4', unitId: 'p4G' }], 'test');
});
after(() => db.close());

const json = (path: string, body: unknown, auth?: string) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  });

const scan = async () =>
  ((await (await json('/api/scan', { sessionId: randomUUID(), productId: GTIN, lotId: 'W4', unitId: 'p4G' })).json()) as {
    unit: { scanCount: number };
  }).unit.scanCount;

const signup = async (email: string) =>
  ((await (
    await json('/api/signup', {
      sessionId: randomUUID(),
      productId: GTIN,
      lotId: 'W4',
      unitId: 'p4G',
      name: 'Alex Teste',
      email,
      consent: '2026-10-v2',
    })
  ).json()) as { crew: number }).crew;

const count = async (table: string) => Number((await db.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0].n);

test('reset: recusa sem token, com token errado e sem a frase, sem apagar nada', async () => {
  await scan();
  await signup('a@example.com');
  assert.equal((await json('/api/admin/reset', { confirm: 'ZERAR TUDO' })).status, 401);
  assert.equal((await json('/api/admin/reset', { confirm: 'ZERAR TUDO' }, 'errado')).status, 401);
  assert.equal((await json('/api/admin/reset', { confirm: 'zerar' }, ADMIN)).status, 400);
  assert.equal(await count('signups'), 1);
});

test('reset: zera os dados de teste, mantém a lista oficial e a numeração volta a 1', async () => {
  await scan();
  await signup('b@example.com');
  const r = await json('/api/admin/reset', { confirm: 'ZERAR TUDO' }, ADMIN);
  assert.equal(r.status, 200);
  const body = (await r.json()) as { remaining: Record<string, number> };
  assert.deepEqual(body.remaining, { signups: 0, collectibles: 0, units: 0, sessions: 0, events: 0, registry: 1 });
  assert.equal(await scan(), 1);
  assert.equal(await signup('c@example.com'), 1);
});

test('reset: sem ADMIN_TOKEN configurado a rota não existe', async () => {
  const open = createApp(db, { allowedOrigins: [], adminToken: null });
  const r = await open.request('/api/admin/reset', { method: 'POST', body: '{"confirm":"ZERAR TUDO"}' });
  assert.equal(r.status, 404);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node --test tests/reset.test.ts`
Expected: FAIL (rota inexistente → 404 em vez de 401/200).

- [ ] **Step 3: Implementar a rota** (em `backend/src/app.ts`, logo depois do handler de `POST /api/admin/registry`)

```ts
  // Zera os dados de teste (cadastros, coleção, leituras, sessões, eventos) e reinicia a
  // numeração. A lista oficial (registry_units) e as migrações ficam.
  app.post('/api/admin/reset', async (c) => {
    const denied = adminDenied(c);
    if (denied) return denied;
    const body = (await readJson(c)) as Record<string, unknown>;
    if (body?.confirm !== 'ZERAR TUDO') throw new HttpError(400, 'confirmação ausente');
    await db.transaction(async (tx) => {
      await tx.exec('truncate collectibles, signups, events, sessions, units restart identity cascade');
    });
    const r = await db.query<Record<string, string>>(
      `select (select count(*) from signups) as signups, (select count(*) from collectibles) as collectibles,
              (select count(*) from units) as units, (select count(*) from sessions) as sessions,
              (select count(*) from events) as events, (select count(*) from registry_units) as registry`,
    );
    const remaining = Object.fromEntries(Object.entries(r.rows[0]).map(([k, n]) => [k, Number(n)]));
    return c.json({ ok: true, remaining });
  });
```

E no cabeçalho de rotas (comentário no topo do arquivo), depois da linha de `POST /api/admin/registry`:

```ts
//   POST /api/admin/reset     zera os dados de teste, mantém a lista oficial (ADMIN_TOKEN + {"confirm":"ZERAR TUDO"})
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && node --test tests/reset.test.ts && npm test && npx tsc -p . --noEmit`
Expected: todos PASS, typecheck sem erros.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app.ts backend/tests/reset.test.ts
git commit -m "API: POST /api/admin/reset zera os dados de teste e mantém a lista oficial"
```

### Task 2: Modal no iPhone — som, palco e efeitos

**Files:**
- Modify: `frontend/src/audio/sfx.ts`
- Modify: `frontend/src/main.ts`
- Modify: `frontend/src/ui/activation.css`

- [ ] **Step 1: Som desligado no modal em tela de toque** (`frontend/src/audio/sfx.ts`)

Adicionar perto do topo, depois de `const listeners = new Set<Listener>();`:

```ts
// iPhone: o Safari derrubava a página ao marcar os checks do modal de cadastro. Com o
// modal aberto em tela de toque, nada de áudio (nem criar o AudioContext).
const quietModal = () =>
  document.documentElement.classList.contains('act-open') && window.matchMedia('(pointer: coarse)').matches;
```

No início de `unlock` (dentro de `initSfx`), antes de `if (!enabled) return;`:

```ts
    if (quietModal()) return;
```

Em `play()`, primeira linha:

```ts
  if (quietModal()) return;
```

- [ ] **Step 2: Palco liberado enquanto o modal está aberto** (`frontend/src/main.ts`)

Depois de `const resumeLanding = ...;` adicionar:

```ts
// Modal de cadastro no celular: além de parar, reduz o canvas 3D a 1×1 para liberar
// memória de vídeo (resumeLanding devolve o tamanho certo).
const releaseLanding = () => {
  stage?.stop();
  if (perf.mobile) stage?.renderer.setSize(1, 1, false);
};
```

E na chamada de `initActivation`, trocar `pauseLanding` por `pauseLanding: releaseLanding`:

```ts
    if (unit?.status === 'verified')
      initActivation({ identity, unit, reduced: perf.reducedMotion, pauseLanding: releaseLanding, resumeLanding });
```

(`releaseLanding` é `const` declarado mais abaixo, mas só é chamado depois que o `scan` resolve, então já existe.)

- [ ] **Step 3: Efeitos contínuos desligados** (`frontend/src/ui/activation.css`, dentro do bloco `@media (max-width: 560px), (pointer: coarse)` existente, no fim)

```css
  .act *,
  .act *::before,
  .act *::after {
    animation: none !important;
    transition: none !important;
    filter: none !important;
  }
  .act-check-row input:checked + i {
    box-shadow: none;
  }
```

- [ ] **Step 4: Verificar**

Run: `cd frontend && npm run check`
Expected: typecheck, lint, 15 testes e build OK.

Teste em WebKit (iPhone 13 emulado, API simulada com unidade verificada): o modal abre, os dois checks marcam, sem `pageerror`; ao fechar o modal o canvas `#stage` volta a ter a largura da janela × pixel ratio.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/audio/sfx.ts frontend/src/main.ts frontend/src/ui/activation.css
git commit -m "Modal no iPhone: sem som, palco 3D liberado e sem efeitos contínuos"
```

### Task 3: Publicar e zerar com o Alex

- [ ] **Step 1:** `git push`; esperar Vercel `READY` no commit e o Railway responder `{"error":"não autorizado"}` (401) em `POST /api/admin/reset` sem token.
- [ ] **Step 2:** Ler `ADMIN_TOKEN` do serviço `inoovation` pela API do Railway (variáveis), sem imprimir o valor.
- [ ] **Step 3:** Pedir ao Alex para fechar todas as abas do site e avisar "pronto".
- [ ] **Step 4:** Chamar `POST /api/admin/reset` com `{"confirm":"ZERAR TUDO"}`. Esperado: `remaining` todo 0 e `registry: 2000`; `GET /api/live` → `{"crew":0,"units":0,"ar":0,...}`.
- [ ] **Step 5:** Alex lê o QR numa aba nova, sem `?limpar`, e se cadastra. Conferir em `/api/live`: `crew: 1`, `units: 1`.
