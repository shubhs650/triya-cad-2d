// M2-06 part 2: STRETCH's geometry, AutoCAD 2024's rules ("STRETCH (Command)"): points inside
// the window move, objects placed by one point move only when it is inside, an arc keeps its
// chord height, a spline loses its fit data, kinds Triya cannot regenerate move only whole.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  inBox,
  stretchGeometry,
  stretchObjects,
  type ArcGeometry,
  type EntityGeometry,
  type HatchGeometry,
  type StretchResult,
} from '../../src/index';
import { circleGeom, entityInit, lineGeom, sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
/** The window from (5,−5) to (15,15): x ≥ 5. */
const WINDOW = inBox({ minX: 5, minY: -5, maxX: 15, maxY: 15 });
const D = { x: 2, y: 1 };
const stretch = (g: EntityGeometry): StretchResult => stretchGeometry(g, WINDOW, D);
const shape = (g: EntityGeometry): EntityGeometry => {
  const r = stretch(g);
  if (r.kind !== 'shape') throw new Error(`expected a shape, got ${r.kind}`);
  return r.geom;
};

describe('stretchGeometry', () => {
  it('moves the end of a line that is inside, and moves a line wholly inside', () => {
    const g = shape(lineGeom(0, 0, 10, 0)) as { start: unknown; end: unknown };
    expect(g.start).toEqual({ x: 0, y: 0 });
    expect(g.end).toEqual({ x: 12, y: 1 });
    expect(stretch(lineGeom(6, 0, 10, 0)).kind).toBe('move');
    expect(stretch(lineGeom(0, 0, 4, 0)).kind).toBe('none');
  });

  it('moves the vertices of a polyline inside and keeps their bulges', () => {
    const g = shape({
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 0.5 },
        { x: 10, y: 10, bulge: 0 },
      ],
    });
    expect(g.kind === 'LWPOLYLINE' && g.vertices).toEqual([
      { x: 0, y: 0, bulge: 0 },
      { x: 12, y: 1, bulge: 0.5 },
      { x: 12, y: 11, bulge: 0 },
    ]);
  });

  it('keeps an arc’s chord height when one end moves', () => {
    // A half circle r 5 from (10,0) to (0,0) through (5,5): chord 10, height 5.
    const arc: ArcGeometry = {
      kind: 'ARC',
      center: { x: 5, y: 0 },
      radius: 5,
      startAngle: 0,
      endAngle: Math.PI,
    };
    const g = stretchGeometry(arc, inBox({ minX: 8, minY: -1, maxX: 12, maxY: 1 }), {
      x: 10,
      y: 0,
    });
    expect(g.kind).toBe('shape');
    const a = (g as { geom: ArcGeometry }).geom;
    const end = (t: number) => [
      r6(a.center.x + a.radius * Math.cos(t)),
      r6(a.center.y + a.radius * Math.sin(t)),
    ];
    expect(end(a.startAngle)).toEqual([20, 0]);
    expect(end(a.endAngle)).toEqual([0, 0]);
    // Chord 20, height 5: r = (10² + 5²) / (2·5) = 12.5, the centre 7.5 below the chord.
    expect(r6(a.radius)).toBe(12.5);
    expect([r6(a.center.x), r6(a.center.y)]).toEqual([10, -7.5]);
  });

  it('moves objects placed by one point only when that point is inside', () => {
    expect(stretch(circleGeom(6, 0, 3)).kind).toBe('move');
    expect(stretch(circleGeom(4, 0, 3)).kind).toBe('none');
    const text = {
      kind: 'TEXT',
      value: 'A',
      style: '11',
      position: { x: 0, y: 0 },
      alignmentPoint: { x: 6, y: 0 },
      height: 1,
      rotation: 0,
      widthFactor: 1,
      oblique: 0,
      halign: 2,
      valign: 0,
      backward: false,
      upsideDown: false,
    } as const;
    // Right-justified text is placed by its alignment point.
    expect(stretch(text).kind).toBe('move');
    expect(stretch({ ...text, halign: 0 }).kind).toBe('none');
  });

  it('moves control points of a spline and drops its fit data', () => {
    const g = shape({
      kind: 'SPLINE',
      degree: 1,
      knots: [0, 0, 1, 1],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      fitPoints: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      closed: false,
      periodic: false,
    });
    expect(g.kind === 'SPLINE' && g.controlPoints[1]).toEqual({ x: 12, y: 1 });
    expect(g.kind === 'SPLINE' && g.fitPoints).toBeUndefined();
  });

  it('leaves a hatch partly inside, saying why, and moves one wholly inside', () => {
    const hatch = (x0: number): HatchGeometry => ({
      kind: 'HATCH',
      pattern: 'SOLID',
      solid: true,
      associative: false,
      style: 0,
      patternType: 1,
      patternAngle: 0,
      patternScale: 1,
      double: false,
      loops: [
        {
          flags: 2,
          polyline: {
            closed: true,
            vertices: [
              { x: x0, y: 0, bulge: 0 },
              { x: 10, y: 0, bulge: 0 },
              { x: 10, y: 5, bulge: 0 },
            ],
          },
        },
      ],
      patternLines: [],
      seedPoints: [],
    });
    expect(stretch(hatch(0))).toEqual({
      kind: 'whole',
      reason: 'a hatch is only moved, with all of it in the window',
    });
    expect(stretch(hatch(6)).kind).toBe('move');
  });
});

