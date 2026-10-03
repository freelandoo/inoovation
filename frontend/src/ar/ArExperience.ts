// Módulo RA embutido (carregado sob demanda). Reaproveita o renderer da página.
//
// Ordem de tentativa:
//   1. WebXR immersive-ar (Android/Chrome): holograma ancorado no chão.
//   2. Câmera + giroscópio (iPhone e demais): holograma sobre o vídeo.
//   3. Prévia 3D sem câmera (desktop, câmera negada): holograma na tela.
// Sempre oferece também o AR nativo (Quick Look no iPhone, Scene Viewer no Android).

import * as THREE from 'three';
import './ar.css';
import { config } from '../config.ts';
import { Hologram } from './hologram.ts';
import { CameraMode, WebXRMode, type ArCtx, type ArMode, type XrState } from './modes.ts';
import type { ArIdentity, LaunchOptions } from './launch.ts';

interface OpenArgs extends LaunchOptions {
  identity: ArIdentity;
  root: HTMLElement;
  sessionPromise: Promise<XRSession> | null;
  orientationPromise: Promise<boolean> | null;
}

class PreviewMode implements ArMode {
  private ctx!: ArCtx;
  enter(ctx: ArCtx) {
    this.ctx = ctx;
    const h = ctx.hologram;
    h.group.position.set(0, 0, 0);
    h.group.rotation.set(0, 0, 0);
    h.setUserScale(1);
    h.autoRotate = true;
    h.appear();
    this.onResize(window.innerWidth, window.innerHeight);
  }
  exit() {}
  update() {}
  onResize(w: number, h: number) {
    const H = this.ctx.hologram.heightMeters;
    const cam = this.ctx.camera;
    cam.fov = 40;
    const dist = w / h < 1 ? H * 2.9 : H * 2.2;
    cam.position.set(0, H * 0.55, dist);
    cam.lookAt(0, H * 0.48, 0);
  }
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function attachGestures(el: HTMLElement, onRotate: (r: number) => void, onScale: (f: number) => void) {
  const pts = new Map<number, { x: number; y: number }>();
  let last = 0;
  const dist = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  el.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) last = dist();
  });
  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pts.size === 1) onRotate(dx * 0.012);
    else if (pts.size === 2) {
      const d = dist();
      if (last > 0) onScale(d / last);
      last = d;
    }
  });
  const up = (e: PointerEvent) => {
    pts.delete(e.pointerId);
    last = pts.size === 2 ? dist() : 0;
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

let hologramCache: Promise<Hologram> | null = null;
function getHologram() {
  hologramCache ??= (async () => {
    const h = new Hologram({ color: config.ar.color, accent: config.ar.accent, heightMeters: config.ar.heightMeters });
    await h.load(config.ar.modelGlb);
    return h;
  })();
  return hologramCache;
}

export async function openArExperience(args: OpenArgs): Promise<void> {
  const { root, identity, renderer } = args;
  if (!renderer) throw new Error('WebGL indisponível');

  const unit = identity.unitId ? `UNIDADE // ${identity.unitId}` : 'RA // AO VIVO';
  root.innerHTML = `
    <video class="arx-video" playsinline muted hidden></video>
    <div class="arx-ui">
      <header class="arx-top">
        <button class="arx-icon" data-a="close" aria-label="Fechar experiência">✕</button>
        <span class="arx-chip"></span>
      </header>
      <p class="arx-hint" aria-live="polite"></p>
      <footer class="arx-bottom">
        <button class="arx-icon" data-a="recenter" aria-label="Reposicionar holograma">⟲</button>
        <button class="arx-shutter" data-a="photo" aria-label="Tirar foto"></button>
        <a class="arx-native" data-a="native" hidden>RA nativa</a>
      </footer>
    </div>
    <div class="arx-loading"><i></i><span>CARREGANDO HOLOGRAMA…</span></div>`;
  root.querySelector('.arx-chip')!.textContent = unit;
  root.hidden = false;
  document.documentElement.classList.add('ar-open');

  const video = root.querySelector<HTMLVideoElement>('.arx-video')!;
  const hint = root.querySelector<HTMLElement>('.arx-hint')!;
  const loading = root.querySelector<HTMLElement>('.arx-loading')!;
  const photoBtn = root.querySelector<HTMLButtonElement>('[data-a="photo"]')!;
  const recenterBtn = root.querySelector<HTMLButtonElement>('[data-a="recenter"]')!;
  const nativeLink = root.querySelector<HTMLAnchorElement>('[data-a="native"]')!;
  const setHint = (s: string) => (hint.textContent = s);

  // AR nativo como alternativa.
  if (isIOS()) {
    nativeLink.rel = 'ar';
    nativeLink.href = config.ar.modelUsdz;
    nativeLink.innerHTML = '<img alt="" width="1" height="1" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="/>RA nativa';
    nativeLink.hidden = false;
  } else if (/Android/i.test(navigator.userAgent)) {
    const glb = new URL(config.ar.modelGlb, location.href).href;
    nativeLink.href = `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(glb)}&mode=ar_preferred&title=Innovation%20Week#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(location.href)};end;`;
    nativeLink.hidden = false;
  }
  root.querySelectorAll('button, a').forEach((b) => b.addEventListener('beforexrselect', (e) => e.preventDefault()));

  args.pauseLanding();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 60);
  const prevClear = renderer.getClearAlpha();
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);

  let mode: ArMode | null = null;
  let closed = false;
  const clock = new THREE.Clock();
  const hologramP = getHologram();

  const resize = () => {
    if (renderer.xr.isPresenting) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    mode?.onResize?.(w, h);
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);

  const close = () => {
    if (closed) return;
    closed = true;
    mode?.exit();
    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', resize);
    renderer.xr.enabled = false;
    renderer.toneMapping = prevTone;
    renderer.setClearColor(0x000000, prevClear);
    hologramP.then((h) => scene.remove(h.group)).catch(() => {});
    root.hidden = true;
    root.innerHTML = '';
    document.documentElement.classList.remove('ar-open');
    args.resumeLanding();
  };
  root.querySelector('[data-a="close"]')!.addEventListener('click', close);

  let hologram: Hologram;
  try {
    hologram = await hologramP;
  } catch (e) {
    close();
    throw e;
  }
  scene.add(hologram.group);
  loading.hidden = true;
  const ctx: ArCtx = { renderer, scene, camera, hologram };
  attachGestures(root, (r) => hologram.rotateBy(r), (f) => hologram.scaleBy(f));

  const setMode = (m: ArMode) => {
    mode?.exit();
    mode = m;
    m.enter(ctx);
    resize();
  };

  renderer.setAnimationLoop((_t, frame) => {
    const dt = Math.min(clock.getDelta(), 0.1);
    mode?.update(dt, frame);
    hologram.update(dt);
    renderer.render(scene, camera);
  });

  // 1) WebXR
  if (args.sessionPromise) {
    try {
      const session = await args.sessionPromise;
      const xr = new WebXRMode({
        overlayRoot: root,
        color: config.ar.color,
        onState: (s: XrState) =>
          setHint(s === 'searching' ? 'Mova o celular devagar para encontrar o chão' : s === 'ready' ? 'Toque para projetar o holograma' : 'Arraste para girar · pinça para ampliar'),
        onEnd: close,
      });
      root.dataset.mode = 'xr';
      await xr.attach(ctx, session);
      setMode(xr);
      recenterBtn.onclick = () => xr.reposition();
      return;
    } catch {
      /* cai para o modo câmera */
    }
  }

  // 2) Câmera
  const cam = new CameraMode(video);
  try {
    const granted = (await args.orientationPromise) ?? false;
    await cam.start(granted);
    root.dataset.mode = 'camera';
    setMode(cam);
    setHint('Arraste para girar · pinça para ampliar');
    recenterBtn.onclick = () => cam.recenter();
    photoBtn.onclick = async () => {
      const blob = await cam.capture(renderer.domElement, () => renderer.render(scene, camera));
      if (!blob) return;
      const file = new File([blob], 'innovation-week.jpg', { type: 'image/jpeg' });
      if (navigator.canShare?.({ files: [file] })) {
        navigator.share({ files: [file], title: 'Innovation Week' }).catch(() => {});
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
    };
    return;
  } catch {
    /* câmera negada ou indisponível */
  }

  // 3) Prévia 3D
  root.dataset.mode = 'preview';
  setMode(new PreviewMode());
  setHint('Câmera indisponível. Veja o holograma aqui ou use a RA nativa.');
}
