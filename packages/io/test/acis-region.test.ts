// ACIS records (SAT text and SAB binary) and the planar REGION boundary read from them
// (M1-04 part 4c). The models are written here by hand; the corpus comparison is in
// packages/testkit/src/mapping/entities.corpus.test.ts.
import { ACadVersion, CadDocument, Region } from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { regionBoundary } from '../src/acis/region';
import { readSab, readSat } from '../src/acis/records';
import { mapEntities } from '../src/index';
import { sab, sat, square, type Rec } from './acis-fixtures';

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
