// M7-03: the palette stack. Palettes open together as tabs of one stack, docked right or left,
// its width dragged; the layout is the user's (kept with the preferences, as AutoCAD keeps its
// palettes' layout in the profile) and normalised as it loads. Below 1366 px the stack is a
// slide-over that Esc slides away. Part 2: the stack also docks at the bottom, floats (dragged
// off its dock, its place and size kept) and auto-hides to its tab strip.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PALETTE_LAYOUT,
  FLOAT_HEIGHT,
  PALETTE_HEIGHT,
  PALETTE_WIDTH,
  PaletteStack,
  autoHidePalettes,
  closePalette,
  dockPalettes,
  dockTarget,
  floatPalettes,
  moveFloating,
  movePalette,
  placeFloating,
  resizeFloating,
  resizePaletteHeight,
  normalizePaletteLayout,
  openPalette,
  type PaletteLayout,
} from '../src/palette-stack';
import { normalizePreferences, PreferencesStore } from '../src/preferences';

const layout = (open: PaletteLayout['open'], active = open[0]): PaletteLayout => ({
  ...DEFAULT_PALETTE_LAYOUT,
  open,
  active,
});

describe('palette layout', () => {
  it('opens a palette after the front tab and brings it to the front', () => {
    const one = openPalette(DEFAULT_PALETTE_LAYOUT, 'properties');
    expect(one.open).toEqual(['properties']);
    expect(one.active).toBe('properties');
    const three = openPalette(openPalette(one, 'layers'), 'health');
    expect(three.open).toEqual(['properties', 'layers', 'health']);
    // An open palette comes to the front where it is.
    const front = openPalette(three, 'properties');
    expect(front.open).toEqual(three.open);
    expect(front.active).toBe('properties');
    expect(openPalette(front, 'references').open).toEqual([
      'properties',
      'references',
      'layers',
      'health',
    ]);
  });

  it('closes a palette, the tab after the front one taking its place', () => {
    const l = layout(['properties', 'layers', 'health'], 'layers');
    expect(closePalette(l, 'layers')).toMatchObject({
      open: ['properties', 'health'],
      active: 'health',
    });
    const last = closePalette(layout(['properties', 'layers'], 'layers'), 'layers');
    expect(last.active).toBe('properties');
    // Closing a tab behind keeps the front one.
    expect(closePalette(l, 'health').active).toBe('layers');
    expect(closePalette(layout(['layers']), 'layers')).toMatchObject({
      open: [],
      active: undefined,
    });
    expect(closePalette(l, 'references')).toBe(l);
  });

  it('moves a tab, the others keeping their order', () => {
    const l = layout(['properties', 'layers', 'health']);
    expect(movePalette(l, 'health', 0).open).toEqual(['health', 'properties', 'layers']);
    expect(movePalette(l, 'properties', 9).open).toEqual(['layers', 'health', 'properties']);
    expect(movePalette(l, 'layers', -1).open).toEqual(['layers', 'properties', 'health']);
    expect(movePalette(l, 'layers', 1)).toBe(l);
    expect(movePalette(l, 'designcenter', 0)).toBe(l);
  });

  it('normalises a stored layout', () => {
    expect(normalizePaletteLayout(undefined)).toEqual(DEFAULT_PALETTE_LAYOUT);
    expect(normalizePaletteLayout('x')).toEqual(DEFAULT_PALETTE_LAYOUT);
    expect(
      normalizePaletteLayout({
        open: ['layers', 'nope', 'layers', 'health', 3],
        active: 'references',
        side: 'left',
        width: 312.4,
      }),
    ).toEqual({
      ...DEFAULT_PALETTE_LAYOUT,
      open: ['layers', 'health'],
      active: 'layers',
      side: 'left',
      width: 312,
    });
    expect(normalizePaletteLayout({ side: 'top', width: 5 })).toMatchObject({
      side: 'right',
      width: PALETTE_WIDTH.min,
    });
    expect(normalizePaletteLayout({ width: 1e6 }).width).toBe(PALETTE_WIDTH.max);
    expect(normalizePaletteLayout({ width: Number.NaN }).width).toBe(PALETTE_WIDTH.initial);
    // Part 2: the bottom dock's height, floating with its place and size, auto-hide.
    expect(
      normalizePaletteLayout({
        side: 'bottom',
        height: 9999,
        floating: true,
        float: { x: 10.6, y: -4, width: 1, height: 'tall' },
        autoHide: true,
      }),
    ).toMatchObject({
      side: 'bottom',
      height: PALETTE_HEIGHT.max,
      floating: true,
      float: {
        x: 11,
        y: -4,
        width: PALETTE_WIDTH.min,
        height: DEFAULT_PALETTE_LAYOUT.float.height,
      },
      autoHide: true,
    });
    expect(normalizePaletteLayout({ floating: 'yes', autoHide: 1, float: 3 })).toMatchObject({
      floating: false,
      autoHide: false,
      float: DEFAULT_PALETTE_LAYOUT.float,
    });
  });

  it('docks at the bottom or a side, which ends floating', () => {
    const floating = floatPalettes(DEFAULT_PALETTE_LAYOUT, { x: 300, y: 200 });
    expect(floating).toMatchObject({ floating: true, side: 'right', float: { x: 300, y: 200 } });
    const bottom = dockPalettes(floating, 'bottom');
    expect(bottom).toMatchObject({ floating: false, side: 'bottom' });
    // Its floating place is kept for the next time it floats.
    expect(floatPalettes(bottom).float).toEqual(floating.float);
    expect(dockPalettes(bottom, 'bottom')).toBe(bottom);
    expect(dockPalettes(floating, 'right').floating).toBe(false);
  });

  it('moves and sizes the floating stack, and sizes the bottom dock', () => {
    const l = floatPalettes(DEFAULT_PALETTE_LAYOUT);
    expect(moveFloating(l, 40.4, 61.6).float).toMatchObject({ x: 40, y: 62 });
    expect(resizeFloating(l, 10, 1e6).float).toMatchObject({
      width: PALETTE_WIDTH.min,
      height: FLOAT_HEIGHT.max,
    });
    expect(resizeFloating(l, l.float.width, l.float.height)).toBe(l);
    expect(resizePaletteHeight(l, 1).height).toBe(PALETTE_HEIGHT.min);
    expect(resizePaletteHeight(l, 333.3).height).toBe(333);
    expect(autoHidePalettes(l, true).autoHide).toBe(true);
    expect(autoHidePalettes(l, false)).toBe(l);
  });

  it('keeps a floating stack inside the window', () => {
    const view = { width: 1000, height: 700 };
    expect(placeFloating({ x: 100, y: 50, width: 400, height: 500 }, view)).toEqual({
      x: 100,
      y: 50,
      width: 400,
      height: 500,
    });
    // Off the right and bottom edges: moved back in.
    expect(placeFloating({ x: 900, y: 600, width: 400, height: 500 }, view)).toEqual({
      x: 600,
      y: 200,
      width: 400,
      height: 500,
    });
    // Bigger than the window: as big as the window, at its corner.
    expect(placeFloating({ x: -50, y: -9, width: 1400, height: 900 }, view)).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 700,
    });
  });

  it("docks a stack dropped at the drawing area's left, right or bottom edge", () => {
    const area = { x: 100, y: 80, width: 1000, height: 600 };
    expect(dockTarget({ x: 110, y: 300 }, area)).toBe('left');
    expect(dockTarget({ x: 1090, y: 300 }, area)).toBe('right');
    expect(dockTarget({ x: 600, y: 670 }, area)).toBe('bottom');
    // A corner goes to the side.
    expect(dockTarget({ x: 1095, y: 675 }, area)).toBe('right');
    expect(dockTarget({ x: 600, y: 300 }, area)).toBeUndefined();
    // Outside the drawing area (over the ribbon or the rail) it floats.
    expect(dockTarget({ x: 600, y: 40 }, area)).toBeUndefined();
    expect(dockTarget({ x: 1120, y: 300 }, area)).toBeUndefined();
  });
});

