// Leitor de QR da página: abre a câmera numa camada cheia, lê o QR do pote e
// devolve a unidade (GTIN / lote / serial).
//
// Dois leitores em paralelo:
//   - BarcodeDetector nativo (Chrome/Android): rápido, lê o quadro inteiro.
//   - jsQR num Web Worker (iPhone e o resto): lê o recorte central, inclusive QR
//     claro sobre fundo escuro. Com o nativo disponível, roda só a cada 3 quadros.
//
// Carregado sob demanda (import dinâmico) no primeiro toque em "ativar unidade".

import './scanner.css';
import { unitFromQrText, type ScannedUnit } from './decode.ts';
import { requestCamera } from './camera.ts';

export type Detector = 'native' | 'jsqr';

export interface ScannerOptions {
  /** getUserMedia já pedido dentro do gesto do usuário. */
  stream: Promise<MediaStream>;
  onUnit: (unit: ScannedUnit, detector: Detector) => void;
  onError: (reason: string) => void;
  onInvalid: () => void;
  onClose: () => void;
}

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type NativeDetectorCtor = {
  new (opts: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
};

const TICK_MS = 140;
const CROP = 0.85;
const MAX_SIDE = 720;

async function nativeDetector(): Promise<NativeDetector | null> {
  const Ctor = (window as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = await Ctor.getSupportedFormats();
    return formats.includes('qr_code') ? new Ctor({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function errorReason(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'camera_denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no_camera';
  if (name === 'NotReadableError') return 'camera_busy';
  if (name === 'NotSupportedError') return 'unsupported';
  return 'camera_error';
}

const ERROR_TEXT: Record<string, string> = {
  camera_denied: 'Sem acesso à câmera. Libere a câmera para este site nas configurações do navegador e tente de novo.',
  no_camera: 'Não encontramos uma câmera neste aparelho.',
  camera_busy: 'A câmera está em uso por outro app. Feche-o e tente de novo.',
  camera_ended: 'A câmera foi interrompida.',
  unsupported: 'Este navegador não permite usar a câmera aqui. Abra o link no navegador padrão do celular.',
  camera_error: 'Não foi possível abrir a câmera.',
};

export function openUnitScanner(opts: ScannerOptions): { close: () => void } {
  const prevFocus = document.activeElement as HTMLElement | null;
  const html = document.documentElement;

  // ---------------------------------------------------------------- DOM
  const root = el('div', 'usc');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'usc-title');
  const video = el('video', 'usc-video');
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  video.muted = true;
  const frame = el('div', 'usc-frame');
  frame.setAttribute('aria-hidden', 'true');
  for (const c of ['tl', 'tr', 'bl', 'br']) frame.appendChild(el('i', `usc-corner usc-${c}`));
  frame.appendChild(el('i', 'usc-beam'));

  const top = el('div', 'usc-top');
  const chip = el('span', 'usc-chip mono');
  const chipState = el('b', '', 'INICIANDO');
  chip.append('LEITURA DA UNIDADE // ', chipState);
  const closeBtn = el('button', 'usc-icon', '✕');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Fechar leitor');
  top.append(chip, closeBtn);

  const bottom = el('div', 'usc-bottom');
  const title = el('h2', 'usc-title', 'Aponte para o QR do pote');
  title.id = 'usc-title';
  const hint = el('p', 'usc-hint', 'Deixe o QR inteiro dentro do quadro.');
  hint.setAttribute('aria-live', 'polite');
  const actions = el('div', 'usc-actions');
  const torchBtn = el('button', 'usc-btn mono', 'LANTERNA');
  torchBtn.type = 'button';
  torchBtn.hidden = true;
  torchBtn.setAttribute('aria-pressed', 'false');
  const retryBtn = el('button', 'usc-btn usc-btn-primary mono', 'TENTAR DE NOVO');
  retryBtn.type = 'button';
  retryBtn.hidden = true;
  actions.append(torchBtn, retryBtn);
  bottom.append(title, hint, actions);

  root.append(video, frame, top, bottom);
  document.body.appendChild(root);
  html.classList.add('usc-open');
  closeBtn.focus();

  // ---------------------------------------------------------------- estado
  let stream: MediaStream | null = null;
  let closed = false;
  let done = false;
  let timer = 0;
  let hintTimer = 0;
  let tickN = 0;
  let native: NativeDetector | null = null;
  let nativeBusy = false;
  let workerBusy = false;
  let lastInvalid = '';
  let torchOn = false;
  const canvas = document.createElement('canvas');
  const ctx2d = canvas.getContext('2d', { willReadFrequently: true });
  const worker = new Worker(new URL('./qrWorker.ts', import.meta.url), { type: 'module' });

  const setState = (s: 'starting' | 'live' | 'locked' | 'error') => {
    root.dataset.state = s;
    chipState.textContent = { starting: 'INICIANDO', live: 'AO VIVO', locked: 'LIDO', error: 'INDISPONÍVEL' }[s];
  };
  setState('starting');

  const stopCamera = () => {
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  };

  const handle = (text: string, detector: Detector) => {
    if (done || closed) return;
    const unit = unitFromQrText(text);
    if (!unit) {
      if (text !== lastInvalid) {
        lastInvalid = text;
        hint.textContent = 'Este QR não é de uma unidade Innovation Week. Aponte para o QR do pote.';
        opts.onInvalid();
      }
      return;
    }
    done = true;
    clearTimeout(hintTimer);
    stopCamera();
    worker.terminate();
    setState('locked');
    title.textContent = 'Unidade lida';
    hint.textContent = `${unit.lotId ? `LOTE ${unit.lotId} · ` : ''}UNIDADE ${unit.unitId}. Carregando sua identidade…`;
    torchBtn.hidden = true;
    navigator.vibrate?.([30, 40, 30]);
    opts.onUnit(unit, detector);
  };

  worker.onmessage = (e: MessageEvent<{ id: number; text: string | null }>) => {
    workerBusy = false;
    if (e.data.text) handle(e.data.text, 'jsqr');
  };
  worker.onerror = () => {
    workerBusy = true; // worker quebrado: segue só com o nativo
  };

  const tick = () => {
    if (closed || done) return;
    timer = window.setTimeout(tick, TICK_MS);
    if (video.readyState < 2 || !video.videoWidth) return;
    tickN++;

    if (native && !nativeBusy) {
      nativeBusy = true;
      native
        .detect(video)
        .then((codes) => codes.forEach((c) => handle(c.rawValue, 'native')))
        .catch(() => (native = null))
        .finally(() => (nativeBusy = false));
    }

    if (ctx2d && !workerBusy && (!native || tickN % 3 === 0)) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const side = Math.round(Math.min(vw, vh) * CROP);
      const out = Math.min(side, MAX_SIDE);
      canvas.width = canvas.height = out;
      ctx2d.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, out, out);
      const img = ctx2d.getImageData(0, 0, out, out);
      workerBusy = true;
      worker.postMessage({ id: tickN, width: out, height: out, data: img.data.buffer }, [img.data.buffer]);
    }
  };

  const showError = (reason: string) => {
    if (closed) return;
    stopCamera();
    setState('error');
    title.textContent = 'Câmera indisponível';
    hint.textContent = ERROR_TEXT[reason] ?? ERROR_TEXT.camera_error;
    torchBtn.hidden = true;
    retryBtn.hidden = reason === 'unsupported' || reason === 'no_camera';
    if (!retryBtn.hidden) retryBtn.focus();
    opts.onError(reason);
  };

  const setupTorch = (track: MediaStreamTrack) => {
    const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
    torchBtn.hidden = !caps.torch;
  };

  const start = (streamPromise: Promise<MediaStream>) => {
    setState('starting');
    title.textContent = 'Aponte para o QR do pote';
    hint.textContent = 'Deixe o QR inteiro dentro do quadro.';
    retryBtn.hidden = true;
    streamPromise
      .then(async (s) => {
        if (closed) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const track = s.getVideoTracks()[0];
        track?.addEventListener('ended', () => !done && showError('camera_ended'));
        video.srcObject = s;
        await video.play();
        native ??= await nativeDetector();
        if (track) setupTorch(track);
        setState('live');
        clearTimeout(hintTimer);
        hintTimer = window.setTimeout(() => {
          if (!done && !closed && root.dataset.state === 'live') {
            hint.textContent = torchBtn.hidden
              ? 'Aproxime o celular devagar e segure firme, com o QR bem iluminado.'
              : 'Aproxime o celular devagar e segure firme. Pouca luz? Toque em LANTERNA.';
          }
        }, 9000);
        tick();
      })
      .catch((err: unknown) => showError(errorReason(err)));
  };

  // ---------------------------------------------------------------- ações
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(hintTimer);
    stopCamera();
    worker.terminate();
    document.removeEventListener('keydown', onKey);
    root.remove();
    html.classList.remove('usc-open');
    prevFocus?.focus?.();
    opts.onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  closeBtn.addEventListener('click', close);

  torchBtn.addEventListener('click', () => {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    torchOn = !torchOn;
    track
      .applyConstraints({ advanced: [{ torch: torchOn } as MediaTrackConstraintSet] })
      .then(() => torchBtn.setAttribute('aria-pressed', String(torchOn)))
      .catch(() => {
        torchOn = false;
        torchBtn.hidden = true;
      });
  });

  retryBtn.addEventListener('click', () => {
    // novo pedido dentro do gesto do clique
    start(requestCamera());
  });

  start(opts.stream);
  return { close };
}
