// Block placement (M1-14): an INSERT's transform, MINSERT cells, and primitives carried from a
// block's own coordinates into the drawing, keeping arcs and ellipses exact under rotation,
// mirroring and non-uniform scale.
import type { InsertGeometry, Vec2 } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  PATH_A,
  PATH_E,
  PATH_L,
  PATH_M,
  applyAffine,
  insertTransforms,
  transformPrimitive,
  type Affine,
  type RenderPrimitive,
} from '../src/index';

const insert = (extra: Partial<InsertGeometry> = {}): InsertGeometry => ({
  kind: 'INSERT',
  block: '40',
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
  ...extra,
});
const near = (p: Vec2, q: Vec2, eps = 1e-9) => {
  expect(p.x).toBeCloseTo(q.x, -Math.log10(eps));
  expect(p.y).toBeCloseTo(q.y, -Math.log10(eps));
};

/** The point at fraction `u` of the sweep of the arc or ellipse command at `i`. */
function curvePoint(path: readonly number[], i: number, u: number): Vec2 {
  if (path[i] === PATH_A) {
    const [cx, cy, r, a0, a1] = path.slice(i + 1, i + 6) as number[];
    const t = a0! + (a1! - a0!) * u;
    return { x: cx! + r! * Math.cos(t), y: cy! + r! * Math.sin(t) };
  }
  if (path[i] === PATH_E) {
    const [cx, cy, rx, ry, rot, a0, a1] = path.slice(i + 1, i + 8) as number[];
    const t = a0! + (a1! - a0!) * u;
    const ux = rx! * Math.cos(t);
    const uy = ry! * Math.sin(t);
    return {
      x: cx! + ux * Math.cos(rot!) - uy * Math.sin(rot!),
      y: cy! + ux * Math.sin(rot!) + uy * Math.cos(rot!),
    };
  }
  throw new Error(`no curve at ${i}`);
}

const pathOf = (p: RenderPrimitive): readonly number[] => ('path' in p ? p.path : []);

describe('insertTransforms', () => {
  it('maps the base point to the insertion point, then scales and turns about it', () => {
    const [m] = insertTransforms(
      insert({ position: { x: 10, y: 5 }, scale: { x: 2, y: 3, z: 1 }, rotation: Math.PI / 2 }),
      { x: 1, y: 1 },
    );
    near(applyAffine(m!, { x: 1, y: 1 }), { x: 10, y: 5 });
    // (2, 1) is 1 along the block's X from the base: scaled to 2, turned to +Y.
    near(applyAffine(m!, { x: 2, y: 1 }), { x: 10, y: 7 });
    // (1, 2) is 1 along the block's Y: scaled to 3, turned to −X.
    near(applyAffine(m!, { x: 1, y: 2 }), { x: 7, y: 5 });
  });

  it('places MINSERT cells along the rotated but unscaled axes, row by row', () => {
    const cells = insertTransforms(
      insert({
        position: { x: 10, y: 0 },
        scale: { x: 5, y: 5, z: 1 },
        rotation: Math.PI / 2,
        array: { columns: 3, rows: 2, columnSpacing: 4, rowSpacing: 7 },
      }),
      { x: 0, y: 0 },
    );
    expect(cells).toHaveLength(6);
    const origins = cells.map((m) => applyAffine(m, { x: 0, y: 0 }));
    // Columns step 4 along the turned X (+Y), rows 7 along the turned Y (−X); scale 5 is not applied.
    near(origins[1]!, { x: 10, y: 4 });
    near(origins[2]!, { x: 10, y: 8 });
    near(origins[3]!, { x: 3, y: 0 });
    near(origins[5]!, { x: 3, y: 8 });
  });

  it('gives one cell for an INSERT and none for an empty array', () => {
    expect(insertTransforms(insert(), { x: 0, y: 0 })).toHaveLength(1);
    const empty = insert({ array: { columns: 0, rows: 2, columnSpacing: 1, rowSpacing: 1 } });
    expect(insertTransforms(empty, { x: 0, y: 0 })).toHaveLength(0);
  });
});