describe('stretchObjects', () => {
  it('moves what the canvas says is inside or picked, and reshapes what the window crosses', () => {
    const base = sampleInit();
    const init = {
      ...base,
      entities: [
        entityInit('40', lineGeom(0, 0, 10, 0)),
        entityInit('41', lineGeom(0, 20, 4, 20)),
        entityInit('42', lineGeom(6, 2, 8, 2)),
      ],
    };
    const model = DocumentModel.create(init);
    const id = (h: string) => model.entityByHandle(h)!.id;
    const b = new ChangeSetBuilder(model);
    const report = stretchObjects(
      b,
      model,
      [id('40'), id('41'), id('42')],
      {
        box: { minX: 5, minY: -5, maxX: 15, maxY: 15 },
        inside: new Set([id('42')]),
        crossing: new Set([id('40'), id('42')]),
      },
      D,
    );
    model.apply(b.build());
    expect(report.ids).toHaveLength(3);
    const ends = (h: string) => {
      const g = model.entityByHandle(h)!.geom as {
        start: { x: number; y: number };
        end: { x: number; y: number };
      };
      return [g.start.x, g.start.y, g.end.x, g.end.y];
    };
    expect(ends('40')).toEqual([0, 0, 12, 1]);
    // Picked individually (outside the window): moved.
    expect(ends('41')).toEqual([2, 21, 6, 21]);
    expect(ends('42')).toEqual([8, 3, 10, 3]);
  });
});

