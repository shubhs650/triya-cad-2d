// Which constraint bars show, per drawing (M9-05 part 2): the objects whose bars CONSTRAINTBAR
// hid (Hide, Hideall), shown again by Show, Reset and Showall; a constraint applied shows its
// objects' bars, or hides them, as CONSTRAINTBARDISPLAY bit 1 says. Display state of the open
// drawing, not part of it: no undo step, not saved (AutoCAD's Help does not say a bar's
// visibility is kept with the drawing).
import type { ViewRequest } from '@triya/engine';

type BarRequest = Extract<ViewRequest, { op: 'constraintBars' }>;

const NONE: ReadonlySet<string> = new Set();

export class ConstraintBarStates {
  readonly #hidden = new Map<number, ReadonlySet<string>>();
  readonly #listeners = new Set<() => void>();

  /** The objects of drawing `doc` whose bars are hidden, by handle. */
  hidden(doc: number): ReadonlySet<string> {
    return this.#hidden.get(doc) ?? NONE;
  }

  /** CONSTRAINTBAR's request, or a constraint applied under CONSTRAINTBARDISPLAY `display`. */
  apply(doc: number, r: Pick<BarRequest, 'action' | 'entities'>, display: number): void {
    const hide = r.action === 'hide' || (r.action === 'applied' && (display & 1) === 0);
    const next = new Set(this.hidden(doc));
    for (const h of r.entities) {
      if (hide) next.add(h);
      else next.delete(h);
    }
    const before = this.hidden(doc);
    if (next.size === before.size && [...next].every((h) => before.has(h))) return;
    this.#hidden.set(doc, next);
    for (const l of this.#listeners) l();
  }

  forget(doc: number): void {
    this.#hidden.delete(doc);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}

export const constraintBarStates = new ConstraintBarStates();
