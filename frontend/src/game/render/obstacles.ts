// Visual dos obstáculos e das cápsulas, com pool de malhas: nada é criado
// durante a partida depois do aquecimento. A geometria visível corresponde aos
// retângulos de colisão da simulação (obstacleRects); só a profundidade (z) é
// decorativa. Todo perigo tem a borda vermelha da campanha; combustível é ciano.

import * as THREE from 'three';
import { obstacleRects, offsetAt, type Obstacle, type ObstacleKind, type Pickup, type Rect } from '../sim/generator.ts';
import { TUNING } from '../sim/tuning.ts';

const DEPTH = 2.2;

interface Mats {
  metal: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  red: THREE.MeshBasicMaterial;
  field: THREE.ShaderMaterial;
}

/** Uma peça (bloco) que acompanha um retângulo de colisão. */
interface Piece {
  body: THREE.Object3D;
  /** Borda vermelha na ponta voltada para a passagem. */
  edge: THREE.Object3D;
}

interface ObstacleView {
  kind: ObstacleKind;
  group: THREE.Group;
  pieces: Piece[];
}

function energyFieldMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() { vPos = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vPos;
      uniform float uTime;
      void main() {
        float bands = 0.55 + 0.45 * sin(vPos.y * 9.0 - uTime * 14.0);
        float flick = 0.85 + 0.15 * sin(uTime * 37.0 + vPos.y * 2.0);
        float core = 1.0 - abs(fract(vPos.x * 2.0) - 0.5) * 0.6;
        gl_FragColor = vec4(vec3(1.0, 0.1, 0.05) * (0.35 + 0.65 * bands) * flick * core, 0.85);
      }`,
  });
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1, false);

function makePiece(kind: ObstacleKind, m: Mats): Piece {
  if (kind === 'pipes') {
    const body = new THREE.Group();
    const pipe = new THREE.Mesh(unitCyl, m.metal);
    body.add(pipe);
    const edge = new THREE.Group();
    const flange = new THREE.Mesh(unitCyl, m.panel);
    flange.scale.set(1.18, 0.34, 1.18);
    const ring = new THREE.Mesh(unitCyl, m.red);
    ring.scale.set(1.2, 0.07, 1.2);
    edge.add(flange, ring);
    return { body, edge };
  }
  if (kind === 'gate') {
    const body = new THREE.Mesh(unitBox, m.field);
    const edge = new THREE.Group();
    const head = new THREE.Mesh(unitBox, m.panel);
    head.scale.set(1.5, 0.42, 1.4);
    const strip = new THREE.Mesh(unitBox, m.red);
    strip.scale.set(1.52, 0.08, 1.42);
    edge.add(head, strip);
    return { body, edge };
  }
  // wall e beam: blocos de metal com borda vermelha
  const body = new THREE.Mesh(unitBox, kind === 'beam' ? m.panel : m.metal);
  const edge = new THREE.Mesh(unitBox, m.red);
  return { body, edge };
}

export class ObstacleRenderer {
  private group = new THREE.Group();
  private mats: Mats;
  private active = new Map<number, ObstacleView>();
  private pool: Record<ObstacleKind, ObstacleView[]> = { pipes: [], wall: [], gate: [], beam: [] };
  private rects: Rect[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.mats = {
      metal: new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.85, roughness: 0.38 }),
      panel: new THREE.MeshStandardMaterial({ color: 0x8d9097, metalness: 0.7, roughness: 0.32 }),
      red: new THREE.MeshBasicMaterial({ color: 0xff1a12 }),
      field: energyFieldMaterial(),
    };
    // Aquecimento: cria o suficiente para a tela e compila os materiais.
    for (const k of Object.keys(this.pool) as ObstacleKind[]) {
      for (let i = 0; i < 5; i++) this.pool[k].push(this.make(k));
    }
  }

  private make(kind: ObstacleKind): ObstacleView {
    const group = new THREE.Group();
    const count = kind === 'beam' ? 1 : 2;
    const pieces: Piece[] = [];
    for (let i = 0; i < count; i++) {
      const p = makePiece(kind, this.mats);
      group.add(p.body, p.edge);
      pieces.push(p);
    }
    group.visible = false;
    this.group.add(group);
    return { kind, group, pieces };
  }

  update(obstacles: readonly Obstacle[], t: number, time: number) {
    this.mats.field.uniforms.uTime.value = time;
    // Libera o que saiu da simulação.
    for (const [id, v] of this.active) {
      if (!obstacles.some((o) => o.id === id)) {
        v.group.visible = false;
        this.pool[v.kind].push(v);
        this.active.delete(id);
      }
    }
    for (const o of obstacles) {
      let v = this.active.get(o.id);
      if (!v) {
        v = this.pool[o.kind].pop() ?? this.make(o.kind);
        v.group.visible = true;
        this.active.set(o.id, v);
      }
      this.layout(o, v, t);
    }
  }

  private layout(o: Obstacle, v: ObstacleView, t: number) {
    const rects = obstacleRects(o, t, TUNING, this.rects);
    const cx = o.x + o.w / 2;
    for (let i = 0; i < v.pieces.length; i++) {
      const r = rects[i];
      const p = v.pieces[i];
      const h = r.y1 - r.y0;
      const cy = (r.y0 + r.y1) / 2;
      // Ponta voltada para a passagem: topo da peça de baixo, base da de cima.
      const tipUp = o.kind === 'beam' ? null : i === 0;
      if (o.kind === 'pipes') {
        p.body.position.set(cx, cy, 0);
        p.body.scale.set(o.w, h, o.w);
        p.edge.position.set(cx, tipUp ? r.y1 - 0.17 : r.y0 + 0.17, 0);
        p.edge.scale.set(o.w, 1, o.w);
      } else if (o.kind === 'gate') {
        p.body.position.set(cx, cy, 0);
        p.body.scale.set(o.w * 0.45, h, DEPTH * 0.6);
        p.edge.position.set(cx, tipUp ? r.y1 - 0.21 : r.y0 + 0.21, 0);
        p.edge.scale.set(o.w, 1, DEPTH * 0.7);
      } else if (o.kind === 'wall') {
        p.body.position.set(cx, cy, 0);
        p.body.scale.set(o.w, h, DEPTH);
        p.edge.position.set(cx, tipUp ? r.y1 - 0.05 : r.y0 + 0.05, 0);
        p.edge.scale.set(o.w + 0.02, 0.1, DEPTH + 0.02);
      } else {
        // beam: bloco suspenso, com faixas vermelhas nas duas faces livres
        p.body.position.set(cx, cy, 0);
        p.body.scale.set(o.w, h, DEPTH);
        const off = offsetAt(o, t);
        const bottomFree = o.blockY0 > TUNING.floor;
        p.edge.position.set(cx, bottomFree ? o.blockY0 + off + 0.05 : o.blockY1 + off - 0.05, 0);
        p.edge.scale.set(o.w + 0.02, 0.1, DEPTH + 0.02);
      }
    }
  }

  reset() {
    for (const [id, v] of this.active) {
      v.group.visible = false;
      this.pool[v.kind].push(v);
      this.active.delete(id);
    }
  }
}

/** Cápsulas de combustível: núcleo ciano (comum) ou dourado (especial). */
export class PickupRenderer {
  private group = new THREE.Group();
  private active = new Map<number, THREE.Group>();
  private pool: { small: THREE.Group[]; big: THREE.Group[] } = { small: [], big: [] };
  private kindOf = new Map<THREE.Group, Pickup['kind']>();
  private shell: THREE.MeshStandardMaterial;
  private core: Record<Pickup['kind'], THREE.MeshBasicMaterial>;
  private halo: Record<Pickup['kind'], THREE.SpriteMaterial>;
  private capsule = new THREE.CapsuleGeometry(0.17, 0.34, 4, 12);
  private cap = new THREE.CylinderGeometry(0.2, 0.2, 0.09, 14);

  constructor(scene: THREE.Scene, glow: THREE.Texture) {
    scene.add(this.group);
    this.shell = new THREE.MeshStandardMaterial({ color: 0xd8dade, metalness: 0.8, roughness: 0.25 });
    this.core = {
      small: new THREE.MeshBasicMaterial({ color: 0x3df2ff }),
      big: new THREE.MeshBasicMaterial({ color: 0xffd36a }),
    };
    this.halo = {
      small: new THREE.SpriteMaterial({ map: glow, color: 0x2fd8ff, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }),
      big: new THREE.SpriteMaterial({ map: glow, color: 0xffb030, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95 }),
    };
    for (let i = 0; i < 4; i++) {
      this.pool.small.push(this.make('small'));
      this.pool.big.push(this.make('big'));
    }
  }

  private make(kind: Pickup['kind']): THREE.Group {
    const g = new THREE.Group();
    const core = new THREE.Mesh(this.capsule, this.core[kind]);
    const top = new THREE.Mesh(this.cap, this.shell);
    top.position.y = 0.3;
    const bottom = new THREE.Mesh(this.cap, this.shell);
    bottom.position.y = -0.3;
    const halo = new THREE.Sprite(this.halo[kind]);
    halo.scale.setScalar(kind === 'big' ? 1.9 : 1.3);
    g.add(halo, core, top, bottom);
    if (kind === 'big') g.scale.setScalar(1.3);
    g.visible = false;
    this.group.add(g);
    this.kindOf.set(g, kind);
    return g;
  }

  update(pickups: readonly Pickup[], time: number) {
    for (const [id, g] of this.active) {
      const p = pickups.find((k) => k.id === id);
      if (!p || p.taken) {
        g.visible = false;
        this.pool[this.kindOf.get(g)!].push(g);
        this.active.delete(id);
      }
    }
    for (const p of pickups) {
      if (p.taken) continue;
      let g = this.active.get(p.id);
      if (!g) {
        g = this.pool[p.kind].pop() ?? this.make(p.kind);
        g.visible = true;
        this.active.set(p.id, g);
      }
      g.position.set(p.x, p.y + Math.sin(time * 3 + p.id) * 0.06, 0);
      g.rotation.set(0.35, time * 2 + p.id, 0.25);
    }
  }

  reset() {
    for (const [id, g] of this.active) {
      g.visible = false;
      this.pool[this.kindOf.get(g)!].push(g);
      this.active.delete(id);
    }
  }
}
