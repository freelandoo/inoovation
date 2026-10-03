// Configuração do gêmeo digital do rótulo Innovation Week.
//
// Todas as camadas usam UV normalizada 0..1 = faca de corte do rótulo. Trocar um
// arquivo por outro de maior resolução (PNG/TIFF convertido, SVG rasterizado,
// arquivo final da gráfica) não exige mexer em shader: basta gerar o derivado com
// `npm run assets:label` (ou apontar o caminho aqui) e, se preciso, calibrar
// scale/x/y da camada abaixo.

// Proporção da arte final (rotulo/01.png, 1920x714 px).
export const LABEL_MM = { width: 300, height: 111.6 } as const;
export const LABEL_ASPECT = LABEL_MM.width / LABEL_MM.height; // ≈ 2.689

/** Tamanho em unidades de mundo (1 unidade = 100 mm). */
export const LABEL_WORLD = {
  width: LABEL_MM.width / 100,
  height: LABEL_MM.height / 100,
  thickness: 0.014, // ≈ 1.4 mm
  cornerRadius: 0.035,
} as const;

const ROOT = '/innovation-week/label';

export const labelAssets = {
  base: {
    desktop: `${ROOT}/base/label-2048.webp`,
    mobile: `${ROOT}/base/label-1024.webp`,
    fallbackAvif: `${ROOT}/base/label-2048.avif`,
    fallbackJpg: `${ROOT}/base/label-2048.jpg`,
  },
  masks: {
    underprint: `${ROOT}/masks/underprint.webp`,
    texture: `${ROOT}/masks/texture.webp`,
    relief: `${ROOT}/masks/relief-height.webp`,
    holographic: `${ROOT}/masks/holographic.webp`,
    luminescent: `${ROOT}/masks/luminescent.webp`,
    photoluminescent: `${ROOT}/masks/photoluminescent.webp`,
  },
} as const;

export type LayerKey = keyof typeof labelAssets.masks;

export interface LayerTransform {
  /** Escala da máscara em torno do centro (1 = sem ajuste). */
  scale: number;
  /** Deslocamento em UV (fração da largura/altura do rótulo). Positivo = direita/cima. */
  x: number;
  y: number;
}

/**
 * Calibração de registro por camada. As separações de ../rotulo/ têm o mesmo tamanho
 * da arte e já vêm recortadas na faca, então caem alinhadas (ver debug/registration.jpg);
 * por isso tudo começa neutro. Ajuste aqui se chegarem arquivos com outro enquadramento.
 */
export const labelLayers: Record<LayerKey, LayerTransform> = {
  underprint: { scale: 1, x: 0, y: 0 },
  texture: { scale: 1, x: 0, y: 0 },
  relief: { scale: 1, x: 0, y: 0 },
  holographic: { scale: 1, x: 0, y: 0 },
  luminescent: { scale: 1, x: 0, y: 0 },
  photoluminescent: { scale: 1, x: 0, y: 0 },
};

/** Ordem da vista explodida (da base para frente), nome da camada e onde ela aparece no rótulo. */
export const explodedOrder: { key: LayerKey | 'base'; label: string; tech: string }[] = [
  { key: 'base', label: 'ARTE IMPRESSA', tech: 'Astronauta, planeta e nave' },
  { key: 'underprint', label: 'CALÇO BRANCO', tech: 'Base dos logos, textos e QR' },
  { key: 'texture', label: 'VERNIZ TEXTURA', tech: 'Estrutura metálica da nave' },
  { key: 'relief', label: 'VERNIZ RELEVO', tech: 'Molduras e placas da armadura' },
  { key: 'holographic', label: 'CASTING HOLOGRÁFICO', tech: 'Céu, planeta e solo' },
  { key: 'luminescent', label: 'VERNIZ LUMINESCENTE', tech: 'Padrão INNOVATION WAY' },
  { key: 'photoluminescent', label: 'VERNIZ FOTOLUMINESCENTE', tech: 'Logos e armadura no escuro' },
];

/** Região do QR impresso na arte (UV, origem embaixo à esquerda). Só narrativa: nunca decodificado. */
export const QR_UV = { x0: 0.902, y0: 0.173, x1: 0.953, y1: 0.309 } as const;

/**
 * Posição horizontal (UV x) em que o scanner da seção "Análise de superfície" acende
 * cada etiqueta de acabamento. Medidas a partir das máscaras atuais (ponto em que a
 * camada começa a ganhar massa da esquerda para a direita).
 */
export const SURFACE_ZONES: { key: LayerKey; label: string; at: number }[] = [
  { key: 'luminescent', label: 'VERNIZ LUMINESCENTE', at: 0.06 },
  { key: 'relief', label: 'VERNIZ RELEVO', at: 0.16 },
  { key: 'holographic', label: 'CASTING HOLOGRÁFICO', at: 0.28 },
  { key: 'texture', label: 'VERNIZ TEXTURA', at: 0.5 },
];

export function layerUvTransform(t: LayerTransform): [number, number, number, number] {
  // uvMask = (uv - 0.5) / scale + 0.5 - offset
  return [1 / t.scale, 1 / t.scale, -t.x, -t.y];
}
