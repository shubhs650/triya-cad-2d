// Which constraint bars show, per drawing (M9-05 part 2): the objects whose bars CONSTRAINTBAR
// hid (Hide, Hideall), shown again by Show, Reset and Showall; a constraint applied shows its
// objects' bars, or hides them, as CONSTRAINTBARDISPLAY bit 1 says. And where the drafter dragged
// bars (M9-05 part 6), each one's offset in CSS pixels from where it is laid out, until
// CONSTRAINTBAR Reset puts its object's bars back. Display state of the open drawing, not part of
// it: no undo step, not saved (AutoCAD's Help does not say a bar's visibility or place is kept
// with the drawing).
import { isConstraintBarOf, type ViewRequest } from '@triya/engine';

type BarRequest = Extract<ViewRequest, { op: 'constraintBars' }>;

/** A dragged bar's offset from where it is laid out, CSS pixels, y down. */
export interface BarOffset {
  readonly x: number;
  readonly y: number;
}

const NONE: ReadonlySet<string> = new Set();
const NOT_MOVED: ReadonlyMap<string, BarOffset> = new Map();

export class ConstraintBarStates {
  readonly #hidden = new Map<number, ReadonlySet<string>>();
  readonly #moved = new Map<number, ReadonlyMap<string, BarOffset>>();
  readonly #listeners = new Set<() => void>();

  /** The objects of drawing `doc` whose bars are hidden, by handle. */
  hidden(doc: number): ReadonlySet<string> {
    return this.#hidden.get(doc) ?? NONE;
  }

  /** The bars of drawing `doc` the drafter dragged, by `constraintBarKey`. */
  moved(doc: number): ReadonlyMap<string, BarOffset> {
    return this.#moved.get(doc) ?? NOT_MOVED;
  }

  /** CONSTRAINTBAR's request, or a constraint applied under CONSTRAINTBARDISPLAY `display`. */
  apply(doc: number, r: Pick<BarRequest, 'action' | 'entities'>, display: number): void {
    const hide = r.action === 'hide' || (r.action === 'applied' && (display & 1) === 0);
    const next = new Set(this.hidden(doc));
    for (const h of r.entities) {
      if (hide) next.add(h);
      else next.delete(h);
    }
    let changed = false;
    const before = this.hidden(doc);
    if (next.size !== before.size || [...next].some((h) => !before.has(h))) {
      this.#hidden.set(doc, next);
      changed = true;
    }
    if (r.action === 'reset') {
      const moved = this.moved(doc);
      const kept = new Map(
        [...moved].filter(([key]) => !r.entities.some((h) => isConstraintBarOf(key, h))),
      );
      if (kept.size !== moved.size) {
        this.#moved.set(doc, kept);
        changed = true;
      }
    }
    if (changed) this.#tell();
  }

  /** The bar `key` of drawing `doc` dragged to `offset`; undefined puts it back. */
  move(doc: number, key: string, offset: BarOffset | undefined): void {
    const moved = this.moved(doc);
    const was = moved.get(key);
    if (was === offset || (was && offset && was.x === offset.x && was.y === offset.y)) return;
    const next = new Map(moved);
    if (offset) next.set(key, { x: offset.x, y: offset.y });
    else next.delete(key);
    this.#moved.set(doc, next);
    this.#tell();
  }

  forget(doc: number): void {
    this.#hidden.delete(doc);
    this.#moved.delete(doc);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #tell(): void {
    for (const l of this.#listeners) l();
  }
}

export const constraintBarStates = new ConstraintBarStates();
