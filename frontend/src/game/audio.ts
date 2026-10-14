// Sons do jogo, sintetizados na hora (Web Audio, sem arquivos nem licenças).
// O jetpack é um ruído filtrado contínuo: os nós são criados uma vez e só o
// volume muda, com rampa curta ao ligar/desligar (nunca reinicia por quadro).
// O navegador só libera áudio depois de um toque/tecla: unlock() é chamado no
// primeiro gesto. Ligado/desligado é a mesma preferência do resto do site.

const KEY = 'iw:sound';

export type Sound = 'pickup' | 'pickup_big' | 'low' | 'pass' | 'crash' | 'record' | 'ui' | 'off';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private jet: GainNode | null = null;
  private jetFilter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastLow = 0;
  enabled: boolean;

  constructor() {
    let on = true;
    try {
      on = localStorage.getItem(KEY) !== 'off';
    } catch {
      /* storage indisponível */
    }
    this.enabled = on;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* storage indisponível */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.02);
  }

  /** Chamar dentro de um gesto do usuário. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this.enabled ? 0.8 : 0;
      this.master.connect(comp);

      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        // ruído "marrom": mais grave que o branco, soa como empuxo
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
      // Jetpack: ruído em loop -> filtro -> volume (começa mudo).
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      this.jetFilter = ctx.createBiquadFilter();
      this.jetFilter.type = 'lowpass';
      this.jetFilter.frequency.value = 900;
      this.jetFilter.Q.value = 0.8;
      this.jet = ctx.createGain();
      this.jet.gain.value = 0;
      src.connect(this.jetFilter).connect(this.jet).connect(this.master);
      src.start();
    } catch {
      this.ctx = null;
    }
  }

  /** Liga/desliga o som contínuo do jetpack com fade curto. */
  setJet(on: boolean) {
    if (!this.ctx || !this.jet || !this.jetFilter) return;
    const t = this.ctx.currentTime;
    this.jet.gain.cancelScheduledValues(t);
    this.jet.gain.setTargetAtTime(on ? 0.55 : 0, t, on ? 0.025 : 0.06);
    this.jetFilter.frequency.setTargetAtTime(on ? 1400 : 500, t, 0.08);
  }

  /** Pausa/retoma o contexto inteiro (aba escondida, pausa). */
  suspend(paused: boolean) {
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  play(s: Sound) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.enabled) return;
    const t = ctx.currentTime;
    switch (s) {
      case 'pickup':
        this.tone('sine', [880, 1320], t, 0.07, 0.25);
        break;
      case 'pickup_big':
        this.tone('sine', [660, 990, 1320, 1760], t, 0.06, 0.28);
        break;
      case 'low':
        if (t - this.lastLow < 1.2) return;
        this.lastLow = t;
        this.tone('square', [988], t, 0.07, 0.08);
        this.tone('square', [988], t + 0.14, 0.07, 0.08);
        break;
      case 'pass':
        this.tone('triangle', [1500], t, 0.025, 0.05);
        break;
      case 'ui':
        this.tone('triangle', [1200, 1600], t, 0.03, 0.12);
        break;
      case 'record':
        this.tone('triangle', [523, 659, 784, 1047], t, 0.11, 0.25);
        break;
      case 'off':
        this.burst(t, 0.18, 1800, 300, 0.25);
        break;
      case 'crash': {
        this.burst(t, 0.6, 2400, 120, 0.9);
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(110, t);
        o.frequency.exponentialRampToValueAtTime(35, t + 0.5);
        g.gain.setValueAtTime(0.9, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + 0.6);
        break;
      }
    }
  }

  private tone(type: OscillatorType, freqs: number[], t: number, step: number, vol: number) {
    const ctx = this.ctx!;
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const at = t + i * step;
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + step * 1.6);
      o.connect(g).connect(this.master!);
      o.start(at);
      o.stop(at + step * 1.7);
    });
  }

  private burst(t: number, dur: number, f0: number, f1: number, vol: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }
}
