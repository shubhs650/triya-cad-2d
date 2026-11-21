// The palette stack (M7-03, UI_SPEC.md §4): the palettes open together as tabs of one docked
// stack, as AutoCAD's palettes anchored to one side of the drawing area. A palette rail button,
// its command (PROPERTIES, ADCENTER, …) or its key opens a palette as the stack's front tab; the
// tabs can be dragged (or moved with Ctrl+Shift+Page Up/Down) into another order; the stack is
// docked right (the default) or left, and its width is dragged at its inner edge. AutoCAD keeps
// its palettes' layout in the user's profile, so Triya keeps it with the preferences: the tabs,
// the front one, the side and the width come back with the next session.
// Below 1366 px the stack slides over the drawing instead of taking room from it, and Esc slides
// it away (the tabs stay open; a rail button brings it back).

/** The palettes the stack holds so far, as named by their commands' host requests. */
export type PaletteName = 'designcenter' | 'health' | 'layers' | 'properties' | 'references';

/** The rail's order, and each palette's name on its rail button and tab. */
export const PALETTES: readonly { readonly name: PaletteName; readonly title: string }[] = [
  { name: 'properties', title: 'Properties' },
  { name: 'layers', title: 'Layers' },
  { name: 'health', title: 'Health' },
  { name: 'references', title: 'References' },
  { name: 'designcenter', title: 'DesignCenter' },
];

export type DockSide = 'left' | 'right';

export interface PaletteLayout {
  /** The open palettes in tab order. */
  readonly open: readonly PaletteName[];
  /** The tab in front: one of `open`, or undefined with none open. */
  readonly active: PaletteName | undefined;
  readonly side: DockSide;
  /** The stack's width, px. */
  readonly width: number;
}

/** The stack's widths, px: wide enough for the Properties palette's two columns, at most 800. */
export const PALETTE_WIDTH = { min: 240, max: 800, initial: 420 } as const;

/** Narrower windows show the stack as a slide-over (UI_SPEC.md §4). */
export const SLIDE_OVER_BELOW = 1366;

export const DEFAULT_PALETTE_LAYOUT: PaletteLayout = {
  open: [],
  active: undefined,
  side: 'right',
  width: PALETTE_WIDTH.initial,
};

const isPalette = (v: unknown): v is PaletteName => PALETTES.some((p) => p.name === v);

export const clampPaletteWidth = (w: number): number =>
  Math.min(PALETTE_WIDTH.max, Math.max(PALETTE_WIDTH.min, Math.round(w)));

/** A stored layout: what is missing or not valid takes its default. */
export function normalizePaletteLayout(raw: unknown): PaletteLayout {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PALETTE_LAYOUT;
  const r = raw as Record<string, unknown>;
  const open = Array.isArray(r['open'])
    ? [...new Set(r['open'].filter(isPalette))]
    : DEFAULT_PALETTE_LAYOUT.open;
  const active = isPalette(r['active']) && open.includes(r['active']) ? r['active'] : open[0];
  const width = r['width'];
  return {
    open,
    active,
    side: r['side'] === 'left' ? 'left' : 'right',
    width:
      typeof width === 'number' && Number.isFinite(width)
        ? clampPaletteWidth(width)
        : PALETTE_WIDTH.initial,
  };
}

/** `p` open in front; a palette not open yet joins after the front tab. */
export function openPalette(l: PaletteLayout, p: PaletteName): PaletteLayout {
  if (l.open.includes(p)) return l.active === p ? l : { ...l, active: p };
  const at = l.active === undefined ? l.open.length : l.open.indexOf(l.active) + 1;
  return { ...l, open: [...l.open.slice(0, at), p, ...l.open.slice(at)], active: p };
}

