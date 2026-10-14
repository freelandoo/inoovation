// Gerador infinito do percurso. Cada obstáculo tem uma "linha segura" (pathY):
// uma altitude com folga de gap/2 acima e abaixo, durante toda a largura dele.
// A diferença entre linhas consecutivas nunca passa do que o astronauta
// consegue subir/descer no tempo entre os dois (ver reach()), descontando o
// tempo de reação e a amplitude de obstáculos móveis. As cápsulas ficam no
// espaço aberto entre obstáculos, perto da reta que liga as linhas seguras.

import { Rng } from './rng.ts';
import { difficultyAt, type Difficulty } from './difficulty.ts';
import type { Tuning } from './tuning.ts';

export type ObstacleKind = 'pipes' | 'wall' | 'gate' | 'beam';

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number;
  w: number;
  /** Linha segura na fase 0 do movimento. */
  pathY: number;
  gap: number;
  /** Movimento vertical: amp * sin(omega * t + phase). */
  amp: number;
  omega: number;
  phase: number;
  /** beam: bloco suspenso [y0, y1] (na fase 0); se toca o teto/chão, se estende até ele. */
  blockY0: number;
  blockY1: number;
  passed: boolean;
  /** Peças quebradas pelo poder Vulcan (bit i = retângulo i de obstacleRects). */
  broken: number;
}

export interface Pickup {
  id: number;
  x: number;
  y: number;
  /** small/big: cápsulas de combustível; vulcan: pote Evora Vulcan (combustível + poder). */
  kind: 'small' | 'big' | 'vulcan';
  taken: boolean;
}

/** Distância vertical alcançável em `t` segundos partindo de vy = 0. */
export function reach(t: number, tune: Tuning, dir: 'up' | 'down'): number {
  const time = t - tune.reaction;
  if (time <= 0) return 0;
  const a = dir === 'up' ? tune.thrust - tune.gravity : tune.gravity;
  const vmax = dir === 'up' ? tune.maxUp : tune.maxFall;
  const tv = vmax / a;
  return time < tv ? 0.5 * a * time * time : 0.5 * a * tv * tv + vmax * (time - tv);
}

/** Maior mudança de linha segura permitida entre dois obstáculos. */
export function maxShift(freeDistance: number, speed: number, tune: Tuning, frac: number): number {
  const t = Math.max(0, freeDistance) / speed;
  return Math.min(reach(t, tune, 'up'), reach(t, tune, 'down')) * frac;
}

export function offsetAt(o: Obstacle, t: number): number {
  return o.amp ? o.amp * Math.sin(o.omega * t + o.phase) : 0;
}

/** Linha segura do obstáculo no instante t. */
export function pathAt(o: Obstacle, t: number): number {
  return o.pathY + (o.kind === 'beam' ? 0 : offsetAt(o, t));
}

/** Maior trecho (m) sem cápsula antes de o gerador forçar uma. */
const MAX_FUEL_GAP = 30;
/**
 * Intervalo (s de jogo) entre potes Evora Vulcan. Pote perdido: o próximo vem
 * VULCAN_EVERY depois dele. Pote pego: só VULCAN_EVERY depois de o poder acabar
 * (5 s de poder a 2x + VULCAN_EVERY após a coleta).
 */
export const VULCAN_EVERY = 15;

/**
 * Distância entre um pote pego em x e o próximo: o trecho do poder (mais rápido,
 * powerSpeed) seguido de VULCAN_EVERY segundos de voo normal.
 */
export function vulcanGapAfterTaken(x: number, tune: Tuning): number {
  const power = distanceIn(x, tune.powerTime) * tune.powerSpeed;
  return power + distanceIn(x + power, VULCAN_EVERY);
}

/** Distância percorrida em `seconds` partindo de x (a velocidade sobe com a distância). */
export function distanceIn(x: number, seconds: number): number {
  let d = x;
  const dt = 0.25;
  for (let t = 0; t < seconds; t += dt) d += difficultyAt(d).speed * Math.min(dt, seconds - t);
  return d - x;
}
const OUT = 6; // quanto as peças passam do chão/teto (só visual)

/** Retângulos letais do obstáculo no instante t (escreve em `out`). */
export function obstacleRects(o: Obstacle, t: number, tune: Tuning, out: Rect[] = []): Rect[] {
  out.length = 0;
  const off = offsetAt(o, t);
  const x0 = o.x;
  const x1 = o.x + o.w;
  if (o.kind === 'beam') {
    const y0 = o.blockY0 <= tune.floor ? tune.floor - OUT : o.blockY0 + off;
    const y1 = o.blockY1 >= tune.ceiling ? tune.ceiling + OUT : o.blockY1 + off;
    out.push({ x0, x1, y0, y1 });
    return out;
  }
  const c = o.pathY + off;
  out.push({ x0, x1, y0: tune.floor - OUT, y1: c - o.gap / 2 });
  out.push({ x0, x1, y0: c + o.gap / 2, y1: tune.ceiling + OUT });
  return out;
}

