// Astronauta oficial da campanha (modelo 3D do traje) para o hero:
// metal escuro recortado pela luz vermelha do eclipse.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class Astronaut {
  readonly group = new THREE.Group();
  opacity = 0;
  private materials: THREE.MeshStandardMaterial[] = [];
  private pointer = new THREE.Vector2();
  private yaw = 0;
  loaded = false;

  constructor(scene: THREE.Scene) {
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-3, 3, 6);
    const rim = new THREE.DirectionalLight(0xff2222, 5);
    rim.position.set(2, 2, -6);
    const rim2 = new THREE.DirectionalLight(0xff3a2a, 3);
    rim2.position.set(-3, 1, -5);
    const fill = new THREE.HemisphereLight(0x401010, 0x050505, 0.8);
    scene.add(key, rim, rim2, fill);
    this.group.visible = false;
  }

  async load(url: string) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // normaliza: altura 1, pés em y=0, centrado
    root.position.set(-center.x, -box.min.y, -center.z);
    const holder = new THREE.Group();
    holder.add(root);
    holder.scale.setScalar(1 / size.y);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      m.envMapIntensity = 0.45;
      m.metalness = 0.55;
      m.roughness = 0.42;
      m.color.multiplyScalar(0.85);
      this.materials.push(m);
    });
    this.group.add(holder);
    this.loaded = true;
  }

  setPointer(nx: number, ny: number) {
    this.pointer.set(nx, ny);
  }

  update(dt: number, t: number) {
    this.group.visible = this.loaded && this.opacity > 0.01;
    if (!this.group.visible) return;
    const transparent = this.opacity < 0.999;
    for (const m of this.materials) {
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = this.opacity;
      m.depthWrite = !transparent;
    }
    this.yaw += (this.pointer.x * 0.25 - this.yaw) * (1 - Math.exp(-dt * 3));
    const inner = this.group.children[0];
    if (inner) {
      // a frente do modelo aponta para -X: +90° o vira para a câmera, com leve três-quartos
      inner.rotation.y = Math.PI / 2 - 0.3 + this.yaw + Math.sin(t * 0.4) * 0.05;
      inner.position.y = Math.sin(t * 0.9) * 0.01;
    }
  }
}
