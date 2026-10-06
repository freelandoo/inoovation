// Modo da RA: rastreamento do rótulo (MindAR). O astronauta só existe enquanto a câmera
// reconhece o rótulo; nada do rótulo é desenhado, a tela mostra só o vídeo e o holograma.
//
// A biblioteca (tfjs embutido, ~2 MB) e os alvos compilados (public/ar/label.mind, gerados
// por scripts/build_ar_target.mjs) só são baixados quando a RA abre.

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
  update(dt: number): void;
  onResize?(w: number, h: number): void;
}

// ---------------------------------------------------------------- MindAR

interface MindArUpdate {
  type: 'updateMatrix' | 'processDone';
  targetIndex?: number;
  worldMatrix?: number[] | null;
}

interface MindArController {
  inputWidth: number;
  inputHeight: number;
  worker?: Worker;
  addImageTargets(url: string): Promise<{ dimensions: [number, number][] }>;
  dummyRun(input: HTMLVideoElement): void;
  processVideo(input: HTMLVideoElement): void;
  stopProcessVideo(): void;
  dispose(): void;
  getProjectionMatrix(): number[];
}

interface MindArModule {
  Controller: new (opts: {
    inputWidth: number;
    inputHeight: number;
    maxTrack?: number;
    filterMinCF?: number;
    filterBeta?: number;
    warmupTolerance?: number;
    missTolerance?: number;
    onUpdate?: (d: MindArUpdate) => void;
  }) => MindArController;
}

let libPromise: Promise<MindArModule> | null = null;
function loadMindAr(url: string) {
  // URL absoluta: em dev o Vite reescreve import('/…') de arquivos de public/ e recusa.
  const href = new URL(url, location.href).href;
  libPromise ??= (import(/* @vite-ignore */ href) as Promise<MindArModule>).catch((e: unknown) => {
    libPromise = null;
    throw e;
  });
  return libPromise;
}

// Posição do astronauta em cada alvo, em frações da altura do alvo (o MindAR entrega a
// pose em pixels do alvo, origem no canto inferior esquerdo, z saindo do rótulo).
const FEET_Y = 0.06;
const OUT_Z = 0.12;
const FIGURE_HEIGHT = 0.8;
// O modelo olha para -x; gira para encarar quem segura o celular (+z sai do rótulo).
const FACE_CAMERA = Math.PI / 2;

export type TrackState = 'scanning' | 'found';

export class ImageTrackingMode implements ArMode {
  private stream: MediaStream | null = null;
  private controller: MindArController | null = null;
  private anchor = new THREE.Group();
  private posts: THREE.Matrix4[] = [];
  private tracked = -1;
  private ctx!: ArCtx;

  constructor(
    private video: HTMLVideoElement,
    private opts: { libUrl: string; targetsUrl: string; heightMeters: number; onState: (s: TrackState) => void },
  ) {
    this.anchor.matrixAutoUpdate = false;
  }

  /** Câmera + biblioteca + alvos. Falha (câmera negada, sem WebGL) -> quem chamou cai na prévia. */
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    const v = this.video;
    v.srcObject = this.stream;
    v.setAttribute('playsinline', '');
    v.muted = true;
    await v.play();
    if (!v.videoWidth) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
    // O MindAR lê os atributos width/height do <video> (não videoWidth) para copiar o quadro.
    v.width = v.videoWidth;
    v.height = v.videoHeight;

    const { Controller } = await loadMindAr(this.opts.libUrl);
    const controller = new Controller({
      inputWidth: v.videoWidth,
      inputHeight: v.videoHeight,
      maxTrack: 1,
      // Menos tremor que o padrão, ao custo de um pouco de atraso.
      filterMinCF: 0.0001,
      filterBeta: 0.001,
      onUpdate: (d) => this.onUpdate(d),
    });
    this.controller = controller;
    const { dimensions } = await controller.addImageTargets(this.opts.targetsUrl);
    this.posts = dimensions.map(([w, h]) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(w / 2, h * FEET_Y, h * OUT_Z),
        new THREE.Quaternion(),
        new THREE.Vector3().setScalar((h * FIGURE_HEIGHT) / this.opts.heightMeters),
      ),
    );
    controller.dummyRun(v);
  }

  enter(ctx: ArCtx) {
    this.ctx = ctx;
    const h = ctx.hologram;
    ctx.camera.position.set(0, 0, 0);
    ctx.camera.quaternion.identity();
    h.group.position.set(0, 0, 0);
    h.group.rotation.set(0, FACE_CAMERA, 0);
    h.setUserScale(1);
    h.autoRotate = false;
    h.hide();
    this.anchor.add(h.group);
    ctx.scene.add(this.anchor);
    this.video.hidden = false;
    this.tracked = -1;
    this.opts.onState('scanning');
    this.controller?.processVideo(this.video);
  }

  exit() {
    const c = this.controller;
    if (c) {
      c.stopProcessVideo();
      c.dispose();
      c.worker?.terminate();
    }
    this.controller = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.video.hidden = true;
    if (this.ctx) {
      this.ctx.hologram.hide();
      this.ctx.scene.add(this.ctx.hologram.group);
      this.ctx.scene.remove(this.anchor);
    }
  }

  private onUpdate(d: MindArUpdate) {
    if (d.type !== 'updateMatrix' || d.targetIndex == null || !this.ctx) return;
    const i = d.targetIndex;
    if (d.worldMatrix) {
      this.anchor.matrix.fromArray(d.worldMatrix).multiply(this.posts[i]);
      this.anchor.matrixWorldNeedsUpdate = true;
      if (this.tracked === -1) {
        this.ctx.hologram.appear();
        navigator.vibrate?.(25);
        this.opts.onState('found');
      }
      this.tracked = i;
    } else if (this.tracked === i) {
      this.tracked = -1;
      this.ctx.hologram.hide();
      this.opts.onState('scanning');
    }
  }

  /** Câmera virtual com o mesmo campo de visão do vídeo (que ocupa a tela com object-fit: cover). */
  onResize(w: number, h: number) {
    const c = this.controller;
    const cam = this.ctx.camera;
    if (!c) return;
    const proj = c.getProjectionMatrix();
    const videoRatio = c.inputWidth / c.inputHeight;
    const shownH = videoRatio > w / h ? h : w / videoRatio;
    cam.fov = (2 * Math.atan((1 / proj[5]) * (h / shownH)) * 180) / Math.PI;
    cam.near = proj[14] / (proj[10] - 1);
    cam.far = proj[14] / (proj[10] + 1);
  }

  update() {}

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
    g.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, W, H);
    g.drawImage(canvas, 0, 0);
    return new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.9));
  }
}
