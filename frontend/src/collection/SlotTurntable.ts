// Personagens girando devagar nos slots da vitrine, sobre fundo branco, sem interação.
//
// Um único WebGLRenderer (fora da tela) desenha todos os slots: renderiza um por vez e
// copia o quadro para o <canvas> 2D de cada card. Muitos contextos WebGL (um por slot)
// estourariam o limite e a memória do iPhone. Só desenha os slots visíveis, a ~30 fps.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FACE_FRONT, loadModel } from './model.ts';

const FOV = 30;
// Modelo ocupa ~66% da altura do card e fica na parte de cima (embaixo vai o nome).
const FILL = 0.66;
const CENTER_FROM_TOP = 0.38;
const SPEED = 0.45; // rad/s
const FRAME_MS = 1000 / 30;

interface Slot {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  spin: THREE.Group;
  visible: boolean;
  onReady: () => void;
  ready: boolean;
}

export class SlotTurntable {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  private slots: Slot[] = [];
  private io: IntersectionObserver;
  private raf = 0;
  private last = 0;
  private paused = false;

  constructor(private reduced: boolean) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0xffffff, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(1.5, 3, 2.5);
    this.scene.add(key);

    const H = 1 / FILL;
    const dist = H / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const ndcY = 1 - 2 * CENTER_FROM_TOP;
    const targetY = 0.5 - (ndcY * H) / 2;
    this.camera.position.set(0, targetY, dist);
    this.camera.lookAt(0, targetY, 0);

    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const s = this.slots.find((x) => x.canvas === e.target);
        if (s) s.visible = e.isIntersecting;
      }
      this.loop();
    });
  }

  async add(canvas: HTMLCanvasElement, modelUrl: string, onReady: () => void) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const model = (await loadModel(modelUrl)).clone();
    const spin = new THREE.Group();
    spin.add(model);
    spin.rotation.y = FACE_FRONT;
    spin.visible = false;
    this.scene.add(spin);
    const slot: Slot = { canvas, ctx, spin, visible: false, onReady, ready: false };
    this.slots.push(slot);
    this.io.observe(canvas);
  }

  /** Para de desenhar (ex.: câmara branca aberta por cima). */
  setPaused(v: boolean) {
    this.paused = v;
    this.loop();
  }

  clear() {
    for (const s of this.slots) {
      this.io.unobserve(s.canvas);
      this.scene.remove(s.spin);
    }
    this.slots = [];
  }

  private loop() {
    const active = !this.paused && this.slots.some((s) => s.visible);
    if (active && !this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
    if (!active && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private frame(now: number) {
    this.raf = 0;
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    if (now - this.last >= FRAME_MS || !this.last) {
      this.last = now;
      const dpr = Math.min(window.devicePixelRatio, 2);
      for (const s of this.slots) {
        if (!s.visible) continue;
        const w = Math.round(s.canvas.clientWidth * dpr);
        const h = Math.round(s.canvas.clientHeight * dpr);
        if (!w || !h) continue;
        if (s.canvas.width !== w || s.canvas.height !== h) {
          s.canvas.width = w;
          s.canvas.height = h;
        }
        if (!this.reduced) s.spin.rotation.y += SPEED * dt;
        const size = this.renderer.getSize(new THREE.Vector2());
        if (size.x !== w || size.y !== h) this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        s.spin.visible = true;
        this.renderer.render(this.scene, this.camera);
        s.spin.visible = false;
        s.ctx.clearRect(0, 0, w, h);
        s.ctx.drawImage(this.renderer.domElement, 0, 0);
        if (!s.ready) {
          s.ready = true;
          s.onReady();
        }
      }
    }
    this.loop();
  }

  dispose() {
    this.clear();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.io.disconnect();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
