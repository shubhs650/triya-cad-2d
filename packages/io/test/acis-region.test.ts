// ACIS records (SAT text and SAB binary) and the planar REGION boundary read from them
// (M1-04 part 4c). The models are written here by hand; the corpus comparison is in
// packages/testkit/src/mapping/entities.corpus.test.ts.
import { ACadVersion, CadDocument, Region } from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { regionBoundary } from '../src/acis/region';
import { readSab, readSat } from '../src/acis/records';
import { mapEntities } from '../src/index';

type Rec = [name: string, type: string, body: string];

/**
 * A 10 × 10 square at the origin whose top edge bulges up as a half circle, with a round
 * hole, moved by (100, 200, 5). `$name` refers to another record. Save version 21500 (R2010).
 */
function square(curves: Partial<Record<'top' | 'hole' | 'plane', string>> = {}): Rec[] {
  return [
    ['hdr', 'asmheader', '@13 230.7.0.65535'],
    ['body', 'body', '$lump $-1 $xf'],
    ['lump', 'lump', '$-1 $shell $body'],
    ['xf', 'transform', '1 0 0 0 1 0 0 0 1 100 200 5 1 no_rotate no_reflect no_shear'],
    ['shell', 'shell', '$-1 $-1 $face $-1 $lump'],
    ['face', 'face', '$-1 $outer $shell $-1 $plane forward single out'],
    ['plane', 'plane-surface', curves.plane ?? '0 0 0 0 0 1 1 0 0 forward_v I I I I'],
    ['outer', 'loop', '$inner $c1 $face'],
    ['c1', 'coedge', '$c2 $c4 $-1 $e1 forward $outer $-1'],
    ['c2', 'coedge', '$c3 $c1 $-1 $e2 forward $outer $-1'],
    ['c3', 'coedge', '$c4 $c2 $-1 $e3 forward $outer $-1'],
    ['c4', 'coedge', '$c1 $c3 $-1 $e4 forward $outer $-1'],
    ['e1', 'edge', '$va 0 $vb 10 $c1 $k1 forward @7 unknown'],
    ['e2', 'edge', '$vb 0 $vc 10 $c2 $k2 forward @7 unknown'],
    ['e3', 'edge', '$vc 0 $vd 3.14 $c3 $k3 forward @7 unknown'],
    ['e4', 'edge', '$vd 0 $va 10 $c4 $k4 forward @7 unknown'],
    ['k1', 'straight-curve', '0 0 0 1 0 0 I I'],
    ['k2', 'straight-curve', '10 0 0 0 1 0 I I'],
    ['k3', 'ellipse-curve', curves.top ?? '5 10 0 0 0 1 5 0 0 1 I I'],
    ['k4', 'straight-curve', '0 10 0 0 -1 0 I I'],
    ['va', 'vertex', '$e1 0 $pa'],
    ['vb', 'vertex', '$e2 0 $pb'],
    ['vc', 'vertex', '$e3 0 $pc'],
    ['vd', 'vertex', '$e4 0 $pd'],
    ['pa', 'point', '0 0 0'],
    ['pb', 'point', '10 0 0'],
    ['pc', 'point', '10 10 0'],
    ['pd', 'point', '0 10 0'],
    ['inner', 'loop', '$-1 $h $face'],
    ['h', 'coedge', '$h $h $-1 $he reversed $inner $-1'],
    ['he', 'edge', '$hv 0 $hv 6.28 $h $hk forward @7 unknown'],
    ['hk', 'ellipse-curve', curves.hole ?? '3 4 0 0 0 1 1 0 0 1 I I'],
    ['hv', 'vertex', '$he 0 $hp'],
    ['hp', 'point', '4 4 0'],
  ];
}

/** The 7.0 header: attribute, history id, and for all but transform and asmheader one more pointer. */
const head = (type: string) =>
  type === 'transform' || type === 'asmheader' ? '$-1 -1' : '$-1 -1 $-1';

