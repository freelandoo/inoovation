// Shaders do gêmeo digital do rótulo. Representação visual dos acabamentos
// físicos: não pretende reproduzir com precisão o comportamento da impressão.

const common = /* glsl */ `
  #define ASPECT 2.7272
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 hash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  // Células de "bolha" do casting holográfico.
  float bubbles(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float md = 1.0;
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 r = g + hash2(i + g) - f;
        md = min(md, dot(r, r));
      }
    return sqrt(md);
  }
  // Holográfico na paleta da campanha: prata, branco, vermelho + aberração espectral mínima.
  vec3 holoPalette(float t) {
    float s = 0.5 + 0.5 * cos(6.2831 * t);
    vec3 c = mix(vec3(0.72, 0.74, 0.77), vec3(1.0), s);
    c = mix(c, vec3(1.0, 0.1, 0.08), smoothstep(0.6, 0.97, 0.5 + 0.5 * cos(6.2831 * (t * 0.5 + 0.25))));
    c += 0.05 * vec3(cos(6.2831 * t), cos(6.2831 * (t + 0.33)), cos(6.2831 * (t + 0.66)));
    return c;
  }
  vec2 xf(vec4 t, vec2 uv) { return (uv - 0.5) * t.xy + 0.5 + t.zw; }
  float inside01(vec2 q) { return step(0.0, q.x) * step(0.0, q.y) * step(q.x, 1.0) * step(q.y, 1.0); }
`;

