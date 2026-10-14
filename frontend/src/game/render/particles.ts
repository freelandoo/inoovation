// Partículas em CPU com buffer fixo (um draw call por sistema): fogo e faíscas
// em modo aditivo, fumaça em modo normal. Nada é alocado depois de criado; se o
// limite estoura, a partícula mais antiga é reaproveitada.

import * as THREE from 'three';

export function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface Emit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  /** Cor no nascimento e no fim (RGB 0..1). */
  c0: [number, number, number];
  c1: [number, number, number];
  /** Arrasto (1/s). */
  drag?: number;
  /** Gravidade (m/s², negativo = cai). */
  gy?: number;
  grow?: number;
}

export class Particles {
  readonly points: THREE.Points;
  private n: number;
  private next = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private base: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private phys: Float32Array; // drag, gy, grow
  private geo: THREE.BufferGeometry;
  private live = 0;

  constructor(scene: THREE.Scene, capacity: number, map: THREE.Texture, additive: boolean) {
    this.n = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.base = new Float32Array(capacity);
    this.c0 = new Float32Array(capacity * 3);
    this.c1 = new Float32Array(capacity * 3);
    this.phys = new Float32Array(capacity * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uMap: { value: map }, uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
      vertexColors: true,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** Converte o tamanho em metros para pixels de acordo com a altura do canvas. */
  setViewport(heightPx: number, fovDeg: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value =
      heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg / 2)));
  }

  emit(e: Emit) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    const i3 = i * 3;
    this.pos[i3] = e.x;
    this.pos[i3 + 1] = e.y;
    this.pos[i3 + 2] = e.z;
    this.vel[i3] = e.vx;
    this.vel[i3 + 1] = e.vy;
    this.vel[i3 + 2] = e.vz;
    this.age[i] = 0;
    this.life[i] = e.life;
    this.base[i] = e.size;
    this.c0.set(e.c0, i3);
    this.c1.set(e.c1, i3);
    this.phys[i3] = e.drag ?? 0;
    this.phys[i3 + 1] = e.gy ?? 0;
    this.phys[i3 + 2] = e.grow ?? 0;
  }

  update(dt: number) {
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i];
      if (life <= 0) continue;
      const age = (this.age[i] += dt);
      const i3 = i * 3;
      if (age >= life) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      live++;
      const k = age / life;
      const drag = Math.exp(-this.phys[i3] * dt);
      this.vel[i3] *= drag;
      this.vel[i3 + 1] = this.vel[i3 + 1] * drag + this.phys[i3 + 1] * dt;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      for (let c = 0; c < 3; c++) this.col[i3 + c] = this.c0[i3 + c] + (this.c1[i3 + c] - this.c0[i3 + c]) * k;
      this.size[i] = this.base[i] * (1 + this.phys[i3 + 2] * k);
      this.alpha[i] = k < 0.1 ? k * 10 : 1 - (k - 0.1) / 0.9;
    }
    if (live || this.live) {
      for (const name of ['position', 'color', 'size', 'alpha']) this.geo.getAttribute(name).needsUpdate = true;
    }
    this.live = live;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
    for (const name of ['alpha', 'size']) this.geo.getAttribute(name).needsUpdate = true;
  }
}
