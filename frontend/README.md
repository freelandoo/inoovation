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
npm run dev:phone    # https://<ip-da-máquina>:5173 (a câmera no celular exige HTTPS)
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
| Rastreamento do rótulo na RA (posição/tamanho do astronauta) | `src/ar/modes.ts` → `ImageTrackingMode` |
| Eventos (`innovation_page_view`, `ar_cta_clicked`…) | `src/analytics/analytics.ts`, enviados à API por `src/api/client.ts` |
| Leitor de QR da página ("Ativar minha unidade") | `src/ui/unitScanCta.ts`, `src/scanner/` |
| Coreografia por seção (posição do rótulo, portal, partículas) | `src/story/Director.ts` |
| Rótulo 3D e acabamentos | `src/label/` |
| Calibração das máscaras (scale/x/y por camada) | `src/label/labelConfig.ts` → `labelLayers` |

## Formato do redirecionamento (a combinar com a Realizse)

Qualquer um destes funciona hoje, e novos nomes de parâmetro entram em `config.params`:

- `?product=…&lot=…&unit=…` (também `gtin/serial`, `01/10/21`)
- `?dl=<link GS1 completo>`
- `/01/<gtin>/10/<lote>/21/<série>` ou `/innovation/<gtin>/<lote>/<série>`
- `source`/`campaign` (ou `utm_source`/`utm_campaign`)

### Sem ids no redirecionamento: leitor de QR da página

Se a página abrir sem o serial, aparece **ATIVAR MINHA UNIDADE** (hero e seção 03). O botão abre a câmera
dentro do site e lê o QR do pote, que já traz o link GS1 completo. Com a unidade lida, a página recarrega em
`/01/<gtin>/10/<lote>/21/<série>?via=scanner` e segue o fluxo normal (a sessão fica com `origin = scanner`).
Leitura: `BarcodeDetector` nativo quando existe (Chrome/Android) + jsQR num Web Worker (iPhone e o resto,
inclusive QR claro sobre fundo escuro). Eventos: `unit_scan_opened`, `unit_scan_succeeded`, `unit_scan_failed`.

Os valores passam por whitelist de caracteres e limite de tamanho, e só são exibidos via `textContent`.
**Autenticidade não é verificada aqui.** Se a Realizse enviar assinatura/token, a validação deve ser feita num backend.

## Rótulo: assets

- Fonte original (não modificar, fora do Git): `../rotulo/`, todos 1920x714 e já recortados na faca
  - `01.png` arte final · `02` calço branco · `03` verniz relevo · `04` casting holográfico
  - `05` verniz luminescente · `06` verniz fotoluminescente · `07` verniz textura
  - nas separações (RGBA), pixel opaco = área com acabamento
- Cópias dos PNGs usados (fora do Git): `assets-src/innovation-week/label/`
- Derivados web: `public/innovation-week/label/base` (WebP 2048/1024, AVIF + JPG para o fallback) e `.../masks`
- Regerar: `npm run assets:label` (gera também a folha `assets-src/.../debug/registration.jpg` para conferir o alinhamento)

Para trocar pelos arquivos finais da gráfica: exportar em alta resolução com a mesma faca de corte (ou ajustar
`scripts/build_label_assets.py`), rodar o script e calibrar `labelLayers`, se necessário. Os shaders usam UV 0..1
e não dependem do tamanho dos arquivos.

## RA: rastreamento do rótulo

O astronauta só aparece quando a câmera reconhece o rótulo e fica ancorado nele (some quando o rótulo sai
do quadro). Nada do rótulo é desenhado por cima do vídeo. Sem câmera (negada/desktop), cai na prévia 3D.

- Biblioteca: MindAR 1.2.5 (MIT), copiada em `public/ar/mindar/` e baixada só quando a RA abre.
- Alvos: `public/ar/label.mind`, gerado de `label-2048.jpg` (rótulo inteiro + 4 faixas sobrepostas, para o
  rótulo curvo no pote; QR e número de série mascarados porque mudam por unidade).
- Regerar depois de trocar a arte: `node scripts/build_ar_target.mjs`.
