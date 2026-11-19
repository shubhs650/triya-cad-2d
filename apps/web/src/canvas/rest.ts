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
  /** Where the rest about to be reported is. */
  #waiting: P | undefined;

  constructor(delay: number, onRest: (p: P | undefined) => void) {
    this.#delay = delay;
    this.#onRest = onRest;
  }

  /** The pointer is at `p`: a rest starts here, unless it is still within the one reported. */
  move(p: P): void {
    const rest = this.#rest;
    if (rest && Math.hypot(p.x - rest.x, p.y - rest.y) <= REST_SLOP_PX) return;
    this.cancel();
    this.#waiting = p;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#waiting = undefined;
      this.#rest = p;
      this.#onRest(p);
    }, this.#delay);
  }

  /**
   * What lies under the pointer changed though it did not move (the view did, M5-20): the rest
   * reported ends, and a rest starts again where it was, so what it found is found afresh. A
   * pointer that is not resting (moved on, or a wheel rolled) stays so.
   */
  again(): void {
    const p = this.#rest ?? this.#waiting;
    if (!p) return;
    this.cancel();
    this.move(p);
  }

  /** The rest ends, or the one about to start does not. */
  cancel(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#waiting = undefined;
    if (!this.#rest) return;
    this.#rest = undefined;
    this.#onRest(undefined);
  }
}
