// Moving, turning and scaling a REGION's ACIS body (M1-75 part 39): the motion is composed into
// the body's transform record, edited in place in SAT text and SAB binary, so every other record
// stays byte for byte as read. The REGION boundary read back is the boundary moved.
import { describe, expect, it } from 'vitest';
import { readSab, readSat } from '../src/acis/records';
import { regionBoundary, type RegionBoundary } from '../src/acis/region';
import { moveBody, movePoint, type PlanMotion } from '../src/acis/transform';
import { sab, sat, square } from './acis-fixtures';

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const text = (b: Uint8Array) => String.fromCharCode(...b);
const read = (b: Uint8Array) =>
  text(b.subarray(0, 15)) === 'ACIS BinaryFile' ? readSab(b) : readSat(text(b));
const boundary = (b: Uint8Array): RegionBoundary => {
  const r = regionBoundary(read(b));
  if (typeof r === 'string') throw new Error(r);
  return r;
};

/** Turned 90° about the origin, doubled, moved by (7, −3), and lifted from Z 5 to Z 8. */
const motion: PlanMotion = {
  rotation: Math.PI / 2,
  scale: 2,
  offset: { x: 7, y: -3 },
  from: 5,
  to: 8,
};
/** `p` (plan) under `motion`: (x, y) → 2 · (−y, x) + (7, −3). */
const at = (x: number, y: number) => ({ x: -2 * y + 7, y: 2 * x - 3 });

/** The fixture's square (corners (100, 200)–(110, 210), the top a half circle) moved. */
const moved = {
  elevation: 8,
  down: false,
  loops: [
    {
      face: 0,
      edges: [
        { kind: 'LINE', start: at(100, 200), end: at(110, 200) },
        { kind: 'LINE', start: at(110, 200), end: at(110, 210) },
        {
          kind: 'ARC',
          center: at(105, 210),
          radius: 10,
          startAngle: Math.PI / 2,
          endAngle: -Math.PI / 2,
        },
        { kind: 'LINE', start: at(100, 210), end: at(100, 200) },
      ],
    },
    { face: 0, edges: [{ kind: 'CIRCLE', center: at(103, 204), radius: 2 }] },
  ],
};

/** Recursively equal, numbers to 1e-9 (angles compared on the circle). */
function close(actual: unknown, expected: unknown, path = ''): void {
  if (typeof expected === 'number') {
    expect(typeof actual, path).toBe('number');
    const a = actual as number;
    const d = /Angle$/.test(path)
      ? Math.abs(Math.atan2(Math.sin(a - expected), Math.cos(a - expected)))
      : Math.abs(a - expected);
    expect(d, `${path}: ${String(actual)} vs ${expected}`).toBeLessThan(1e-9);
    return;
  }
  if (expected && typeof expected === 'object') {
    expect(Object.keys(actual as object).sort(), path).toEqual(Object.keys(expected).sort());
    for (const [k, v] of Object.entries(expected)) {
      close((actual as Record<string, unknown>)[k], v, `${path}.${k}`);
    }
    return;
  }
  expect(actual, path).toBe(expected);
}

/** A SAT transform line: its header, 13 numbers to 1e-9, its flags, and the closing `#`. */
function record(line: string, header: string, numbers: number[], flags: string[]): void {
  expect(line.startsWith(`${header} `), line).toBe(true);
  const tokens = line.slice(header.length).trim().split(' ');
  expect(tokens).toHaveLength(13 + 3 + 1);
  tokens
    .slice(0, 13)
    .forEach((t, i) => expect(Math.abs(Number(t) - numbers[i]!), line).toBeLessThan(1e-9));
  expect(tokens.slice(13)).toEqual([...flags, '#']);
}

describe('moveBody', () => {
  it('composes the motion into the SAT transform record and leaves every other line alone', () => {
    const before = bytes(sat(square()));
    const after = moveBody(before, motion);
    if (typeof after === 'string') throw new Error(after);
    close(boundary(after), moved);
    const lines = (b: Uint8Array) => text(b).split('\n');
    const changed = lines(after).filter((l, i) => l !== lines(before)[i]);
    expect(changed).toHaveLength(1);
    // Rows of the turn (row vectors, as ACIS applies them), the translation, the scale, flags.
    record(
      changed[0]!,
      'transform $-1 -1',
      [0, 1, 0, -1, 0, 0, 0, 0, 1, -393, 197, 8, 2],
      ['rotate', 'no_reflect', 'no_shear'],
    );
  });

  it('edits the SAB transform in place, so only its doubles and flags change', () => {
    const before = sab(square());
    const after = moveBody(before, motion);
    if (typeof after === 'string') throw new Error(after);
    close(boundary(after), moved);
    expect(after.length).toBe(before.length);
    const xf = read(before).offsets[3]!;
    const changedAt = [...after.keys()].filter((i) => after[i] !== before[i]);
    expect(changedAt.length).toBeGreaterThan(0);
    // Every changed byte lies inside the transform record, between its first field and its end.
    expect(Math.min(...changedAt)).toBeGreaterThanOrEqual(xf[0]!);
    expect(Math.max(...changedAt)).toBeLessThanOrEqual(xf[xf.length - 1]!);
    // The rotate flag is now true (tag 10); reflect and shear stay false (tag 11).
    expect([...xf.slice(-3)].map((o) => after[o])).toEqual([10, 11, 11]);
  });

  it('keeps a moved body moving: two motions compose like one', () => {
    const half: PlanMotion = {
      rotation: Math.PI / 4,
      scale: Math.SQRT2,
      offset: { x: 0, y: 0 },
      from: 5,
      to: 5,
    };
    const once = moveBody(bytes(sat(square())), half);
    if (typeof once === 'string') throw new Error(once);
    // (x, y) → √2 · R45 (x, y) twice is 2 · R90 (x, y); then the rest of `motion`.
    const twice = moveBody(once, { ...half, offset: motion.offset, from: 5, to: 8 });
    if (typeof twice === 'string') throw new Error(twice);
    close(boundary(twice), moved);
  });

  it('writes R14 SAT flags as numbers, as save version 106 does', () => {
    const r14 =
      '106 3 1 0\r\nbody $-1 $1 $-1 $2 #\r\nlump $-1 $-1 $-1 $0 #\r\n' +
      'transform $-1 1 0 0 0 1 0 0 0 1 15.25 -223.5 0 1 0 0 0 #\r\n';
    const after = moveBody(bytes(r14), { ...motion, from: 0, to: 0 });
    if (typeof after === 'string') throw new Error(after);
    record(
      text(after).split('\r\n')[3]!,
      'transform $-1',
      [0, 1, 0, -1, 0, 0, 0, 0, 1, 454, 27.5, 0, 2],
      ['1', '0', '0'],
    );
  });

  it('refuses a body without a transform, and data it cannot read', () => {
    const none = square().map((r) =>
      r[0] === 'body' ? (['body', 'body', '$lump $-1 $-1'] as typeof r) : r,
    );
    expect(moveBody(bytes(sat(none)), motion)).toBe('an ACIS body without a transform record');
    expect(moveBody(new Uint8Array([1, 2, 3]), motion)).toBe('ACIS data Triya cannot read');
  });

  it('moves a point as it moves the body', () => {
    close(movePoint(motion, { x: 100, y: 200, z: 5 }), { x: -393, y: 197, z: 8 });
    close(movePoint(motion, { x: 0, y: 0, z: 6 }), { x: 7, y: -3, z: 10 });
  });
});
