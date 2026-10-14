// Renderizador, câmera e luzes do jogo. A câmera é lateral, em perspectiva com
// pouca distorção, e enquadra sempre a mesma largura de mundo (VIEW_WIDTH): o
// tempo de reação é igual em qualquer celular. Telas mais altas mostram mais
// cenário acima e abaixo, nunca mais percurso à frente.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { PerfProfile } from '../../perf/tier.ts';
import { TUNING } from '../sim/tuning.ts';

/** Largura do mundo visível no plano do jogo (m). */
export const VIEW_WIDTH = 9.5;
/** Posição horizontal do astronauta na tela (fração a partir da esquerda). */
export const PLAYER_SCREEN_X = 0.26;
/** Altura mínima visível (m): faixa de 13 m + espaço do HUD em cima e da dica embaixo. */
const MIN_VIEW_HEIGHT = 18;
const FOV = 36;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 9 / 16, 0.5, 260);
  /** Altura visível no plano do jogo (m), recalculada no resize. */
  viewHeight = 16;
  viewWidth = VIEW_WIDTH;
  private shake = 0;
  private host: HTMLElement;

  constructor(canvas: HTMLCanvasElement, host: HTMLElement, perf: PerfProfile) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: perf.tier === 'high',
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, perf.mobile ? Math.min(perf.maxDpr, 1.75) : perf.maxDpr));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(0x020306);
    this.scene.fog = new THREE.Fog(0x020306, 34, 125);

    // Reflexos do metal: ambiente gerado uma vez, sem textura externa.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    // O ambiente é uma sala clara: forte demais deixa todo metal cinza-claro.
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-4, 8, 10);
    const rim = new THREE.DirectionalLight(0xff2a1a, 3.2);
    rim.position.set(6, 2, -8);
    const fill = new THREE.HemisphereLight(0x5a6a88, 0x120404, 0.55);
    this.scene.add(key, rim, fill);

    this.resize();
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Celular (mais estreito que 9:16): largura fixa. Telas mais largas ganham um
    // pouco de largura para não apertar a faixa jogável sob o HUD.
    this.viewHeight = Math.max(VIEW_WIDTH / aspect, MIN_VIEW_HEIGHT);
    this.viewWidth = this.viewHeight * aspect;
    this.camera.position.z = this.viewHeight / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    this.camera.updateProjectionMatrix();
  }

  /** Meia largura visível a uma profundidade z (para reciclar cenário). */
  halfWidthAt(z: number) {
    return (this.camera.position.z - z) * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * this.camera.aspect;
  }

  addShake(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  /** Posiciona a câmera seguindo o astronauta (x interpolado) e desenha. */
  render(playerX: number, dt: number, time: number) {
    const cam = this.camera;
    const mid = (TUNING.floor + TUNING.ceiling) / 2;
    // Um pouco acima do centro: o HUD fica sobre o céu, não sobre o percurso.
    cam.position.x = playerX + this.viewWidth * (0.5 - PLAYER_SCREEN_X);
    cam.position.y = mid + (this.viewHeight - 15.5) * 0.1;
    if (this.shake > 0.001) {
      cam.position.x += Math.sin(time * 71) * this.shake * 0.35;
      cam.position.y += Math.cos(time * 53) * this.shake * 0.35;
      this.shake *= Math.exp(-dt * 7);
    }
    cam.lookAt(cam.position.x, cam.position.y, 0);
    this.renderer.render(this.scene, cam);
  }

  dispose() {
    this.renderer.dispose();
  }
}