describe('PaletteStack', () => {
  it('toggles the palette showing, as the rail buttons and Ctrl+1 do', () => {
    const s = new PaletteStack();
    s.toggle('properties');
    s.toggle('layers');
    expect(s.layout().open).toEqual(['properties', 'layers']);
    expect(s.get()).toBe('layers');
    // A tab behind comes to the front; the one in front closes.
    s.toggle('properties');
    expect(s.get()).toBe('properties');
    s.toggle('properties');
    expect(s.layout().open).toEqual(['layers']);
    expect(s.get()).toBe('layers');
    s.set(undefined);
    expect(s.get()).toBeUndefined();
  });

  it('slides the slide-over away on Esc only while the window is narrow', () => {
    const s = new PaletteStack();
    let calls = 0;
    s.subscribe(() => calls++);
    s.set('layers');
    s.slideAway();
    expect(s.get()).toBe('layers');
    s.setNarrow(true);
    s.slideAway();
    expect(s.get()).toBeUndefined();
    // The tabs stay open; a rail button brings the stack back with its palette in front.
    expect(s.layout().open).toEqual(['layers']);
    s.toggle('layers');
    expect(s.get()).toBe('layers');
    s.slideAway();
    // A wide window docks the stack again.
    s.setNarrow(false);
    expect(s.get()).toBe('layers');
    expect(calls).toBe(6);
  });

  it('slides over only while docked at a side', () => {
    const s = new PaletteStack();
    s.set('layers');
    s.setNarrow(true);
    expect(s.slideOver()).toBe(true);
    s.dock('bottom');
    expect(s.slideOver()).toBe(false);
    // Docked at the bottom or floating, Esc does not slide it away: it narrows no drawing.
    s.slideAway();
    expect(s.get()).toBe('layers');
    s.dock('left');
    s.float();
    expect(s.slideOver()).toBe(false);
    s.slideAway();
    expect(s.get()).toBe('layers');
  });

  it('keeps width and side within their ranges', () => {
    const s = new PaletteStack();
    s.resize(10);
    expect(s.layout().width).toBe(PALETTE_WIDTH.min);
    s.dock('left');
    expect(s.layout().side).toBe('left');
  });
});

