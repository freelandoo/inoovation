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

## Jogo: Astronaut Jetpack (`/jogo`)

Endless runner lateral em 3D, vertical 9:16, feito em Three.js no mesmo projeto (abre na hora pelo QR, sem
motor extra). Segurar (toque, mouse, Espaço/↑/W ou A/gatilho do controle) liga o jetpack; soltar, cai. Entrada
pela área do membro (botão JOGAR) ou direto em `/jogo`. `?debug` mostra a caixa de colisão e o FPS.

- `src/game/sim/`: simulação pura (sem DOM/Three), passo fixo de 1/120 s — física, combustível, gerador com
  seed, dificuldade por distância. Ajustes em `tuning.ts` e `difficulty.ts`.
- `src/game/render/`: câmera (largura de mundo fixa: o tempo de reação é igual em qualquer celular), cenário,
  obstáculos e cápsulas com pool, astronauta + jetpack, partículas.
- `src/game/main.ts`: estados da página, HUD, pausa, fim de partida, ranking.
- Gerador: cada obstáculo tem uma linha segura; a mudança entre linhas nunca passa do alcance vertical no tempo
  disponível (descontando reação e obstáculos móveis). Cápsulas só onde pegar não condena a partida, e nunca
  mais de 30 m sem uma. Teste: um autopiloto atravessa 2000 m em 30 seeds (`tests/game.test.ts`).
- Pote Evora Vulcan (`public/innovation-week/deck/pot.webp`): ~15 s depois do anterior (`VULCAN_EVERY` em
  `generator.ts`); se o jogador pega, o próximo só vem 15 s depois de o poder acabar. Dá +50 de combustível e 5 s de poder (`powerTime`) voando 2x mais rápido (`powerSpeed`): contorno vermelho, rastro, e bater numa
  pilastra quebra a peça em vez de matar. Chão e teto continuam letais.
- Recorde: local sempre; com API e link de membro no aparelho, vai para o ranking (`/api/game/*`). O servidor
  sorteia a seed e recusa distância impossível para o tempo decorrido.

- Visual: bloom (luzes HDR: neon dos obstáculos, trilhos, fogo, cápsulas, pote) em aparelhos com WebGL2
  bom; desliga sozinho se o FPS ficar abaixo de 40 (`?bloom=0`/`?bloom=1` força). Estrelas cintilando no
  fundo e luzes de pista nos trilhos.

### Ranking (`/ranking`)

Pódio com o top 3 (1º no centro, maior, coroa) e lista até 50. Todos veem; quem tem link de membro no
aparelho vê a própria posição (`POST /api/game/me`), quem não tem recebe o convite "Ative um pote" com o
leitor de QR (mesmo fluxo de ativação da página principal). Botão RANKING no fim de partida e na área do
membro.

### Personagem (`public/models/astronaut-rig.glb`)

Gerado das FBX do Mixamo em `../animações` (o astronauta oficial riggado): `npm run assets:rig` (Blender 4.4+
no PATH, ou rode o `blender.exe` com `-b --factory-startup -P scripts/build_astronaut_rig.py`). Clipes: `idle`
(Floating), `fly` (Flying), `impact` (Falling Flat Impact). O script corrige os pesos do capacete: o auto-rig do
Mixamo ligou ~22% dos vértices dele ao pescoço/tronco, e o capacete esticava nas animações.

### Testes

- `npm test`: inclui a simulação (`tests/game.test.ts`).
- `npm run test:game-e2e [url]`: Chromium real com toque (CDP), mouse e teclado contra o `vite` rodando —
  menu, toque, jetpack, coleta, pausa, colisão, fim, reinício sem duplicar objetos, foco perdido.
