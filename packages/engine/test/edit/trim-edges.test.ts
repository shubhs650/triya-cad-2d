// M3-12 part 4: the cutting and boundary edges of objects that are not curves themselves
// (`edit/trim-edges.ts`): block references (nested, MINSERT, nonuniformly scaled), dimensions,
// tables, leaders, text by its drawn box, attributes, regions, viewports and chosen hatches.
import { describe, expect, it } from 'vitest';
import {
  edgeTexts,
  objectEdgeCurves,
  toleranceForSize,
  type Curve,
  type EdgeOptions,
  type Entity,
  type EntityGeometry,
  type Vec2,
} from '../../src/index';
import { setup } from '../commands/edit-harness';

const tol = toleranceForSize(100);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pt = (p: Vec2) => [r6(p.x), r6(p.y)];
const PLAIN: EdgeOptions = { extend: false, hatches: false };

/** A curve in a few numbers, for comparing. */
function shape(c: Curve): unknown {
  switch (c.kind) {
    case 'LINE':
      return ['LINE', ...pt(c.start), ...pt(c.end)];
    case 'CIRCLE':
      return ['CIRCLE', ...pt(c.center), r6(c.radius)];
    case 'ARC':
      return ['ARC', ...pt(c.center), r6(c.radius), r6(c.startAngle), r6(c.endAngle)];
    case 'ELLIPSE':
      return ['ELLIPSE', ...pt(c.center), ...pt(c.majorAxis), r6(c.ratio)];
    case 'XLINE':
    case 'RAY':
      return [c.kind, ...pt(c.base), ...pt(c.direction)];
    case 'LWPOLYLINE':
      return ['LWPOLYLINE', c.closed, ...c.vertices.flatMap((v) => [...pt(v), v.bulge])];
    default:
      return [c.kind];
  }
}

const insert = (extra: Record<string, unknown> = {}): EntityGeometry =>
  ({
    kind: 'INSERT',
    block: '50',
    position: { x: 10, y: 10 },
    scale: { x: 2, y: 2, z: 2 },
    rotation: Math.PI / 2,
    attributes: [],
    ...extra,
  }) as never;

const text = (value: string, x: number, y: number): EntityGeometry =>
  ({
    kind: 'TEXT',
    value,
    style: '16',
    position: { x, y },
    height: 1,
    rotation: 0,
    widthFactor: 1,
    oblique: 0,
    halign: 0,
    valign: 0,
  }) as never;

/** A canvas that draws every text in a box 2 per character wide and 1 high from its position. */
const textBox = (t: { value?: string; position: Vec2 }): Vec2[] => {
  const w = 2 * (t.value?.length ?? 1);
  const { x, y } = t.position;
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + 1 },
    { x, y: y + 1 },
  ];
};

/** The edges of the object with handle `h`, its texts measured as `textBox` draws them. */
function edgesOf(model: ReturnType<typeof setup>['model'], e: Entity, o: EdgeOptions = PLAIN) {
  const boxes = new Map<object, Vec2[]>();
  for (const t of edgeTexts(model, e, o)) boxes.set(t.key, textBox(t.text as never));
  return objectEdgeCurves({ model, tol, textBox: (k) => boxes.get(k) }, e, o).map(shape);
}

