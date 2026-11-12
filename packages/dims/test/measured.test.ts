// M2-35 part 10: the value a dimension measures, unformatted, for the Properties palette's
// Measurement row (AutoCAD's AcDbDimension measurement: a length in drawing units, an angle in
// radians), for every kind the dimension engine draws.
import { describe, expect, it } from 'vitest';
import type { DimensionGeometry } from '@triya/engine';
import { measuredValue } from '../src/index';

const common = {
  kind: 'DIMENSION',
  style: '27',
  textPosition: { x: 0, y: 0 },
  textUserPositioned: false,
  text: '',
  textRotation: 0,
  horizontalDirection: 0,
  attachment: 5,
  lineSpacingStyle: 1,
  lineSpacing: 1,
} as const;

const value = (g: object) => measuredValue({ geom: { ...common, ...g } as DimensionGeometry });

describe('measuredValue (M2-35 part 10)', () => {
  it('measures linear, aligned, radius and diameter dimensions', () => {
    const ends = { first: { x: 0, y: 0 }, second: { x: 30, y: 40 } };
    const at = { definitionPoint: { x: 30, y: 50 } };
    expect(value({ dimType: 'linear', ...ends, ...at, rotation: 0 })).toBeCloseTo(30, 12);
    expect(value({ dimType: 'linear', ...ends, ...at, rotation: Math.PI / 2 })).toBeCloseTo(40, 12);
    expect(value({ dimType: 'aligned', ...ends, ...at })).toBeCloseTo(50, 12);
    const chord = { chordPoint: { x: 6, y: 8 }, leaderLength: 0 };
    expect(value({ dimType: 'radius', definitionPoint: { x: 0, y: 0 }, ...chord })).toBe(10);
    // A diameter's DXF 10 is the far chord point.
    expect(value({ dimType: 'diameter', definitionPoint: { x: -6, y: -8 }, ...chord })).toBe(20);
  });

  it('measures angles in radians, the reflex one when the arc point is outside', () => {
    const three = {
      dimType: 'angular3pt',
      vertex: { x: 0, y: 0 },
      first: { x: 10, y: 0 },
      second: { x: 0, y: 10 },
    };
    expect(value({ ...three, definitionPoint: { x: 5, y: 5 } })).toBeCloseTo(Math.PI / 2, 12);
    expect(value({ ...three, definitionPoint: { x: -5, y: -5 } })).toBeCloseTo(
      (3 * Math.PI) / 2,
      12,
    );
    const lines = {
      dimType: 'angular',
      line1Start: { x: 0, y: 0 },
      line1End: { x: 10, y: 0 },
      line2Start: { x: 0, y: 0 },
      definitionPoint: { x: 10, y: 10 },
      arcPoint: { x: 8, y: 3 },
    };
    expect(value(lines)).toBeCloseTo(Math.PI / 4, 12);
  });

  it('measures ordinate, jogged radius and arc length dimensions', () => {
    const ordinate = {
      dimType: 'ordinate',
      definitionPoint: { x: 2, y: 1 },
      feature: { x: 10, y: -5 },
      leaderEnd: { x: 40, y: -5 },
    };
    expect(value({ ...ordinate, axis: 'y' })).toBe(6);
    expect(value({ ...ordinate, axis: 'x' })).toBe(8);
    const jogged = {
      kind: 'LARGE_RADIAL_DIMENSION',
      dimType: 'jogged',
      definitionPoint: { x: 0, y: 0 },
      chordPoint: { x: 40, y: 0 },
      overrideCenter: { x: 0, y: 4 },
      jogPoint: { x: 20, y: 2 },
      leaderLength: 0,
    };
    expect(value(jogged)).toBe(40);
    const sweep = Math.PI / 3;
    const arc = {
      kind: 'ARC_DIMENSION',
      dimType: 'arc',
      center: { x: 0, y: 0 },
      first: { x: 10, y: 0 },
      second: { x: 10 * Math.cos(sweep), y: 10 * Math.sin(sweep) },
      startAngle: 0,
      endAngle: sweep,
      partial: false,
      definitionPoint: { x: 15, y: 5 },
    };
    expect(value(arc)).toBeCloseTo(10 * sweep, 12);
  });

  it('has no value for a degenerate dimension or another object', () => {
    expect(
      value({
        dimType: 'angular3pt',
        vertex: { x: 0, y: 0 },
        first: { x: 0, y: 0 },
        second: { x: 0, y: 10 },
        definitionPoint: { x: 5, y: 5 },
      }),
    ).toBeUndefined();
    expect(
      measuredValue({ geom: { kind: 'POINT', position: { x: 0, y: 0 } } } as never),
    ).toBeUndefined();
  });
});
