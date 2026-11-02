// M1-22: the view maths behind real-time zoom and pan on the canvas.
import { screenToWorld, worldToScreen, type ViewTransform } from '@triya/render';
import { describe, expect, it } from 'vitest';
import {
  WHEEL_STEP,
  extentsView,
  panBy,
  wheelFactor,
  zoomAt,
  type ViewportSize,
} from '../src/canvas/navigate';

const size: ViewportSize = { width: 800, height: 600 };
const view: ViewTransform = { center: { x: 10, y: -5 }, scale: 2 };

describe('zoomAt', () => {
  it('keeps the world point under the cursor still', () => {
    const cursor = { x: 130, y: 470 };
    const before = screenToWorld(view, size.width, size.height, cursor);
    for (const factor of [WHEEL_STEP, 1 / WHEEL_STEP, 7.5]) {
      const next = zoomAt(view, size, cursor, factor);
      expect(next.scale).toBeCloseTo(view.scale * factor, 12);
      const after = screenToWorld(next, size.width, size.height, cursor);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
    }
  });

  it('zooms about the centre when the cursor is there', () => {
    const next = zoomAt(view, size, { x: 400, y: 300 }, 4);
    expect(next.center.x).toBeCloseTo(10, 12);
    expect(next.center.y).toBeCloseTo(-5, 12);
  });

  it('ignores factors that are not positive and finite', () => {
    for (const f of [0, -2, Infinity, NaN])
      expect(zoomAt(view, size, { x: 1, y: 2 }, f)).toBe(view);
  });
});

describe('panBy', () => {
  it('moves the drawing with the pointer', () => {
    const grab = { x: 200, y: 100 };
    const world = screenToWorld(view, size.width, size.height, grab);
    const next = panBy(view, 35, -20);
    const moved = worldToScreen(next, size.width, size.height, world);
    expect(moved.x).toBeCloseTo(235, 9);
    expect(moved.y).toBeCloseTo(80, 9);
    expect(next.scale).toBe(view.scale);
  });
});

describe('wheelFactor', () => {
  it('zooms in one step per notch rolled forward and out per notch rolled back (ZOOMWHEEL 0)', () => {
    expect(wheelFactor(-100, 0)).toBeCloseTo(WHEEL_STEP, 12);
    expect(wheelFactor(100, 0)).toBeCloseTo(1 / WHEEL_STEP, 12);
    expect(wheelFactor(-300, 0)).toBeCloseTo(WHEEL_STEP ** 3, 12);
  });

  it('reads line and page deltas as notches too', () => {
    expect(wheelFactor(-3, 1)).toBeCloseTo(WHEEL_STEP, 12);
    expect(wheelFactor(1, 2)).toBeCloseTo(1 / WHEEL_STEP, 12);
  });

  it('turns a trackpad pixel delta into a fraction of a step', () => {
    const f = wheelFactor(-10, 0);
    expect(f).toBeGreaterThan(1);
    expect(f).toBeLessThan(WHEEL_STEP);
  });
});

describe('extentsView', () => {
  it('fits the extents with a margin', () => {
    const v = extentsView({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, size);
    expect(v.center).toEqual({ x: 50, y: 25 });
    // 800 px wide less 5 % each side, for 100 units.
    expect(v.scale).toBeCloseTo(7.2, 12);
  });

  it('centres a single point at unit scale', () => {
    const v = extentsView({ minX: 3, minY: 4, maxX: 3, maxY: 4 }, size);
    expect(v).toEqual({ center: { x: 3, y: 4 }, scale: 1 });
  });

  it('shows the origin for an empty drawing', () => {
    const v = extentsView(undefined, size);
    expect(v.center).toEqual({ x: 0, y: 0 });
    expect(v.scale).toBeGreaterThan(0);
  });
});
