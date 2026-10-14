// Simulação do jogo (src/game/sim): física, combustível, colisão, geração e
// dificuldade. Roda sem navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/sim/world.ts';
import { FuelSystem } from '../src/game/sim/fuel.ts';
import { TUNING } from '../src/game/sim/tuning.ts';
import { difficultyAt, MAX_SPEED } from '../src/game/sim/difficulty.ts';
import { obstacleRects, pathAt, reach } from '../src/game/sim/generator.ts';
import { autopilot } from '../src/game/sim/autopilot.ts';

const steps = (s: number) => Math.round(s / TUNING.step);
/** Mundo sem obstáculos por perto (para testar só a física). */
function clearWorld(seed = 1) {
  const w = new World(seed);
  w.obstacles.length = 0;
  w.pickups.length = 0;
  return w;
}

test('fica parado em READY e o primeiro toque inicia a partida com propulsão', () => {
  const w = new World(1);
  for (let i = 0; i < 100; i++) w.step(false);
  assert.equal(w.state, 'ready');
  assert.equal(w.x, 0);
  assert.equal(w.y, TUNING.startY);
  w.step(true);
  assert.equal(w.state, 'flying');
  assert.deepEqual(
    w.drain().map((e) => e.type),
    ['start', 'thrust_on', 'fuel_low'].slice(0, 2),
  );
  assert.ok(w.vy > 0);
});

test('segurar sobe até a velocidade máxima; soltar cai até a máxima de queda', () => {
  const w = clearWorld();
  w.y = 3;
  for (let i = 0; i < steps(1); i++) w.step(true);
  assert.equal(w.state, 'flying');
  assert.ok(Math.abs(w.vy - TUNING.maxUp) < 1e-9);
  const top = w.y;
  for (let i = 0; i < steps(1); i++) w.step(false);
  assert.equal(w.state, 'falling');
  assert.ok(Math.abs(w.vy + TUNING.maxFall) < 1e-9);
  assert.ok(w.y < top);
});

test('alternar rápido entre subir e cair só gera eventos de borda', () => {
  const w = clearWorld();
  let toggles = 0;
  for (let i = 0; i < 200; i++) {
    const held = Math.floor(i / 5) % 2 === 0;
    w.step(held);
    if (i > 0 && held !== (Math.floor((i - 1) / 5) % 2 === 0)) toggles++;
  }
  const ev = w.drain().filter((e) => e.type === 'thrust_on' || e.type === 'thrust_off');
  assert.equal(ev.length, toggles + 1);
  assert.ok(w.alive);
});

test('combustível: consome só com propulsão, para no zero e não passa de 100%', () => {
  const w = clearWorld();
  w.step(true);
  const per = TUNING.fuel.burn * TUNING.step;
  assert.ok(Math.abs(w.fuel.value - (100 - per)) < 1e-9);
  const before = w.fuel.value;
  for (let i = 0; i < 30; i++) w.step(false);
  assert.equal(w.fuel.value, before, 'sem propulsão não gasta');

  const f = new FuelSystem(100, 100, 0.2);
  const seen: string[] = [];
  f.on((e) => seen.push(e.type));
  assert.equal(f.consume(85), 85);
  assert.ok(seen.includes('fuel_low'));
  assert.equal(f.consume(50), 15);
  assert.equal(f.value, 0);
  assert.ok(seen.includes('fuel_empty'));
  assert.equal(f.collect(30), 30);
  assert.equal(f.collect(60), 60);
  assert.equal(f.collect(60), 10);
  assert.equal(f.value, 100);
});

test('tanque vazio corta o impulso na hora, mas a partida continua', () => {
  const w = clearWorld();
  w.y = 12;
  w.step(true);
  w.fuel.consume(w.fuel.value);
  w.step(true);
  assert.equal(w.state, 'out_of_fuel');
  assert.equal(w.thrusting, false);
  const vy = w.vy;
  w.step(true);
  assert.ok(w.vy < vy, 'segurando sem combustível, cai');
  assert.ok(w.alive);
});

