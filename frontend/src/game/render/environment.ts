// Cenário: céu, eclipse distante (o vermelho da campanha), estrelas, estrutura
// da estação ao fundo e trilhos letais de chão/teto com luzes de pista. A
// paralaxe é a da própria perspectiva: tudo é estático no mundo e as camadas
// mais distantes andam menos na tela. Cada camada é um "ladrilho"
// repetido 3 vezes e reposicionado conforme a câmera anda (sem criar objetos).

import * as THREE from 'three';
import { TUNING } from '../sim/tuning.ts';
import type { Stage } from './stage.ts';

class Tiled {
  readonly tiles: THREE.Object3D[];
  constructor(
    parent: THREE.Object3D,
    content: THREE.Object3D,
    readonly span: number,
  ) {
    this.tiles = [content, content.clone(), content.clone()];
    for (const t of this.tiles) parent.add(t);
  }
  update(camX: number) {
    const k = Math.floor(camX / this.span);
    for (let i = 0; i < 3; i++) this.tiles[i].position.x = (k + i - 1) * this.span;
  }
}

function skyTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#05070d');
  grad.addColorStop(0.55, '#020306');
  grad.addColorStop(0.85, '#0b0303');
  grad.addColorStop(1, '#1a0404');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Planeta em eclipse: disco escuro com borda vermelha (shader, sem textura). */
function eclipse(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float disk = 0.62;
        float rim = smoothstep(disk - 0.015, disk, r) * (1.0 - smoothstep(disk, disk + 0.02, r));
        float halo = exp(-max(r - disk, 0.0) * 9.0) * step(disk, r);
        // luz vindo de baixo-direita, como na arte da campanha
        float side = clamp(dot(normalize(p + 1e-4), normalize(vec2(0.55, -0.85))) * 0.5 + 0.5, 0.0, 1.0);
        float k = (rim * 1.6 + halo * 0.55) * (0.25 + 0.75 * pow(side, 2.0));
        k *= 0.92 + 0.08 * sin(uTime * 0.7);
        vec3 col = mix(vec3(1.0, 0.08, 0.04), vec3(1.0, 0.55, 0.35), rim * side);
        gl_FragColor = vec4(col * k, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.scale.setScalar(64);
  m.position.set(0, 2, -150);
  m.renderOrder = -10;
  return m;
}

function starField(count: number, span: number, z0: number, z1: number, rng: () => number): THREE.Points {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rng() * span;
    pos[i * 3 + 1] = -40 + rng() * 100;
    pos[i * 3 + 2] = z0 + (z1 - z0) * rng();
    const warm = rng() < 0.12;
    const b = 0.35 + rng() * 0.65;
    col[i * 3] = b;
    col[i * 3 + 1] = warm ? b * 0.55 : b * 0.9;
    col[i * 3 + 2] = warm ? b * 0.5 : b;
  }
  const phase = new Float32Array(count);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    phase[i] = rng() * 6.283;
    size[i] = 1.2 + rng() * rng() * 3.2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  return new THREE.Points(geo, STAR_MAT);
}

/** Estrelas: tamanho por estrela e cintilação (as maiores passam do limiar do bloom). */
const STAR_MAT = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexColors: true,
  uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
  vertexShader: /* glsl */ `
    attribute float phase;
    attribute float size;
    uniform float uTime;
    uniform float uPx;
    varying vec3 vColor;
    void main() {
      float tw = 0.55 + 0.45 * sin(uTime * (1.5 + fract(phase) * 3.0) + phase);
      vColor = color * (0.6 + tw * (size > 3.0 ? 2.6 : 0.9));
      gl_PointSize = size * uPx * (0.8 + 0.4 * tw);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vColor;
    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float d = dot(p, p);
      float a = exp(-d * 4.0) + 0.35 * exp(-abs(p.x) * 18.0) * exp(-abs(p.y) * 2.0) + 0.35 * exp(-abs(p.y) * 18.0) * exp(-abs(p.x) * 2.0);
      if (a < 0.02) discard;
      gl_FragColor = vec4(vColor * a, 1.0);
    }`,
});

