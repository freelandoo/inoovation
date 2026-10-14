// Simulação da partida, sem Three.js nem DOM: roda igual no navegador e nos
// testes. Avança sempre em passos fixos (tune.step); quem chama acumula o tempo
// real do quadro e chama step() quantas vezes precisar.

import { FuelSystem } from './fuel.ts';
import { difficultyAt, phaseOf } from './difficulty.ts';
import { Generator, obstacleRects, type Obstacle, type Pickup, type Rect } from './generator.ts';
import { TUNING, type Tuning } from './tuning.ts';

export type State = 'ready' | 'flying' | 'falling' | 'out_of_fuel' | 'dead';
export type DeathCause = 'obstacle' | 'floor' | 'ceiling';

export type GameEvent =
  | { type: 'start' }
  | { type: 'thrust_on' }
  | { type: 'thrust_off' }
  | { type: 'pickup'; kind: Pickup['kind']; added: number; x: number; y: number }
  | { type: 'fuel_low' }
  | { type: 'fuel_empty' }
  | { type: 'pass' }
  | { type: 'power_on'; until: number }
  | { type: 'power_off' }
  | { type: 'smash'; x: number; y: number; obstacle: number; piece: number }
  | { type: 'phase'; phase: number }
  | { type: 'dead'; cause: DeathCause };

export class World {
  readonly tune: Tuning;
  readonly fuel: FuelSystem;
  state: State = 'ready';
  /** Tempo de jogo (s) desde o primeiro toque. */
  t = 0;
  ticks = 0;
  x = 0;
  y: number;
  vy = 0;
  speed = 0;
  thrusting = false;
  fuelCollected = 0;
  pickupsTaken = 0;
  passed = 0;
  phase = 1;
  seed = 1;
  /** Fim do poder Vulcan (tempo de jogo, s). */
  powerUntil = 0;
  smashed = 0;
  private poweredFlag = false;
  obstacles: Obstacle[] = [];
  pickups: Pickup[] = [];
  /** Eventos desde a última leitura (drain). */
  readonly events: GameEvent[] = [];
  private gen!: Generator;
  private rects: Rect[] = [];

  constructor(seed: number, tune: Tuning = TUNING) {
    this.tune = tune;
    this.y = tune.startY;
    this.fuel = new FuelSystem(tune.fuel.max, tune.fuel.start, tune.fuel.low);
    this.fuel.on((e) => {
      if (e.type === 'fuel_low') this.events.push({ type: 'fuel_low' });
      else if (e.type === 'fuel_empty') this.events.push({ type: 'fuel_empty' });
    });
    this.reset(seed);
  }

  get distance() {
    return Math.max(0, this.x);
  }
  get alive() {
    return this.state !== 'dead';
  }
  /** Poder Vulcan ativo: bater num obstáculo quebra a peça em vez de matar. */
  get powered() {
    return this.t < this.powerUntil;
  }
  /** Segundos de poder restantes. */
  get powerLeft() {
    return Math.max(0, this.powerUntil - this.t);
  }

  reset(seed: number) {
    for (const o of this.obstacles) this.gen?.recycle(o);
    for (const p of this.pickups) this.gen?.recyclePickup(p);
    this.obstacles.length = 0;
    this.pickups.length = 0;
    this.events.length = 0;
    this.seed = seed;
    this.gen = new Generator(seed, this.tune);
    this.state = 'ready';
    this.t = 0;
    this.ticks = 0;
    this.x = 0;
    this.y = this.tune.startY;
    this.vy = 0;
    this.speed = difficultyAt(0).speed;
    this.thrusting = false;
    this.fuelCollected = 0;
    this.pickupsTaken = 0;
    this.passed = 0;
    this.phase = 1;
    this.powerUntil = 0;
    this.smashed = 0;
    this.poweredFlag = false;
    this.fuel.reset();
    this.gen.fill(this.tune.lookahead, this.obstacles, this.pickups);
  }

