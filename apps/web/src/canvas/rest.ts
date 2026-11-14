// When the pointer rests on the canvas (M2-35 part 21, rollover tooltips): it has stayed put for
// a delay. A tremor of a few pixels keeps a rest; moving on, a press, a wheel roll or leaving
// the canvas ends it, and its listener hears `undefined`.

/** How far the pointer may drift and still be resting, CSS pixels. */
export const REST_SLOP_PX = 3;

export class RestWatch<P extends { readonly x: number; readonly y: number }> {
  readonly #delay: number;
  readonly #onRest: (p: P | undefined) => void;
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** Where the pointer rests now, once reported. */
  #rest: P | undefined;

  constructor(delay: number, onRest: (p: P | undefined) => void) {
    this.#delay = delay;
    this.#onRest = onRest;
  }

  /** The pointer is at `p`: a rest starts here, unless it is still within the one reported. */
  move(p: P): void {
    const rest = this.#rest;
    if (rest && Math.hypot(p.x - rest.x, p.y - rest.y) <= REST_SLOP_PX) return;
    this.cancel();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#rest = p;
      this.#onRest(p);
    }, this.#delay);
  }

  /** The rest ends, or the one about to start does not. */
  cancel(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (!this.#rest) return;
    this.#rest = undefined;
    this.#onRest(undefined);
  }
}
