// Astronauta do jogo: o modelo oficial riggado (astronaut-rig.glb, gerado por
// scripts/build_astronaut_rig.py) dentro de um wrapper que aplica orientação,
// inclinação e animações sem tocar no asset. O jetpack é preso ao osso Spine2:
// acompanha o corpo em qualquer animação, e o fogo sai dos dois bocais na
// direção dos pés.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Particles } from './particles.ts';

type Clip = 'idle' | 'fly' | 'impact';

const MODEL_SCALE = 1.35;

/** Posições no espaço do osso Spine2 (m): +Y sobe a coluna, -Z são as costas. */
const PACK_CENTER = new THREE.Vector3(0, -0.02, -0.2);
const NOZZLES = [new THREE.Vector3(-0.055, -0.15, -0.21), new THREE.Vector3(0.055, -0.15, -0.21)];

function flameMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPower: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uPower;
      void main() {
        // vUv.y = 1 no bocal, 0 na ponta da chama
        float along = vUv.y;
        float flick = 0.8 + 0.2 * sin(uTime * 60.0 + vUv.x * 25.0) * sin(uTime * 37.0);
        float core = smoothstep(0.35, 1.0, along);
        vec3 col = mix(vec3(1.0, 0.22, 0.02), vec3(1.0, 0.85, 0.35), core);
        col = mix(col, vec3(1.0, 1.0, 0.9), smoothstep(0.85, 1.0, along));
        float a = pow(along, 1.4) * flick * uPower;
        gl_FragColor = vec4(col * a * 1.6, a);
      }`,
  });
}

export class AstronautView {
  /** Posicionado pelo jogo no ponto (x, y) da simulação. */
  readonly root = new THREE.Group();
  /** Inclinação/vibração, separada do posicionamento. */
  private body = new THREE.Group();
  private model!: THREE.Object3D;
  private mixer!: THREE.AnimationMixer;
  private actions = {} as Record<Clip, THREE.AnimationAction>;
  private current: Clip | null = null;
  private spine: THREE.Bone | null = null;
  private flames: THREE.Mesh[] = [];
  private flameMat = flameMaterial();
  private glow: THREE.Sprite[] = [];
  private nozzleWorld = [new THREE.Vector3(), new THREE.Vector3()];
  private dirWorld = new THREE.Vector3();
  private power = 0;
  private emitAcc = 0;
  private pitch = 0;
  private tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private fire: Particles,
    private smoke: Particles,
    private glowMap: THREE.Texture,
  ) {
    this.root.add(this.body);
    scene.add(this.root);
  }

  async load(url: string, onProgress?: (ratio: number) => void) {
    const gltf = await new GLTFLoader().loadAsync(url, (e) => {
      if (e.total) onProgress?.(e.loaded / e.total);
    });
    this.model = gltf.scene;
    // Nas animações do Mixamo o personagem olha para +Z; o percurso anda em +X.
    this.model.rotation.y = Math.PI / 2;
    this.model.scale.setScalar(MODEL_SCALE);
    // Centro do corpo na pose de voo (medido no Blender) vai para a origem do wrapper.
    this.model.position.set(-0.06 * MODEL_SCALE, -0.455 * MODEL_SCALE, 0);
    this.model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isMesh) {
        mesh.frustumCulled = false;
        const m = mesh.material as THREE.MeshStandardMaterial;
        m.envMapIntensity = 1.6;
      }
      if ((o as THREE.Bone).isBone && /Spine2$/.test(o.name)) this.spine = o as THREE.Bone;
    });
    this.body.add(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) {
      const name = clip.name as Clip;
      const a = this.mixer.clipAction(clip);
      if (name === 'impact') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions[name] = a;
    }
    if (this.spine) this.buildJetpack(this.spine);
    this.play('idle', 0);
  }

  private buildJetpack(spine: THREE.Bone) {
    // O osso está na escala do modelo; o jetpack é medido em metros do modelo original.
    const pack = new THREE.Group();
    pack.position.copy(PACK_CENTER);
    const shell = new THREE.MeshStandardMaterial({ color: 0xe9eaec, metalness: 0.55, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d21, metalness: 0.8, roughness: 0.4 });
    const red = new THREE.MeshBasicMaterial({ color: 0xff1a12 });
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.09), shell);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.025, 0.092), red);
    stripe.position.y = 0.05;
    pack.add(tank, stripe);
    for (const n of NOZZLES) {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.04, 0.07, 12, 1, true), dark);
      nozzle.position.copy(n).sub(PACK_CENTER).add(new THREE.Vector3(0, 0.02, 0));
      pack.add(nozzle);
      // Chama: cone apontando para -Y do osso (pés), com a base no bocal.
      const geo = new THREE.ConeGeometry(0.045, 0.5, 14, 1, true);
      geo.rotateX(Math.PI); // ponta para baixo
      geo.translate(0, -0.25, 0);
      const flame = new THREE.Mesh(geo, this.flameMat);
      flame.position.copy(n);
      flame.renderOrder = 5;
      spine.add(flame);
      this.flames.push(flame);
      const g = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glowMap, color: 0xff7a2a, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      g.position.copy(n).add(new THREE.Vector3(0, -0.04, 0));
      g.scale.setScalar(0.3);
      spine.add(g);
      this.glow.push(g);
    }
    spine.add(pack);
  }

  play(clip: Clip, fade = 0.25) {
    if (this.current === clip || !this.actions[clip]) return;
    const next = this.actions[clip];
    next.reset().setEffectiveWeight(1).play();
    if (this.current) next.crossFadeFrom(this.actions[this.current], fade, false);
    this.current = clip;
  }

  setTimeScale(s: number) {
    if (this.current) this.actions[this.current].timeScale = s;
  }

  /**
   * thrust: jetpack ligado; vy: velocidade vertical (inclinação);
   * mode: estado visual do personagem.
   */
  update(dt: number, time: number, thrust: boolean, vy: number, mode: 'ready' | 'play' | 'empty' | 'dead') {
    if (!this.mixer) return;
    this.mixer.update(dt);

    // Inclinação: sobe de nariz para cima, cai de nariz para baixo.
    const target = mode === 'ready' ? 0 : mode === 'dead' ? this.pitch : THREE.MathUtils.clamp(vy * 0.05, -0.38, 0.3);
    this.pitch += (target - this.pitch) * (1 - Math.exp(-dt * 9));
    this.body.rotation.z = this.pitch;
    // Vibração do equipamento com o jetpack ligado.
    const shake = thrust ? 0.012 : 0;
    this.body.position.set(Math.sin(time * 83) * shake, Math.cos(time * 71) * shake, 0);
    if (mode === 'ready') this.body.position.y += Math.sin(time * 2) * 0.06;

    // Potência da chama: sobe rápido, apaga com um rabicho curto.
    const want = thrust ? 1 : mode === 'ready' ? 0.12 : 0;
    this.power += (want - this.power) * (1 - Math.exp(-dt * (thrust ? 30 : 12)));
    this.flameMat.uniforms.uPower.value = this.power;
    this.flameMat.uniforms.uTime.value = time;
    const len = 0.35 + this.power * 0.9 + Math.sin(time * 50) * 0.05 * this.power;
    for (const f of this.flames) {
      f.visible = this.power > 0.02;
      f.scale.set(0.8 + this.power * 0.5, len, 0.8 + this.power * 0.5);
    }
    for (const g of this.glow) {
      g.visible = this.power > 0.02;
      g.scale.setScalar(0.18 + this.power * 0.4);
      g.material.opacity = Math.min(1, this.power * 1.4);
    }

    if (this.spine && this.power > 0.05) this.emitTrail(dt, thrust);
  }

  private emitTrail(dt: number, thrust: boolean) {
    const spine = this.spine!;
    spine.updateWorldMatrix(true, false);
    for (let i = 0; i < 2; i++) this.nozzleWorld[i].copy(NOZZLES[i]).applyMatrix4(spine.matrixWorld);
    this.dirWorld.set(0, -1, 0).transformDirection(spine.matrixWorld);
    this.emitAcc += dt * (thrust ? 90 : 20);
    while (this.emitAcc >= 1) {
      this.emitAcc -= 1;
      const n = this.nozzleWorld[(Math.random() * 2) | 0];
      const sp = 3 + Math.random() * 2.5;
      const j = () => (Math.random() - 0.5) * 0.9;
      this.tmp.copy(this.dirWorld);
      this.fire.emit({
        x: n.x, y: n.y, z: n.z,
        vx: this.tmp.x * sp + j() - 2.5, vy: this.tmp.y * sp + j(), vz: this.tmp.z * sp + j(),
        life: 0.18 + Math.random() * 0.14, size: 0.16 + Math.random() * 0.1,
        c0: [1, 0.75, 0.3], c1: [0.9, 0.12, 0.02], drag: 3, grow: 0.6,
      });
      if (Math.random() < 0.3) {
        this.smoke.emit({
          x: n.x, y: n.y, z: n.z,
          vx: this.tmp.x * sp * 0.4 - 1.5, vy: this.tmp.y * sp * 0.4 + 0.3, vz: j(),
          life: 0.6 + Math.random() * 0.4, size: 0.25, c0: [0.35, 0.33, 0.33], c1: [0.1, 0.1, 0.11], drag: 2, grow: 2.2,
        });
      }
    }
  }

  /** Fumaça e faíscas de quando o jetpack é desligado. */
  puff() {
    if (!this.spine) return;
    for (const n of this.nozzleWorld) {
      for (let i = 0; i < 6; i++) {
        this.smoke.emit({
          x: n.x, y: n.y, z: n.z,
          vx: -1 + (Math.random() - 0.5), vy: -0.5 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.6,
          life: 0.5 + Math.random() * 0.3, size: 0.18, c0: [0.4, 0.38, 0.37], c1: [0.08, 0.08, 0.09], drag: 2.5, grow: 2,
        });
      }
    }
  }

  /** Posição de mundo do pacote, para efeitos (explosão, faíscas). */
  packWorld(out: THREE.Vector3) {
    if (!this.spine) return out.copy(this.root.position);
    return out.copy(PACK_CENTER).applyMatrix4(this.spine.matrixWorld);
  }
}
