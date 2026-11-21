// The palette stack (M7-03, UI_SPEC.md §4): the palettes open together as tabs of one docked
// stack, as AutoCAD's palettes anchored to one side of the drawing area. A palette rail button,
// its command (PROPERTIES, ADCENTER, …) or its key opens a palette as the stack's front tab; the
// tabs can be dragged (or moved with Ctrl+Shift+Page Up/Down) into another order; the stack is
// docked right (the default) or left, and its width is dragged at its inner edge. AutoCAD keeps
// its palettes' layout in the user's profile, so Triya keeps it with the preferences: the tabs,
// the front one, the side and the width come back with the next session.
// Below 1366 px the stack slides over the drawing instead of taking room from it, and Esc slides
// it away (the tabs stay open; a rail button brings it back).
// Part 2: as AutoCAD's palettes, the stack also docks at the bottom of the drawing area, floats
// over it (dragged off its dock by its tab strip; dropped at an edge of the drawing area, it docks
// there), and auto-hides: collapsed to its tab strip until the pointer rests on it. Its floating
// place and size, the bottom dock's height and auto-hide are kept with the rest of the layout.

/** The palettes the stack holds so far, as named by their commands' host requests. */
export type PaletteName =
  'designcenter' | 'health' | 'history' | 'layers' | 'properties' | 'references';

/** The rail's order, and each palette's name on its rail button and tab. */
export const PALETTES: readonly { readonly name: PaletteName; readonly title: string }[] = [
  { name: 'properties', title: 'Properties' },
  { name: 'layers', title: 'Layers' },
  { name: 'health', title: 'Health' },
  { name: 'references', title: 'References' },
  { name: 'designcenter', title: 'DesignCenter' },
  { name: 'history', title: 'Command History' },
];

export type DockSide = 'bottom' | 'left' | 'right';

/** A floating stack's place (its top left corner in the window) and size, px. */
export interface FloatRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PaletteLayout {
  /** The open palettes in tab order. */
  readonly open: readonly PaletteName[];
  /** The tab in front: one of `open`, or undefined with none open. */
  readonly active: PaletteName | undefined;
  /** Where it docks; a floating stack docks here again when it is not dropped at another edge. */
  readonly side: DockSide;
  /** The stack's width docked left or right, px. */
  readonly width: number;
  /** The stack's height docked at the bottom, px. */
  readonly height: number;
  /** Floating over the drawing area at `float`, instead of docked. */
  readonly floating: boolean;
  readonly float: FloatRect;
  /** Collapsed to its tab strip until the pointer rests on it (or the keyboard focuses it). */
  readonly autoHide: boolean;
}

/** The stack's widths, px: wide enough for the Properties palette's two columns, at most 800. */
export const PALETTE_WIDTH = { min: 240, max: 800, initial: 420 } as const;
/** Its heights docked at the bottom, px: a few rows of a list at least. */
export const PALETTE_HEIGHT = { min: 120, max: 600, initial: 240 } as const;
/** A floating stack's heights, px. */
export const FLOAT_HEIGHT = { min: 160, max: 1600 } as const;
/** How near the drawing area's edge, px, a floating stack is dropped to dock there. */
export const DOCK_EDGE = 32;

/** Narrower windows show the stack as a slide-over (UI_SPEC.md §4). */
export const SLIDE_OVER_BELOW = 1366;

export const DEFAULT_PALETTE_LAYOUT: PaletteLayout = {
  open: [],
  active: undefined,
  side: 'right',
  width: PALETTE_WIDTH.initial,
  height: PALETTE_HEIGHT.initial,
  floating: false,
  float: { x: 160, y: 140, width: 360, height: 480 },
  autoHide: false,
};

const isPalette = (v: unknown): v is PaletteName => PALETTES.some((p) => p.name === v);

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(v)));

export const clampPaletteWidth = (w: number): number =>
  clamp(w, PALETTE_WIDTH.min, PALETTE_WIDTH.max);

export const clampPaletteHeight = (h: number): number =>
  clamp(h, PALETTE_HEIGHT.min, PALETTE_HEIGHT.max);

export const clampFloatHeight = (h: number): number => clamp(h, FLOAT_HEIGHT.min, FLOAT_HEIGHT.max);

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function normalizeFloat(raw: unknown): FloatRect {
  const d = DEFAULT_PALETTE_LAYOUT.float;
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const num = (k: string, fallback: number) => {
    const v = r[k];
    return isNumber(v) ? v : fallback;
  };
  return {
    x: Math.round(num('x', d.x)),
    y: Math.round(num('y', d.y)),
    width: clampPaletteWidth(num('width', d.width)),
    height: clampFloatHeight(num('height', d.height)),
  };
}

