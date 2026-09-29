// Modos da RA:
//  - WebXRMode: Chrome/Android com ARCore. Detecta o chão e ancora o holograma (6DoF).
//  - CameraMode: qualquer celular (inclui iPhone). Vídeo da câmera + giroscópio (3DoF).

import * as THREE from 'three';
import type { Hologram } from './hologram.ts';

export interface ArCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  hologram: Hologram;
}

export interface ArMode {
  enter(ctx: ArCtx): void;
  exit(): void;
  update(dt: number, frame?: XRFrame): void;
  onResize?(w: number, h: number): void;
}

export async function isWebXRArSupported(): Promise<boolean> {
  try {
    return !!(await navigator.xr?.isSessionSupported('immersive-ar'));
  } catch {
    return false;
  }
}

/** iOS exige que isto rode direto no clique, antes de qualquer await. */
export function requestOrientationPermission(): Promise<boolean> {
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
  if (DOE && typeof DOE.requestPermission === 'function') {
    return DOE.requestPermission()
      .then((r) => r === 'granted')
      .catch(() => false);
  }
  return Promise.resolve(!!DOE);
}

// ---------------------------------------------------------------- Câmera

const EYE_HEIGHT = 1.45;
const DISTANCE = 3.8;
const zee = new THREE.Vector3(0, 0, 1);
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();

function orientationToQuaternion(out: THREE.Quaternion, a: number, b: number, g: number, screenAngle: number) {
  euler.set(b, a, -g, 'YXZ');
  out.setFromEuler(euler);
  out.multiply(q1);
  out.multiply(q0.setFromAxisAngle(zee, -screenAngle));
  return out;
}

export class CameraMode implements ArMode {
  private stream: MediaStream | null = null;
  private target = new THREE.Quaternion();
  private hasOrientation = false;
  private placed = false;
  private mirrored = false;
  private ctx!: ArCtx;
  private fallbackTimer = 0;
  private onOrient = (e: DeviceOrientationEvent) => this.handleOrientation(e);

  constructor(private video: HTMLVideoElement) {}

  async start(orientationGranted: boolean) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play();
    this.mirrored = this.stream.getVideoTracks()[0]?.getSettings?.().facingMode === 'user';
    this.video.classList.toggle('mirrored', this.mirrored);
    if (orientationGranted) window.addEventListener('deviceorientation', this.onOrient);
  }

  enter(ctx: ArCtx) {
    this.ctx = ctx;
    this.placed = false;
    this.hasOrientation = false;
    ctx.camera.position.set(0, 0, 0);
    ctx.camera.quaternion.identity();
    // Sem noção de chão/escala real neste modo: começa menor para caber inteiro na tela.
    ctx.hologram.setUserScale(0.72);
    ctx.hologram.autoRotate = true;
    ctx.hologram.hide();
    this.video.hidden = false;
    this.fallbackTimer = window.setTimeout(() => this.place(), 600);
  }

  exit() {
    clearTimeout(this.fallbackTimer);
    window.removeEventListener('deviceorientation', this.onOrient);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.video.hidden = true;
  }

  onResize(w: number, h: number) {
    this.ctx.camera.fov = w < h ? 62 : 42;
  }

  private handleOrientation(e: DeviceOrientationEvent) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const d = THREE.MathUtils.DEG2RAD;
    const angle = (screen.orientation?.angle ?? 0) * d;
    orientationToQuaternion(this.target, e.alpha * d, e.beta * d, e.gamma * d, angle);
    if (!this.hasOrientation) {
      this.hasOrientation = true;
      this.ctx.camera.quaternion.copy(this.target);
      this.place();
    }
  }

  private place() {
    if (this.placed) return;
    clearTimeout(this.fallbackTimer);
    this.placed = true;
    const { camera, hologram } = this.ctx;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize().multiplyScalar(DISTANCE);
    hologram.group.position.set(fwd.x, -EYE_HEIGHT, fwd.z);
    hologram.faceTowards(new THREE.Vector3(0, -EYE_HEIGHT, 0));
    hologram.appear();
    navigator.vibrate?.(25);
  }

  recenter() {
    this.placed = false;
    this.place();
  }

  update(dt: number) {
    if (!this.hasOrientation) return;
    this.ctx.camera.quaternion.slerp(this.target, 1 - Math.exp(-dt * 18));
  }

  /** Foto: vídeo + holograma num JPEG. */
  capture(canvas: HTMLCanvasElement, render: () => void): Promise<Blob | null> {
    const v = this.video;
    render();
    const W = canvas.width;
    const H = canvas.height;
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const g = out.getContext('2d')!;
    const vr = v.videoWidth / v.videoHeight;
    const cr = W / H;
    let sw = v.videoWidth;
    let sh = v.videoHeight;
    if (vr > cr) sw = sh * cr;
    else sh = sw / cr;
    g.save();
    if (this.mirrored) {
      g.translate(W, 0);
      g.scale(-1, 1);
    }
    g.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, W, H);
    g.restore();
    g.drawImage(canvas, 0, 0);
    return new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.9));
  }
}

