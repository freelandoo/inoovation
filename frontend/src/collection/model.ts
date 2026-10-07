// Modelos 3D dos personagens: carregados uma vez e normalizados (altura 1, pés em y=0,
// centrado). Quem precisa de mais de uma cópia na tela usa clone() (mesma geometria).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// O modelo olha para -x; este giro deixa ele de frente para a câmera.
export const FACE_FRONT = Math.PI / 2;

const models = new Map<string, Promise<THREE.Group>>();
export function loadModel(url: string) {
  let p = models.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url).then((gltf) => {
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const s = 1 / size.y;
      const holder = new THREE.Group();
      root.scale.setScalar(s);
      root.position.set(-center.x * s, -box.min.y * s, -center.z * s);
      holder.add(root);
      return holder;
    });
    p.catch(() => models.delete(url));
    models.set(url, p);
  }
  return p;
}

