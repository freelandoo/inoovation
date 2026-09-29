// EnergyPortal / InnovationEnergyCore: eclipse vermelho com corona, ruído,
// descargas e colapso para o centro (clique no CTA da RA).

import * as THREE from 'three';

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uCollapse;
  uniform float uHover;
  uniform float uDetail;
  uniform vec3 uRed;
  uniform vec3 uHot;
  uniform vec3 uDeep;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      if (float(i) >= uDetail) break;
      v += a * noise(p);
      p = p * 2.03 + 11.7;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float t = uTime;
    // distorção leve
    p += 0.012 * vec2(noise(p * 3.0 + t * 0.2), noise(p * 3.0 - t * 0.2)) - 0.006;
    float r = length(p);
    float a = atan(p.y, p.x);
    float R = 0.36 * (1.0 - uCollapse * 0.97) * (1.0 + uHover * 0.03);

    // coordenadas polares periódicas para o ruído não ter costura
    vec2 pc = vec2(cos(a), sin(a));
    float n = fbm(pc * 2.2 + vec2(r * 4.0 - t * 0.22, t * 0.05));
    float n2 = fbm(pc * 5.0 + vec2(r * 10.0 - t * 0.5, 0.0));

    float limb = exp(-pow((r - R) / (0.01 + 0.018 * n), 2.0));
    float corona = exp(-max(r - R, 0.0) * 5.0 / (0.35 + 0.9 * n)) * smoothstep(R - 0.01, R + 0.01, r);
    float inner = exp(-max(R - r, 0.0) * 18.0) * step(r, R);

    // descargas: arcos finos intermitentes junto à borda
    float flick = step(0.82, noise(vec2(a * 3.0, floor(t * 7.0))));
    float arcR = R + 0.03 + 0.06 * fbm(pc * 6.0 + t * 1.5);
    float arcs = pow(max(0.0, 1.0 - abs(r - arcR) * 90.0), 3.0) * flick;

    // superfície do planeta: vermelho profundo com relevo
    float disk = smoothstep(R, R - 0.004, r);
    float surf = fbm(p * 7.0 + 3.0);
    vec3 planet = uDeep * (0.08 + 0.22 * surf) * smoothstep(0.0, R, r) + uRed * inner * 0.35;

    vec3 col = uRed * (corona * (0.7 + 0.7 * n2) + arcs * 1.4) + uHot * limb * 1.6;
    col += uDeep * exp(-r * 1.8) * 0.35;
    col *= uIntensity * (1.0 + uCollapse * 2.5 + uHover * 0.35);
    col = mix(col, planet * uIntensity + uHot * limb * 1.4 * uIntensity, disk);
    col += uHot * uCollapse * uCollapse * exp(-r * 6.0) * 3.0;

    float edgeFade = smoothstep(1.0, 0.7, r);
    float alpha = clamp(max(max(col.r, col.g), disk * 0.97), 0.0, 1.0) * edgeFade;
    gl_FragColor = vec4(col * edgeFade, alpha);
    #include <colorspace_fragment>
  }
`;

export class EnergyPortal {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  /** Raio do anel em unidades de mundo (o plano é dimensionado a partir dele). */
  radius = 1;
  intensity = 1;
  collapse = 0;
  hover = 0;
  private hoverTarget = 0;

  constructor(detail: number) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uCollapse: { value: 0 },
        uHover: { value: 0 },
        uDetail: { value: detail },
        uRed: { value: new THREE.Color('#ff1616') },
        uHot: { value: new THREE.Color('#ff5a4a') },
        uDeep: { value: new THREE.Color('#8e0000') },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = -10;
    this.mesh.position.z = -6;
  }

  setHover(v: boolean) {
    this.hoverTarget = v ? 1 : 0;
  }

  update(dt: number, t: number) {
    this.hover += (this.hoverTarget - this.hover) * (1 - Math.exp(-dt * 6));
    const u = this.material.uniforms;
    u.uTime.value = t;
    u.uIntensity.value = this.intensity;
    u.uCollapse.value = this.collapse;
    u.uHover.value = this.hover;
    // plano de lado S => raio R=0.36 no espaço [-1,1] => S = radius / 0.36 * 2 / 2
    const s = this.radius / 0.36;
    this.mesh.scale.set(s * 2, s * 2, 1);
    this.mesh.visible = this.intensity > 0.005;
  }
}