describe('palette layout persistence', () => {
  it('is kept with the preferences and comes back with them', async () => {
    let saved: unknown;
    const store = new PreferencesStore({
      load: () => Promise.resolve(undefined),
      save: (p) => {
        saved = JSON.parse(JSON.stringify(p));
        return Promise.resolve();
      },
    });
    await store.load();
    const stack = new PaletteStack();
    stack.subscribe(() => store.update({ palettes: stack.layout() }));
    stack.set('layers');
    stack.set('properties');
    stack.move('properties', 0);
    stack.dock('left');
    stack.resize(500);
    stack.resizeHeight(300);
    stack.float({ x: 200, y: 150 });
    stack.sizeFloat(380, 520);
    stack.autoHide(true);

    // The next session.
    const next = new PreferencesStore({
      load: () => Promise.resolve(saved),
      save: () => Promise.resolve(),
    });
    await next.load();
    const restored = new PaletteStack();
    restored.restore(next.get().palettes);
    expect(restored.layout()).toEqual({
      open: ['properties', 'layers'],
      active: 'properties',
      side: 'left',
      width: 500,
      height: 300,
      floating: true,
      float: { x: 200, y: 150, width: 380, height: 520 },
      autoHide: true,
    });
    expect(normalizePreferences({}).palettes).toEqual(DEFAULT_PALETTE_LAYOUT);
  });
});
