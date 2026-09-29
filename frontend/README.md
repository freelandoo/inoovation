# Innovation Week — página de destino do QR (PJ Codeworks)

Página pública aberta quando alguém escaneia o QR único da embalagem. Fluxo:

```
QR impresso → Realizse (produto/lote/unidade) → redireciona → ESTA PÁGINA → RA
```

A Realizse cuida do QR, da identificação e do redirecionamento. Esta página recebe
os identificadores, conta a história do rótulo e abre a experiência de realidade aumentada.

## Rodar

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev:phone    # https://<ip-da-máquina>:5173 (câmera/WebXR no celular exigem HTTPS)
npm run check        # typecheck + lint + testes + build
npm run build        # gera dist/ (site estático)
```

Testar identidades: `/?product=1845678901001&lot=l1&unit=AO`, `/01/1845678901001/10/l1/21/AO`,
`/innovation/1845678901001/l1/AO`. Forçar nível de desempenho: `?tier=low|medium|high`; `?reduced`.

Inspeção visual: `node scripts/shots.mjs http://localhost:5173 shots` e `node scripts/cases.mjs shots`.

## Deploy (Vercel)

1. New Project → importar este repositório → **Root Directory: `frontend`** (o `vercel.json` já define build e rotas).
2. Environment Variables: `VITE_API_URL` = URL pública do backend na Railway (sem barra no final).
3. Deploy. Rotas como `/innovation/...` e `/01/...` já caem no `index.html`.

Sem `VITE_API_URL`, a página funciona normalmente, só não envia scans e eventos.
Depois é só mandar a URL para a Realizse configurar o redirecionamento.

## Onde mexer

| O quê | Arquivo |
|---|---|
| Nomes de parâmetros aceitos, URL externa da RA, URL da API | `src/config.ts` |
| Leitura/validação dos ids (ProductIdentityResolver) | `src/identity/resolver.ts` (+ testes em `tests/`) |
| Ids mantidos na sessão e propagados à RA | `src/identity/session.ts` |
| Ponto de integração da RA | `src/ar/launch.ts` → `launchARExperience({ productId, lotId, unitId, source, campaign })` |
| Eventos (`innovation_page_view`, `ar_cta_clicked`…) | `src/analytics/analytics.ts`, enviados à API por `src/api/client.ts` |
| Coreografia por seção (posição do rótulo, portal, partículas) | `src/story/Director.ts` |
| Rótulo 3D e acabamentos | `src/label/` |
| Calibração das máscaras (scale/x/y por camada) | `src/label/labelConfig.ts` → `labelLayers` |

## Formato do redirecionamento (a combinar com a Realizse)

Qualquer um destes funciona hoje, e novos nomes de parâmetro entram em `config.params`:

- `?product=…&lot=…&unit=…` (também `gtin/serial`, `01/10/21`)
- `?dl=<link GS1 completo>`
- `/01/<gtin>/10/<lote>/21/<série>` ou `/innovation/<gtin>/<lote>/<série>`
- `source`/`campaign` (ou `utm_source`/`utm_campaign`)

Os valores passam por whitelist de caracteres e limite de tamanho, e só são exibidos via `textContent`.
**Autenticidade não é verificada aqui.** Se a Realizse enviar assinatura/token, a validação deve ser feita num backend.

## Rótulo: assets

- Fonte original (não modificar, fora do Git): `../innovation_week_rotulo_png/`
- Cópias dos PNGs usados (fora do Git): `assets-src/innovation-week/label/`
- Derivados web: `public/innovation-week/label/base` (WebP 2048/1024, AVIF + JPG para o fallback) e `.../masks`
- Regerar: `npm run assets:label` (recorta cada arquivo pela linha de corte ciano, remove as guias e gera a folha
  `assets-src/.../debug/registration.jpg` para conferir o alinhamento)

Para trocar pelos arquivos finais da gráfica: exportar em alta resolução com a mesma faca de corte (ou ajustar
`scripts/build_label_assets.py`), rodar o script e calibrar `labelLayers`, se necessário. Os shaders usam UV 0..1
e não dependem do tamanho dos arquivos.