/** SAT text: each record is `type header body #`. */
function sat(recs: Rec[]): string {
  const index = new Map(recs.map(([n], i) => [n, i]));
  const ref = (s: string) => s.replace(/\$([a-z]\w*)/g, (_, n: string) => `$${index.get(n)}`);
  return [
    '21500 43 2 24',
    '16 Autodesk AutoCAD 20 ASM 230.7.0.65535 NT 0',
    '25.4 9.9999999999999995e-07 1e-10',
    ...recs.map(([, type, body]) => `${type} ${head(type)} ${ref(body)} #`),
    'End-of-ASM-data',
  ].join('\n');
}

/** The same records as SAB, tag by tag (see records.ts). */
function sab(recs: Rec[]): Uint8Array {
  const index = new Map(recs.map(([n], i) => [n, i]));
  const out: number[] = [];
  const i32 = (v: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, v, true);
    out.push(...b);
  };
  /** A double, with its tag. */
  const f64 = (v: number) => {
    out.push(6);
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    out.push(...b);
  };
  const text = (tag: number, s: string) =>
    out.push(tag, s.length, ...[...s].map((c) => c.charCodeAt(0)));
  out.push(...[...'ACIS BinaryFile'].map((c) => c.charCodeAt(0)));
  [21800, 0, 2, 12].forEach(i32);
  text(7, 'Autodesk AutoCAD');
  text(7, 'ASM 230.7.0.65535 NT');
  text(7, 'Tue Dec  2 10:27:19 2025');
  for (const d of [25.4, 1e-6, 1e-10]) f64(d);
  for (const [, type, body] of recs) {
    const parts = type.split('-');
    parts.slice(0, -1).forEach((p) => text(14, p));
    text(13, parts[parts.length - 1]!);
    const tokens = [...head(type).split(' '), ...body.match(/@\d+ \S+|\S+/g)!];
    for (const t of tokens) {
      if (t.startsWith('$')) {
        out.push(12);
        i32(t === '$-1' ? -1 : index.get(t.slice(1))!);
      } else if (t.startsWith('@')) text(7, t.split(' ')[1]!);
      else if (t === 'forward' || t === 'reversed') out.push(t === 'reversed' ? 10 : 11);
      else if (/^-?[\d.]+(e-?\d+)?$/.test(t)) f64(Number(t));
      else text(7, t);
    }
    out.push(17);
  }
  return new Uint8Array(out);
}

const expected = {
  loops: [
    {
      face: 0,
      edges: [
        { kind: 'LINE', start: { x: 100, y: 200 }, end: { x: 110, y: 200 } },
        { kind: 'LINE', start: { x: 110, y: 200 }, end: { x: 110, y: 210 } },
        { kind: 'ARC', center: { x: 105, y: 210 }, radius: 5, startAngle: 0, endAngle: Math.PI },
        { kind: 'LINE', start: { x: 100, y: 210 }, end: { x: 100, y: 200 } },
      ],
    },
    { face: 0, edges: [{ kind: 'CIRCLE', center: { x: 103, y: 204 }, radius: 1 }] },
  ],
  elevation: 5,
  down: false,
};

describe('ACIS records', () => {
  it('reads SAT records by pointer, with @n strings and the 7.0 header stripped', () => {
    const m = readSat(sat(square()));
    expect(m.version).toBe(21500);
    expect(m.records).toHaveLength(square().length);
    expect(m.records[1]).toEqual({
      type: 'body',
      fields: [{ ptr: 2 }, { ptr: -1 }, { ptr: 3 }],
    });
    expect(m.records[0]!.fields).toEqual(['230.7.0.65535']);
    expect(m.records[3]!.fields.slice(0, 3)).toEqual([1, 0, 0]);
  });

  it('reads the same records from SAB, joining a type from its parts', () => {
    const t = readSat(sat(square())).records;
    const b = readSab(sab(square())).records;
    expect(b.map((r) => r.type)).toEqual(t.map((r) => r.type));
    expect(b[6]!.type).toBe('plane-surface');
    expect(b[1]).toEqual(t[1]);
  });

  it('keeps the pre-7.0 layout, which has only the attribute pointer', () => {
    const m = readSat('400 3 1 0\n16 Autodesk AutoCAD 0\n1 1e-06 1e-10\nbody $-1 $1 $-1 $-1 #\n');
    expect(m.records[0]!.fields).toEqual([{ ptr: 1 }, { ptr: -1 }, { ptr: -1 }]);
  });
});

