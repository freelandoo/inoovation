// Cenário: céu, eclipse distante (o vermelho da campanha), estrelas, estrutura
// da estação ao fundo, trilhos letais de chão/teto e poeira perto do plano do
// jogo. A paralaxe é a da própria perspectiva: tudo é estático no mundo e as
// camadas mais distantes andam menos na tela. Cada camada é um "ladrilho"
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

/** Nebulosa distante: nuvens de ruído em vermelho/magenta/azul, bem fracas. */
function nebula(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uOff: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uOff;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }
      void main() {
        vec2 p = vUv * vec2(3.0, 2.0) + vec2(uOff, 0.0);
        float t = uTime * 0.01;
        float n = fbm(p + fbm(p * 1.7 + t));
        float m = fbm(p * 2.3 - t + 4.0);
        vec3 red = vec3(0.55, 0.04, 0.05);
        vec3 mag = vec3(0.32, 0.03, 0.30);
        vec3 blu = vec3(0.04, 0.10, 0.35);
        vec3 col = red * smoothstep(0.45, 0.85, n) + mag * smoothstep(0.5, 0.9, m) * 0.8 + blu * smoothstep(0.55, 0.95, 1.0 - n) * 0.7;
        // some nas bordas do plano
        float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x) * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
        gl_FragColor = vec4(col * edge * 0.16, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.scale.set(260, 160, 1);
  m.position.z = -170;
  m.renderOrder = -20;
  return m;
}

/** Riscos de velocidade perto da câmera: passam rápido pela paralaxe. */
function speedLines(count: number, span: number, rng: () => number, mat: THREE.Material): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const len = 1.5 + rng() * 3.5;
    m.compose(
      new THREE.Vector3(rng() * span, TUNING.floor - 2 + rng() * (TUNING.ceiling - TUNING.floor + 4), 4 + rng() * 9),
      new THREE.Quaternion(),
      new THREE.Vector3(len, 0.025 + rng() * 0.025, 1),
    );
    mesh.setMatrixAt(i, m);
  }
  mesh.frustumCulled = false;
  return mesh;
}

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

function dustLayer(count: number, span: number, rng: () => number): THREE.Points {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rng() * span;
    pos[i * 3 + 1] = TUNING.floor + rng() * (TUNING.ceiling - TUNING.floor);
    pos[i * 3 + 2] = -4 + rng() * 6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 0.05, color: 0x8a96b0, transparent: true, opacity: 0.55, depthWrite: false }),
  );
}

export class Environment {
  private layers: Tiled[] = [];
  private planet: THREE.Mesh;
  private nebula: THREE.Mesh;
  private streakMat: THREE.MeshBasicMaterial;
  private stage: Stage;

  constructor(stage: Stage, quality: 'high' | 'medium') {
    this.stage = stage;
    const scene = stage.scene;
    scene.background = skyTexture();
    let seed = 1234567;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    this.nebula = nebula();
    scene.add(this.nebula);
    this.planet = eclipse();
    scene.add(this.planet);

    const root = new THREE.Group();
    scene.add(root);
    const metal = new THREE.MeshStandardMaterial({ color: 0x101115, metalness: 0.25, roughness: 0.85, envMapIntensity: 0.3 });
    // Fundo: silhuetas translúcidas sem luz — a nebulosa aparece através delas e
    // elas não se confundem com os obstáculos (que são opacos e têm borda vermelha).
    const farMetal = new THREE.MeshBasicMaterial({ color: 0x0a0c14, transparent: true, opacity: 0.45, depthWrite: false });
    const red = new THREE.MeshBasicMaterial({ color: hdr(2.2, 0.04, 0.02), fog: false });
    const redDim = new THREE.MeshBasicMaterial({ color: hdr(0.45, 0.02, 0.01) });
    this.streakMat = new THREE.MeshBasicMaterial({
      color: hdr(1.4, 1.6, 2),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });

    this.layers.push(new Tiled(root, starField(quality === 'high' ? 700 : 380, 140, -90, -130, rng), 140));
    this.layers.push(new Tiled(root, stationLayer(90, rng, farMetal, redDim), 90));
    this.layers.push(new Tiled(root, railLayer(24, TUNING.floor, false, metal, red), 24));
    this.layers.push(new Tiled(root, railLayer(24, TUNING.ceiling, true, metal, red), 24));
    if (quality === 'high') this.layers.push(new Tiled(root, dustLayer(160, 24, rng), 24));
    this.layers.push(new Tiled(root, speedLines(quality === 'high' ? 22 : 12, 30, rng, this.streakMat), 30));
  }

  /** Pixels por unidade de tamanho das estrelas (acompanha o DPR). */
  setPixelRatio(pr: number) {
    STAR_MAT.uniforms.uPx.value = pr;
  }

  /** speed01: 0 parado, 1 velocidade máxima (riscos mais visíveis). */
  update(camX: number, time: number, speed01 = 0) {
    for (const l of this.layers) l.update(camX);
    STAR_MAT.uniforms.uTime.value = time;
    this.streakMat.opacity = 0.08 + speed01 * 0.22;
    const neb = this.nebula.material as THREE.ShaderMaterial;
    neb.uniforms.uTime.value = time;
    neb.uniforms.uOff.value = camX * 0.0025;
    this.nebula.position.set(camX, this.stage.camera.position.y, -170);
    // O eclipse anda bem devagar e dá a volta fora da tela.
    const span = 130;
    this.planet.position.x = camX + 55 - ((((camX * 0.04) % span) + span) % span);
    this.planet.position.y = this.stage.camera.position.y - 4;
    (this.planet.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
  }
}
