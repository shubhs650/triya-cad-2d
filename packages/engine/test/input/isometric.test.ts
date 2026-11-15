// M3-06 part 2: isometric snap, ORTHO on the isoplanes and the isocircle (AutoCAD 2024 Help,
// "Set Isometric Grid and Snap", "ISOPLANE (Command)", "SNAPSTYL", "SNAPISOPAIR").
import { describe, expect, it } from 'vitest';
import { constrainCursor } from '../../src/input/constrain';
import {
  ISOPLANE_NAMES,
  isoOrthoPoint,
  isoSnap,
  isocircleAxes,
  isoplaneAxes,
  isoplaneOf,
  nextIsoplane,
} from '../../src/input/isometric';

const C30 = Math.cos(Math.PI / 6);
const r9 = (p: { x: number; y: number }) => ({ x: +p.x.toFixed(9) + 0, y: +p.y.toFixed(9) + 0 });
const angle = (v: { x: number; y: number }) =>
  Math.round(((Math.atan2(v.y, v.x) * 180) / Math.PI + 360) % 360);

describe('isoplanes', () => {
  it('step Left, Top, Right and round; anything unknown reads as Left', () => {
    expect(ISOPLANE_NAMES).toEqual(['Left', 'Top', 'Right']);
    expect([nextIsoplane(0), nextIsoplane(1), nextIsoplane(2)]).toEqual([1, 2, 0]);
    expect([isoplaneOf(1), isoplaneOf(2), isoplaneOf(0), isoplaneOf(7), isoplaneOf('x')]).toEqual([
      1, 2, 0, 0, 0,
    ]);
  });

  it('have AutoCAD’s axes: Left 90° and 150°, Top 30° and 150°, Right 30° and 90°', () => {
    expect(isoplaneAxes(0).map(angle)).toEqual([90, 150]);
    expect(isoplaneAxes(1).map(angle)).toEqual([30, 150]);
    expect(isoplaneAxes(2).map(angle)).toEqual([30, 90]);
    expect(isoplaneAxes(0)[0]).toEqual({ x: 0, y: 1 });
  });
});

describe('isometric SNAP', () => {
  it('rounds to the points a spacing apart along 30°, 90° and 150°', () => {
    // Straight up: the vertical neighbours are the spacing apart.
    expect(r9(isoSnap({ x: 0.2, y: 9.1 }, 10))).toEqual({ x: 0, y: 10 });
    // Along 30°: (cos 30°, sin 30°) × 10.
    expect(r9(isoSnap({ x: 8.3, y: 5.4 }, 10))).toEqual(r9({ x: 10 * C30, y: 5 }));
    // Along 150°, two steps.
    expect(r9(isoSnap({ x: -17, y: 10.4 }, 10))).toEqual(r9({ x: -20 * C30, y: 10 }));
    // Every snap point is the spacing from its nearest neighbours.
    const p = isoSnap({ x: 40, y: 3 }, 10);
    const q = isoSnap({ x: 40 + 10 * C30, y: 8 }, 10);
    expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeCloseTo(10, 9);
  });

  it('counts from the snap base, and leaves the cursor with no spacing', () => {
    expect(r9(isoSnap({ x: 1, y: 3 }, 2, { x: 1, y: 1 }))).toEqual({ x: 1, y: 3 });
    expect(r9(isoSnap({ x: 1.1, y: 2.6 }, 2, { x: 1, y: 1 }))).toEqual({ x: 1, y: 3 });
    expect(isoSnap({ x: 1.1, y: 2.6 }, 0)).toEqual({ x: 1.1, y: 2.6 });
  });
});

describe('isometric ORTHO', () => {
  const base = { x: 10, y: 10 };
  it('keeps to the isoplane axis the cursor is nearer to', () => {
    // Top: 30° and 150°.
    const top = isoOrthoPoint(base, { x: 30, y: 20 }, 1);
    expect(angle({ x: top.x - base.x, y: top.y - base.y })).toBe(30);
    const back = isoOrthoPoint(base, { x: -10, y: 21 }, 1);
    expect(angle({ x: back.x - base.x, y: back.y - base.y })).toBe(150);
    // Left: 90° and 150°; a cursor below follows 270°.
    const down = isoOrthoPoint(base, { x: 11, y: -10 }, 0);
    expect(r9(down)).toEqual({ x: 10, y: -10 });
    // Right: 30° and 90°; the distance along is the cursor's projection.
    const right = isoOrthoPoint(base, { x: 10 + 20 * C30, y: 20 }, 2);
    expect(r9(right)).toEqual(r9({ x: 10 + 20 * C30, y: 20 }));
    expect(isoOrthoPoint(base, base, 1)).toEqual(base);
  });

  it('is what constrainCursor does with an isoplane, after the isometric snap', () => {
    const c = constrainCursor({ x: 30, y: 21 }, { base, ortho: true, isoplane: 1 });
    expect(angle({ x: c.point.x - base.x, y: c.point.y - base.y })).toBe(30);
    const snapped = constrainCursor({ x: 8.3, y: 5.4 }, { snap: { x: 99, y: 10 }, isoplane: 2 });
    expect(r9(snapped.point)).toEqual(r9({ x: 10 * C30, y: 5 }));
    // Without an isoplane, SNAP stays rectangular with both spacings.
    const rect = constrainCursor({ x: 8.3, y: 5.4 }, { snap: { x: 4, y: 10 } });
    expect(rect.point).toEqual({ x: 8, y: 10 });
  });
});

describe('isocircle', () => {
  it('is an ellipse of √(3/2)·r by √(1/2)·r, its major axis 0° Top, 120° Left, 60° Right', () => {
    const c = { x: 5, y: 5 };
    for (const [plane, deg] of [
      [1, 0],
      [0, 120],
      [2, 60],
    ] as const) {
      const e = isocircleAxes(c, 10, plane);
      expect(e.center).toBe(c);
      expect(Math.hypot(e.axis.x, e.axis.y)).toBeCloseTo(10 * Math.sqrt(1.5), 9);
      expect(e.other).toBeCloseTo(10 * Math.sqrt(0.5), 9);
      expect(angle(e.axis)).toBe(deg);
    }
  });

  it('passes through the points the radius along both of its plane’s axes', () => {
    for (const plane of [0, 1, 2] as const) {
      const e = isocircleAxes({ x: 0, y: 0 }, 4, plane);
      const a = Math.hypot(e.axis.x, e.axis.y);
      const u = { x: e.axis.x / a, y: e.axis.y / a };
      for (const axis of isoplaneAxes(plane)) {
        const p = { x: 4 * axis.x, y: 4 * axis.y };
        // In the ellipse's own frame: (p·u / a)² + (p×u / b)² = 1.
        const along = p.x * u.x + p.y * u.y;
        const across = p.x * u.y - p.y * u.x;
        expect((along / a) ** 2 + (across / e.other) ** 2).toBeCloseTo(1, 9);
      }
    }
  });
});
