// DigitalLabelTwin: o rótulo físico real da Innovation Week como objeto 3D.
//
//  group (posição/escala/rotação vindas do Director)
//   └ tilt (inclinação por cursor/toque, limitada a ±4° X / ±7° Y)
//      ├ body   extrusão com espessura ~1,4 mm, bisel e borda metálica escura
//      │        face da frente = shader que combina base + 6 acabamentos
//      └ layers planos coplanares da vista explodida (um por acabamento)

import * as THREE from 'three';
import {
  LABEL_WORLD,
  QR_UV,
  explodedOrder,
  labelAssets,
  labelLayers,
  layerUvTransform,
  type LayerKey,
} from './labelConfig.ts';
import { labelFragment, labelVertex, layerFragment } from './labelShaders.ts';

const MASK_ORDER: LayerKey[] = ['underprint', 'texture', 'relief', 'holographic', 'luminescent', 'photoluminescent'];
const KIND: Record<LayerKey, number> = {
  underprint: 0,
  texture: 1,
  relief: 2,
  holographic: 3,
  luminescent: 4,
  photoluminescent: 5,
};

export interface LabelState {
  reveal: number; // 0..1 revelação da arte
  explode: number; // 0..1 vista explodida
  qrFocus: number; // 0..1 destaque do QR
  ambient: number; // 0..1 luz ambiente (0 = "lights off")
  scan: number; // posição do scanner em UV x (-0.3..1.3); fora disso = desligado
  scanIntensity: number;
  opacity: number;
}

