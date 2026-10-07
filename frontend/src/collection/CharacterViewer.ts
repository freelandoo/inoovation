// Visualizador do personagem coletado: câmara branca (imagem de fundo, object-fit
// cover) com o modelo sólido girando em cima do pedestal. Arrastar gira (com inércia);
// parado por um tempo, volta a girar sozinho.
//
// O canvas é transparente por cima da imagem; posição e escala do modelo saem do
// recorte "cover" da imagem, então os pés ficam no pedestal em qualquer proporção de tela.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FACE_FRONT, loadModel } from './model.ts';

// Medidas na imagem da câmara (1672x941): centro do topo do pedestal e altura do personagem.
const BG = { w: 1672, h: 941, feetX: 837, feetY: 563, figure: 400 };
const FOV = 24;

function contactShadow() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {},
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(0.12, 0.02, 0.02, a * a * 0.55); }',
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2), mat);
  m.position.y = 0.002;
  return m;
}

export class CharacterViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  private pivot = new THREE.Group();
  private spin = new THREE.Group();
  private clock = new THREE.Clock();
  private velocity = 0;
  private idle = 4;
  private enter = 0;
  private dragging = false;
  private lastX = 0;
  private ro: ResizeObserver;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement, private reduced: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1.5, 3, 2.5);
    const rim = new THREE.DirectionalLight(0xff2a2a, 1.4);
    rim.position.set(-2, 1.5, -2);
    this.scene.add(key, rim);

    this.spin.rotation.y = FACE_FRONT;
    this.pivot.add(this.spin, contactShadow());
    this.scene.add(this.pivot);

    this.bindDrag();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(canvas);
    this.layout();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  async show(modelUrl: string) {
    const model = await loadModel(modelUrl);
    if (this.disposed) return;
    this.spin.clear();
    this.spin.add(model);
    this.spin.rotation.y = FACE_FRONT;
    this.enter = this.reduced ? 1 : 0;
    this.idle = 4;
  }

  private bindDrag() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.velocity = 0;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      const r = dx * 0.012;
      this.spin.rotation.y += r;
      this.velocity = r * 60;
      this.idle = 0;
    });
    const up = () => (this.dragging = false);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  /** Câmera e posição do modelo a partir do recorte "cover" da imagem de fundo. */
  private layout() {
    const W = this.canvas.clientWidth || window.innerWidth;
    const H = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(W, H, false);
    const s = Math.max(W / BG.w, H / BG.h);
    const feetX = (W - BG.w * s) / 2 + BG.feetX * s;
    const feetY = (H - BG.h * s) / 2 + BG.feetY * s;
    const figurePx = BG.figure * s;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const dist = H / (figurePx * 2 * tan);
    const pxPerUnit = figurePx;
    this.camera.aspect = W / H;
    this.camera.position.set(0, 0, dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.pivot.position.set((feetX - W / 2) / pxPerUnit, -(feetY - H / 2) / pxPerUnit, 0);
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (!this.dragging) {
      this.idle += dt;
      this.velocity *= Math.exp(-dt * 3);
      const auto = this.idle > 2.5 && !this.reduced ? 0.5 : 0;
      this.spin.rotation.y += (this.velocity + auto * Math.min(1, (this.idle - 2.5) / 1.5)) * dt;
    }
    if (this.enter < 1) {
      this.enter = Math.min(1, this.enter + dt / 0.9);
      const e = 1 - Math.pow(1 - this.enter, 3);
      this.spin.scale.setScalar(0.6 + 0.4 * e);
      this.spin.position.y = (1 - e) * 0.35;
      this.spin.rotation.y += (1 - e) * dt * 9;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.ro.disconnect();
    this.renderer.setAnimationLoop(null);
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
