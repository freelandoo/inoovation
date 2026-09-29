// Configuração do gêmeo digital do rótulo Innovation Week.
//
// Todas as camadas usam UV normalizada 0..1 = faca de corte do rótulo. Trocar um
// arquivo por outro de maior resolução (PNG/TIFF convertido, SVG rasterizado,
// arquivo final da gráfica) não exige mexer em shader: basta gerar o derivado com
// `npm run assets:label` (ou apontar o caminho aqui) e, se preciso, calibrar
// scale/x/y da camada abaixo.

export const LABEL_MM = { width: 300, height: 110 } as const;
export const LABEL_ASPECT = LABEL_MM.width / LABEL_MM.height; // ≈ 2.727

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
 * Calibração de registro por camada. As máscaras atuais foram recortadas pela linha
 * de corte ciano de cada separação e já caem alinhadas (ver debug/registration.jpg);
 * por isso tudo começa neutro. Ajuste aqui quando chegarem os arquivos finais.
 */
export const labelLayers: Record<LayerKey, LayerTransform> = {
  underprint: { scale: 1, x: 0, y: 0 },
  texture: { scale: 1, x: 0, y: 0 },
  relief: { scale: 1, x: 0, y: 0 },
  holographic: { scale: 1, x: 0, y: 0 },
  luminescent: { scale: 1, x: 0, y: 0 },
  photoluminescent: { scale: 1, x: 0, y: 0 },
};

/** Ordem da vista explodida (da base para frente) e rótulos exibidos. */
export const explodedOrder: { key: LayerKey | 'base'; label: string; tech: string }[] = [
  { key: 'base', label: 'BASE ART', tech: 'Arte impressa' },
  { key: 'underprint', label: 'WHITE UNDERPRINT', tech: 'Calço branco' },
  { key: 'texture', label: 'TEXTURE', tech: 'Verniz textura' },
  { key: 'relief', label: 'RELIEF', tech: 'Verniz relevo' },
  { key: 'holographic', label: 'HOLOGRAPHIC', tech: 'Casting holográfico bolha' },
  { key: 'luminescent', label: 'LUMINESCENT', tech: 'Verniz luminescente' },
  { key: 'photoluminescent', label: 'PHOTOLUMINESCENT', tech: 'Verniz fotoluminescente' },
];

/** Região do QR impresso na arte (UV, origem embaixo à esquerda). Só narrativa: nunca decodificado. */
export const QR_UV = { x0: 0.914, y0: 0.064, x1: 0.981, y1: 0.231 } as const;

/**
 * Faixas horizontais (UV x) onde cada acabamento se concentra, usadas para
 * acender os rótulos "RELIEF / TEXTURE / HOLOGRAPHIC / LUMINESCENT" quando o
 * scanner passa. Medidas a partir das máscaras atuais.
 */
export const SURFACE_ZONES: { key: LayerKey; label: string; at: number }[] = [
  { key: 'relief', label: 'RELIEF', at: 0.1 },
  { key: 'luminescent', label: 'LUMINESCENT', at: 0.2 },
  { key: 'holographic', label: 'HOLOGRAPHIC', at: 0.42 },
  { key: 'texture', label: 'TEXTURE', at: 0.62 },
];

export function layerUvTransform(t: LayerTransform): [number, number, number, number] {
  // uvMask = (uv - 0.5) / scale + 0.5 - offset
  return [1 / t.scale, 1 / t.scale, -t.x, -t.y];
}
