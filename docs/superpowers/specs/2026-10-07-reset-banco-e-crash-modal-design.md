# Zerar o banco de produção e acabar com o crash do modal no iPhone

Data: 2026-10-07 · Status: aprovado

## Objetivo

1. Poder zerar os dados de teste de produção quantas vezes for preciso (agora para o teste
   do Alex e na véspera do evento), sem perder a lista oficial de ids.
2. Depois de zerar, a primeira abertura do QR mostra "Leitura Nº 001" e o primeiro
   cadastro vira "Tripulante Nº 0001".
3. O Safari do iPhone para de derrubar a página ao marcar os checks do modal de cadastro.

## Contexto

- "Leitura Nº" = `units.scan_count`, somado uma vez por sessão nova (`sessions.id` vem do
  aparelho). `?limpar` e uma recarga do Safari depois de crash criam sessão nova → +1.
- "Tripulante Nº" = `signups.id` (bigserial).
- `registry_units` (2000 ids oficiais da Realizse) e `schema_migrations` não podem ser apagados.
- O Postgres de produção não tem URL pública; hoje só dá para acessar abrindo um proxy TCP
  temporário no Railway.
- O crash ("Um problema ocorreu repetidamente") é do processo da página no iPhone (memória /
  GPU / áudio), só no modal, ao marcar checks. Não foi reproduzível no WebKit do Windows.

## 1. Endpoint de reset

`POST /api/admin/reset`

- Autorização: `Authorization: Bearer <ADMIN_TOKEN>` (mesmo esquema das rotas de admin
  existentes; sem `ADMIN_TOKEN` configurado a rota responde 404).
- Corpo obrigatório: `{"confirm": "ZERAR TUDO"}`; qualquer outra coisa → 400 sem efeito.
- Numa transação: `truncate collectibles, signups, events, sessions, units restart identity cascade`.
- Não toca em `registry_units` nem `schema_migrations`.
- Resposta 200: `{ ok: true, remaining: { signups, collectibles, units, sessions, events, registry } }`.

Testes (PGlite, como os atuais):
- 401/404 sem token; 400 sem a frase; nada apagado nesses casos.
- Com token e frase: tabelas de teste vazias, `registry` intacto.
- Depois do reset: o próximo cadastro tem `crew = 1` e a primeira leitura `scanCount = 1`.

## 2. Modal no iPhone (telas de toque, só com o modal aberto)

- Sem som: `play()` não toca nada enquanto `html.act-open` em tela de toque; os toques do
  modal não criam nem usam o AudioContext.
- Palco 3D liberado: além de `stop()`, o canvas do palco vai para 1×1 px enquanto o modal está
  aberto (libera o framebuffer) e volta ao tamanho certo ao fechar.
- Sem efeitos contínuos dentro do modal: sem animações infinitas (selo girando, pulsos, brilho
  do botão), sem `filter`/`drop-shadow`, sem brilho/transição no check. Visual igual, estático.
- Desktop não muda.

Teste: WebKit (iPhone 13 emulado) abre o modal, marca os dois checks, sem erro; confirmar que o
palco volta ao fechar. O crash real só se confirma no aparelho.

## 3. Execução do reset com o Alex

1. Publicar 1 e 2; confirmar deploy no Vercel e no Railway.
2. Alex fecha todas as abas do site no iPhone.
3. Alex avisa "pronto"; chamo o endpoint; confirmo tudo 0 e registry 2000 (`/api/live` também 0).
4. Alex lê o QR numa aba nova, sem `?limpar`.
5. Conferir nos eventos: uma sessão, leitura 1, cadastro 1.

## Fora do escopo

- Mudar a regra de contagem de leituras.
- Corrigir o redirecionamento da ri3.ai (continua com a Realizse).
