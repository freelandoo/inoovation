// Efeitos sonoros sintetizados (Web Audio), sem arquivos: laser, bipes, carga de
// máquina, impacto, "whoosh". Navegadores só liberam áudio depois de um toque ou
// tecla; antes disso play() não faz nada (as animações seguem mudas). O estado
// ligado/desligado fica no aparelho.

export type Sfx =
  | 'whoosh'
  | 'charge'
  | 'lock'
  | 'sparkle'
  | 'tick'
  | 'beep'
  | 'unbeep'
  | 'error'
  | 'transmit'
  | 'success'
  | 'laser'
  | 'boot'
  | 'arrival';

const KEY = 'iw:sound';
type Listener = (on: boolean) => void;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let enabled = readEnabled();
let lastTick = 0;
const listeners = new Set<Listener>();

// iPhone: o Safari derrubava a página ao marcar os checks do modal de cadastro. Com o
// modal aberto em tela de toque, nada de áudio (nem criar o AudioContext).
const quietModal = () =>
  document.documentElement.classList.contains('act-open') && window.matchMedia('(pointer: coarse)').matches;

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

function setup(): AudioContext | null {
  if (ctx) return ctx;
  try {
    return createContext();
  } catch {
    ctx = null;
    master = null;
    return null;
  }
}

