# Innovation Week — identidade digital da embalagem

Página de destino do QR único das embalagens Innovation Week, com experiência em realidade aumentada.

```
QR impresso → Realizse (produto/lote/unidade) → redireciona → frontend (Vercel) → RA
                                                                   │
                                                                   └→ backend (Railway) → Postgres
```

| Pasta | O quê | Deploy |
|---|---|---|
| [`frontend/`](frontend/) | Página (Vite + TypeScript + three.js + GSAP), rótulo 3D, RA embutida | Vercel, Root Directory `frontend` |
| [`backend/`](backend/) | API de scans e eventos (Node 24 + Hono + Postgres) | Railway, Root Directory `backend` |

Detalhes em [frontend/README.md](frontend/README.md) e [backend/README.md](backend/README.md).

## Variáveis

| Onde | Variável | Valor |
|---|---|---|
| Vercel | `VITE_API_URL` | URL pública do serviço na Railway |
| Railway | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| Railway | `ALLOWED_ORIGINS` | domínio da Vercel |
| Railway | `ADMIN_TOKEN` | token para `GET /api/stats` |

## Assets fora do repositório

O repositório é público. Por isso, estes arquivos de trabalho ficam só localmente:

- `rotulo/`: pacote-fonte do rótulo (arte final 01.png + separações 02–07.png)
- `innovation_week_rotulo_png/`: versão anterior do rótulo (não usada mais)
- `frontend/assets-src/`: cópias dos PNGs e folha de registro das máscaras
- modelo 3D original (`.fbx`) e referências

Os derivados usados pelo site (WebP/AVIF/GLB/USDZ) estão versionados em `frontend/public/`.
Para regerar, é preciso ter o pacote-fonte ao lado de `frontend/` (`npm run assets:label`).