const WIDTH: Record<ObstacleKind, number> = { pipes: 1.15, wall: 0.8, gate: 0.6, beam: 2.4 };

export class Generator {
  private rng: Rng;
  private nextX: number;
  private lastPath: number;
  private lastAmp = 0;
  private lastEnd: number;
  private fuelDebt = 0;
  private lastFuelX = 0;
  private nextVulcanX = 0;
  private nextId = 1;
  private obstaclePool: Obstacle[] = [];
  private pickupPool: Pickup[] = [];
  private readonly tune: Tuning;

  constructor(seed: number, tune: Tuning) {
    this.tune = tune;
    this.rng = new Rng(seed);
    this.nextX = tune.firstObstacleX;
    this.lastPath = tune.startY;
    this.lastEnd = 0;
    this.nextVulcanX = this.vulcanInterval(0);
  }

  /** Posição do próximo pote: ~VULCAN_EVERY s de voo depois de x. */
  private vulcanInterval(x: number) {
    return x + distanceIn(x, VULCAN_EVERY * this.rng.range(0.95, 1.08));
  }

  /**
   * O jogador pegou o pote em x: o próximo só depois do poder acabar mais
   * VULCAN_EVERY. Com 15 s entre potes e ~34 m gerados à frente, o próximo
   * ainda não existe no percurso quando isso é chamado.
   */
  vulcanTaken(x: number) {
    const after = x + vulcanGapAfterTaken(x, this.tune);
    this.nextVulcanX = Math.max(this.nextVulcanX, after);
  }

  /** Gera obstáculos e cápsulas até `xMax`. */
  fill(xMax: number, obstacles: Obstacle[], pickups: Pickup[]) {
    while (this.nextX < xMax) this.spawn(obstacles, pickups);
  }

  recycle(o: Obstacle) {
    this.obstaclePool.push(o);
  }
  recyclePickup(p: Pickup) {
    this.pickupPool.push(p);
  }

  private spawn(obstacles: Obstacle[], pickups: Pickup[]) {
    const tune = this.tune;
    const rng = this.rng;
    const x = this.nextX;
    const diff = difficultyAt(x);

    let kind: ObstacleKind = rng.pick(['pipes', 'pipes', 'wall', 'beam'] as const);
    // Seca de combustível: o próximo obstáculo fica parado para a cápsula caber.
    const overdue = x - this.lastFuelX > MAX_FUEL_GAP;
    const moving = !overdue && diff.moving > 0 && rng.chance(diff.moving);
    if (moving && kind !== 'beam') kind = 'gate';
    let gap = diff.gap * rng.range(1, 1.12);
    let amp = moving ? rng.range(0.45, 1) * diff.moveAmp : 0;
    // A linha anterior precisa caber na faixa permitida deste obstáculo; senão o
    // limite (clamp) empurraria a linha além do alcance. As passagens só
    // diminuem com a distância, então sem movimento e com o gap mínimo sempre cabe.
    const fits = (g: number, a: number) =>
      this.lastPath >= tune.floor + g / 2 + a + 0.6 && this.lastPath <= tune.ceiling - g / 2 - a - 0.6;
    if (!fits(gap, amp)) {
      amp = 0;
      if (kind === 'gate') kind = 'pipes';
      if (!fits(gap, 0)) gap = diff.gap;
    }
    // Mudança de altitude permitida até aqui; o movimento dos dois obstáculos
    // consome parte desse alcance.
    const free = x - this.lastEnd - tune.hitW;
    const reachable = maxShift(free, diff.speed, tune, diff.shift);
    amp = Math.min(amp, Math.max(0, reachable - this.lastAmp));
    if (amp < 0.25) {
      amp = 0;
      if (kind === 'gate') kind = 'pipes';
    }
    const width = WIDTH[kind];
    const limit = reachable - amp - this.lastAmp;
    const lo = tune.floor + gap / 2 + amp + 0.6;
    const hi = tune.ceiling - gap / 2 - amp - 0.6;
    const shift = Math.max(0, limit) * rng.range(-1, 1) * (overdue ? 0.3 : 1);
    const pathY = clamp(this.lastPath + shift, lo, hi);

    const o = this.obstaclePool.pop() ?? ({} as Obstacle);
    o.id = this.nextId++;
    o.kind = kind;
    o.x = x;
    o.w = width;
    o.pathY = pathY;
    o.gap = gap;
    o.amp = amp;
    o.omega = amp ? (Math.PI * 2) / rng.range(2.6, 3.4) : 0;
    o.phase = amp ? rng.range(0, Math.PI * 2) : 0;
    o.passed = false;
    o.broken = 0;
    o.blockY0 = 0;
    o.blockY1 = 0;
    if (kind === 'beam') this.placeBeam(o, diff);
    obstacles.push(o);

    this.placeFuel(x, pathY, o.kind === 'beam' ? 0 : o.amp, diff, pickups, overdue);

    this.lastPath = pathY;
    this.lastAmp = kind === 'beam' ? 0 : amp;
    this.lastEnd = x + width;
    this.nextX = x + width + diff.spacing * rng.range(0.92, 1.12);
  }

