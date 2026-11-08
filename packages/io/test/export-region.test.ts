// TriyaToAcad for REGION (M1-75 part 39): MOVE, ROTATE and SCALE of a REGION are saved by
// composing the motion into its ACIS body's transform record, in SAT (R2004 here) and SAB
// (R2018), to DXF, binary DXF and DWG. Drawings are authored in memory with acad-ts and saved
// once, so "the file" is real bytes; every corpus REGION is edited in
// packages/testkit/src/export/export-region.corpus.test.ts.
import { ACadVersion, CadDocument, Region, XYZ } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type RegionGeometry,
  type RegionLoop,
  type Vec2,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';
import { sab, sat, square } from './acis-fixtures';

type Edge = RegionLoop['edges'][number];

/** A drawing with the fixture square as its only REGION, its ACIS data in SAT or SAB. */
function drawing(version: ACadVersion, format: CadFormat, point?: XYZ): Uint8Array {
  const doc = new CadDocument(version);
  const r = new Region();
  r.binaryData =
    version >= ACadVersion.AC1027
      ? sab(square())
      : Uint8Array.from(sat(square()), (c) => c.charCodeAt(0));
  if (point) r.point = point;
  doc.entities!.add(r);
  return writeCadDocument(doc, { format });
}

const CASES = [
  { name: 'SAT in an R2004 DXF', version: ACadVersion.AC1018, format: 'dxf' as const },
  { name: 'SAT in an R2004 DWG', version: ACadVersion.AC1018, format: 'dwg' as const },
  { name: 'SAB in an R2018 DXF', version: ACadVersion.AC1032, format: 'dxf' as const },
  { name: 'SAB in an R2018 DWG', version: ACadVersion.AC1032, format: 'dwg' as const },
];

const open = (bytes: Uint8Array): DocumentModel =>
  DocumentModel.create(documentInit(readCadDocument(bytes)));
const region = (m: DocumentModel): Entity => [...m.entities()].find((e) => e.type === 'REGION')!;

/** Turn by `a` about `c`, scale by `k`, then move by `d`: what ROTATE, SCALE and MOVE do. */
function motion(a: number, k: number, c: Vec2, d: Vec2) {
  const p = (q: Vec2): Vec2 => ({
    x: c.x + k * ((q.x - c.x) * Math.cos(a) - (q.y - c.y) * Math.sin(a)) + d.x,
    y: c.y + k * ((q.x - c.x) * Math.sin(a) + (q.y - c.y) * Math.cos(a)) + d.y,
  });
  const edge = (e: Edge): Edge => {
    switch (e.kind) {
      case 'LINE':
        return { ...e, start: p(e.start), end: p(e.end) };
      case 'ARC':
        return {
          ...e,
          center: p(e.center),
          radius: k * e.radius,
          startAngle: e.startAngle + a,
          endAngle: e.endAngle + a,
        };
      case 'CIRCLE':
        return { ...e, center: p(e.center), radius: k * e.radius };
      case 'ELLIPSE': {
        const v = e.majorAxis;
        return {
          ...e,
          center: p(e.center),
          majorAxis: {
            x: k * (v.x * Math.cos(a) - v.y * Math.sin(a)),
            y: k * (v.x * Math.sin(a) + v.y * Math.cos(a)),
          },
        };
      }
    }
  };
  return (g: RegionGeometry): RegionGeometry => ({
    ...g,
    loops: g.loops.map((l) => ({ ...l, edges: l.edges.map(edge) })),
  });
}

function edit(m: DocumentModel, f: (g: RegionGeometry) => RegionGeometry): void {
  const e = region(m);
  const b = new ChangeSetBuilder(m);
  b.updateEntity(e.id, { geom: f(e.geom as RegionGeometry) });
  m.apply(b.build());
}

/** Recursively equal, numbers to `eps` (angles compared on the circle). */
function close(actual: unknown, expected: unknown, eps = 1e-9, path = ''): void {
  if (typeof expected === 'number') {
    const a = actual as number;
    const d = /Angle$/.test(path)
      ? Math.abs(Math.atan2(Math.sin(a - expected), Math.cos(a - expected)))
      : Math.abs(a - expected);
    expect(d, `${path}: ${String(actual)} vs ${expected}`).toBeLessThan(eps);
    return;
  }
  if (expected && typeof expected === 'object') {
    expect(Object.keys(actual as object).sort(), path).toEqual(Object.keys(expected).sort());
    for (const [k, v] of Object.entries(expected)) {
      close((actual as Record<string, unknown>)[k], v, eps, `${path}.${k}`);
    }
    return;
  }
  expect(actual, path).toBe(expected);
}

const ROTATE_SCALE_MOVE = motion(Math.PI / 6, 1.5, { x: 105, y: 205 }, { x: -40, y: 12.5 });

