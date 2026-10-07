// Módulo RA embutido (carregado sob demanda). Reaproveita o renderer da página.
//
// Ordem de tentativa:
//   1. Rastreamento do rótulo: o astronauta só aparece quando a câmera reconhece o
//      rótulo e fica ancorado nele (some quando o rótulo sai do quadro).
//   2. Prévia 3D sem câmera (desktop, câmera negada, sem suporte): holograma na tela,
//      com o AR nativo (Quick Look no iPhone, Scene Viewer no Android) como alternativa.

import * as THREE from 'three';
import './ar.css';
import { config } from '../config.ts';
import { Hologram } from './hologram.ts';
import { ImageTrackingMode, type ArCtx, type ArMode, type TrackState } from './modes.ts';
import { play } from '../audio/sfx.ts';
import type { ArIdentity, LaunchOptions } from './launch.ts';

interface OpenArgs extends LaunchOptions {
  identity: ArIdentity;
  root: HTMLElement;
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
    cam.near = 0.01;
    cam.far = 60;
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
      <div class="arx-frame" aria-hidden="true" hidden><i></i><i></i><i></i><i></i></div>
      <p class="arx-hint" aria-live="polite"></p>
      <button class="arx-collect" data-a="collect" type="button" hidden><span>COLECIONAR</span></button>
      <footer class="arx-bottom">
        <span></span>
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
  const frame = root.querySelector<HTMLElement>('.arx-frame')!;
  const collectBtn = root.querySelector<HTMLButtonElement>('[data-a="collect"]')!;
  const nativeLink = root.querySelector<HTMLAnchorElement>('[data-a="native"]')!;
  const setHint = (s: string) => (hint.textContent = s);

  // AR nativo como alternativa (só na prévia: não depende do rótulo).
  const offerNativeAr = () => {
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
  };

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
  hologram.resetSolid();
  const ctx: ArCtx = { renderer, scene, camera, hologram };
  attachGestures(root, (r) => hologram.rotateBy(r), (f) => hologram.scaleBy(f));

  const setMode = (m: ArMode) => {
    mode?.exit();
    mode = m;
    m.enter(ctx);
    resize();
  };

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    mode?.update(dt);
    hologram.update(dt);
    renderer.render(scene, camera);
  });

  // 1) Rastreamento do rótulo
  loading.querySelector('span')!.textContent = 'PREPARANDO A CÂMERA…';
  const track = new ImageTrackingMode(video, {
    libUrl: config.ar.trackingLib,
    targetsUrl: config.ar.trackingTargets,
    heightMeters: config.ar.heightMeters,
    onState: (st) => {
      frame.hidden = st !== 'scanning';
      trackState = st;
      if (collect) syncCollect();
      else setHint(st === 'scanning' ? 'Aponte a câmera para o rótulo' : 'Arraste para girar · pinça para ampliar');
    },
  });

  // Colecionar → (linha sobe, vira sólido) → Pegar → fecha e vai para a vitrine.
  const collect = args.collect;
  let trackState: TrackState = 'scanning';
  let stage: 'idle' | 'solidifying' | 'ready' | 'taking' = 'idle';
  const syncCollect = () => {
    const found = trackState === 'found';
    const label = collectBtn.querySelector('span')!;
    collectBtn.hidden = !found || stage === 'solidifying' || stage === 'taking';
    collectBtn.classList.toggle('take', stage === 'ready');
    label.textContent = stage === 'ready' ? 'PEGAR' : 'COLECIONAR';
    if (!found) setHint('Aponte a câmera para o rótulo');
    else if (stage === 'idle') setHint('Seu personagem chegou. Toque em COLECIONAR para materializá-lo.');
    else if (stage === 'solidifying') setHint('Materializando…');
    else if (stage === 'ready') setHint('Ele é seu. Toque em PEGAR para guardar na sua coleção.');
  };
  collectBtn.addEventListener('click', async () => {
    if (!collect || trackState !== 'found') return;
    if (stage === 'idle') {
      stage = 'solidifying';
      syncCollect();
      play('charge');
      await hologram.solidify();
      if (closed) return;
      play('lock');
      navigator.vibrate?.([20, 40, 20]);
      stage = 'ready';
      syncCollect();
    } else if (stage === 'ready') {
      stage = 'taking';
      syncCollect();
      setHint('');
      play('success');
      await hologram.take();
      navigator.vibrate?.(40);
      close();
      collect.onTake();
    }
  });
  try {
    await track.start();
    if (closed) {
      track.exit();
      return;
    }
    loading.hidden = true;
    root.dataset.mode = 'track';
    setMode(track);
    photoBtn.onclick = async () => {
      const blob = await track.capture(renderer.domElement, () => renderer.render(scene, camera));
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
    track.exit();
    loading.hidden = true;
    if (closed) return;
  }

  // 2) Prévia 3D
  root.dataset.mode = 'preview';
  setMode(new PreviewMode());
  offerNativeAr();
  setHint('Câmera indisponível. Veja o holograma aqui ou use a RA nativa.');
}