function blackTexture() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export class DigitalLabelTwin {
  readonly group = new THREE.Group();
  readonly tilt = new THREE.Group();
  readonly state: LabelState = {
    reveal: 0,
    explode: 0,
    qrFocus: 0,
    ambient: 1,
    scan: -1,
    scanIntensity: 0,
    opacity: 1,
  };
  /** Carga do fotoluminescente (0..1): enche com luz, decai no escuro. */
  charge = 0;
  loaded = false;
  masksLoaded = false;

  private material: THREE.ShaderMaterial;
  private layerMeshes: { key: LayerKey; mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];
  private tiltTarget = new THREE.Vector2();
  private lightTarget = new THREE.Vector3(1.2, 0.8, 3);
  private lightPos = new THREE.Vector3(1.2, 0.8, 3);
  private loader = new THREE.TextureLoader();
  private effects = 0;
  private autoLight: boolean;
  private tmp = new THREE.Vector3();

  constructor(
    private renderer: THREE.WebGLRenderer,
    opts: { autoLight: boolean },
  ) {
    this.autoLight = opts.autoLight;
    const black = blackTexture();
    const W = LABEL_WORLD.width;
    const H = LABEL_WORLD.height;

    this.material = new THREE.ShaderMaterial({
      vertexShader: labelVertex,
      fragmentShader: labelFragment,
      transparent: true,
      toneMapped: false,
      uniforms: {
        tBase: { value: black },
        tUnder: { value: black },
        tTex: { value: black },
        tRelief: { value: black },
        tHolo: { value: black },
        tLum: { value: black },
        tPhoto: { value: black },
        uXf: { value: MASK_ORDER.map((k) => new THREE.Vector4(...layerUvTransform(labelLayers[k]))) },
        uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 381) },
        uLightPos: { value: this.lightPos },
        uLightColor: { value: new THREE.Color('#fff4f0') },
        uLightIntensity: { value: 1 },
        uAmbient: { value: 1 },
        uScan: { value: -1 },
        uScanWidth: { value: 0.035 },
        uScanIntensity: { value: 0 },
        uReveal: { value: 0 },
        uCharge: { value: 0 },
        uEffects: { value: 0 },
        uLumBase: { value: 0.05 },
        uQrFocus: { value: 0 },
        uQr: { value: new THREE.Vector4(QR_UV.x0, QR_UV.y0, QR_UV.x1, QR_UV.y1) },
        uTime: { value: 0 },
        uOpacity: { value: 1 },
        uRed: { value: new THREE.Color('#ff1616') },
        uRedHot: { value: new THREE.Color('#ff3030') },
        uPhotoColor: { value: new THREE.Color('#fff1ea') },
      },
    });

    // Corpo com espessura e bisel. Grupo 0 = faces (shader), grupo 1 = laterais.
    const shape = roundedRect(W, H, LABEL_WORLD.cornerRadius);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: LABEL_WORLD.thickness,
      bevelEnabled: true,
      bevelThickness: 0.003,
      bevelSize: 0.003,
      bevelSegments: 2,
      curveSegments: 6,
    });
    geo.translate(0, 0, -LABEL_WORLD.thickness / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) + W / 2) / W, (pos.getY(i) + H / 2) / H);
    }
    uv.needsUpdate = true;
    geo.computeVertexNormals();
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.85, roughness: 0.32 });
    const body = new THREE.Mesh(geo, [this.material, edgeMat]);
    body.renderOrder = 5;
    this.tilt.add(body);

    // Camadas da vista explodida.
    const planeGeo = new THREE.PlaneGeometry(W * 0.998, H * 0.998);
    for (const { key } of explodedOrder) {
      if (key === 'base') continue;
      const additive = key === 'luminescent' || key === 'photoluminescent';
      const mat = new THREE.ShaderMaterial({
        vertexShader: labelVertex,
        fragmentShader: layerFragment,
        defines: { KIND: KIND[key] },
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          tMask: { value: black },
          uXf: { value: new THREE.Vector4(...layerUvTransform(labelLayers[key])) },
          uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 381) },
          uLightPos: { value: this.lightPos },
          uOpacity: { value: 0 },
          uTime: this.material.uniforms.uTime,
          uRed: this.material.uniforms.uRed,
          uRedHot: this.material.uniforms.uRedHot,
          uPhotoColor: this.material.uniforms.uPhotoColor,
        },
      });
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 6 + this.layerMeshes.length;
      this.tilt.add(mesh);
      this.layerMeshes.push({ key, mesh, mat });
    }

    this.group.add(this.tilt);
    this.group.visible = false;
  }

  private loadTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
    return this.loader.loadAsync(url).then((t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      return t;
    });
  }

  /** 1º a arte base (bloqueia só o rótulo), depois máscaras em segundo plano. */
  async load(preferLarge: boolean) {
    const baseUrl = preferLarge ? labelAssets.base.desktop : labelAssets.base.mobile;
    this.material.uniforms.tBase.value = await this.loadTexture(baseUrl, true);
    this.loaded = true;
    this.group.visible = true;
    if (!preferLarge) {
      // Troca para 2048 quando ocioso (o zoom no QR precisa de nitidez).
      const idle = (cb: () => void) =>
        'requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 2500);
      idle(() => {
        this.loadTexture(labelAssets.base.desktop, true)
          .then((t) => {
            const old = this.material.uniforms.tBase.value as THREE.Texture;
            this.material.uniforms.tBase.value = t;
            old.dispose();
          })
          .catch(() => {});
      });
    }
  }

  async loadMasks() {
    const uniformFor: Record<LayerKey, string> = {
      underprint: 'tUnder',
      texture: 'tTex',
      relief: 'tRelief',
      holographic: 'tHolo',
      luminescent: 'tLum',
      photoluminescent: 'tPhoto',
    };
    await Promise.all(
      MASK_ORDER.map(async (key) => {
        const tex = await this.loadTexture(labelAssets.masks[key], false);
        this.material.uniforms[uniformFor[key]].value = tex;
        const layer = this.layerMeshes.find((l) => l.key === key);
        if (layer) layer.mat.uniforms.tMask.value = tex;
        const img = tex.image as { width?: number; height?: number } | undefined;
        if (key === 'relief' && img?.width && img.height) {
          (this.material.uniforms.uTexel.value as THREE.Vector2).set(1 / img.width, 1 / img.height);
        }
      }),
    );
    this.masksLoaded = true;
  }

  /** Entrada de ponteiro normalizada (-1..1). Controla tilt e direção da luz. */
  setPointer(nx: number, ny: number) {
    this.tiltTarget.set(-ny * THREE.MathUtils.degToRad(4), nx * THREE.MathUtils.degToRad(7));
    this.lightTarget.set(nx * 2.6, -ny * 1.6 + 0.3, 2.6);
  }

  setAutoLight(v: boolean) {
    this.autoLight = v;
  }

  /** Posição de mundo de um ponto UV da face da frente. */
  worldPointForUv(u: number, v: number, zOffset = 0, target = new THREE.Vector3()) {
    target.set((u - 0.5) * LABEL_WORLD.width, (v - 0.5) * LABEL_WORLD.height, LABEL_WORLD.thickness / 2 + zOffset);
    return this.tilt.localToWorld(target);
  }

  qrWorldCenter(target = new THREE.Vector3()) {
    return this.worldPointForUv((QR_UV.x0 + QR_UV.x1) / 2, (QR_UV.y0 + QR_UV.y1) / 2, 0, target);
  }

  /** Deslocamento Z de cada camada da vista explodida (unidades locais). */
  layerOffset(index: number): number {
    const n = this.layerMeshes.length;
    const e = THREE.MathUtils.clamp(this.state.explode * (n + 1) - index, 0, 1);
    const ease = e * e * (3 - 2 * e);
    return LABEL_WORLD.thickness / 2 + 0.004 + ease * (index + 1) * 0.2;
  }

  layerCount() {
    return this.layerMeshes.length;
  }

  update(dt: number, t: number) {
    const u = this.material.uniforms;
    const s = this.state;
    u.uTime.value = t;

    // Tilt e luz com amortecimento (sensação física, não segue o cursor "colado").
    const k = 1 - Math.exp(-dt * 5);
    this.tilt.rotation.x += (this.tiltTarget.x - this.tilt.rotation.x) * k;
    this.tilt.rotation.y += (this.tiltTarget.y - this.tilt.rotation.y) * k;
    if (this.autoLight) {
      this.lightTarget.set(Math.sin(t * 0.45) * 2.4, Math.cos(t * 0.31) * 0.9 + 0.3, 2.6);
    }
    // Durante o scan, a luz acompanha o scanner.
    const scanning = s.scanIntensity > 0.05 && s.scan > -0.2 && s.scan < 1.2;
    const lx = scanning ? (s.scan - 0.5) * LABEL_WORLD.width : this.lightTarget.x;
    this.tmp.set(lx, this.lightTarget.y, this.lightTarget.z);
    this.tilt.localToWorld(this.tmp);
    this.lightPos.lerp(this.tmp, 1 - Math.exp(-dt * 6));

    // Fotoluminescente: CHARGE (luz) -> DARKNESS -> AFTERGLOW (~6 s).
    if (s.ambient > 0.7) this.charge = Math.min(1, this.charge + dt * 0.8);
    this.charge = Math.min(1, this.charge + s.scanIntensity * dt * 1.5);
    if (s.ambient < 0.5) this.charge *= Math.exp(-dt / 6);

    this.effects += ((this.masksLoaded ? 1 : 0) - this.effects) * (1 - Math.exp(-dt * 2));

    u.uReveal.value = s.reveal >= 0.999 ? 1.2 : s.reveal * 1.1;
    u.uAmbient.value = s.ambient;
    u.uScan.value = s.scan;
    u.uScanIntensity.value = s.scanIntensity;
    u.uCharge.value = this.charge;
    u.uEffects.value = this.effects * (1 - s.explode * 0.85);
    u.uQrFocus.value = s.qrFocus;
    u.uOpacity.value = s.opacity;
    u.uLumBase.value = 0.006 + (1 - s.ambient) * 0.035;

    this.group.visible = this.loaded && s.opacity > 0.01;

    const layersOn = s.explode > 0.001 && this.masksLoaded;
    this.layerMeshes.forEach((l, i) => {
      l.mesh.visible = layersOn;
      if (!layersOn) return;
      l.mesh.position.z = this.layerOffset(i);
      const e = THREE.MathUtils.clamp(s.explode * (this.layerMeshes.length + 1) - i, 0, 1);
      l.mat.uniforms.uOpacity.value = Math.min(1, e * 1.5) * s.opacity;
    });
  }
}
