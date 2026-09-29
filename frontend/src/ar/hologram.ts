// Holograma do astronauta para a RA: shader próprio (fresnel, scanlines, glitch
// ocasional, materialização de baixo para cima) + base emissora, feixe e partículas.
// Unidade interna: modelo normalizado para 1 de altura, pés em y=0.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FIGURE_LIFT = 0.07;

const figureVertex = /* glsl */ `
  uniform float uTime;
  uniform float uGlitch;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  varying float vLocalY;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vUv = uv;
    vec3 p = position;
    vLocalY = p.y;
    float band = step(0.93, hash(floor(p.y * 36.0) + floor(uTime * 24.0)));
    p.x += band * uGlitch * 0.035 * sin(uTime * 90.0);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const figureFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform vec3 uAccent;
  uniform float uTime;
  uniform float uReveal;
  uniform float uOpacity;
  uniform float uGlitch;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  varying float vLocalY;
  void main() {
    if (vLocalY > uReveal) discard;
    vec3 V = normalize(cameraPosition - vPosW);
    vec3 N = normalize(vNormalW);
    float fres = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.2);
    float lum = smoothstep(0.02, 0.6, dot(texture2D(uMap, vUv).rgb, vec3(0.299, 0.587, 0.114)));
    float scan = 0.72 + 0.28 * sin(vLocalY * 420.0 - uTime * 7.0);
    float sweep = exp(-pow((vLocalY - fract(uTime * 0.28) * 1.3 + 0.15) * 22.0, 2.0));
    float flicker = 0.93 + 0.07 * sin(uTime * 41.0) * sin(uTime * 17.0) - uGlitch * 0.25;
    float edge = (1.0 - step(0.999, uReveal)) * smoothstep(uReveal - 0.025, uReveal, vLocalY);
    vec3 col = uColor * (0.35 + 1.1 * lum) * scan + uAccent * (fres * 1.3 + sweep * 0.9 + edge * 3.0);
    float alpha = (0.28 + 0.55 * lum * scan + fres * 0.9 + sweep * 0.45 + edge) * flicker * uOpacity;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

const simpleVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const baseFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uAccent;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  float ring(float r, float at, float w) { return smoothstep(w, 0.0, abs(r - at)); }
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0) discard;
    float a = atan(c.y, c.x);
    float rim = ring(r, 0.96, 0.025);
    float dashes = ring(r, 0.82, 0.018) * step(0.5, fract(a * 6.0 / 3.14159 + uTime * 0.4));
    float ticks = ring(r, 0.7, 0.05) * step(0.85, fract(a * 36.0 / 3.14159));
    float pulse = ring(r, fract(uTime * 0.45), 0.04) * (1.0 - r);
    float inner = pow(1.0 - r, 2.5) * 0.9;
    float alpha = (rim + dashes * 0.8 + ticks * 0.6 + pulse + inner) * uOpacity;
    gl_FragColor = vec4(mix(uColor, uAccent, rim + pulse), clamp(alpha, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float fade = pow(1.0 - vUv.y, 1.6);
    float streaks = 0.6 + 0.4 * sin(vUv.x * 80.0 + uTime * 1.5) * sin(vUv.x * 23.0 - uTime);
    float alpha = fade * streaks * 0.22 * uOpacity;
    gl_FragColor = vec4(uColor * alpha, alpha);
    #include <colorspace_fragment>
  }
`;

const particlesVertex = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime;
  uniform float uSize;
  varying float vAlpha;
  void main() {
    float t = fract(aSeed.z + uTime * (0.08 + aSeed.z * 0.1));
    float ang = aSeed.x * 6.2831 + uTime * 0.3;
    float rad = 0.05 + aSeed.y * 0.3;
    vec3 p = vec3(cos(ang) * rad, t * 1.25, sin(ang) * rad);
    vAlpha = smoothstep(0.0, 0.1, t) * (1.0 - t);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * (0.5 + aSeed.y) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const particlesFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d) * vAlpha * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }
