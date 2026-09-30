# Innovation Week — backend (API)

Node 24 (TypeScript executado direto, sem build) + Hono + Postgres.

| Rota | Uso |
|---|---|
| `GET /api/health` | Saúde e ping no banco (healthcheck da Railway) |
| `POST /api/scan` | Abertura da página: `{ sessionId, productId, lotId, unitId, source, campaign, origin, tier }` |
| `POST /api/events` | Evento ou lote (até 20): `{ sessionId, name, data }` |
| `GET /api/stats` | Métricas. Header `Authorization: Bearer <ADMIN_TOKEN>` |
| `POST /api/admin/registry?batch=<nome>` | Importa a lista de IDs (corpo = o arquivo). Header `Authorization: Bearer <ADMIN_TOKEN>` |

O corpo é aceito como JSON mesmo com `Content-Type: text/plain`: o frontend usa `sendBeacon`, que evita preflight de CORS.

## Dados

Sem dado pessoal: não guarda IP, user agent completo, nome ou e-mail. Ver `migrations/001_init.sql`.

- `units`: uma linha por embalagem (produto+lote+unidade), com contagem de scans (uma por sessão)
- `sessions`: cada abertura da página (id aleatório do navegador), origem, campanha, tipo de aparelho
- `events`: jornada (`innovation_page_view` … `ar_experience_started`)
- `registry_units`: lista oficial de unidades da Realizse (produto GTIN-14, lote, serial)

Uma unidade lida nasce `verified` se estiver em `registry_units`, senão `seen` (a página mostra "não reconhecido"). Se a lista chegar depois, o import promove as `seen` que casarem. `blocked` nunca muda sozinho.

O serial diferencia maiúsculas de minúsculas (`7Hk` e `7hk` são unidades distintas).

## Importar a lista de IDs

A Realizse envia um arquivo com um link GS1 por linha (`https://ri3.ai/01/<gtin>/10/<lote>/21/<serial>`):

Pela API (produção; o Postgres da Railway não fica exposto na internet):

```bash
curl -X POST "https://<api>/api/admin/registry?batch=pedido-60216403"   -H "Authorization: Bearer $ADMIN_TOKEN" --data-binary @lista.csv
```

Ou direto no banco (local): `DATABASE_URL=... npm run registry:import -- lista.csv`.

As duas formas mostram o resumo (por produto/lote, duplicadas, inválidas) e grava em lotes. Rodar de novo o mesmo arquivo não duplica. O CSV nunca vai para o git (`*.csv` no `.gitignore`).

## Rodar local

```bash
npm install
cp .env.example .env      # ajuste DATABASE_URL
npm run dev               # aplica migrações e sobe em :3000
npm run check             # typecheck + testes (Postgres real via PGlite, sem Docker)
```

## Railway

1. New Project → Deploy from GitHub repo → este repositório. Em **Settings → Root Directory**: `backend`.
2. Adicione um **Postgres** ao projeto.
3. Variables do serviço:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `ALLOWED_ORIGINS` = domínio da Vercel (ex.: `https://innovation.vercel.app`)
   - `ADMIN_TOKEN` = um valor aleatório longo
4. Settings → Networking → **Generate Domain**. Essa URL vai no `VITE_API_URL` do frontend.

`railway.json` já define start, healthcheck e política de restart. As migrações rodam ao iniciar, com lock (seguro com mais de uma instância).
Nova migração: criar `migrations/002_nome.sql`.
