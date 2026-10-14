// Visual dos obstáculos e das cápsulas, com pool de malhas: nada é criado
// durante a partida depois do aquecimento. A geometria visível corresponde aos
// retângulos de colisão da simulação (obstacleRects); só a profundidade (z) é
// decorativa. Todo perigo tem a borda vermelha da campanha; combustível é ciano.

import * as THREE from 'three';
import { obstacleRects, offsetAt, type Obstacle, type ObstacleKind, type Pickup, type Rect } from '../sim/generator.ts';
import { TUNING } from '../sim/tuning.ts';
import type { Particles } from './particles.ts';

const DEPTH = 2.2;

interface Mats {
  metal: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  red: THREE.MeshBasicMaterial;
  neon: THREE.MeshBasicMaterial;
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
        gl_FragColor = vec4(vec3(2.4, 0.05, 0.02) * (0.35 + 0.65 * bands) * flick * core, 0.85);
      }`,
  });
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1, false);

function makePiece(kind: ObstacleKind, m: Mats): Piece {
  if (kind === 'pipes') {
    const body = new THREE.Group();
    const pipe = new THREE.Mesh(unitCyl, m.metal);
    // Faixa neon na frente do tubo (o grupo é escalado pela largura/altura da peça).
    const strip = new THREE.Mesh(unitBox, m.neon);
    strip.scale.set(0.09, 1, 0.04);
    strip.position.z = 0.5;
    body.add(pipe, strip);
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
  // wall e beam: blocos de metal com borda vermelha e faixas neon na face da frente
  const body = new THREE.Group();
  body.add(new THREE.Mesh(unitBox, kind === 'beam' ? m.panel : m.metal));
  if (kind === 'wall') {
    for (const x of [-0.36, 0.36]) {
      const strip = new THREE.Mesh(unitBox, m.neon);
      strip.scale.set(0.07, 1, 0.02);
      strip.position.set(x, 0, 0.5);
      body.add(strip);
    }
  } else {
    const strip = new THREE.Mesh(unitBox, m.neon);
    strip.scale.set(0.92, 0.05, 0.02);
    strip.position.set(0, 0, 0.5);
    body.add(strip);
  }
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
      // Cores acima de 1: passam do limiar do bloom e brilham.
      red: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.6, 0.06, 0.03) }),
      neon: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.03, 0.015) }),
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
      const broken = (o.broken & (1 << i)) !== 0;
      p.body.visible = !broken;
      p.edge.visible = !broken;
      if (broken) continue;
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

/**
 * Coletáveis: cápsulas de combustível (núcleo ciano comum, dourado especial) e
 * o pote Evora Vulcan (imagem do produto, halo vermelho pulsando e brasas).
 */
export class PickupRenderer {
  private group = new THREE.Group();
  private active = new Map<number, THREE.Group>();
  private pool: Record<Pickup['kind'], THREE.Group[]> = { small: [], big: [], vulcan: [] };
  private kindOf = new Map<THREE.Group, Pickup['kind']>();
  private shell: THREE.MeshStandardMaterial;
  private core: Record<'small' | 'big', THREE.MeshBasicMaterial>;
  private halo: Record<Pickup['kind'], THREE.SpriteMaterial>;
  private potMat: THREE.SpriteMaterial;
  private capsule = new THREE.CapsuleGeometry(0.17, 0.34, 4, 12);
  private cap = new THREE.CylinderGeometry(0.2, 0.2, 0.09, 14);
  private fire: Particles;
  private emberAcc = 0;

  constructor(scene: THREE.Scene, glow: THREE.Texture, fire: Particles, pot: THREE.Texture) {
    scene.add(this.group);
    this.fire = fire;
    this.shell = new THREE.MeshStandardMaterial({ color: 0xd8dade, metalness: 0.8, roughness: 0.25 });
    this.core = {
      small: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.25, 1.45) }),
      big: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.05, 0.3) }),
    };
    const halo = (color: number, opacity: number) =>
      new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, opacity });
    this.halo = { small: halo(0x2fd8ff, 0.45), big: halo(0xffb030, 0.55), vulcan: halo(0xff1a0a, 1) };
    this.potMat = new THREE.SpriteMaterial({ map: pot, transparent: true, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      this.pool.small.push(this.make('small'));
      this.pool.big.push(this.make('big'));
    }
    this.pool.vulcan.push(this.make('vulcan'), this.make('vulcan'));
  }

  private make(kind: Pickup['kind']): THREE.Group {
    const g = new THREE.Group();
    if (kind === 'vulcan') {
      // Halo largo + núcleo mais forte atrás do pote; a imagem fica na frente.
      const outer = new THREE.Sprite(this.halo.vulcan);
      outer.scale.setScalar(3.2);
      outer.name = 'outer';
      const inner = new THREE.Sprite(this.halo.vulcan);
      inner.scale.setScalar(1.9);
      inner.name = 'inner';
      const pot = new THREE.Sprite(this.potMat);
      pot.scale.set(0.96, 1.5, 1);
      pot.position.z = 0.05;
      pot.name = 'pot';
      g.add(outer, inner, pot);
    } else {
      const core = new THREE.Mesh(this.capsule, this.core[kind]);
      const top = new THREE.Mesh(this.cap, this.shell);
      top.position.y = 0.3;
      const bottom = new THREE.Mesh(this.cap, this.shell);
      bottom.position.y = -0.3;
      const halo = new THREE.Sprite(this.halo[kind]);
      halo.scale.setScalar(kind === 'big' ? 1.9 : 1.3);
      g.add(halo, core, top, bottom);
      if (kind === 'big') g.scale.setScalar(1.3);
    }
    g.visible = false;
    this.group.add(g);
    this.kindOf.set(g, kind);
    return g;
  }

  update(pickups: readonly Pickup[], time: number, dt: number) {
    for (const [id, g] of this.active) {
      const p = pickups.find((k) => k.id === id);
      if (!p || p.taken) {
        g.visible = false;
        this.pool[this.kindOf.get(g)!].push(g);
        this.active.delete(id);
      }
    }
    this.emberAcc += dt * 26;
    const embers = Math.floor(this.emberAcc);
    this.emberAcc -= embers;
    for (const p of pickups) {
      if (p.taken) continue;
      let g = this.active.get(p.id);
      if (!g) {
        g = this.pool[p.kind].pop() ?? this.make(p.kind);
        g.visible = true;
        this.active.set(p.id, g);
      }
      if (p.kind === 'vulcan') {
        const pulse = 0.5 + 0.5 * Math.sin(time * 6);
        g.position.set(p.x, p.y + Math.sin(time * 2.4 + p.id) * 0.1, 0);
        g.rotation.set(0, 0, 0);
        g.getObjectByName('outer')!.scale.setScalar(3 + pulse * 0.6);
        g.getObjectByName('inner')!.scale.setScalar(1.75 + pulse * 0.3);
        (g.getObjectByName('pot') as THREE.Sprite).material.rotation = Math.sin(time * 1.7 + p.id) * 0.12;
        for (let i = 0; i < embers; i++) this.ember(g.position);
      } else {
        g.position.set(p.x, p.y + Math.sin(time * 3 + p.id) * 0.06, 0);
        g.rotation.set(0.35, time * 2 + p.id, 0.25);
      }
    }
  }

  /** Brasa subindo do pote. */
  private ember(at: THREE.Vector3) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.25 + Math.random() * 0.25;
    this.fire.emit({
      x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r * 1.3, z: 0.15,
      vx: (Math.random() - 0.5) * 0.8, vy: 0.6 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 0.4,
      life: 0.5 + Math.random() * 0.5, size: 0.07 + Math.random() * 0.08,
      c0: [1, 0.55, 0.2], c1: [0.8, 0.05, 0.02], drag: 1.2,
    });
  }

  reset() {
    for (const [id, g] of this.active) {
      g.visible = false;
      this.pool[this.kindOf.get(g)!].push(g);
      this.active.delete(id);
    }
  }
}
