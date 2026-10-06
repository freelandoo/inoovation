// Configuração central da página Innovation Week.

export const config = {
  /**
   * Nomes aceitos para cada campo na URL. O formato definitivo do redirecionamento
   * da Realizse ainda não foi fechado; basta acrescentar nomes aqui.
   */
  params: {
    product: ['product', 'productId', 'gtin', '01'],
    lot: ['lot', 'lotId', 'lote', '10'],
    unit: ['unit', 'unitId', 'serial', 'sn', '21'],
    source: ['source', 'utm_source', 'src'],
    campaign: ['campaign', 'utm_campaign', 'cmp'],
    digitalLink: ['dl', 'link'],
  },

  /** Prefixos de rota que podem vir antes de /produto/lote/unidade. */
  routePrefixes: ['innovation', 'iw'],

  api: {
    /**
     * URL do backend (Railway), ex.: https://innovation-api.up.railway.app
     * Definida no build via VITE_API_URL. Vazia = sem envio (só console em dev).
     */
    baseUrl: (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/$/, ''),
  },

  ar: {
    /** Se a RA for hospedada em outra rota/app, preencha aqui (recebe os ids na query). */
    externalUrl: null as string | null,
    modelGlb: '/models/spacesuit.glb',
    modelUsdz: '/models/spacesuit.usdz',
    /** Rastreamento do rótulo (MindAR, MIT) e alvos gerados por scripts/build_ar_target.mjs. */
    trackingLib: '/ar/mindar/mindar-image.prod.js',
    trackingTargets: '/ar/label.mind',
    heightMeters: 1.8,
    color: '#ff1a1a',
    accent: '#ffd2cc',
  },

  hero: {
    modelGlb: '/models/spacesuit.glb',
    modelTexture: null as string | null,
  },

  scanner: {
    /** Marca na URL de quem ativou a unidade pelo leitor de QR da página (?via=scanner). */
    viaParam: 'via',
    viaValue: 'scanner',
  },

  /** Não repetir a sequência de inicialização completa na mesma sessão. */
  bootSeenKey: 'iw:boot-seen',
} as const;

export type AppConfig = typeof config;
