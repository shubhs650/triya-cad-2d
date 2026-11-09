// M2-04 part 2: object snap tracking (OTRACK) and the EXTension and PARallel snaps, which
// follow paths from points acquired by hovering, as AutoCAD 2024 Help describes them ("Use
// Object Snap Tracking", "Object Snaps": Extension, Parallel). The paths from acquired points
// are horizontal and vertical (POLARMODE bit 2 off, AutoCAD's default) or along the polar
// angles; where two paths cross near the cursor, the cursor goes to their crossing.
import { describe, expect, it } from 'vitest';
import { constrainCursor } from '../../src/input/constrain';
import { trackCursor, trackLabel, type Acquired } from '../../src/input/track';

const deg = (d: number) => (d * Math.PI) / 180;
const round = (p: { x: number; y: number }) => ({ x: +p.x.toFixed(9), y: +p.y.toFixed(9) });
const END: Acquired = { kind: 'point', point: { x: 50, y: 20 }, mode: 'END' };

describe('OTRACK', () => {
  it('tracks horizontally and vertically from an acquired point', () => {
    const v = trackCursor({ x: 50.4, y: 80 }, { acquired: [END], tolerance: 1 })!;
    expect(round(v.point)).toEqual({ x: 50, y: 80 });
    expect(v.paths).toEqual([{ from: END.point, angle: deg(90), label: 'Endpoint' }]);
    expect(trackLabel(v, 2)).toBe('Endpoint: 60.00 < 90°');
    const h = trackCursor({ x: 10, y: 19.5 }, { acquired: [END], tolerance: 1 })!;
    expect(round(h.point)).toEqual({ x: 10, y: 20 });
    expect(h.paths[0]!.angle).toBeCloseTo(deg(180), 12);
    expect(trackCursor({ x: 10, y: 15 }, { acquired: [END], tolerance: 1 })).toBeUndefined();
  });

  it('goes to where the paths of two acquired points cross', () => {
    const mid: Acquired = { kind: 'point', point: { x: 0, y: 70 }, mode: 'MID' };
    const x = trackCursor({ x: 50.6, y: 69.3 }, { acquired: [END, mid], tolerance: 1 })!;
    expect(round(x.point)).toEqual({ x: 50, y: 70 });
    expect(x.paths.map((p) => p.label).sort()).toEqual(['Endpoint', 'Midpoint']);
    expect(trackLabel(x, 4)).toBe('Endpoint: < 90°, Midpoint: < 0°');
  });

  it('crosses polar tracking from the base point with a path from an acquired point', () => {
    const lock = trackCursor(
      { x: 50.5, y: 0.4 },
      { base: { x: 0, y: 0 }, polar: { increment: deg(90) }, acquired: [END], tolerance: 1 },
    )!;
    expect(round(lock.point)).toEqual({ x: 50, y: 0 });
    expect(lock.paths.map((p) => p.label).sort()).toEqual(['Endpoint', 'Polar']);
  });

  it('follows the polar angles from acquired points with POLARMODE bit 2', () => {
    const at45 = { x: 60, y: 30.2 };
    expect(trackCursor(at45, { acquired: [END], tolerance: 1 })).toBeUndefined();
    const lock = trackCursor(at45, {
      acquired: [END],
      polar: { increment: deg(45) },
      trackPolar: true,
      tolerance: 1,
    })!;
    expect(lock.paths[0]!.angle).toBeCloseTo(deg(45), 12);
    expect(round(lock.point)).toEqual({ x: 60.1, y: 30.1 });
  });
});

describe('EXTension', () => {
  const ext: Acquired = { kind: 'extension', point: { x: 100, y: 0 }, direction: { x: 1, y: 1 } };

  it('runs on from the end of a line, not back over it', () => {
    const on = trackCursor({ x: 110.5, y: 9.5 }, { acquired: [ext], tolerance: 1 })!;
    expect(round(on.point)).toEqual({ x: 110, y: 10 });
    expect(on.paths).toEqual([{ from: ext.point, angle: deg(45), label: 'Extension' }]);
    expect(trackCursor({ x: 95, y: -5 }, { acquired: [ext], tolerance: 1 })).toBeUndefined();
  });
});

describe('PARallel', () => {
  const par: Acquired = { kind: 'parallel', point: { x: 5, y: 5 }, direction: { x: 3, y: 4 } };

  it('runs from the base point parallel to the acquired line, either way', () => {
    const base = { x: 100, y: 100 };
    const fwd = trackCursor({ x: 130.4, y: 140 }, { base, acquired: [par], tolerance: 1 })!;
    expect(round(fwd.point)).toEqual(round({ x: 130 + 0.4 * 0.36, y: 140 + 0.4 * 0.48 }));
    expect(fwd.paths[0]!.label).toBe('Parallel');
    const back = trackCursor({ x: 70, y: 60.3 }, { base, acquired: [par], tolerance: 1 })!;
    expect(back.paths[0]!.angle).toBeCloseTo(Math.atan2(-4, -3) + 2 * Math.PI, 12);
    // No base point, nothing to run parallel from.
    expect(trackCursor({ x: 130.4, y: 140 }, { acquired: [par], tolerance: 1 })).toBeUndefined();
  });
});

describe('constrainCursor with tracking', () => {
  it('reports a polar lock as before and a tracking lock as `track`', () => {
    const base = { x: 0, y: 0 };
    const polar = constrainCursor(
      { x: 30, y: 0.3 },
      { base, polar: { increment: deg(90) }, acquired: [END], tolerance: 1 },
    );
    expect(polar.polar?.angle).toBe(0);
    expect(polar.track).toBeUndefined();
    const crossed = constrainCursor(
      { x: 50.5, y: 0.4 },
      { base, polar: { increment: deg(90) }, acquired: [END], tolerance: 1 },
    );
    expect(round(crossed.point)).toEqual({ x: 50, y: 0 });
    expect(crossed.track?.paths).toHaveLength(2);
  });

  it("meets an acquired point's path along ORTHO's axis", () => {
    const base = { x: 0, y: 0 };
    const c = constrainCursor(
      { x: 50.5, y: 7 },
      { base, ortho: true, acquired: [END], tolerance: 1 },
    );
    expect(round(c.point)).toEqual({ x: 50, y: 0 });
    expect(c.track?.paths.map((p) => p.label)).toEqual(['Ortho', 'Endpoint']);
    // Away from every path ORTHO alone applies.
    expect(
      constrainCursor({ x: 30, y: 7 }, { base, ortho: true, acquired: [END], tolerance: 1 }),
    ).toEqual({ point: { x: 30, y: 0 } });
  });

  it('tracks acquired points with no base point (the first point of a command)', () => {
    const c = constrainCursor({ x: 49.6, y: -40 }, { acquired: [END], tolerance: 1 });
    expect(round(c.point)).toEqual({ x: 50, y: -40 });
    expect(c.track?.paths[0]!.angle).toBeCloseTo(deg(270), 12);
  });
});
