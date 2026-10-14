// Piloto automático simples (liga/desliga com previsão). Serve de prova nos
// testes de que o gerador só cria percursos possíveis: se um controlador tão
// simples sobrevive milhares de metros em várias seeds, um humano também pode.

import { maxShift, pathAt } from './generator.ts';
import type { World } from './world.ts';

export function autopilot(w: World): boolean {
  if (w.state === 'ready') return true; // primeiro toque
  const tune = w.tune;
  const half = tune.hitW / 2;
  // Obstáculo atual (em cima dele) ou o próximo à frente.
  const next = w.obstacles.find((o) => o.x + o.w + half > w.x);
  let target = tune.startY;
  if (next) {
    const arrive = w.t + Math.max(0, next.x - half - w.x) / w.speed;
    target = pathAt(next, Math.max(w.t, arrive));
    // Cápsula no caminho antes do obstáculo, se der para pegar sem desviar muito.
    const p = w.pickups.find((k) => !k.taken && k.x > w.x && k.x < next.x);
    if (p && w.fuel.ratio < 0.9) {
      const now = maxShift(p.x - w.x - half, w.speed, tune, 1);
      const after = maxShift(next.x - p.x - half, w.speed, tune, 1);
      if (Math.abs(p.y - w.y) < now && Math.abs(p.y - target) + (next.kind === 'beam' ? 0 : next.amp) < after) target = p.y;
    }
  }
  // Onde para se mudar o comando agora (distância de frenagem).
  if (w.vy < 0) return w.y - (w.vy * w.vy) / (2 * (tune.thrust - tune.gravity)) - 0.1 < target;
  return w.y + (w.vy * w.vy) / (2 * tune.gravity) + 0.1 < target;
}