  /** Bloco suspenso: a linha segura fica acima ou abaixo dele, com folga gap/2 + amp. */
  private placeBeam(o: Obstacle, diff: Difficulty) {
    const tune = this.tune;
    const h = this.rng.range(1.1, 2.2);
    const margin = o.gap / 2 + o.amp;
    const roomBelow = o.pathY - tune.floor;
    const roomAbove = tune.ceiling - o.pathY;
    const below = roomAbove > roomBelow ? true : roomAbove < roomBelow ? false : this.rng.chance(0.5);
    // linha segura abaixo do bloco -> bloco acima dela, e vice-versa
    if (below) {
      o.blockY0 = o.pathY + margin;
      o.blockY1 = o.blockY0 + h;
      if (tune.ceiling - o.blockY1 < diff.gap * 0.9) o.blockY1 = tune.ceiling; // pendurado no teto
    } else {
      o.blockY1 = o.pathY - margin;
      o.blockY0 = o.blockY1 - h;
      if (o.blockY0 - tune.floor < diff.gap * 0.9) o.blockY0 = tune.floor; // apoiado no chão
    }
    // Bloco preso ao teto/chão não balança.
    if (o.blockY0 <= tune.floor || o.blockY1 >= tune.ceiling) {
      o.amp = 0;
      o.omega = 0;
    }
  }

  /**
   * Cápsula no espaço aberto antes do obstáculo, perto da trajetória segura.
   * Pegar a cápsula nunca pode condenar a partida: as duas pernas (linha
   * anterior -> cápsula -> próximo obstáculo) precisam caber no alcance,
   * contando o movimento dos obstáculos. Se não couber, fica para o próximo.
   */
  private placeFuel(x: number, pathY: number, amp: number, diff: Difficulty, pickups: Pickup[], overdue: boolean) {
    this.fuelDebt += 1;
    // O vão inteiro (onde o pote fica) precisa começar depois do ponto mínimo.
    const vulcan = this.lastEnd >= this.nextVulcanX;
    if (this.fuelDebt < diff.fuelEvery && !overdue && !vulcan) return;
    const tune = this.tune;
    const rng = this.rng;
    const gapStart = this.lastEnd + 0.9;
    const gapEnd = x - 0.9;
    if (gapEnd - gapStart < 1) return;
    const big = !vulcan && rng.chance(diff.bigFuel);
    const want = rng.range(0.3, 0.6);
    // A especial fica um pouco fora da linha: recompensa por arriscar.
    const off = big ? rng.range(-1, 1) * Math.min(1.6, diff.gap * 0.45) : rng.range(-0.3, 0.3);
    let px = 0;
    let y = NaN;
    for (const t of [want, 0.45, 0.3, 0.6, 0.2, 0.75]) {
      px = gapStart + (gapEnd - gapStart) * t;
      // Faixa de altura de onde dá para chegar vindo da linha anterior e sair a tempo para a próxima.
      const r1 = maxShift(px - this.lastEnd - tune.hitW / 2, diff.speed, tune, 1) - this.lastAmp;
      const r2 = maxShift(x - px - tune.hitW / 2, diff.speed, tune, 1) - amp;
      const lo = Math.max(this.lastPath - r1, pathY - r2, tune.floor + 1.2);
      const hi = Math.min(this.lastPath + r1, pathY + r2, tune.ceiling - 1.2);
      if (hi - lo < 0.1) continue;
      const lineY = this.lastPath + (pathY - this.lastPath) * t;
      y = Math.min(hi - 0.05, Math.max(lo + 0.05, lineY + off));
      break;
    }
    // Pote sem lugar seguro aqui: tenta no próximo vão.
    if (Number.isNaN(y)) return;
    this.fuelDebt = Math.max(0, this.fuelDebt - diff.fuelEvery);
    this.lastFuelX = px;
    if (vulcan) this.nextVulcanX = this.vulcanInterval(px);
    const p = this.pickupPool.pop() ?? ({} as Pickup);
    p.id = this.nextId++;
    p.x = px;
    p.y = y;
    p.kind = vulcan ? 'vulcan' : big ? 'big' : 'small';
    p.taken = false;
    pickups.push(p);
  }
}

function clamp(v: number, a: number, b: number) {
  return a > b ? (a + b) / 2 : Math.min(b, Math.max(a, v));
}
