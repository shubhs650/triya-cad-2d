// M3-06 part 7: the drafting aids in a UCS and with SNAPANG. AutoCAD 2024 Help, "SNAPANG" (the
// snap and grid turn "relative to the current UCS"), "ORTHOMODE" (horizontal or vertical
// "relative to the UCS", turned with the snap angle) and "Polar Tracking Tab": absolute polar
// angles are based on the current UCS, and object snap tracking's paths are its horizontal and
// vertical.
import { describe, expect, it } from 'vitest';
import { constrainCursor, orthoPoint, polarLabel, snapToGrid } from '../../src/input/constrain';
import { trackLabel, type Acquired } from '../../src/input/track';
import { toUcs, toWorld, turnToUcs, ucsOf } from '../../src/input/ucs';

const deg = (d: number) => (d * Math.PI) / 180;
const round = (p: { x: number; y: number }) => ({ x: +p.x.toFixed(9), y: +p.y.toFixed(9) });

describe('a plan UCS', () => {
  it('turns points into and out of its coordinates', () => {
    const u = { origin: { x: 10, y: 5 }, angle: deg(90) };
    expect(toWorld(u, { x: 3, y: 4 })).toEqual({ x: 6, y: 8 });
    expect(toUcs(u, { x: 6, y: 8 })).toEqual({ x: 3, y: 4 });
    expect(turnToUcs(u, { x: 0, y: 1 })).toEqual({ x: 1, y: 0 });
  });

  it('is read from the header, and the WCS where it is missing or not in plan', () => {
    const header = new Map<string, unknown>([
      ['$UCSORG', { x: 1, y: 2, z: 0 }],
      ['$UCSXDIR', { x: 0, y: -1, z: 0 }],
      ['$UCSYDIR', { x: 1, y: 0, z: 0 }],
    ]);
    expect(ucsOf(header)).toEqual({ origin: { x: 1, y: 2 }, angle: deg(270) });
    expect(ucsOf(header, true)).toEqual({ origin: { x: 0, y: 0 }, angle: 0 });
    // Y clockwise from X: the Z axis points down, which plan input cannot follow.
    header.set('$UCSYDIR', { x: -1, y: 0, z: 0 });
    expect(ucsOf(header)).toEqual({ origin: { x: 0, y: 0 }, angle: 0 });
  });
});

describe('ORTHO and SNAP turned', () => {
  it('keeps the turned axis the cursor is nearer to', () => {
    expect(round(orthoPoint({ x: 0, y: 0 }, { x: 10, y: 9 }, deg(45)))).toEqual({
      x: 9.5,
      y: 9.5,
    });
    expect(round(orthoPoint({ x: 0, y: 0 }, { x: -1, y: 10 }, deg(45)))).toEqual({
      x: -5.5,
      y: 5.5,
    });
  });

  it('snaps to a grid turned about its base', () => {
    const p = snapToGrid({ x: 7.2, y: 7 }, { x: 10, y: 10 }, { x: 0, y: 0 }, deg(45));
    expect(round(p)).toEqual(round({ x: 10 * Math.cos(deg(45)), y: 10 * Math.sin(deg(45)) }));
    expect(snapToGrid({ x: 9, y: 11 }, { x: 10, y: 10 }, { x: 0, y: 0 }, 0)).toEqual({
      x: 10,
      y: 10,
    });
  });

  it('turns snap and ORTHO by the UCS and the snap angle together', () => {
    const c = constrainCursor(
      { x: 9, y: 9.4 },
      { base: { x: 0, y: 0 }, ortho: true, ucs: deg(30), snapAngle: deg(15) },
    );
    expect(round(c.point)).toEqual(round({ x: 9.2, y: 9.2 }));
    const s = constrainCursor({ x: 0.2, y: 9.8 }, { snap: { x: 10, y: 10 }, ucs: deg(90) });
    expect(round(s.point)).toEqual({ x: 0, y: 10 });
  });
});

describe('tracking in a UCS', () => {
  it('counts polar angles from the UCS’s X axis, as the tooltip shows them', () => {
    const c = constrainCursor(
      { x: 7.1, y: 7 },
      { base: { x: 0, y: 0 }, polar: { increment: deg(90) }, ucs: deg(45), tolerance: 0.5 },
    );
    expect(c.polar).toBeDefined();
    expect(round(c.point)).toEqual(round({ x: 7.05, y: 7.05 }));
    expect(polarLabel(c.polar!)).toBe('Polar: 9.9702 < 0°');
    // A path the world's axes would give is not one of the UCS's.
    const off = constrainCursor(
      { x: 10, y: 0.1 },
      { base: { x: 0, y: 0 }, polar: { increment: deg(90) }, ucs: deg(45), tolerance: 0.5 },
    );
    expect(off.polar).toBeUndefined();
  });

  it('tracks along the UCS’s horizontal and vertical from an acquired point', () => {
    const end: Acquired = { kind: 'point', point: { x: 0, y: 0 }, mode: 'END' };
    const c = constrainCursor({ x: -5, y: 5.2 }, { acquired: [end], ucs: deg(45), tolerance: 0.5 });
    expect(c.track).toBeDefined();
    expect(trackLabel(c.track!)).toMatch(/^Endpoint: 7\.\d+ < 90°$/);
  });
});