describe('objectEdgeCurves', () => {
  it("cuts with a block reference's objects carried by its transform", () => {
    const { model, byHandle } = setup([insert()]);
    // Block B: line (0,0)-(1,0) and circle (1,0) r 0.5; scaled 2, turned 90°, at (10,10).
    expect(edgesOf(model, byHandle('40')!)).toEqual([
      ['LINE', 10, 10, 10, 12],
      ['CIRCLE', 10, 12, 1],
    ]);
    // With EDGEMODE 1 the block's line goes on as an xline, its circle stays a circle.
    expect(edgesOf(model, byHandle('40')!, { extend: true, hatches: false })).toEqual([
      ['XLINE', 10, 10, 0, 2],
      ['CIRCLE', 10, 12, 1],
    ]);
  });

  it('draws a circle of a nonuniformly scaled reference as an ellipse, and every MINSERT cell', () => {
    const { model, byHandle } = setup([
      insert({ position: { x: 0, y: 0 }, rotation: 0, scale: { x: 4, y: 2, z: 1 } }),
      insert({
        position: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
        array: { columns: 2, rows: 1, columnSpacing: 5, rowSpacing: 0 },
      }),
    ]);
    expect(edgesOf(model, byHandle('40')!)).toEqual([
      ['LINE', 0, 0, 4, 0],
      ['ELLIPSE', 4, 0, 2, 0, 0.5],
    ]);
    expect(edgesOf(model, byHandle('41')!)).toEqual([
      ['LINE', 0, 0, 1, 0],
      ['CIRCLE', 1, 0, 0.5],
      ['LINE', 5, 0, 6, 0],
      ['CIRCLE', 6, 0, 0.5],
    ]);
  });

  it('follows nested references and leaves out objects on layers off and invisible ones', () => {
    // 42 is a reference to B inside B's own definition would recurse: use a second block.
    const { model, byHandle } = setup([
      insert({ position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } }),
      [text('AB', 3, 3), { owner: '50' }],
      [text('C', 5, 5), { owner: '50', visible: false }],
    ]);
    // The text in the block is cut with as its drawn box, in the reference's coordinates.
    expect(edgesOf(model, byHandle('40')!)).toEqual([
      ['LINE', 0, 0, 1, 0],
      ['CIRCLE', 1, 0, 0.5],
      ['LWPOLYLINE', true, 3, 3, 0, 7, 3, 0, 7, 4, 0, 3, 4, 0],
    ]);
  });

  it('cuts with text by its drawn box, and with nothing when the canvas did not measure it', () => {
    const { model, byHandle } = setup([text('ABC', 1, 2)]);
    expect(edgesOf(model, byHandle('40')!)).toEqual([
      ['LWPOLYLINE', true, 1, 2, 0, 7, 2, 0, 7, 3, 0, 1, 3, 0],
    ]);
    expect(objectEdgeCurves({ model, tol }, byHandle('40')!, PLAIN)).toEqual([]);
  });

  it("cuts with a reference's shown attributes, an attribute definition's tag", () => {
    const attribute = (value: string, flags: number) => ({
      ...(text(value, 20, 0) as object),
      tag: 'T',
      flags,
    });
    const { model, byHandle } = setup([
      insert({
        position: { x: 0, y: 0 },
        block: '99',
        attributes: [attribute('XY', 0), attribute('HIDDEN', 1)],
      }),
      { ...(text('', 30, 0) as object), kind: 'ATTDEF', tag: 'TAG', prompt: '', flags: 0 } as never,
    ]);
    // Block 99 does not exist: the reference cuts with its visible attribute only.
    expect(edgesOf(model, byHandle('40')!)).toEqual([
      ['LWPOLYLINE', true, 20, 0, 0, 24, 0, 0, 24, 1, 0, 20, 1, 0],
    ]);
    expect(edgeTexts(model, byHandle('41')!, PLAIN).map((t) => t.text)).toMatchObject([
      { kind: 'TEXT', value: 'TAG' },
    ]);
  });

  it("cuts with a dimension's block, which EDGEMODE does not carry on", () => {
    const { model, byHandle } = setup([{ kind: 'DIMENSION', block: '50' } as never]);
    expect(edgesOf(model, byHandle('40')!, { extend: true, hatches: false })).toEqual([
      ['LINE', 0, 0, 1, 0],
      ['CIRCLE', 1, 0, 0.5],
    ]);
  });

  it("cuts with a leader's path", () => {
    const { model, byHandle } = setup([
      {
        kind: 'LEADER',
        style: '',
        vertices: [
          { x: 0, y: 0 },
          { x: 4, y: 3 },
          { x: 8, y: 3 },
        ],
        arrowhead: false,
        spline: false,
        creationType: 3,
        textHeight: 0,
        textWidth: 0,
        horizontalDirection: { x: 1, y: 0 },
        blockOffset: { x: 0, y: 0 },
        annotationOffset: { x: 0, y: 0 },
      } as never,
    ]);
    expect(edgesOf(model, byHandle('40')!, { extend: true, hatches: false })).toEqual([
      ['LWPOLYLINE', false, 0, 0, 0, 4, 3, 0, 8, 3, 0],
    ]);
  });

  it("cuts with a region's loops and a floating viewport's frame, not the layout's own", () => {
    const { model, byHandle } = setup([
      {
        kind: 'REGION',
        loops: [{ face: 0, edges: [{ kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 3 }] }],
      } as never,
      { kind: 'VIEWPORT', id: 2, center: { x: 5, y: 5 }, width: 4, height: 2 } as never,
      { kind: 'VIEWPORT', id: 1, center: { x: 5, y: 5 }, width: 4, height: 2 } as never,
      {
        kind: 'VIEWPORT',
        id: 3,
        center: { x: 5, y: 5 },
        width: 4,
        height: 2,
        clipBoundary: '30',
      } as never,
    ]);
    expect(edgesOf(model, byHandle('40')!)).toEqual([['CIRCLE', 0, 0, 3]]);
    expect(edgesOf(model, byHandle('41')!)).toEqual([
      ['LWPOLYLINE', true, 3, 4, 0, 7, 4, 0, 7, 6, 0, 3, 6, 0],
    ]);
    expect(edgesOf(model, byHandle('42')!)).toEqual([]);
    expect(edgesOf(model, byHandle('43')!)).toEqual([]);
  });

  it("cuts with a hatch's boundary only when hatches are edges", () => {
    const { model, byHandle } = setup([
      {
        kind: 'HATCH',
        loops: [
          {
            flags: 2,
            polyline: {
              closed: false,
              vertices: [
                { x: 0, y: 0, bulge: 0 },
                { x: 4, y: 0, bulge: 0 },
                { x: 4, y: 4, bulge: 0 },
              ],
            },
          },
          {
            flags: 1,
            edges: [
              { type: 'line', start: { x: 10, y: 0 }, end: { x: 12, y: 0 } },
              // Clockwise: angles stored negated, so it sweeps from −π to −π/2 counter-clockwise.
              {
                type: 'arc',
                center: { x: 10, y: 2 },
                radius: 2,
                startAngle: Math.PI / 2,
                endAngle: Math.PI,
                ccw: false,
              },
              {
                type: 'arc',
                center: { x: 20, y: 0 },
                radius: 1,
                startAngle: 0,
                endAngle: 2 * Math.PI,
                ccw: true,
              },
            ],
          },
        ],
      } as never,
    ]);
    expect(edgesOf(model, byHandle('40')!)).toEqual([]);
    expect(edgesOf(model, byHandle('40')!, { extend: true, hatches: true })).toEqual([
      ['LWPOLYLINE', true, 0, 0, 0, 4, 0, 0, 4, 4, 0],
      ['LINE', 10, 0, 12, 0],
      ['ARC', 10, 2, 2, r6(-Math.PI), r6(-Math.PI / 2)],
      ['CIRCLE', 20, 0, 1],
    ]);
  });

  it('keeps the edges of curves as before, EDGEMODE included', () => {
    const { model, byHandle } = setup();
    expect(edgesOf(model, byHandle('30')!, { extend: true, hatches: false })).toEqual([
      ['XLINE', 0, 0, 10, 0],
    ]);
  });
});
