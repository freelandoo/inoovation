// Dificuldade em função da distância (m). Interpola entre pontos-chave e para
// de crescer no último: o jogo fica difícil, mas nunca impossível.

export interface Difficulty {
  phase: 1 | 2 | 3 | 4 | 5;
  /** Velocidade horizontal (m/s). */
  speed: number;
  /** Altura livre das passagens (m). */
  gap: number;
  /** Distância entre obstáculos consecutivos (m). */
  spacing: number;
  /** Chance de um obstáculo ser móvel. */
  moving: number;
  /** Amplitude máxima do movimento (m). */
  moveAmp: number;
  /** Fração da mudança de altitude alcançável que o gerador pode exigir. */
  shift: number;
  /** Obstáculos, em média, entre cápsulas de combustível. */
  fuelEvery: number;
  /** Chance de a cápsula ser especial (+60). */
  bigFuel: number;
}

type Key = Omit<Difficulty, 'phase'> & { d: number };

const KEYS: Key[] = [
  { d: 0, speed: 4.2, gap: 4.8, spacing: 8.2, moving: 0, moveAmp: 0, shift: 0.45, fuelEvery: 1, bigFuel: 0.15 },
  { d: 100, speed: 4.8, gap: 4.2, spacing: 7.4, moving: 0, moveAmp: 0, shift: 0.6, fuelEvery: 1.1, bigFuel: 0.15 },
  { d: 300, speed: 5.3, gap: 3.7, spacing: 6.8, moving: 0.3, moveAmp: 0.8, shift: 0.7, fuelEvery: 1.25, bigFuel: 0.2 },
  { d: 600, speed: 5.9, gap: 3.3, spacing: 6.2, moving: 0.4, moveAmp: 1.1, shift: 0.78, fuelEvery: 1.4, bigFuel: 0.22 },
  { d: 1000, speed: 6.4, gap: 3.0, spacing: 5.8, moving: 0.5, moveAmp: 1.3, shift: 0.82, fuelEvery: 1.5, bigFuel: 0.25 },
  { d: 2000, speed: 6.8, gap: 2.8, spacing: 5.5, moving: 0.55, moveAmp: 1.4, shift: 0.85, fuelEvery: 1.6, bigFuel: 0.25 },
];

/** Velocidade máxima que o jogo alcança (o backend usa o mesmo teto para validar). */
export const MAX_SPEED = KEYS[KEYS.length - 1].speed;

export function phaseOf(d: number): Difficulty['phase'] {
  return d < 100 ? 1 : d < 300 ? 2 : d < 600 ? 3 : d < 1000 ? 4 : 5;
}

export function difficultyAt(distance: number): Difficulty {
  const d = Math.max(0, distance);
  let i = 0;
  while (i < KEYS.length - 2 && d >= KEYS[i + 1].d) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = Math.min(1, (d - a.d) / (b.d - a.d));
  const mix = (k: keyof Omit<Key, 'd'>) => a[k] + (b[k] - a[k]) * t;
  return {
    phase: phaseOf(d),
    speed: mix('speed'),
    gap: mix('gap'),
    spacing: mix('spacing'),
    moving: mix('moving'),
    moveAmp: mix('moveAmp'),
    shift: mix('shift'),
    fuelEvery: mix('fuelEvery'),
    bigFuel: mix('bigFuel'),
  };
}