/** A stored layout: what is missing or not valid takes its default. */
export function normalizePaletteLayout(raw: unknown): PaletteLayout {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PALETTE_LAYOUT;
  const r = raw as Record<string, unknown>;
  const open = Array.isArray(r['open'])
    ? [...new Set(r['open'].filter(isPalette))]
    : DEFAULT_PALETTE_LAYOUT.open;
  const active = isPalette(r['active']) && open.includes(r['active']) ? r['active'] : open[0];
  const width = r['width'];
  const height = r['height'];
  const side = r['side'];
  return {
    open,
    active,
    side: side === 'left' || side === 'bottom' ? side : 'right',
    width: isNumber(width) ? clampPaletteWidth(width) : PALETTE_WIDTH.initial,
    height: isNumber(height) ? clampPaletteHeight(height) : PALETTE_HEIGHT.initial,
    floating: r['floating'] === true,
    float: normalizeFloat(r['float']),
    autoHide: r['autoHide'] === true,
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

export const resizePaletteHeight = (l: PaletteLayout, height: number): PaletteLayout => {
  const h = clampPaletteHeight(height);
  return h === l.height ? l : { ...l, height: h };
};

/** Docked at `side`: a floating stack lands there. */
export const dockPalettes = (l: PaletteLayout, side: DockSide): PaletteLayout =>
  side === l.side && !l.floating ? l : { ...l, side, floating: false };

/** Floating, at its last floating place or with its top left corner at `at`. */
export function floatPalettes(l: PaletteLayout, at?: { x: number; y: number }): PaletteLayout {
  const floated = l.floating ? l : { ...l, floating: true };
  return at === undefined ? floated : moveFloating(floated, at.x, at.y);
}

export function moveFloating(l: PaletteLayout, x: number, y: number): PaletteLayout {
  const [fx, fy] = [Math.round(x), Math.round(y)];
  return fx === l.float.x && fy === l.float.y ? l : { ...l, float: { ...l.float, x: fx, y: fy } };
}

export function resizeFloating(l: PaletteLayout, width: number, height: number): PaletteLayout {
  const [w, h] = [clampPaletteWidth(width), clampFloatHeight(height)];
  return w === l.float.width && h === l.float.height
    ? l
    : { ...l, float: { ...l.float, width: w, height: h } };
}

export const autoHidePalettes = (l: PaletteLayout, on: boolean): PaletteLayout =>
  on === l.autoHide ? l : { ...l, autoHide: on };

/**
 * Where a floating stack is drawn in a window of `view`'s size: inside it, as AutoCAD keeps a
 * floating palette on screen when the window shrinks; no bigger than it.
 */
export function placeFloating(
  rect: FloatRect,
  view: { readonly width: number; readonly height: number },
): FloatRect {
  const width = Math.min(rect.width, view.width);
  const height = Math.min(rect.height, view.height);
  return {
    x: Math.max(0, Math.min(rect.x, view.width - width)),
    y: Math.max(0, Math.min(rect.y, view.height - height)),
    width,
    height,
  };
}

/**
 * The dock a stack dragged to `at` lands in: the drawing area's left or right edge (corners go
 * to the side), or its bottom edge, within DOCK_EDGE px; undefined floats it there.
 */
export function dockTarget(
  at: { readonly x: number; readonly y: number },
  area: FloatRect,
): DockSide | undefined {
  const inside =
    at.x >= area.x && at.x <= area.x + area.width && at.y >= area.y && at.y <= area.y + area.height;
  if (!inside) return undefined;
  if (at.x - area.x < DOCK_EDGE) return 'left';
  if (area.x + area.width - at.x < DOCK_EDGE) return 'right';
  if (area.y + area.height - at.y < DOCK_EDGE) return 'bottom';
  return undefined;
}

const sameLayout = (a: PaletteLayout, b: PaletteLayout): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

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
    this.slideOver() && this.#away ? undefined : this.#layout.active;

  narrow = (): boolean => this.#narrow;

  /**
   * The stack slides over the drawing area: the window is narrow and the stack is docked at a
   * side (docked at the bottom or floating, it takes no width from the drawing area).
   */
  slideOver = (): boolean =>
    this.#narrow && !this.#layout.floating && this.#layout.side !== 'bottom';

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

  resizeHeight(height: number): void {
    this.#change(resizePaletteHeight(this.#layout, height));
  }

  dock(side: DockSide): void {
    this.#away = false;
    this.#change(dockPalettes(this.#layout, side));
  }

  /** Floating, at its last floating place or at `at`. */
  float(at?: { x: number; y: number }): void {
    this.#away = false;
    this.#change(floatPalettes(this.#layout, at));
  }

  moveFloat(x: number, y: number): void {
    this.#change(moveFloating(this.#layout, x, y));
  }

  sizeFloat(width: number, height: number): void {
    this.#change(resizeFloating(this.#layout, width, height));
  }

  autoHide(on: boolean): void {
    this.#change(autoHidePalettes(this.#layout, on));
  }

  /** Esc in the slide-over: it slides away, its tabs kept. */
  slideAway(): void {
    if (!this.slideOver() || this.#away || this.#layout.active === undefined) return;
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
