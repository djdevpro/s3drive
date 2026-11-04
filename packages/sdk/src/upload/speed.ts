// Débit et temps restant : moyenne mobile exponentielle sur 5 s des octets envoyés ;
// temps restant affiché après 3 s de mesure et si le débit est non nul.

const TAU_MS = 5_000;
const MIN_SAMPLE_MS = 200;
const RELIABLE_AFTER_MS = 3_000;
/** Sans octet depuis ce délai, le débit retombe à 0. */
const STALE_MS = 10_000;

export class SpeedMeter {
  #rate = 0;
  #last = 0;
  #started = 0;
  #pending = 0;

  add(bytes: number, now: number): void {
    if (bytes <= 0) return;
    if (this.#started === 0) {
      this.#started = now;
      this.#last = now;
    }
    this.#pending += bytes;
    const dt = now - this.#last;
    if (dt < MIN_SAMPLE_MS) return;
    const instant = (this.#pending * 1000) / dt;
    const alpha = 1 - Math.exp(-dt / TAU_MS);
    this.#rate = this.#rate === 0 ? instant : this.#rate + alpha * (instant - this.#rate);
    this.#pending = 0;
    this.#last = now;
  }

  /** Octets par seconde. */
  value(now: number): number {
    if (this.#started === 0 || now - this.#last > STALE_MS) return 0;
    return this.#rate;
  }

  /** Mesure assez longue pour annoncer un temps restant. */
  reliable(now: number): boolean {
    return this.#started !== 0 && now - this.#started >= RELIABLE_AFTER_MS && this.value(now) > 0;
  }

  reset(): void {
    this.#rate = 0;
    this.#last = 0;
    this.#started = 0;
    this.#pending = 0;
  }
}