export const labelVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vPosW;
  varying vec3 vN;
  varying vec3 vT;
  varying vec3 vB;
  varying float vFront;
  void main() {
    vUv = uv;
    vFront = normal.z;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    mat3 m = mat3(modelMatrix);
    vN = normalize(m * normal);
    vT = normalize(m * vec3(1.0, 0.0, 0.0));
    vB = normalize(m * vec3(0.0, 1.0, 0.0));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const labelFragment = /* glsl */ `
  uniform sampler2D tBase;
  uniform sampler2D tUnder;
  uniform sampler2D tTex;
  uniform sampler2D tRelief;
  uniform sampler2D tHolo;
  uniform sampler2D tLum;
  uniform sampler2D tPhoto;
  // 0 underprint, 1 texture, 2 relief, 3 holographic, 4 luminescent, 5 photoluminescent
  uniform vec4 uXf[6];
  uniform vec2 uTexel;
  uniform vec3 uLightPos;
  uniform vec3 uLightColor;
  uniform float uLightIntensity;
  uniform float uAmbient;
  uniform float uScan;
  uniform float uScanWidth;
  uniform float uScanIntensity;
  uniform float uReveal;
  uniform float uCharge;
  uniform float uEffects;
  uniform float uLumBase;
  uniform float uQrFocus;
  uniform vec4 uQr;
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uRed;
  uniform vec3 uRedHot;
  uniform vec3 uPhotoColor;

  varying vec2 vUv;
  varying vec3 vPosW;
  varying vec3 vN;
  varying vec3 vT;
  varying vec3 vB;
  varying float vFront;

  ${common}

  float mask(sampler2D s, vec4 t, vec2 uv) {
    vec2 q = xf(t, uv);
    return texture2D(s, q).r * inside01(q);
  }

  void main() {
    vec3 V = normalize(cameraPosition - vPosW);

    if (vFront < 0.0) {
      // Verso: filme metálico escuro.
      float f = pow(1.0 - abs(dot(normalize(vN), V)), 3.0);
      gl_FragColor = vec4(vec3(0.04) + f * 0.25, uOpacity);
      #include <colorspace_fragment>
      return;
    }

    vec2 uv = vUv;
    vec3 base = texture2D(tBase, uv).rgb;
    float under = mask(tUnder, uXf[0], uv);
    float tex = mask(tTex, uXf[1], uv);
    float holo = mask(tHolo, uXf[3], uv);
    float lum = mask(tLum, uXf[4], uv);
    float photo = mask(tPhoto, uXf[5], uv);
    float fx = uEffects;

    // Relevo: normal a partir do mapa de altura (máscara suavizada).
    vec2 q = xf(uXf[2], uv);
    float h = texture2D(tRelief, q).r * inside01(q);
    float hx = texture2D(tRelief, q + vec2(uTexel.x, 0.0)).r - texture2D(tRelief, q - vec2(uTexel.x, 0.0)).r;
    float hy = texture2D(tRelief, q + vec2(0.0, uTexel.y)).r - texture2D(tRelief, q - vec2(0.0, uTexel.y)).r;
    vec3 nL = vec3(-hx * 2.4 * fx, -hy * 2.4 * fx, 1.0);

    // Verniz textura: micro-normal granulada só dentro da máscara.
    vec2 gp = uv * vec2(420.0, 154.0);
    float g1 = noise(gp);
    float g2 = noise(gp + 17.3);
    nL.xy += (vec2(g1, g2) - 0.5) * 0.28 * tex * fx;
    nL = normalize(nL);
    vec3 N = normalize(vT * nL.x + vB * nL.y + normalize(vN) * nL.z);

    vec3 L = normalize(uLightPos - vPosW);
    vec3 H = normalize(L + V);
    float ndl = max(dot(N, L), 0.0);
    float ndh = max(dot(N, H), 0.0);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

    // Sem calço branco = substrato metálico aparente (rótulo metalizado).
    float metal = (1.0 - under) * fx;
    float gloss = mix(mix(36.0, 150.0, h), 9.0, tex);
    float specAmt = mix(mix(0.1, 0.7, max(h, metal * 0.5)), 0.25, tex);
    vec3 specTint = mix(vec3(1.0), base * 1.7 + 0.08, metal * 0.7);
    float spec = pow(ndh, gloss) * specAmt;

    // Scanner: fonte de luz física que explica todos os efeitos.
    float scan = exp(-pow((uv.x - uScan) / uScanWidth, 2.0)) * uScanIntensity;
    vec3 Lr = normalize(vT * -sign(uv.x - uScan + 1e-4) + normalize(vN) * 0.3);
    float rake = max(dot(N, Lr), 0.0);
    float reliefEdge = clamp(length(vec2(hx, hy)) * 7.0, 0.0, 1.0);

    float amb = mix(0.07, 1.0, uAmbient);
    vec3 col = base * (0.66 * amb + 0.42 * ndl * uLightIntensity * amb);
    col += specTint * spec * uLightColor * uLightIntensity * (0.35 + 0.65 * amb);
    col += metal * fres * 0.1 * uLightColor * amb;

    col += base * scan * uRed * 0.8;
    col += uRedHot * scan * (reliefEdge * 1.4 * rake + tex * 0.3 * g1) * fx;
    col += vec3(1.0, 0.86, 0.82) * scan * pow(ndh, 18.0) * h * 0.9 * fx;

    // Linha visível do scanner + halo suave.
    float dx = uv.x - uScan;
    col += uRedHot * (exp(-pow(dx / 0.0025, 2.0)) * 1.6 + exp(-pow(dx / 0.05, 2.0)) * 0.12) * uScanIntensity;
    col += vec3(1.0, 0.9, 0.88) * exp(-pow(dx / 0.0012, 2.0)) * 0.7 * uScanIntensity;

    if (holo > 0.01) {
      vec3 R = reflect(-V, N);
      float ang = dot(R, vT) * 0.6 + dot(R, vB) * 0.4 + dot(N, V) * 0.8;
      float bub = bubbles(uv * vec2(90.0, 33.0));
      float phase = ang * 2.4 + bub * 0.45 + uv.x * 1.2 + uv.y * 0.5;
      vec3 irid = holoPalette(phase);
      float hl = 0.28 + spec * 3.0 + scan * 1.3 + fres * 0.9 + (1.0 - bub) * 0.12;
      col = mix(col, col * 0.7 + irid * hl * amb * 0.8, holo * 0.38 * fx);
    }

    float lumDrive = uLumBase + scan * 2.0;
    col += uRedHot * lum * lumDrive * fx;

    col += uPhotoColor * photo * uCharge * ((1.0 - uAmbient) * 1.5 + 0.02) * fx;

    // Revelação da arte (entrada do hero): metal escuro até a linha passar.
    float hidden = smoothstep(uReveal - 0.05, uReveal, uv.x);
    vec3 darkMetal = vec3(0.028) + spec * 0.7 * uLightColor + fres * 0.18;
    col = mix(col, darkMetal, hidden);
    float edge = exp(-pow((uv.x - uReveal) / 0.006, 2.0)) * step(0.001, uReveal) * step(uReveal, 0.999);
    col += uRedHot * edge * 2.2;

    // Foco no QR impresso (narrativa; o QR nunca é decodificado).
    vec2 qc = (uQr.xy + uQr.zw) * 0.5;
    vec2 qs = (uQr.zw - uQr.xy) * 0.5;
    vec2 d = abs(uv - qc) - qs;
    float boxd = max(d.x * ASPECT, d.y);
    float inQr = 1.0 - smoothstep(0.0, 0.006, boxd);
    float frame = exp(-pow((boxd - 0.018) / 0.003, 2.0));
    col = mix(col, col * (0.18 + 0.82 * inQr), uQrFocus);
    col += uRedHot * frame * uQrFocus * (0.75 + 0.25 * sin(uTime * 6.0));
    float qy = mix(uQr.y, uQr.w, fract(uTime * 0.7));
    col += uRedHot * exp(-pow((uv.y - qy) / 0.004, 2.0)) * inQr * uQrFocus;

    gl_FragColor = vec4(col, uOpacity);
    #include <colorspace_fragment>
  }
`;

/** Camada isolada da vista explodida. KIND definido via defines. */
export const layerFragment = /* glsl */ `
  uniform sampler2D tMask;
  uniform vec4 uXf;
  uniform vec2 uTexel;
  uniform vec3 uLightPos;
  uniform float uOpacity;
  uniform float uTime;
  uniform vec3 uRed;
  uniform vec3 uRedHot;
  uniform vec3 uPhotoColor;
  varying vec2 vUv;
  varying vec3 vPosW;
  varying vec3 vN;
  varying vec3 vT;
  varying vec3 vB;
  varying float vFront;

  ${common}

  void main() {
    vec2 q = xf(uXf, vUv);
    float m = texture2D(tMask, q).r * inside01(q);
    vec3 V = normalize(cameraPosition - vPosW);
    vec3 c;
    float a = m;

    #if KIND == 0
      c = vec3(0.96, 0.96, 0.95);
      a *= 0.78;
    #elif KIND == 1
      float g = noise(vUv * vec2(700.0, 257.0));
      c = vec3(0.42 + 0.4 * g);
      a *= 0.8;
    #elif KIND == 2
      float hx = texture2D(tMask, q + vec2(uTexel.x, 0.0)).r - texture2D(tMask, q - vec2(uTexel.x, 0.0)).r;
      float hy = texture2D(tMask, q + vec2(0.0, uTexel.y)).r - texture2D(tMask, q - vec2(0.0, uTexel.y)).r;
      vec3 N = normalize(vT * -hx * 3.0 + vB * -hy * 3.0 + normalize(vN));
      vec3 L = normalize(uLightPos - vPosW);
      float spec = pow(max(dot(N, normalize(L + V)), 0.0), 40.0);
      c = vec3(0.62) * (0.4 + 0.6 * max(dot(N, L), 0.0)) + spec;
      a = smoothstep(0.08, 0.45, m) * 0.92;
    #elif KIND == 3
      vec3 R = reflect(-V, normalize(vN));
      float phase = dot(R, vT) * 2.0 + dot(R, vB) + bubbles(vUv * vec2(150.0, 55.0)) * 0.5 + vUv.x;
      c = holoPalette(phase) * 0.95;
      a *= 0.85;
    #elif KIND == 4
      c = uRedHot * (1.2 + 0.3 * sin(uTime * 3.0 + vUv.x * 12.0));
    #else
      c = uPhotoColor * 1.3;
    #endif

    // Contorno fino: mostra o formato da camada mesmo onde a máscara é vazia.
    vec2 e = min(vUv, 1.0 - vUv) * vec2(ASPECT, 1.0);
    float border = 1.0 - smoothstep(0.0, 0.006, min(e.x, e.y));
    c = mix(c, uRed, border * (1.0 - a));
    a = max(a, border * 0.55);

    gl_FragColor = vec4(c, a * uOpacity);
    #include <colorspace_fragment>
  }
`;