describe('transformPrimitive', () => {
  const arc: RenderPrimitive = {
    kind: 'stroke',
    path: [PATH_M, 2, 1, PATH_A, 1, 1, 1, 0, Math.PI / 2, 1],
    color: 'foreground',
    lineweight: 0.5,
  };
  const ellipse: RenderPrimitive = {
    kind: 'stroke',
    path: [PATH_M, 3, 0, PATH_E, 0, 0, 3, 1, 0.3, 0.2, 2.5, 1],
    color: 'foreground',
  };
  const transforms: [string, Affine][] = [
    ['identity', { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }],
    [
      'rotate and scale',
      insertTransforms(insert({ scale: { x: 2, y: 2, z: 1 }, rotation: 1 }), { x: 0, y: 0 })[0]!,
    ],
    ['mirror in X', insertTransforms(insert({ scale: { x: -1, y: 1, z: 1 } }), { x: 0, y: 0 })[0]!],
    [
      'mirror in Y and turn',
      insertTransforms(insert({ scale: { x: 1.5, y: -1.5, z: 1 }, rotation: 2 }), {
        x: 0,
        y: 0,
      })[0]!,
    ],
    [
      'non-uniform',
      insertTransforms(insert({ scale: { x: 3, y: 1, z: 1 }, rotation: 0.4 }), { x: 0, y: 0 })[0]!,
    ],
    [
      'non-uniform mirrored',
      insertTransforms(
        insert({ position: { x: 5, y: -2 }, scale: { x: -0.5, y: 2, z: 1 }, rotation: -0.7 }),
        { x: 1, y: 1 },
      )[0]!,
    ],
  ];

  for (const [name, m] of transforms) {
    it(`keeps arcs and ellipses exact: ${name}`, () => {
      for (const src of [arc, ellipse]) {
        const out = pathOf(transformPrimitive(src, m));
        const i = 3;
        expect([PATH_A, PATH_E]).toContain(out[i]);
        for (const u of [0, 0.25, 0.5, 1])
          near(curvePoint(out, i, u), applyAffine(m, curvePoint(pathOf(src), i, u)), 1e-9);
        near(
          { x: out[1]!, y: out[2]! },
          applyAffine(m, { x: pathOf(src)[1]!, y: pathOf(src)[2]! }),
        );
      }
    });
  }

  it('keeps a circle arc an arc under rotation and uniform scale, and a mirror flips its direction', () => {
    const turned = pathOf(transformPrimitive(arc, transforms[1]![1]));
    expect(turned[3]).toBe(PATH_A);
    expect(turned[9]).toBe(1);
    const mirrored = pathOf(transformPrimitive(arc, transforms[2]![1]));
    expect(mirrored[3]).toBe(PATH_A);
    expect(mirrored[9]).toBe(0);
    expect(pathOf(transformPrimitive(arc, transforms[4]![1]))[3]).toBe(PATH_E);
  });

  it('moves lines, points and infinite lines, and keeps colour and lineweight', () => {
    const m = transforms[3]![1];
    const line: RenderPrimitive = {
      kind: 'stroke',
      path: [PATH_M, 0, 0, PATH_L, 1, 0],
      color: '#ff0000',
      lineweight: 0.35,
    };
    const out = transformPrimitive(line, m);
    expect(out).toMatchObject({ kind: 'stroke', color: '#ff0000', lineweight: 0.35 });
    near({ x: pathOf(out)[4]!, y: pathOf(out)[5]! }, applyAffine(m, { x: 1, y: 0 }));
    const point = transformPrimitive({ kind: 'point', x: 1, y: 2, color: 'foreground' }, m);
    expect(point.kind).toBe('point');
    if (point.kind === 'point') near(point, applyAffine(m, { x: 1, y: 2 }));
    const ray = transformPrimitive(
      {
        kind: 'infinite',
        base: { x: 1, y: 0 },
        direction: { x: 1, y: 0 },
        both: false,
        color: 'foreground',
      },
      m,
    );
    if (ray.kind !== 'infinite') throw new Error('expected an infinite line');
    near(ray.base, applyAffine(m, { x: 1, y: 0 }));
    const tip = applyAffine(m, { x: 2, y: 0 });
    near(ray.direction, { x: tip.x - ray.base.x, y: tip.y - ray.base.y });
  });

  it('carries a dashed stroke’s continuous path and scales its pattern length', () => {
    const dashed: RenderPrimitive = {
      kind: 'stroke',
      path: [PATH_M, 0, 0, PATH_L, 0.5, 0],
      color: 'foreground',
      continuous: [PATH_M, 0, 0, PATH_L, 10, 0],
      patternLength: 0.75,
    };
    const out = transformPrimitive(dashed, transforms[1]![1]);
    if (out.kind !== 'stroke') throw new Error('expected a stroke');
    expect(out.patternLength).toBeCloseTo(1.5, 12);
    near(
      { x: out.continuous![4]!, y: out.continuous![5]! },
      applyAffine(transforms[1]![1], { x: 10, y: 0 }),
    );
  });

  it('carries a hatch family’s tint area and spacing, and a gradient’s frame (M1-16)', () => {
    const m = transforms[1]![1];
    const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    const family: RenderPrimitive = {
      kind: 'stroke',
      path: [PATH_M, 0, 0, PATH_L, 1, 0],
      color: 'foreground',
      hatch: {
        area: [PATH_M, 0, 0, PATH_L, 1, 0, PATH_L, 1, 1],
        evenOdd: true,
        spacing: 0.5,
        period: 2,
        dashLength: 1,
        marks: 1,
      },
    };
    const out = transformPrimitive(family, m);
    if (out.kind !== 'stroke' || !out.hatch) throw new Error('expected a hatch stroke');
    expect(out.hatch).toMatchObject({ spacing: 0.5 * k, period: 2 * k, dashLength: k, marks: 1 });
    near({ x: out.hatch.area[7]!, y: out.hatch.area[8]! }, applyAffine(m, { x: 1, y: 1 }));

    const frame = { a: 2, b: 0, c: 0, d: 3, e: 1, f: 1 };
    const fill: RenderPrimitive = {
      kind: 'fill',
      path: [PATH_M, 0, 0],
      color: '#0000ff',
      gradient: { kind: 'linear', frame, stops: [[0, 0]], colors: ['#0000ff', '#ffff00'] },
    };
    const g = transformPrimitive(fill, m);
    if (g.kind !== 'fill' || !g.gradient) throw new Error('expected a gradient fill');
    // Unit (1, 0) is block (3, 1), which the insert carries into the drawing.
    near(applyAffine(g.gradient.frame, { x: 1, y: 0 }), applyAffine(m, { x: 3, y: 1 }));
  });
});