function createContext(): AudioContext | null {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 6;
  master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(comp).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

let unlockFn: (() => void) | null = null;

/** Liga o áudio no primeiro gesto da pessoa (exigência dos navegadores). */
export function initSfx() {
  const unlock = () => {
    if (quietModal()) return;
    // Som desligado: nem cria o áudio (o botão de som chama de novo ao religar).
    if (!enabled) return;
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    try {
      const c = setup();
      if (c && c.state !== 'running') c.resume().catch(() => {});
      // iOS: um buffer vazio tocado dentro do gesto destrava a saída.
      if (c) {
        const s = c.createBufferSource();
        s.buffer = c.createBuffer(1, 1, 22050);
        s.connect(c.destination);
        s.start(0);
      }
    } catch {
      /* sem áudio: a página segue muda */
    }
  };
  unlockFn = unlock;
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

export const soundOn = () => enabled;

export function setSound(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(on));
}

export function onSoundChange(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ---------------------------------------------------------------- blocos

function env(g: GainNode, t: number, peak: number, attack: number, release: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
}

function tone(c: AudioContext, type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, out: AudioNode = master!) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, peak, Math.min(0.01, dur / 4), dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(c: AudioContext, t: number, dur: number, peak: number, filter: BiquadFilterType, f0: number, f1: number, q = 1) {
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = c.createGain();
  env(g, t, peak, dur * 0.35, dur * 0.65);
  s.connect(f).connect(g).connect(master!);
  s.start(t);
  s.stop(t + dur + 0.05);
}

/** Eco curto, para dar espaço ao sucesso e ao laser. */
function echo(c: AudioContext, time = 0.16, fb = 0.32): AudioNode {
  const input = c.createGain();
  const d = c.createDelay(1);
  const g = c.createGain();
  d.delayTime.value = time;
  g.gain.value = fb;
  input.connect(master!);
  input.connect(d).connect(g).connect(d);
  g.connect(master!);
  return input;
}

// ---------------------------------------------------------------- sons

const SOUNDS: Record<Sfx, (c: AudioContext, t: number) => void> = {
  // cartão abrindo: ar varrendo de grave para agudo
  whoosh: (c, t) => noise(c, t, 0.55, 0.35, 'bandpass', 300, 3200, 1.4),

  // máquina carregando: dente-de-serra subindo com tremolo
  charge: (c, t) => {
    const o = c.createOscillator();
    const lp = c.createBiquadFilter();
    const g = c.createGain();
    const lfo = c.createOscillator();
    const lfoG = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.9);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(3800, t + 0.9);
    lfo.frequency.setValueAtTime(9, t);
    lfo.frequency.linearRampToValueAtTime(28, t + 0.9);
    lfoG.gain.value = 0.05;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    lfo.connect(lfoG).connect(g.gain);
    o.connect(lp).connect(g).connect(master!);
    o.start(t);
    lfo.start(t);
    o.stop(t + 1);
    lfo.stop(t + 1);
  },

  // trava/impacto do check: bumbo grave + clique metálico + ping
  lock: (c, t) => {
    tone(c, 'sine', 160, 38, t, 0.35, 0.9);
    noise(c, t, 0.06, 0.4, 'highpass', 3000, 6000);
    tone(c, 'triangle', 1760, 1760, t + 0.02, 0.5, 0.12, echo(c, 0.12, 0.3));
  },

  // faíscas: pings agudos aleatórios
  sparkle: (c, t) => {
    const out = echo(c, 0.09, 0.25);
    for (let i = 0; i < 6; i++) tone(c, 'sine', 2400 + Math.random() * 2600, 3000 + Math.random() * 3000, t + i * 0.045 + Math.random() * 0.02, 0.12, 0.05, out);
  },

  // caractere decodificando (limitado para não virar ruído)
  tick: (c, t) => {
    if (t - lastTick < 0.05) return;
    lastTick = t;
    tone(c, 'square', 2600 + Math.random() * 900, 2600, t, 0.018, 0.035);
  },

  beep: (c, t) => {
    tone(c, 'sine', 1180, 1180, t, 0.05, 0.14);
    tone(c, 'sine', 1580, 1580, t + 0.06, 0.07, 0.14);
  },
  unbeep: (c, t) => tone(c, 'sine', 900, 700, t, 0.07, 0.1),

  error: (c, t) => {
    tone(c, 'square', 220, 200, t, 0.09, 0.08);
    tone(c, 'square', 165, 150, t + 0.11, 0.14, 0.08);
  },

  // transmitindo dados: chirps rápidos subindo
  transmit: (c, t) => {
    for (let i = 0; i < 8; i++) tone(c, 'square', 700 + i * 160, 900 + i * 160, t + i * 0.07, 0.03, 0.03);
  },

  // tripulante registrado: arpejo maior com eco
  success: (c, t) => {
    const out = echo(c, 0.14, 0.35);
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(c, 'triangle', f, f, t + i * 0.075, 0.35, 0.16, out));
    tone(c, 'sine', 130.8, 65.4, t, 0.6, 0.35);
  },

  // laser: queda rápida de frequência
  laser: (c, t) => {
    const out = echo(c, 0.11, 0.28);
    tone(c, 'sawtooth', 2200, 110, t, 0.32, 0.13, out);
    tone(c, 'square', 1500, 90, t + 0.01, 0.28, 0.05, out);
  },

  // leitura inicial: varredura + bipes de sistema
  boot: (c, t) => {
    noise(c, t, 0.7, 0.12, 'bandpass', 800, 4000, 6);
    tone(c, 'sine', 880, 880, t + 0.25, 0.06, 0.1);
    tone(c, 'sine', 880, 880, t + 0.5, 0.06, 0.1);
    tone(c, 'sine', 1320, 1320, t + 0.75, 0.12, 0.12);
  },

  // telão: chegada de novo tripulante (laser duplo + impacto + acorde)
  arrival: (c, t) => {
    SOUNDS.laser(c, t);
    SOUNDS.laser(c, t + 0.14);
    SOUNDS.lock(c, t + 0.42);
    SOUNDS.success(c, t + 0.5);
  },
};

export function play(name: Sfx, delay = 0) {
  if (quietModal()) return;
  if (!enabled || !ctx || ctx.state !== 'running' || !master) return;
  try {
    SOUNDS[name](ctx, ctx.currentTime + delay);
  } catch {
    /* som é enfeite: nunca derruba a interação */
  }
}

/** Botão de som (ícone de alto-falante). */
export function soundToggle(className = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `sfx-toggle ${className}`.trim();
  const render = (on: boolean) => {
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Desligar som' : 'Ligar som');
    b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>${
      on ? '<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>' : '<path d="M16 9.5l5 5M21 9.5l-5 5"/>'
    }</svg><span>${on ? 'SOM' : 'MUDO'}</span>`;
  };
  render(enabled);
  onSoundChange(render);
  b.addEventListener('click', () => {
    setSound(!enabled);
    if (enabled && !ctx) unlockFn?.();
    if (enabled) play('beep');
  });
  return b;
}