test('coletar cápsula abastece e some', () => {
  const w = clearWorld();
  w.step(true);
  w.fuel.consume(70 - w.tune.fuel.burn * w.tune.step);
  w.pickups.push({ id: 999, x: w.x + 0.3, y: w.y, kind: 'small', taken: false });
  w.step(false);
  const ev = w.drain().find((e) => e.type === 'pickup');
  assert.ok(ev && ev.type === 'pickup' && Math.abs(ev.added - 30) < 1e-9);
  assert.equal(w.pickups.find((p) => p.id === 999)?.taken, true);
  assert.ok(Math.abs(w.fuel.value - 60) < 1e-9);
  w.step(false);
  assert.equal(w.pickupsTaken, 1, 'não coleta de novo');
});

test('bater em obstáculo, no chão ou no teto encerra a partida uma única vez', () => {
  const hit = clearWorld();
  hit.step(true);
  hit.obstacles.push({
    id: 1, kind: 'wall', x: hit.x + 0.5, w: 0.8, pathY: 2, gap: 2, amp: 0, omega: 0, phase: 0, blockY0: 0, blockY1: 0, passed: false, broken: 0,
  });
  for (let i = 0; i < steps(1); i++) hit.step(false);
  assert.equal(hit.state, 'dead');
  const deaths = hit.drain().filter((e) => e.type === 'dead');
  assert.equal(deaths.length, 1);
  assert.equal(deaths[0].type === 'dead' && deaths[0].cause, 'obstacle');
  const x = hit.x;
  for (let i = 0; i < 50; i++) hit.step(true);
  assert.equal(hit.x, x, 'morto não avança nem pontua');
  assert.equal(hit.drain().length, 0);

  const floor = clearWorld();
  for (let i = 0; i < steps(3) && floor.alive; i++) floor.step(i === 0);
  assert.equal(floor.drain().find((e) => e.type === 'dead')?.type === 'dead' && floor.state, 'dead');

  const ceil = clearWorld();
  for (let i = 0; i < steps(4) && ceil.alive; i++) ceil.step(true);
  const d = ceil.drain().find((e) => e.type === 'dead');
  assert.ok(d && d.type === 'dead' && d.cause === 'ceiling');
});

test('reiniciar não duplica objetos e volta ao estado inicial', () => {
  const w = new World(42);
  const counts = [w.obstacles.length, w.pickups.length];
  for (let i = 0; i < steps(5); i++) w.step(autopilot(w));
  w.reset(42);
  assert.deepEqual([w.obstacles.length, w.pickups.length], counts);
  assert.deepEqual([w.state, w.x, w.distance, w.fuel.value, w.fuelCollected], ['ready', 0, 0, 100, 0]);
  assert.equal(new Set(w.obstacles.map((o) => o)).size, w.obstacles.length, 'nenhum objeto repetido');
});

test('mesma seed gera o mesmo percurso', () => {
  const a = new World(7);
  const b = new World(7);
  for (let i = 0; i < steps(20); i++) {
    a.step(autopilot(a));
    b.step(autopilot(b));
  }
  assert.equal(a.x, b.x);
  assert.equal(a.y, b.y);
  assert.deepEqual(
    a.obstacles.map((o) => [o.kind, o.x, o.pathY]),
    b.obstacles.map((o) => [o.kind, o.x, o.pathY]),
  );
});

test('pontuação independe do FPS: só o número de passos fixos conta', () => {
  // O laço do jogo acumula o tempo real do quadro e roda passos fixos. Simula
  // 10 s de jogo com quadros de 60, 30 e 144 Hz (com jitter) e compara.
  function run(fps: number) {
    const w = new World(3);
    let acc = 0;
    let time = 0;
    let k = 0;
    while (time < 10) {
      const frame = (1 / fps) * (1 + 0.3 * Math.sin(k++));
      time += frame;
      acc += frame;
      while (acc >= TUNING.step) {
        acc -= TUNING.step;
        w.step(autopilot(w));
      }
    }
    return w;
  }
  const ref = run(60);
  for (const fps of [30, 144]) {
    const w = run(fps);
    // Diferença máxima: um passo a mais ou a menos pelo resto do acumulador.
    assert.ok(Math.abs(w.x - ref.x) <= MAX_SPEED * TUNING.step * 2 + 1e-9, `fps ${fps}`);
  }
});

