// Campo de partículas: dados/energia em profundidade. Três comportamentos,
// controlados pelo Director:
//   converge -> orbitam o portal (cresce até a seção da RA)
//   morph 0..1 -> reúnem-se no QR do rótulo
//   morph 1..2 -> reorganizam-se no formato do card de identidade digital

import * as THREE from 'three';

const vertex = /* glsl */ `
  attribute vec4 aRand;
  attribute vec3 aTarget;
  uniform float uTime;
  uniform float uConverge;
  uniform float uMorph;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uOpacity;
  uniform float uMotion;
  uniform vec2 uView;
  uniform vec3 uPortal;
  uniform float uPortalRadius;
  uniform vec3 uQrPoint;
  uniform vec3 uTargetCenter;
  uniform float uTargetSize;
  varying float vAlpha;
  varying float vHot;

  float ease(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }

  void main() {
    float z = mod(aRand.z * 14.0 + uTime * uMotion * (0.12 + aRand.w * 0.3), 14.0) - 11.0;
    float spread = (10.0 - z) / 10.0;
    vec3 freeP = vec3((aRand.x - 0.5) * uView.x * 1.25 * spread, (aRand.y - 0.5) * uView.y * 1.25 * spread, z);
    freeP.x += sin(uTime * 0.3 * uMotion + aRand.w * 20.0) * 0.06;
    float depthFade = smoothstep(-11.0, -8.0, z) * smoothstep(3.0, 1.2, z);

    float ang = aRand.x * 6.2831 + uTime * uMotion * (0.15 + aRand.w * 0.25);
    float rad = uPortalRadius * (1.02 + (aRand.y - 0.5) * 0.3);
    vec3 ring = uPortal + vec3(cos(ang) * rad, sin(ang) * rad, (aRand.z - 0.5) * 0.4);
    float c = ease(uConverge * 1.3 - aRand.w * 0.3);
    vec3 p = mix(freeP, ring, c);

    float m1 = ease((uMorph - aRand.w * 0.25) / 0.75);
    float m2 = ease((uMorph - 1.0 - aRand.w * 0.25) / 0.75);
    vec3 q = uQrPoint + (aRand.xyz - 0.5) * vec3(0.12, 0.12, 0.05);
    vec3 tgt = uTargetCenter + vec3(aTarget.xy * uTargetSize, aTarget.z * 0.04);
    p = mix(p, q, m1);
    p = mix(p, tgt, m2);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * uPixelRatio * (0.55 + aRand.w * 0.9) / max(0.5, -mv.z);
    gl_Position = projectionMatrix * mv;
    vAlpha = uOpacity * mix(depthFade * 0.8, 1.0, max(max(m1, c), m2));
    vHot = step(0.86, aRand.w);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uRed;
  uniform vec3 uWhite;
  varying float vAlpha;
  varying float vHot;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.05, d) * vAlpha;
    vec3 c = mix(uRed, uWhite, vHot);
    gl_FragColor = vec4(c * a, a);
    #include <colorspace_fragment>
  }
`;

/** Pontos-alvo no formato do card (contorno arredondado + módulos tipo QR), em -1..1. */
function cardTargets(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  const w = 1;
  const h = 1 / 1.586;
  const r = 0.08;
  const cols = 23;
  const rows = 14;
  for (let i = 0; i < count; i++) {
    let x: number;
    let y: number;
    if (i % 5 < 2) {
      // contorno
      const per = 2 * (w + h) * 2;
      let s = Math.random() * per;
      if (s < 2 * w) {
        x = -w + s;
        y = h;
      } else if ((s -= 2 * w) < 2 * h) {
        x = w;
        y = h - s;
      } else if ((s -= 2 * h) < 2 * w) {
        x = w - s;
        y = -h;
      } else {
        s -= 2 * w;
        x = -w;
        y = -h + s;
      }
      x = Math.max(-w + r * 0.3, Math.min(w - r * 0.3, x));
    } else {
      // módulos preenchidos com padrão pseudoaleatório fixo
      let cx = 0;
      let cy = 0;
      for (let tries = 0; tries < 8; tries++) {
        cx = Math.floor(Math.random() * cols);
        cy = Math.floor(Math.random() * rows);
        if (Math.sin(cx * 12.9898 + cy * 78.233) * 43758.5453 % 1 > -0.1) break;
      }
      x = -w * 0.86 + (cx / (cols - 1)) * w * 1.72 + (Math.random() - 0.5) * 0.03;
      y = -h * 0.8 + (cy / (rows - 1)) * h * 1.6 + (Math.random() - 0.5) * 0.03;
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = Math.random() - 0.5;
  }
  return out;
}

export class ParticleField {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  converge = 0;
  morph = 0;
  opacity = 1;
  readonly portal = new THREE.Vector3(0, 0, -6);
  portalRadius = 1;
  readonly qrPoint = new THREE.Vector3();
  readonly targetCenter = new THREE.Vector3();
  targetSize = 1;

  constructor(count: number, pixelRatio: number, motion: number) {
    const geo = new THREE.BufferGeometry();
    const rand = new Float32Array(count * 4);
    for (let i = 0; i < rand.length; i++) rand[i] = Math.random();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
    geo.setAttribute('aTarget', new THREE.BufferAttribute(cardTargets(count), 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uConverge: { value: 0 },
        uMorph: { value: 0 },
        uSize: { value: 22 },
        uPixelRatio: { value: pixelRatio },
        uOpacity: { value: 1 },
        uMotion: { value: motion },
        uView: { value: new THREE.Vector2(10, 6) },
        uPortal: { value: this.portal },
        uPortalRadius: { value: 1 },
        uQrPoint: { value: this.qrPoint },
        uTargetCenter: { value: this.targetCenter },
        uTargetSize: { value: 1 },
        uRed: { value: new THREE.Color('#ff3030') },
        uWhite: { value: new THREE.Color('#f5f5f3') },
      },
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }

  setView(w: number, h: number) {
    (this.material.uniforms.uView.value as THREE.Vector2).set(w, h);
  }

  update(_dt: number, t: number) {
    const u = this.material.uniforms;
    u.uTime.value = t;
    u.uConverge.value = this.converge;
    u.uMorph.value = this.morph;
    u.uOpacity.value = this.opacity;
    u.uPortalRadius.value = this.portalRadius;
    u.uTargetSize.value = this.targetSize;
    this.points.visible = this.opacity > 0.01;
  }
}