describe('triyaToAcad REGION', () => {
  it.each(CASES)('saves a turned, scaled and moved REGION ($name)', ({ version, format }) => {
    const file = drawing(version, format);
    for (const binary of format === 'dxf' ? [false, true] : [false]) {
      const model = open(file);
      edit(model, ROTATE_SCALE_MOVE);
      const saved = exportDocument(readCadDocument(file), model, { format, binary });
      const back = region(open(saved));
      close(back.geom, region(model).geom);
      expect(back.handle).toBe(region(model).handle);
    }
  });

  it('saves a REGION raised to another elevation', () => {
    const file = drawing(ACadVersion.AC1032, 'dxf');
    const model = open(file);
    edit(model, (g) => ({ ...motion(0, 1, { x: 0, y: 0 }, { x: 3, y: 4 })(g), elevation: 9 }));
    const saved = exportDocument(readCadDocument(file), model, { format: 'dxf' });
    close(region(open(saved)).geom, region(model).geom);
  });

  it('moves a DWG REGION’s point with its body', () => {
    const file = drawing(ACadVersion.AC1032, 'dwg', new XYZ(105, 205, 5));
    const model = open(file);
    edit(model, motion(Math.PI / 2, 2, { x: 105, y: 205 }, { x: 10, y: 0 }));
    const saved = exportDocument(readCadDocument(file), model, { format: 'dwg' });
    const r = [...readCadDocument(saved).getCadObjects()].find((o) => o instanceof Region);
    close({ ...(r as Region).point }, { x: 115, y: 205, z: 5 });
  });

  it('keeps an unmoved REGION as read when only its layer colour changes', () => {
    const file = drawing(ACadVersion.AC1032, 'dxf');
    const model = open(file);
    const e = region(model);
    const b = new ChangeSetBuilder(model);
    b.updateEntity(e.id, { color: { kind: 'aci', index: 3 } });
    model.apply(b.build());
    const saved = exportDocument(readCadDocument(file), model, { format: 'dxf' });
    const bodies = (bytes: Uint8Array) =>
      [...readCadDocument(bytes).getCadObjects()]
        .filter((o): o is Region => o instanceof Region)
        .map((r) => [...r.binaryData]);
    expect(bodies(saved)).toEqual(bodies(file));
  });

  it.each([
    ['a mirrored boundary', 'a mirrored boundary'],
    ['one edge moved', 'a boundary that is not the original moved, turned or scaled'],
    ['an edge dropped', 'a boundary that is not the original moved, turned or scaled'],
    ['a flipped plane', 'a change of plane direction'],
  ])('refuses %s', (what, reason) => {
    const file = drawing(ACadVersion.AC1032, 'dxf');
    const model = open(file);
    edit(model, (g) => {
      if (what === 'a mirrored boundary') {
        // About the line x = 105: (x, y) → (210 − x, y); the arc keeps running counter-clockwise.
        const m = (p: Vec2): Vec2 => ({ x: 210 - p.x, y: p.y });
        return {
          ...g,
          loops: g.loops.map((l) => ({
            ...l,
            edges: l.edges.map((e): Edge => {
              if (e.kind === 'LINE') return { ...e, start: m(e.start), end: m(e.end) };
              if (e.kind === 'ARC') {
                return {
                  ...e,
                  center: m(e.center),
                  startAngle: Math.PI - e.endAngle,
                  endAngle: Math.PI - e.startAngle,
                };
              }
              return e.kind === 'CIRCLE' ? { ...e, center: m(e.center) } : e;
            }),
          })),
        };
      }
      if (what === 'one edge moved') {
        const [outer, ...rest] = g.loops;
        const edges = [...outer!.edges];
        const line = edges[0]!;
        if (line.kind === 'LINE') edges[0] = { ...line, start: { x: 99, y: 199 } };
        return { ...g, loops: [{ ...outer!, edges }, ...rest] };
      }
      if (what === 'an edge dropped') {
        const [outer, ...rest] = g.loops;
        return { ...g, loops: [{ ...outer!, edges: outer!.edges.slice(1) }, ...rest] };
      }
      return { ...g, normal: { x: 0, y: 0, z: -1 } };
    });
    expect(() => exportDocument(readCadDocument(file), model, { format: 'dxf' })).toThrow(
      UnsupportedChangeError,
    );
    expect(() => exportDocument(readCadDocument(file), model, { format: 'dxf' })).toThrow(reason);
  });

  it('refuses a new REGION, which would need an ACIS body', () => {
    const file = drawing(ACadVersion.AC1032, 'dxf');
    const model = open(file);
    const e = region(model);
    const b = new ChangeSetBuilder(model);
    b.addEntity({ owner: e.owner, layer: e.layer, geom: e.geom });
    model.apply(b.build());
    expect(() => exportDocument(readCadDocument(file), model, { format: 'dxf' })).toThrow(
      'a new REGION (Triya cannot make an ACIS body)',
    );
  });

  it('refuses a body without a transform record', () => {
    const doc = new CadDocument(ACadVersion.AC1018);
    const r = new Region();
    const none = square().map((x) =>
      x[0] === 'body' ? (['body', 'body', '$lump $-1 $-1'] as typeof x) : x,
    );
    r.binaryData = Uint8Array.from(sat(none), (c) => c.charCodeAt(0));
    doc.entities!.add(r);
    const file = writeCadDocument(doc, { format: 'dxf' });
    const model = open(file);
    edit(model, motion(0, 1, { x: 0, y: 0 }, { x: 1, y: 0 }));
    expect(() => exportDocument(readCadDocument(file), model, { format: 'dxf' })).toThrow(
      'an ACIS body without a transform record',
    );
  });
});
