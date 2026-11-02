// M1-22 part 2: the ZOOM options and named views as view functions. They become ZOOM and
// VIEW command options when the command line arrives (M2-01); the navigation bar calls them now.
import type { ViewRecord } from '@triya/engine';
import { visibleBox, type ViewTransform } from '@triya/render';
import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  ViewHistory,
  allView,
  namedView,
  scaleView,
  windowView,
} from '../src/canvas/views';

const size = { width: 800, height: 600 };
const view: ViewTransform = { center: { x: 10, y: -5 }, scale: 2 };

describe('ZOOM Window', () => {
  it('fills the window with the box, without a margin', () => {
    const v = windowView({ x: 0, y: 0 }, { x: 40, y: 20 }, size)!;
    expect(v.center).toEqual({ x: 20, y: 10 });
    expect(v.scale).toBeCloseTo(20, 12); // 800 px / 40 units; 600 / 20 = 30 is looser
  });

  it('takes the corners in any order', () => {
    expect(windowView({ x: 40, y: 0 }, { x: 0, y: 20 }, size)).toEqual(
      windowView({ x: 0, y: 20 }, { x: 40, y: 0 }, size),
    );
  });

  it('ignores a window with no area', () => {
    expect(windowView({ x: 1, y: 1 }, { x: 1, y: 5 }, size)).toBeUndefined();
  });
});

describe('ZOOM All', () => {
  const limits = { minX: 0, minY: 0, maxX: 12, maxY: 9 };

  it('shows the limits or the extents, whichever reaches further', () => {
    const extents = { minX: 5, minY: -10, maxX: 30, maxY: 4 };
    const box = visibleBox(allView(limits, extents, size), size.width, size.height);
    expect(box.minX).toBeLessThanOrEqual(0);
    expect(box.maxX).toBeGreaterThanOrEqual(30);
    expect(box.minY).toBeLessThanOrEqual(-10);
    expect(box.maxY).toBeGreaterThanOrEqual(9);
  });

  it('shows the limits of an empty drawing', () => {
    const v = allView(limits, undefined, size);
    expect(v.center).toEqual({ x: 6, y: 4.5 });
  });

  it('shows the extents when there are no limits', () => {
    const v = allView(undefined, { minX: 0, minY: 0, maxX: 100, maxY: 50 }, size);
    expect(v.center).toEqual({ x: 50, y: 25 });
  });
});

describe('ZOOM Scale', () => {
  it('nX scales the current view about its centre', () => {
    expect(scaleView(view, 2)).toEqual({ center: view.center, scale: 4 });
    expect(scaleView(view, 0.5)).toEqual({ center: view.center, scale: 1 });
  });

  it('ignores factors that are not positive and finite', () => {
    for (const f of [0, -1, NaN, Infinity]) expect(scaleView(view, f)).toBe(view);
  });
});

describe('ZOOM Previous', () => {
  it('steps back through the views it was given, newest first', () => {
    const h = new ViewHistory();
    const a = { center: { x: 0, y: 0 }, scale: 1 };
    const b = { center: { x: 1, y: 0 }, scale: 1 };
    h.push(a);
    h.push(b);
    expect(h.previous()).toBe(b);
    expect(h.previous()).toBe(a);
    expect(h.previous()).toBeUndefined();
  });

  it('keeps the last ten views, as AutoCAD does per viewport', () => {
    const h = new ViewHistory();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h.push({ center: { x: i, y: 0 }, scale: 1 });
    let n = 0;
    while (h.previous()) n++;
    expect(HISTORY_LIMIT).toBe(10);
    expect(n).toBe(10);
  });

  it('does not record the same view twice in a row', () => {
    const h = new ViewHistory();
    h.push(view);
    h.push({ ...view });
    expect(h.previous()).toBe(view);
    expect(h.previous()).toBeUndefined();
  });
});

describe('named views (VIEW restore)', () => {
  const record = (o: Partial<ViewRecord>): ViewRecord =>
    ({
      handle: '1A',
      name: 'view_custom',
      center: { x: 65, y: 15 },
      height: 100,
      width: 240,
      direction: { x: 0, y: 0, z: 1 },
      target: { x: 0, y: 0, z: 0 },
      lensLength: 50,
      frontClip: 0,
      backClip: 0,
      twist: 0,
      viewMode: 0,
      renderMode: 0,
      ...o,
    }) as ViewRecord;

  it('fits the view width and height into the window around its centre', () => {
    const v = namedView(record({}), size)!;
    expect(v.center).toEqual({ x: 65, y: 15 });
    // 240 wide in 800 px (3.33/unit) is tighter than 100 high in 600 px (6/unit).
    expect(v.scale).toBeCloseTo(800 / 240, 12);
  });

  it('adds the target to the centre (the centre is in display coordinates)', () => {
    const v = namedView(record({ target: { x: 5, y: -2, z: 0 } }), size)!;
    expect(v.center).toEqual({ x: 70, y: 13 });
  });

  it('cannot show a view that is not a plan view or is twisted', () => {
    expect(namedView(record({ direction: { x: 1, y: 1, z: 1 } }), size)).toBeUndefined();
    expect(namedView(record({ twist: 0.3 }), size)).toBeUndefined();
  });
});
