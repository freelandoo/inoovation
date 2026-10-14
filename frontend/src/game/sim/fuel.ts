// Tanque do jetpack, independente do movimento. Avisa por eventos quando o
// valor muda, fica baixo, esvazia ou recebe uma cápsula.

export type FuelEvent =
  | { type: 'fuel_changed'; value: number; ratio: number }
  | { type: 'fuel_low' }
  | { type: 'fuel_empty' }
  | { type: 'fuel_collected'; amount: number; added: number };

export class FuelSystem {
  value: number;
  readonly max: number;
  private readonly start: number;
  private readonly lowRatio: number;
  private low = false;
  private listeners = new Set<(e: FuelEvent) => void>();

  constructor(max: number, start: number, lowRatio: number) {
    this.max = max;
    this.start = start;
    this.lowRatio = lowRatio;
    this.value = Math.min(start, max);
  }

  on(fn: (e: FuelEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get ratio() {
    return this.value / this.max;
  }
  get empty() {
    return this.value <= 0;
  }
  get isLow() {
    return this.low;
  }

  reset() {
    this.value = Math.min(this.start, this.max);
    this.low = false;
    this.emit({ type: 'fuel_changed', value: this.value, ratio: this.ratio });
  }

  /** Gasta até `amount`; devolve quanto realmente saiu do tanque. */
  consume(amount: number): number {
    if (amount <= 0 || this.value <= 0) return 0;
    const used = Math.min(amount, this.value);
    this.value -= used;
    if (this.value < 1e-9) this.value = 0;
    this.emit({ type: 'fuel_changed', value: this.value, ratio: this.ratio });
    this.checkLow();
    if (this.value === 0) this.emit({ type: 'fuel_empty' });
    return used;
  }

  /** Abastece sem passar do máximo; devolve quanto entrou de fato. */
  collect(amount: number): number {
    const added = Math.max(0, Math.min(amount, this.max - this.value));
    this.value += added;
    this.emit({ type: 'fuel_collected', amount, added });
    this.emit({ type: 'fuel_changed', value: this.value, ratio: this.ratio });
    this.checkLow();
    return added;
  }

  private checkLow() {
    const low = this.ratio < this.lowRatio;
    if (low && !this.low) this.emit({ type: 'fuel_low' });
    this.low = low;
  }

  private emit(e: FuelEvent) {
    for (const fn of this.listeners) fn(e);
  }
}