  drain(): GameEvent[] {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  /** Um passo fixo. `held`: o jogador está segurando (toque/mouse/tecla/controle). */
  step(held: boolean) {
    const tune = this.tune;
    if (this.state === 'dead') return;
    if (this.state === 'ready') {
      if (!held) return;
      this.state = 'flying';
      this.events.push({ type: 'start' });
    }
    const dt = tune.step;
    this.ticks++;
    this.t = this.ticks * dt;

    const thrust = held && !this.fuel.empty;
    if (thrust !== this.thrusting) {
      this.thrusting = thrust;
      this.events.push({ type: thrust ? 'thrust_on' : 'thrust_off' });
    }
    this.vy += ((thrust ? tune.thrust : 0) - tune.gravity) * dt;
    this.vy = Math.min(tune.maxUp, Math.max(-tune.maxFall, this.vy));
    this.y += this.vy * dt;
    this.speed = difficultyAt(this.x).speed;
    this.x += this.speed * dt;
    if (thrust) this.fuel.consume(tune.fuel.burn * dt);
    if (this.fuel.empty && this.thrusting) {
      this.thrusting = false;
      this.events.push({ type: 'thrust_off' });
    }
    this.state = this.fuel.empty ? 'out_of_fuel' : this.thrusting ? 'flying' : 'falling';

    const phase = phaseOf(this.x);
    if (phase !== this.phase) {
      this.phase = phase;
      this.events.push({ type: 'phase', phase });
    }

    this.collectPickups();
    if (this.poweredFlag && !this.powered) {
      this.poweredFlag = false;
      this.events.push({ type: 'power_off' });
    }
    const cause = this.collide();
    if (cause) {
      this.die(cause);
      return;
    }
    this.advanceTrack();
  }

  private hitbox(): Rect {
    const { hitW, hitH } = this.tune;
    return { x0: this.x - hitW / 2, x1: this.x + hitW / 2, y0: this.y - hitH / 2, y1: this.y + hitH / 2 };
  }

  private collide(): DeathCause | null {
    const tune = this.tune;
    const hb = this.hitbox();
    if (hb.y0 <= tune.floor) return 'floor';
    if (hb.y1 >= tune.ceiling) return 'ceiling';
    for (const o of this.obstacles) {
      if (o.x > hb.x1 || o.x + o.w < hb.x0) continue;
      const rects = obstacleRects(o, this.t, tune, this.rects);
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (o.broken & (1 << i)) continue;
        if (!(r.x0 < hb.x1 && r.x1 > hb.x0 && r.y0 < hb.y1 && r.y1 > hb.y0)) continue;
        if (!this.powered) return 'obstacle';
        // Poder Vulcan: a peça se parte e o astronauta segue.
        o.broken |= 1 << i;
        this.smashed++;
        const y = Math.min(r.y1, Math.max(r.y0, this.y));
        this.events.push({ type: 'smash', x: Math.max(r.x0, hb.x0), y, obstacle: o.id, piece: i });
      }
    }
    return null;
  }

  private collectPickups() {
    const hb = this.hitbox();
    for (const p of this.pickups) {
      const r = p.kind === 'vulcan' ? this.tune.vulcanR : this.tune.pickupR;
      if (p.taken || p.x - r > hb.x1 || p.x + r < hb.x0) continue;
      const cx = Math.min(hb.x1, Math.max(hb.x0, p.x));
      const cy = Math.min(hb.y1, Math.max(hb.y0, p.y));
      if ((p.x - cx) ** 2 + (p.y - cy) ** 2 > r * r) continue;
      p.taken = true;
      const amount = this.tune.fuel[p.kind];
      const added = this.fuel.collect(amount);
      this.fuelCollected += added;
      this.pickupsTaken++;
      this.events.push({ type: 'pickup', kind: p.kind, added, x: p.x, y: p.y });
      if (p.kind === 'vulcan') {
        this.gen.vulcanTaken(p.x);
        this.powerUntil = this.t + this.tune.powerTime;
        this.poweredFlag = true;
        this.events.push({ type: 'power_on', until: this.powerUntil });
      }
    }
  }

  private advanceTrack() {
    const behind = this.x - 14;
    for (const o of this.obstacles) {
      if (!o.passed && o.x + o.w < this.x - this.tune.hitW / 2) {
        o.passed = true;
        this.passed++;
        this.events.push({ type: 'pass' });
      }
    }
    // Recicla o que ficou para trás (fora da tela).
    let w = 0;
    for (const o of this.obstacles) {
      if (o.x + o.w < behind) this.gen.recycle(o);
      else this.obstacles[w++] = o;
    }
    this.obstacles.length = w;
    w = 0;
    for (const p of this.pickups) {
      if (p.x < behind) this.gen.recyclePickup(p);
      else this.pickups[w++] = p;
    }
    this.pickups.length = w;
    this.gen.fill(this.x + this.tune.lookahead, this.obstacles, this.pickups);
  }

  private die(cause: DeathCause) {
    if (this.poweredFlag) this.events.push({ type: 'power_off' });
    this.poweredFlag = false;
    this.powerUntil = 0;
    if (this.thrusting) this.events.push({ type: 'thrust_off' });
    this.thrusting = false;
    this.state = 'dead';
    this.events.push({ type: 'dead', cause });
  }
}