test('obstáculos aparecem indefinidamente e não nascem dentro do astronauta', () => {
  const w = new World(11);
  w.step(true);
  for (const o of w.obstacles) assert.ok(o.x >= TUNING.firstObstacleX);
  // Teleporta adiante várias vezes, checando que o percurso continua sendo gerado.
  for (let k = 0; k < 50; k++) {
    w.x += 200;
    w.obstacles.length = 0;
    w.pickups.length = 0;
    w.y = 6.5;
    (w as unknown as { advanceTrack(): void }).advanceTrack();
    assert.ok(w.obstacles.some((o) => o.x > w.x + 10), `geração em ${w.x}`);
  }
});

test('cápsulas ficam fora dos obstáculos e dentro da faixa jogável', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const w = new World(seed);
    for (let i = 0; i < steps(120) && w.alive; i++) {
      w.step(autopilot(w));
      for (const p of w.pickups) {
        assert.ok(p.y > TUNING.floor + 1 && p.y < TUNING.ceiling - 1);
        for (const o of w.obstacles) {
          for (const r of obstacleRects(o, w.t, TUNING)) {
            const inside = p.x > r.x0 - 0.3 && p.x < r.x1 + 0.3 && p.y > r.y0 && p.y < r.y1;
            assert.ok(!inside, `cápsula dentro de obstáculo (seed ${seed})`);
          }
        }
      }
    }
  }
});

test('não gera sequências impossíveis: o piloto automático atravessa 2000 m em 30 seeds', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const w = new World(seed * 7919);
    while (w.alive && w.distance < 2000) w.step(autopilot(w));
    assert.ok(w.alive, `seed ${seed * 7919} morreu em ${w.distance.toFixed(0)} m (${w.drain().find((e) => e.type === 'dead')?.type})`);
  }
});

test('linhas seguras consecutivas respeitam o alcance vertical', () => {
  const w = new World(99);
  const seen = new Map<number, { x: number; w: number; pathY: number; amp: number }>();
  while (w.alive && w.distance < 1500) {
    w.step(autopilot(w));
    for (const o of w.obstacles) seen.set(o.id, { x: o.x, w: o.w, pathY: o.pathY, amp: o.kind === 'beam' ? 0 : o.amp });
  }
  const list = [...seen.values()].sort((a, b) => a.x - b.x);
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    const t = (b.x - a.x - a.w - TUNING.hitW) / difficultyAt(b.x).speed;
    const lim = Math.min(reach(t, TUNING, 'up'), reach(t, TUNING, 'down'));
    assert.ok(Math.abs(b.pathY - a.pathY) + a.amp + b.amp <= lim + 1e-6, `obstáculo em ${b.x.toFixed(1)}`);
  }
});

test('dificuldade cresce por fases e para de crescer', () => {
  const d = [0, 100, 300, 600, 1000].map(difficultyAt);
  assert.deepEqual(d.map((x) => x.phase), [1, 2, 3, 4, 5]);
  for (let i = 1; i < d.length; i++) {
    assert.ok(d[i].speed > d[i - 1].speed);
    assert.ok(d[i].gap < d[i - 1].gap);
  }
  assert.equal(d[0].moving, 0, 'fase 1 só tem obstáculos estáticos');
  const far = difficultyAt(1e6);
  assert.equal(far.speed, MAX_SPEED);
  assert.ok(far.gap >= 2.8);
  assert.ok(far.gap > TUNING.hitH * 5);
});