`;

const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export class Hologram {
  readonly group = new THREE.Group();
  heightMeters: number;
  userScale = 1;
  userRotation = 0;
  autoRotate = true;
  private t = 0;
  private sinceAppear = 0;
  private glitchTimer = 2;
  private glitch = 0;
  private uniforms: { uTime: { value: number }; uColor: { value: THREE.Color }; uAccent: { value: THREE.Color } };
  private figure = new THREE.Group();
  private base: THREE.Mesh;
  private baseMat: THREE.ShaderMaterial;
  private beamMat: THREE.ShaderMaterial;
  private particlesMat: THREE.ShaderMaterial;
  private figureMat: THREE.ShaderMaterial | null = null;

  constructor(opts: { color: string; accent: string; heightMeters: number }) {
    this.heightMeters = opts.heightMeters;
    this.group.visible = false;
    this.uniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(opts.color) },
      uAccent: { value: new THREE.Color(opts.accent) },
    };
    this.figure.position.y = FIGURE_LIFT;
    this.group.add(this.figure);

    this.baseMat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uOpacity: { value: 0 } },
      vertexShader: simpleVertex,
      fragmentShader: baseFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.base = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), this.baseMat);
    this.base.rotation.x = -Math.PI / 2;
    this.base.position.y = 0.002;
    this.base.renderOrder = 2;
    this.group.add(this.base);

    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uOpacity: { value: 0 } },
      vertexShader: simpleVertex,
      fragmentShader: beamFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const beamGeo = new THREE.CylinderGeometry(0.46, 0.4, 1.3, 64, 1, true);
    beamGeo.translate(0, 0.65, 0);
    const beam = new THREE.Mesh(beamGeo, this.beamMat);
    beam.renderOrder = 3;
    this.group.add(beam);

    const count = 160;
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    pgeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    this.particlesMat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uOpacity: { value: 0 }, uSize: { value: 40 } },
      vertexShader: particlesVertex,
      fragmentShader: particlesFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const points = new THREE.Points(pgeo, this.particlesMat);
    points.frustumCulled = false;
    points.renderOrder = 4;
    this.group.add(points);
    this.applyScale();
  }

  async load(url: string) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = 1 / size.y;
    const normalize = new THREE.Matrix4()
      .makeScale(s, s, s)
      .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));

    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uMap: { value: null }, uReveal: { value: 0 }, uOpacity: { value: 1 }, uGlitch: { value: 0 } },
      vertexShader: figureVertex,
      fragmentShader: figureFragment,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    // Passada só de profundidade: só a superfície da frente aparece.
    const depthMat = mat.clone();
    depthMat.uniforms = mat.uniforms;
    depthMat.transparent = false;
    depthMat.depthWrite = true;
    depthMat.colorWrite = false;

    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(normalize, mesh.matrixWorld));
      const src = mesh.material as THREE.MeshStandardMaterial;
      if (!mat.uniforms.uMap.value && src.map) mat.uniforms.uMap.value = src.map;
      const depth = new THREE.Mesh(geo, depthMat);
      depth.renderOrder = 0;
      const holo = new THREE.Mesh(geo, mat);
      holo.renderOrder = 1;
      this.figure.add(depth, holo);
    });
    if (!mat.uniforms.uMap.value) {
      const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      white.needsUpdate = true;
      mat.uniforms.uMap.value = white;
    }
    this.figureMat = mat;
  }

  appear() {
    this.group.visible = true;
    this.sinceAppear = 0;
  }

  hide() {
    this.group.visible = false;
  }

  rotateBy(rad: number) {
    this.userRotation += rad;
  }

  scaleBy(f: number) {
    this.userScale = THREE.MathUtils.clamp(this.userScale * f, 0.25, 3);
    this.applyScale();
  }

  setUserScale(v: number) {
    this.userScale = v;
    this.applyScale();
  }

  private applyScale() {
    this.group.scale.setScalar(this.heightMeters * this.userScale);
  }

  faceTowards(worldPos: THREE.Vector3) {
    const p = this.group.getWorldPosition(new THREE.Vector3());
    this.group.rotation.set(0, Math.atan2(worldPos.x - p.x, worldPos.z - p.z), 0);
  }

  update(dt: number) {
    this.t += dt;
    this.uniforms.uTime.value = this.t;
    if (!this.group.visible) return;
    const t = (this.sinceAppear += dt);
    const baseIn = easeOutCubic(Math.min(t / 0.5, 1));
    this.base.scale.setScalar(0.2 + 0.8 * baseIn);
    this.baseMat.uniforms.uOpacity.value = baseIn;
    this.beamMat.uniforms.uOpacity.value = clamp01((t - 0.3) / 0.6);
    this.particlesMat.uniforms.uOpacity.value = clamp01((t - 0.5) / 0.8);
    if (this.figureMat) {
      this.figureMat.uniforms.uReveal.value = t < 0.6 ? 0 : easeOutCubic(Math.min((t - 0.6) / 2.2, 1)) * 1.01;
      this.glitchTimer -= dt;
      if (this.glitchTimer <= 0) {
        this.glitch = 1;
        this.glitchTimer = 2.5 + Math.random() * 4;
      }
      this.glitch = Math.max(0, this.glitch - dt * 6);
      this.figureMat.uniforms.uGlitch.value = this.glitch;
    }
    this.figure.position.y = FIGURE_LIFT + Math.sin(this.t * 1.3) * 0.012;
    if (this.autoRotate) this.userRotation += dt * 0.35;
    this.figure.rotation.y = this.userRotation;
  }
}
