// M7-03: the palette stack. Palettes open together as tabs of one stack, docked right or left,
// its width dragged; the layout is the user's (kept with the preferences, as AutoCAD keeps its
// palettes' layout in the profile) and normalised as it loads. Below 1366 px the stack is a
// slide-over that Esc slides away.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PALETTE_LAYOUT,
  PALETTE_WIDTH,
  PaletteStack,
  closePalette,
  movePalette,
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
    ).toEqual({ open: ['layers', 'health'], active: 'layers', side: 'left', width: 312 });
    expect(normalizePaletteLayout({ side: 'top', width: 5 })).toMatchObject({
      side: 'right',
      width: PALETTE_WIDTH.min,
    });
    expect(normalizePaletteLayout({ width: 1e6 }).width).toBe(PALETTE_WIDTH.max);
    expect(normalizePaletteLayout({ width: Number.NaN }).width).toBe(PALETTE_WIDTH.initial);
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
    });
    expect(normalizePreferences({}).palettes).toEqual(DEFAULT_PALETTE_LAYOUT);
  });
});
