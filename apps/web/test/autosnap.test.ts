// AutoSnap's tooltip and marker for AutoCAD's Deferred Tangent and Deferred Perpendicular
// (M3-01 part 2): the mode's marker with an ellipsis after it, "Deferred Tangent" as its tip.
import { describe, expect, it } from 'vitest';
import { markerPrimitives, snapLabel } from '../src/canvas/autosnap';

describe('AutoSnap deferred markers', () => {
  it('names a deferred TAN or PER as AutoCAD does', () => {
    expect(snapLabel('TAN')).toBe('Tangent');
    expect(snapLabel('TAN', true)).toBe('Deferred Tangent');
    expect(snapLabel('PER', true)).toBe('Deferred Perpendicular');
  });

  it("draws the mode's marker and three dots after it", () => {
    const p = { x: 10, y: 10 };
    const plain = markerPrimitives('TAN', p, 0.1, '#fff');
    const deferred = markerPrimitives('TAN', p, 0.1, '#fff', true);
    expect(deferred.slice(0, plain.length)).toEqual(plain);
    expect(deferred).toHaveLength(plain.length + 1);
    const dots = deferred.at(-1)!;
    if (dots.kind !== 'stroke') throw new Error('the dots are a stroke');
    // Three closed squares, all to the right of the marker (5 px half-size at 0.1 per px).
    const path = [...dots.path];
    expect(path.length).toBe(3 * 13);
    for (let k = 0; k < 3; k++) expect(path[13 * k + 1]!).toBeGreaterThan(10.5);
  });
});