describe('REGION boundary', () => {
  it('reads every loop of a face as plan-view curves, moved by the body transform', () => {
    expect(regionBoundary(readSat(sat(square())))).toEqual(expected);
  });

  it('reads the same boundary from SAB', () => {
    expect(regionBoundary(readSab(sab(square())))).toEqual(expected);
  });

  it('turns an arc about −Z into the counter-clockwise arc it draws in plan view', () => {
    // From (10, 10) to (0, 10) about −Z is clockwise in plan: the bulge goes down.
    const b = regionBoundary(readSat(sat(square({ top: '5 10 0 0 0 -1 5 0 0 1 I I' }))));
    if (typeof b === 'string') throw new Error(b);
    const arc = b.loops[0]!.edges[2]!;
    expect(arc).toMatchObject({ kind: 'ARC', center: { x: 105, y: 210 }, radius: 5 });
    if (arc.kind !== 'ARC') throw new Error(arc.kind);
    expect(arc.startAngle).toBeCloseTo(Math.PI, 12);
    expect(arc.endAngle).toBeCloseTo(0, 12);
  });

  it('reads an elliptical edge by its eccentric anomalies', () => {
    const b = regionBoundary(readSat(sat(square({ top: '5 10 0 0 0 1 5 0 0 0.4 I I' }))));
    if (typeof b === 'string') throw new Error(b);
    expect(b.loops[0]!.edges[2]).toMatchObject({
      kind: 'ELLIPSE',
      center: { x: 105, y: 210 },
      majorAxis: { x: 5, y: 0 },
      ratio: 0.4,
      startParam: 0,
      endParam: Math.PI,
    });
  });

  it('reports a tilted plane and a spline edge', () => {
    expect(
      regionBoundary(readSat(sat(square({ plane: '0 0 0 1 0 0 0 1 0 forward_v I I I I' })))),
    ).toBe('tilted plane');
    const spline = square().map((r): Rec =>
      r[0] === 'k2' ? ['k2', 'intcurve-curve', 'forward { exactcur }'] : r,
    );
    expect(regionBoundary(readSat(sat(spline)))).toBe('unsupported boundary');
  });
});

describe('mapEntities REGION', () => {
  const H = (o: { handle: number }) => o.handle.toString(16).toUpperCase();

  it('maps a SAT region and a SAB region to the same boundary at their elevation', () => {
    for (const data of [Uint8Array.from(sat(square()), (c) => c.charCodeAt(0)), sab(square())]) {
      const doc = new CadDocument(ACadVersion.AC1032);
      const r = new Region();
      r.binaryData = data;
      doc.entities?.add(r);
      const { entities, unmapped } = mapEntities(doc);
      expect(unmapped).toEqual([]);
      expect(entities.find((e) => e.handle === H(r))!.geom).toEqual({
        kind: 'REGION',
        loops: expected.loops,
        elevation: 5,
      });
    }
  });

  it('reports a region whose ACIS data it cannot read', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const r = new Region();
    r.binaryData = new Uint8Array([1, 2, 3]);
    doc.entities?.add(r);
    expect(mapEntities(doc).unmapped).toEqual([
      { handle: H(r), type: 'REGION', reason: 'unsupported boundary' },
    ]);
  });
});

describe('SAT header', () => {
  it('reads R14 SAT (save version 106), which has only the version line', () => {
    const m = readSat('106 42 1 0\r\nbody $-1 $1 $-1 $2 #\r\nlump $-1 $-1 $-1 $0 #\r\n');
    expect(m.records.map((r) => r.type)).toEqual(['body', 'lump']);
  });
});