// ---------------------------------------------------------------- WebXR

function buildReticle(color: string) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
      void main(){
        float r = length(vUv - 0.5) * 2.0;
        float a = atan(vUv.y - 0.5, vUv.x - 0.5);
        float ring = smoothstep(0.06, 0.0, abs(r - 0.85));
        float dash = smoothstep(0.04, 0.0, abs(r - 0.6)) * step(0.5, fract(a * 4.0 / 3.14159 + uTime));
        float dot_ = smoothstep(0.12, 0.08, r);
        float alpha = ring + dash * 0.8 + dot_;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uColor, alpha);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4).rotateX(-Math.PI / 2), mat);
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  return mesh;
}

export type XrState = 'searching' | 'ready' | 'placed';

export class WebXRMode implements ArMode {
  private reticle: THREE.Mesh;
  private session: XRSession | null = null;
  private hitTestSource: XRHitTestSource | null = null;
  private placed = false;
  private ctx!: ArCtx;

  constructor(
    private opts: { overlayRoot: HTMLElement; color: string; onState: (s: XrState) => void; onEnd: () => void },
  ) {
    this.reticle = buildReticle(opts.color);
  }

  /** Recebe a sessão já pedida no clique (ver launch.ts). */
  async attach(ctx: ArCtx, session: XRSession) {
    this.ctx = ctx;
    const { renderer } = ctx;
    this.session = session;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
    const viewer = await session.requestReferenceSpace('viewer');
    this.hitTestSource = (await session.requestHitTestSource?.({ space: viewer })) ?? null;
    session.addEventListener('select', () => this.placeAtReticle());
    session.addEventListener('end', () => this.cleanup());
  }

  enter(ctx: ArCtx) {
    this.ctx = ctx;
    ctx.scene.add(this.reticle);
    ctx.hologram.hide();
    ctx.hologram.setUserScale(1);
    ctx.hologram.autoRotate = false;
    this.placed = false;
    this.opts.onState('searching');
  }

  exit() {
    this.ctx.scene.remove(this.reticle);
    this.session?.end().catch(() => {});
  }

  private cleanup() {
    this.hitTestSource?.cancel();
    this.hitTestSource = null;
    this.session = null;
    this.ctx.renderer.xr.enabled = false;
    this.ctx.scene.remove(this.reticle);
    this.opts.onEnd();
  }

  reposition() {
    this.placed = false;
    this.ctx.hologram.hide();
    this.opts.onState('searching');
  }

  private placeAtReticle() {
    if (this.placed || !this.reticle.visible) return;
    const { hologram, camera } = this.ctx;
    hologram.group.position.setFromMatrixPosition(this.reticle.matrix);
    hologram.faceTowards(camera.getWorldPosition(new THREE.Vector3()));
    hologram.appear();
    this.placed = true;
    this.reticle.visible = false;
    navigator.vibrate?.(30);
    this.opts.onState('placed');
  }

  update(dt: number, frame?: XRFrame) {
    (this.reticle.material as THREE.ShaderMaterial).uniforms.uTime.value += dt;
    if (!frame || this.placed || !this.hitTestSource) return;
    const ref = this.ctx.renderer.xr.getReferenceSpace();
    if (!ref) return;
    const hits = frame.getHitTestResults(this.hitTestSource);
    const pose = hits[0]?.getPose(ref);
    if (pose) {
      this.reticle.matrix.fromArray(pose.transform.matrix);
      if (!this.reticle.visible) this.opts.onState('ready');
      this.reticle.visible = true;
    } else {
      if (this.reticle.visible) this.opts.onState('searching');
      this.reticle.visible = false;
    }
  }
}
