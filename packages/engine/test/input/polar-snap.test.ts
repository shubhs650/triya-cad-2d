// M3-06 part 3: PolarSnap (SNAPTYPE 1, POLARDIST) and polar angles relative to the last segment
// (POLARMODE 1), as AutoCAD 2024 Help describes them ("About Polar Tracking and PolarSnap",
// "Polar Tracking Tab (Drafting Settings Dialog Box)").
import { describe, expect, it } from 'vitest';
import { constrainCursor, polarLabel, polarTrack } from '../../src/input/constrain';
import { trackLabel, type Acquired } from '../../src/input/track';

const deg = (d: number) => (d * Math.PI) / 180;
const round = (p: { x: number; y: number }) => ({ x: +p.x.toFixed(9), y: +p.y.toFixed(9) });
const base = { x: 0, y: 0 };
const END: Acquired = { kind: 'point', point: { x: 50, y: 40 }, mode: 'END' };

describe('PolarSnap', () => {
  it('snaps along a polar path to multiples of the polar distance from the base point', () => {
    const c = constrainCursor(
      { x: 13.1, y: 0.4 },
      { base, polar: { increment: deg(90) }, polarSnap: 4, tolerance: 1 },
    );
    expect(c.point).toEqual({ x: 12, y: 0 });
    expect(c.polar?.distance).toBe(12);
    expect(polarLabel(c.polar!)).toBe('Polar: 12.0000 < 0°');
    // Along 45° too: the distance rounds, not the coordinates.
    const d = constrainCursor(
      { x: 6, y: 6.2 },
      { base, polar: { increment: deg(45) }, polarSnap: 4, tolerance: 1 },
    );
    expect(d.polar?.distance).toBeCloseTo(8, 12);
    expect(round(d.point)).toEqual(round({ x: 8 / Math.SQRT2, y: 8 / Math.SQRT2 }));
  });

  it('leaves the cursor free off every tracking path (no grid snap)', () => {
    expect(
      constrainCursor(
        { x: 13.1, y: 7.4 },
        { base, polar: { increment: deg(90) }, polarSnap: 4, tolerance: 1 },
      ),
    ).toEqual({ point: { x: 13.1, y: 7.4 } });
    // Without polar tracking or a base point there is nothing to snap along.
    expect(constrainCursor({ x: 13.1, y: 0.4 }, { polarSnap: 4 })).toEqual({
      point: { x: 13.1, y: 0.4 },
    });
  });

  it('snaps along an object snap tracking path from the acquired point', () => {
    const c = constrainCursor({ x: 49.6, y: 27 }, { acquired: [END], polarSnap: 5, tolerance: 1 });
    expect(round(c.point)).toEqual({ x: 50, y: 25 });
    expect(trackLabel(c.track!)).toBe('Endpoint: 15.0000 < 270°');
  });

  it('keeps the crossing of two paths where it is', () => {
    const c = constrainCursor(
      { x: 50.4, y: 0.3 },
      { base, polar: { increment: deg(90) }, acquired: [END], polarSnap: 7, tolerance: 1 },
    );
    expect(round(c.point)).toEqual({ x: 50, y: 0 });
    expect(c.track?.paths).toHaveLength(2);
  });
});

describe('Relative to last segment (POLARMODE 1)', () => {
  // The last segment was drawn at 30°: its direction is what the angles count from.
  const relative = deg(30);

  it('tracks the increment angles from the last segment', () => {
    // 10 along 120° (90° from the segment), 0.3 off it.
    const at = { x: -5 - 0.3 * Math.cos(deg(30)), y: 10 * Math.sin(deg(120)) - 0.15 };
    const c = constrainCursor(at, { base, polar: { increment: deg(90), relative }, tolerance: 1 });
    expect(c.polar?.angle).toBeCloseTo(deg(120), 12);
    expect(c.polar?.relative).toBe(relative);
    expect(polarLabel(c.polar!)).toBe('Relative Polar: 10.0000 < 90°');
    // Absolute 90° is no longer a path.
    expect(
      constrainCursor(
        { x: 0.3, y: 10 },
        { base, polar: { increment: deg(90), relative }, tolerance: 0.5 },
      ).polar,
    ).toBeUndefined();
  });

  it('counts the additional angles from the last segment too', () => {
    const t = polarTrack(
      base,
      { x: Math.cos(deg(40)) * 10, y: Math.sin(deg(40)) * 10 },
      { increment: deg(90), additional: [deg(10)], relative },
      0.5,
    )!;
    expect(t.angle).toBeCloseTo(deg(40), 12);
    expect(polarLabel(t)).toBe('Relative Polar: 10.0000 < 10°');
  });

  it('names a relative polar path crossing an acquired point path', () => {
    const c = constrainCursor(
      { x: 50.1, y: 50 * Math.tan(deg(30)) - 0.5 },
      { base, polar: { increment: deg(90), relative }, acquired: [END], tolerance: 1 },
    );
    expect(c.track && trackLabel(c.track)).toBe('Endpoint: < 270°, Relative Polar: < 0°');
  });

  it("OTRACK's polar paths from acquired points stay absolute", () => {
    const c = constrainCursor(
      { x: 49.7, y: 20 },
      { polar: { increment: deg(90), relative }, trackPolar: true, acquired: [END], tolerance: 1 },
    );
    expect(c.track && trackLabel(c.track)).toBe('Endpoint: 20.0000 < 270°');
  });
});