test('obstáculos móveis mantêm a passagem livre do tamanho certo', () => {
  const w = new World(5);
  while (w.alive && w.distance < 900) w.step(autopilot(w));
  const moving = w.obstacles.filter((o) => o.amp > 0 && o.kind !== 'beam');
  for (const o of moving) {
    for (let t = 0; t < 4; t += 0.1) {
      const [bottom, top] = obstacleRects(o, t, TUNING);
      assert.ok(Math.abs(top.y0 - bottom.y1 - o.gap) < 1e-9);
      const c = pathAt(o, t);
      assert.ok(c - o.gap / 2 > TUNING.floor && c + o.gap / 2 < TUNING.ceiling);
    }
  }
});

test('pote Evora Vulcan aparece a cada ~10 s de jogo, mais raro que as cápsulas', () => {
  const w = new World(2024);
  const seen = new Map<number, string>();
  while (w.alive && w.t < 120) {
    w.step(autopilot(w));
    for (const p of w.pickups) seen.set(p.id, p.kind);
  }
  assert.ok(w.alive);
  const kinds = [...seen.values()];
  const pots = kinds.filter((k) => k === 'vulcan').length;
  assert.ok(pots >= 9 && pots <= 15, `${pots} potes em 120 s`);
  assert.ok(kinds.filter((k) => k !== 'vulcan').length > pots * 3, 'cápsulas comuns continuam mais frequentes');
});

test('pegar o pote dá combustível e 4 s de poder; com poder a pilastra quebra em vez de matar', () => {
  const w = clearWorld();
  w.step(true);
  w.fuel.consume(80);
  w.pickups.push({ id: 500, x: w.x + 0.3, y: w.y, kind: 'vulcan', taken: false });
  w.step(false);
  let ev = w.drain().map((e) => e.type);
  assert.ok(ev.includes('pickup') && ev.includes('power_on'));
  assert.ok(w.powered);
  assert.ok(Math.abs(w.powerLeft - TUNING.powerTime) < 0.02);
  assert.ok(Math.abs(w.fuel.value - (100 - 80 - TUNING.fuel.burn * TUNING.step + TUNING.fuel.vulcan)) < 1e-6);

  // Parede inteira na frente (passagem fora de alcance): com poder, atravessa.
  w.obstacles.push({
    id: 77, kind: 'wall', x: w.x + 0.8, w: 0.8, pathY: 1.5, gap: 1, amp: 0, omega: 0, phase: 0, blockY0: 0, blockY1: 0, passed: false, broken: 0,
  });
  w.y = 7;
  w.vy = 0;
  for (let i = 0; i < steps(0.6); i++) w.step(w.vy < 0);
  assert.ok(w.alive, 'com poder não morre na pilastra');
  ev = w.drain().map((e) => e.type);
  assert.ok(ev.includes('smash'));
  assert.equal(w.smashed, 1);
  assert.equal(w.obstacles.find((o) => o.id === 77)!.broken, 0b10, 'só a peça de cima (a que bateu) quebrou');

  // O poder acaba em 4 s; depois disso a próxima pilastra mata.
  while (w.powered) w.step(w.vy < 0 && w.y < 7);
  assert.ok(w.drain().some((e) => e.type === 'power_off'));
  w.obstacles.push({
    id: 78, kind: 'wall', x: w.x + 0.8, w: 0.8, pathY: 1.5, gap: 1, amp: 0, omega: 0, phase: 0, blockY0: 0, blockY1: 0, passed: false, broken: 0,
  });
  for (let i = 0; i < steps(0.6) && w.alive; i++) w.step(w.vy < 0);
  assert.equal(w.state, 'dead');
});

test('com poder, chão e teto continuam letais', () => {
  const w = clearWorld();
  w.step(true);
  w.powerUntil = w.t + 10;
  for (let i = 0; i < steps(4) && w.alive; i++) w.step(false);
  const d = w.drain().find((e) => e.type === 'dead');
  assert.ok(d && d.type === 'dead' && d.cause === 'floor');
});
