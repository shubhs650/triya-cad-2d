// What the ribbon's Layers and Properties dropdowns show (M7-02 part 3): each drawing's engine
// sends the layer, colour, linetype, lineweight and transparency of its selection, or the current
// ones, while the ribbon asks (`ribbon-properties`); App.tsx files them here by drawing.
import { parseColorValue, type RibbonProperties } from '@triya/engine';
import { aciRgb } from '@triya/render';

class RibbonPropertiesStore {
  readonly #byDoc = new Map<number, RibbonProperties>();
  readonly #listeners = new Set<() => void>();

  set(doc: number, p: RibbonProperties): void {
    this.#byDoc.set(doc, p);
    for (const l of this.#listeners) l();
  }

  get = (doc: number | undefined): RibbonProperties | undefined =>
    doc === undefined ? undefined : this.#byDoc.get(doc);

  forget(doc: number): void {
    if (this.#byDoc.delete(doc)) for (const l of this.#listeners) l();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}

export const ribbonPropertiesStore = new RibbonPropertiesStore();

/**
 * The CSS colour of a Color value (`aci:1`, `rgb:255,0,0`), or undefined for ByLayer and ByBlock,
 * which a swatch shows as such. ACI 7 shows white, as AutoCAD's lists do.
 */
export function swatchOf(value: string): string | undefined {
  const c = parseColorValue(value);
  if (!c) return undefined;
  if (c.kind === 'aci') return `rgb(${aciRgb(c.index).join(' ')})`;
  if (c.kind === 'rgb') return `rgb(${c.r} ${c.g} ${c.b})`;
  return undefined;
}

/**
 * The command each drawing is running (M7-02 part 4), for the contextual tab it shows (Hatch
 * Creation, Array Creation): its outermost, as a transparent command inside it keeps the tab.
 */
class RunningCommands {
  readonly #byDoc = new Map<number, readonly string[]>();
  readonly #listeners = new Set<() => void>();

  #set(doc: number, names: readonly string[]): void {
    if (names.length) this.#byDoc.set(doc, names);
    else this.#byDoc.delete(doc);
    for (const l of this.#listeners) l();
  }

  started(doc: number, command: string, transparent: boolean): void {
    if (!transparent) this.#set(doc, [...(this.#byDoc.get(doc) ?? []), command]);
  }

  ended(doc: number, command: string): void {
    const names = this.#byDoc.get(doc) ?? [];
    const i = names.lastIndexOf(command);
    if (i >= 0) this.#set(doc, names.toSpliced(i, 1));
  }

  forget(doc: number): void {
    if (this.#byDoc.has(doc)) this.#set(doc, []);
  }

  get = (doc: number | undefined): string | undefined =>
    doc === undefined ? undefined : this.#byDoc.get(doc)?.[0];

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}

export const runningCommands = new RunningCommands();
