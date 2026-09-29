// Palco único: um renderer, uma câmera, uma cena para a página inteira.
// Rótulo, portal, partículas e astronauta vivem aqui. A RA reaproveita o mesmo
// renderer quando é aberta (ver src/ar/launch.ts).

import * as THREE from 'three';
import type { PerfProfile } from '../perf/tier.ts';

export interface Updatable {
  update(dt: number, time: number): void;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  readonly canvas: HTMLCanvasElement;
  /** Tamanho visível no plano z=0, em unidades de mundo (atualizado no resize). */
  readonly view = { width: 1, height: 1, aspect: 1 };
  private items = new Set<Updatable>();
  private clock = new THREE.Clock();
  private dpr: number;
  private slowFrames = 0;
  private running = false;
  private visible = true;
  onResize?: () => void;

  constructor(canvas: HTMLCanvasElement, private perf: PerfProfile) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: perf.tier === 'high',
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.dpr = Math.min(window.devicePixelRatio || 1, perf.maxDpr);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera.position.set(0, 0, 10);

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      this.visible = document.visibilityState === 'visible';
      if (this.visible) this.clock.getDelta();
    });
    this.resize();
  }

  add(item: Updatable) {
    this.items.add(item);
  }

  resize() {
    if (this.renderer.xr.isPresenting) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dist = this.camera.position.z;
    this.view.height = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.view.width = this.view.height * this.camera.aspect;
    this.view.aspect = this.camera.aspect;
    this.onResize?.();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** Para o loop (ex.: enquanto a RA usa o renderer). */
  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private tick() {
    if (!this.visible) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    for (const it of this.items) it.update(dt, t);
    this.renderer.render(this.scene, this.camera);
    this.adaptDpr(dt);
  }

  /** Reduz a resolução automaticamente se o aparelho não sustentar ~45 fps. */
  private adaptDpr(dt: number) {
    if (dt > 1 / 40) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 45 && this.dpr > 0.75) {
      this.dpr = Math.max(0.75, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.resize();
      this.slowFrames = 0;
    }
  }

  get profile() {
    return this.perf;
  }
}
