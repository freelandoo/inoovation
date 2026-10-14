// Entrada de um botão só: segurar = jetpack ligado.
//
// - Toque e mouse chegam pelos Pointer Events da superfície de jogo (um evento
//   por dedo/botão; nada de touch + mouse sintetizado em dobro).
// - Botões do HUD ficam fora da superfície: tocar neles não liga o jetpack.
// - Teclado: Espaço, ↑ ou W. Controle: A/B/X/Y ou gatilhos; Start pausa.
// - Perder o foco (trocar de aba/app, alerta do sistema) solta tudo.

export class Input {
  private pointers = new Set<number>();
  private keys = new Set<string>();
  private pad = false;
  private padStart = false;
  private surface: HTMLElement;
  /** Chamado em cada novo aperto (para liberar o áudio no primeiro gesto). */
  onPress: (() => void) | null = null;
  /** Start do controle / Esc / P. */
  onPause: (() => void) | null = null;
  /** Enter / A no controle fora do jogo (menus). */
  onConfirm: (() => void) | null = null;

  constructor(surface: HTMLElement) {
    this.surface = surface;
    surface.addEventListener('pointerdown', this.down);
    surface.addEventListener('pointerup', this.up);
    surface.addEventListener('pointercancel', this.up);
    surface.addEventListener('lostpointercapture', this.up);
    // Sem rolagem, zoom por toque duplo, menu de contexto ou seleção.
    surface.addEventListener('touchstart', prevent, { passive: false });
    surface.addEventListener('touchmove', prevent, { passive: false });
    surface.addEventListener('contextmenu', prevent);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Jetpack pedido agora (qualquer fonte). */
  get held(): boolean {
    return this.pointers.size > 0 || this.keys.size > 0 || this.pad;
  }

  /** Lê o controle (a Gamepad API não tem eventos de botão; chamar por quadro). */
  pollGamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    let held = false;
    let start = false;
    for (const p of pads) {
      if (!p) continue;
      for (const i of [0, 1, 2, 3, 6, 7]) if (p.buttons[i]?.pressed) held = true;
      if (p.buttons[9]?.pressed) start = true;
    }
    if (held && !this.pad) this.pressed();
    this.pad = held;
    if (start && !this.padStart) this.onPause?.();
    this.padStart = start;
  }

  releaseAll = () => {
    this.pointers.clear();
    this.keys.clear();
    this.pad = false;
  };

  private pressed() {
    this.onPress?.();
  }

  private down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.add(e.pointerId);
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      /* ponteiro já liberado */
    }
    this.pressed();
  };

  private up = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
  };

  private keyDown = (e: KeyboardEvent) => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      this.onPause?.();
      return;
    }
    if (e.code === 'Enter') {
      this.onConfirm?.();
      return;
    }
    if (e.code !== 'Space' && e.code !== 'ArrowUp' && e.code !== 'KeyW') return;
    // Espaço em cima de um botão focado aciona o botão, não o jetpack.
    if ((e.target as HTMLElement | null)?.closest?.('button, a, input')) return;
    e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    this.pressed();
  };

  private keyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onVisibility = () => {
    if (document.hidden) this.releaseAll();
  };
}

function prevent(e: Event) {
  if (e.cancelable) e.preventDefault();
}