describe('stretchGeometry of a dimension that can be regenerated (M2-10 part 3)', () => {
  const dim = {
    kind: 'DIMENSION',
    dimType: 'linear',
    style: '27',
    first: { x: 0, y: 0 },
    second: { x: 10, y: 0 },
    definitionPoint: { x: 10, y: 3 },
    textPosition: { x: 0, y: 4 },
    textUserPositioned: false,
    text: '',
    textRotation: 0,
    horizontalDirection: 0,
    attachment: 5,
    lineSpacingStyle: 1,
    lineSpacing: 1,
    rotation: 0,
  } as EntityGeometry;
  const regen = (g: EntityGeometry, inside = WINDOW) =>
    stretchGeometry(g, inside, D, { dimensions: true });

  it('moves the definition points inside the window', () => {
    const r = regen(dim);
    expect(r).toMatchObject({
      kind: 'shape',
      geom: {
        first: { x: 0, y: 0 },
        second: { x: 12, y: 1 },
        definitionPoint: { x: 12, y: 4 },
        textPosition: { x: 0, y: 4 },
        textUserPositioned: false,
      },
    });
  });

  it('places text moved on its own as the user placed it', () => {
    const r = regen(dim, inBox({ minX: -1, minY: 3.5, maxX: 1, maxY: 5 }));
    expect(r).toMatchObject({
      kind: 'shape',
      geom: { textPosition: { x: 2, y: 5 }, textUserPositioned: true, second: { x: 10, y: 0 } },
    });
  });

  it('moves a dimension wholly inside, and leaves one wholly outside', () => {
    expect(regen(dim, () => true)).toEqual({ kind: 'move' });
    expect(regen(dim, () => false)).toEqual({ kind: 'none' });
  });

  it('only moves a dimension whole without a dimension engine', () => {
    expect(stretch(dim)).toMatchObject({ kind: 'whole' });
  });

  describe('an arc length dimension (M2-30)', () => {
    // The arc of radius 10 about (0,0) from 0° to 90°, its dimension arc at radius 15.
    const arc = {
      ...dim,
      kind: 'ARC_DIMENSION',
      dimType: 'arc',
      center: { x: 0, y: 0 },
      first: { x: 10, y: 0 },
      second: { x: 0, y: 10 },
      startAngle: 0,
      endAngle: Math.PI / 2,
      partial: false,
      definitionPoint: { x: 10.6, y: 10.6 },
      textPosition: { x: 11, y: 11 },
      leader: [
        { x: 7.07, y: 7.07 },
        { x: 10.6, y: 10.6 },
      ],
    } as EntityGeometry;

    it('keeps DXF 40/41 the angles of its ends about the centre when STRETCH moves an end', () => {
      // The window takes the first end (10,0) only; it moves by (2,1).
      const r = regen(arc, inBox({ minX: 9, minY: -1, maxX: 11, maxY: 1 }));
      if (r.kind !== 'shape') throw new Error(r.kind);
      const g = r.geom as Extract<EntityGeometry, { kind: 'ARC_DIMENSION' }>;
      expect(g.first).toEqual({ x: 12, y: 1 });
      expect(g.startAngle).toBeCloseTo(Math.atan2(1, 12), 12);
      expect(g.endAngle).toBeCloseTo(Math.PI / 2, 12);
      // Angles stay in [0, 2π), as AutoCAD writes them.
      const down = stretchGeometry(
        arc,
        inBox({ minX: 9, minY: -1, maxX: 11, maxY: 1 }),
        { x: 0, y: -2 },
        {
          dimensions: true,
        },
      );
      if (down.kind !== 'shape') throw new Error(down.kind);
      const dg = down.geom as Extract<EntityGeometry, { kind: 'ARC_DIMENSION' }>;
      expect(dg.startAngle).toBeCloseTo(2 * Math.PI + Math.atan2(-2, 10), 12);
    });

    it('stretches its leader points with the other definition points', () => {
      const r = regen(arc, inBox({ minX: 10, minY: 10, maxX: 12, maxY: 12 }));
      if (r.kind !== 'shape') throw new Error(r.kind);
      const g = r.geom as Extract<EntityGeometry, { kind: 'ARC_DIMENSION' }>;
      expect(g.leader).toEqual([
        { x: 7.07, y: 7.07 },
        { x: 12.6, y: 11.6 },
      ]);
      expect(g.definitionPoint).toEqual({ x: 12.6, y: 11.6 });
      // All of it inside: moved whole.
      expect(regen(arc, () => true)).toEqual({ kind: 'move' });
      // Only the leader's points inside: a shape, not a move.
      const leaderOnly = regen(arc, inBox({ minX: 7, minY: 7, maxX: 7.1, maxY: 7.1 }));
      expect(leaderOnly.kind).toBe('shape');
    });
  });
});
