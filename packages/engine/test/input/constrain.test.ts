// M2-04 ORTHO, POLAR and SNAP: the cursor constraints, as AutoCAD 2024 applies them to a point
// picked from a base point (ORTHOMODE, POLARANG/POLARMODE, SNAPMODE/SNAPUNIT/SNAPBASE).
import { describe, expect, it } from 'vitest';
import {
  orthoPoint,
  polarLabel,
  polarTrack,
  snapToGrid,
  constrainCursor,
} from '../../src/input/constrain';

const deg = (d: number) => (d * Math.PI) / 180;
const round = (p: { x: number; y: number }) => ({ x: +p.x.toFixed(9), y: +p.y.toFixed(9) });

describe('ORTHO', () => {
  it('keeps the axis the cursor is nearer to, from the base point', () => {
    expect(orthoPoint({ x: 10, y: 10 }, { x: 50, y: 13 })).toEqual({ x: 50, y: 10 });
    expect(orthoPoint({ x: 10, y: 10 }, { x: 12, y: -40 })).toEqual({ x: 10, y: -40 });
    expect(orthoPoint({ x: 0, y: 0 }, { x: -5, y: 4 })).toEqual({ x: -5, y: 0 });
  });
});

describe('POLAR', () => {
  const s = { increment: deg(45) };

  it('locks to the nearest increment angle when the cursor is within the tolerance of it', () => {
    const t = polarTrack({ x: 0, y: 0 }, { x: 10, y: 10.3 }, s, 0.5)!;
    expect(t.angle).toBeCloseTo(deg(45), 12);
    expect(round(t.point)).toEqual(round({ x: 10.15, y: 10.15 }));
    expect(t.distance).toBeCloseTo(Math.hypot(10.15, 10.15), 9);
  });

  it('does not lock away from every polar angle', () => {
    expect(polarTrack({ x: 0, y: 0 }, { x: 10, y: 4 }, s, 0.5)).toBeUndefined();
  });

  it('takes additional angles (POLARADDANG) as well as the increments', () => {
    const t = polarTrack(
      { x: 0, y: 0 },
      { x: 10, y: 1.8 },
      { increment: deg(90), additional: [deg(10)] },
      0.5,
    )!;
    expect(t.angle).toBeCloseTo(deg(10), 12);
  });

  it('finds 0° and 270° as well as positive angles', () => {
    expect(
      polarTrack({ x: 5, y: 5 }, { x: 5.2, y: -20 }, { increment: deg(90) }, 0.5)!.angle,
    ).toBeCloseTo(deg(270), 12);
    expect(polarTrack({ x: 5, y: 5 }, { x: 30, y: 5.1 }, { increment: deg(90) }, 0.5)!.angle).toBe(
      0,
    );
  });

  it('shows distance and angle as AutoCAD: "Polar: 14.3543 < 45°"', () => {
    const t = polarTrack({ x: 0, y: 0 }, { x: 10, y: 10.3 }, s, 0.5)!;
    expect(polarLabel(t, 4)).toBe('Polar: 14.3543 < 45°');
  });
});

describe('SNAP', () => {
  it('rounds to the snap spacing from the snap base', () => {
    expect(snapToGrid({ x: 12.4, y: -7.6 }, { x: 10, y: 10 })).toEqual({ x: 10, y: -10 });
    expect(snapToGrid({ x: 3.6, y: 2.2 }, { x: 0.5, y: 1 }, { x: 0.1, y: 0 })).toEqual({
      x: 3.6,
      y: 2,
    });
  });
});

describe('constrainCursor', () => {
  it('applies SNAP, then ORTHO or POLAR from the base point', () => {
    const base = { x: 0, y: 0 };
    expect(constrainCursor({ x: 12.4, y: 3 }, { snap: { x: 10, y: 10 } })).toEqual({
      point: { x: 10, y: 0 },
    });
    expect(constrainCursor({ x: 12.4, y: 3 }, { base, ortho: true })).toEqual({
      point: { x: 12.4, y: 0 },
    });
    const polar = constrainCursor(
      { x: 10, y: 10.3 },
      { base, polar: { increment: deg(45) }, tolerance: 0.5 },
    );
    expect(polar.polar?.angle).toBeCloseTo(deg(45), 12);
    // Without a base point only SNAP applies.
    expect(constrainCursor({ x: 12.4, y: 3 }, { ortho: true })).toEqual({
      point: { x: 12.4, y: 3 },
    });
  });
});