/** Silhuetas da estação ao fundo: torres e treliças com luzes de sinalização. */
function stationLayer(span: number, rng: () => number, metal: THREE.Material, light: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const n = 14;
  const towers = new THREE.InstancedMesh(box, metal, n);
  const lights = new THREE.InstancedMesh(box, light, n * 2);
  const m = new THREE.Matrix4();
  let li = 0;
  for (let i = 0; i < n; i++) {
    const x = (i / n) * span + rng() * 3;
    const z = -38 - rng() * 30;
    const fromTop = rng() < 0.45;
    const h = 10 + rng() * 16;
    const w = 2 + rng() * 6;
    const y = fromTop ? TUNING.ceiling + 14 - h / 2 : TUNING.floor - 14 + h / 2;
    m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(w, h, 1 + rng() * 3));
    towers.setMatrixAt(i, m);
    for (let k = 0; k < 2; k++) {
      const ly = fromTop ? y - h / 2 + 0.3 + k * 1.4 : y + h / 2 - 0.3 - k * 1.4;
      m.compose(new THREE.Vector3(x + (k ? w / 2 : -w / 2) * 0.7, ly, z + 0.6), new THREE.Quaternion(), new THREE.Vector3(0.22, 0.22, 0.22));
      lights.setMatrixAt(li++, m);
    }
  }
  lights.count = li;
  g.add(towers, lights);
  return g;
}

/** Trilho letal (chão ou teto): faixa de metal, nervuras e linha vermelha de perigo. */
function railLayer(span: number, y: number, up: boolean, metal: THREE.Material, edge: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const s = up ? -1 : 1; // chão: a superfície útil fica em y; teto: idem, virado para baixo
  const slab = new THREE.Mesh(new THREE.BoxGeometry(span, 4, 3.4), metal);
  slab.position.set(span / 2, y - s * 2, 0);
  // Linha de perigo só na quina da frente: uma face horizontal funda viraria uma
  // faixa larga na perspectiva.
  const line = new THREE.Mesh(new THREE.BoxGeometry(span, 0.08, 0.08), edge);
  line.position.set(span / 2, y - s * 0.04, 1.7);
  const ribs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.5, 3.6), metal, Math.ceil(span / 1.5));
  const m = new THREE.Matrix4();
  for (let i = 0; i < ribs.count; i++) {
    m.makeTranslation(i * 1.5 + 0.4, y - s * 0.32, 0);
    ribs.setMatrixAt(i, m);
  }
  // Luzes de pista na quina da frente: com a câmera andando, "correm" para trás.
  const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.07, 0.06), runLight, Math.ceil(span / 3));
  for (let i = 0; i < lights.count; i++) {
    m.makeTranslation(i * 3 + 1.2, y - s * 0.16, 1.72);
    lights.setMatrixAt(i, m);
  }
  g.add(slab, line, ribs, lights);
  return g;
}

/** Cor HDR (acima de 1) para passar do limiar do bloom. */
const hdr = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const runLight = new THREE.MeshBasicMaterial({ color: hdr(2.4, 0.7, 0.25) });

export class Environment {
  private layers: Tiled[] = [];
  private planet: THREE.Mesh;
  private stage: Stage;

  constructor(stage: Stage, quality: 'high' | 'medium') {
    this.stage = stage;
    const scene = stage.scene;
    scene.background = skyTexture();
    let seed = 1234567;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    this.planet = eclipse();
    scene.add(this.planet);

    const root = new THREE.Group();
    scene.add(root);
    const metal = new THREE.MeshStandardMaterial({ color: 0x101115, metalness: 0.25, roughness: 0.85, envMapIntensity: 0.3 });
    // Fundo: silhuetas translúcidas sem luz — não se confundem com os obstáculos
    // (que são opacos e têm borda vermelha).
    const farMetal = new THREE.MeshBasicMaterial({ color: 0x0a0c14, transparent: true, opacity: 0.45, depthWrite: false });
    const red = new THREE.MeshBasicMaterial({ color: hdr(2.2, 0.04, 0.02), fog: false });
    const redDim = new THREE.MeshBasicMaterial({ color: hdr(0.45, 0.02, 0.01) });

    this.layers.push(new Tiled(root, starField(quality === 'high' ? 700 : 380, 140, -90, -130, rng), 140));
    this.layers.push(new Tiled(root, stationLayer(90, rng, farMetal, redDim), 90));
    this.layers.push(new Tiled(root, railLayer(24, TUNING.floor, false, metal, red), 24));
    this.layers.push(new Tiled(root, railLayer(24, TUNING.ceiling, true, metal, red), 24));
  }

  /** Pixels por unidade de tamanho das estrelas (acompanha o DPR). */
  setPixelRatio(pr: number) {
    STAR_MAT.uniforms.uPx.value = pr;
  }

  update(camX: number, time: number) {
    for (const l of this.layers) l.update(camX);
    STAR_MAT.uniforms.uTime.value = time;
    // O eclipse anda bem devagar e dá a volta fora da tela.
    const span = 130;
    this.planet.position.x = camX + 55 - ((((camX * 0.04) % span) + span) % span);
    this.planet.position.y = this.stage.camera.position.y - 4;
    (this.planet.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
  }
}