/** `p` closed; when it was in front, the tab after it (else before it) comes to the front. */
export function closePalette(l: PaletteLayout, p: PaletteName): PaletteLayout {
  const at = l.open.indexOf(p);
  if (at < 0) return l;
  const open = l.open.filter((x) => x !== p);
  const active = l.active === p ? (open[at] ?? open[at - 1]) : l.active;
  return { ...l, open, active };
}

/** `p` moved to tab position `to` (clamped), the others keeping their order. */
export function movePalette(l: PaletteLayout, p: PaletteName, to: number): PaletteLayout {
  const from = l.open.indexOf(p);
  if (from < 0) return l;
  const rest = l.open.filter((x) => x !== p);
  const at = Math.max(0, Math.min(rest.length, to));
  if (at === from) return l;
  return { ...l, open: [...rest.slice(0, at), p, ...rest.slice(at)] };
}

export const resizePalettes = (l: PaletteLayout, width: number): PaletteLayout => {
  const w = clampPaletteWidth(width);
  return w === l.width ? l : { ...l, width: w };
};

export const dockPalettes = (l: PaletteLayout, side: DockSide): PaletteLayout =>
  side === l.side ? l : { ...l, side };

const sameLayout = (a: PaletteLayout, b: PaletteLayout): boolean =>
  a.active === b.active &&
  a.side === b.side &&
  a.width === b.width &&
  a.open.length === b.open.length &&
  a.open.every((p, i) => b.open[i] === p);

/**
 * The stack the app shows: its layout (kept with the preferences) and, for this session only,
 * whether the window is narrow and whether Esc slid the slide-over away.
 */
export class PaletteStack {
  #layout: PaletteLayout = DEFAULT_PALETTE_LAYOUT;
  #narrow = false;
  #away = false;
  readonly #listeners = new Set<() => void>();

  /** The layout, for the preferences and the stack's own drawing. */
  layout = (): PaletteLayout => this.#layout;

  /** The palette showing: the front tab, unless Esc slid the slide-over away. */
  get = (): PaletteName | undefined =>
    this.#narrow && this.#away ? undefined : this.#layout.active;

  narrow = (): boolean => this.#narrow;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** `p` showing, opened if it is not; undefined closes the palette showing. */
  set(p: PaletteName | undefined): void {
    if (p === undefined) {
      const shown = this.get();
      if (shown !== undefined) this.close(shown);
      return;
    }
    const wasAway = this.#away;
    this.#away = false;
    this.#change(openPalette(this.#layout, p), wasAway);
  }

  /** A rail button, Ctrl+1 or Ctrl+2: closes `p` when it shows, else shows it. */
  toggle(p: PaletteName): void {
    if (this.get() === p) this.close(p);
    else this.set(p);
  }

  close(p: PaletteName): void {
    this.#change(closePalette(this.#layout, p));
  }

  move(p: PaletteName, to: number): void {
    this.#change(movePalette(this.#layout, p, to));
  }

  resize(width: number): void {
    this.#change(resizePalettes(this.#layout, width));
  }

  dock(side: DockSide): void {
    this.#change(dockPalettes(this.#layout, side));
  }

  /** Esc in the slide-over: it slides away, its tabs kept. */
  slideAway(): void {
    if (!this.#narrow || this.#away || this.#layout.active === undefined) return;
    this.#away = true;
    this.#notify();
  }

  setNarrow(narrow: boolean): void {
    if (narrow === this.#narrow) return;
    this.#narrow = narrow;
    this.#notify();
  }

  /** The layout kept with the preferences (on load, or changed in another way). */
  restore(layout: PaletteLayout): void {
    this.#change(normalizePaletteLayout(layout));
  }

  /** `notify` tells the listeners even when the layout is the same (the session state changed). */
  #change(next: PaletteLayout, notify = false): void {
    if (sameLayout(next, this.#layout) && !notify) return;
    this.#layout = next;
    this.#notify();
  }

  #notify(): void {
    for (const l of this.#listeners) l();
  }
}

export const paletteStack = new PaletteStack();
