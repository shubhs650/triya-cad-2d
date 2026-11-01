// M1-04 acceptance: the entities AcadToTriya produces for every public-corpus ASCII DXF match
// what the file states, read by an independent group-code reader (dxf-oracle.ts) and taken to
// plan view with AutoCAD's arbitrary-axis algorithm written out here (DXF reference, "Object
// Coordinate Systems"), not with the mapper's own conversion.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EntityInit, Vec2 } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { mapEntities, mapTables, readCadDocument, type MappedTables } from '@triya/io';
import { loadManifest } from '../corpus/manifest.ts';
import { all, first, readDxfOracle, type DxfEntity, type Group } from './dxf-oracle.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);

type V3 = { x: number; y: number; z: number };
const num = (groups: readonly Group[], code: number, dflt = 0): number => {
  const v = first(groups, code);
  return v === undefined ? dflt : Number.parseFloat(v);
};
const pt = (g: readonly Group[], code: number): V3 => ({
  x: num(g, code),
  y: num(g, code + 10),
  z: num(g, code + 20),
});
const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const unit = (a: V3): V3 => {
  const l = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** AutoCAD's arbitrary-axis algorithm: the OCS axes of extrusion N. */
function ocs(n: V3): { ax: V3; ay: V3; n: V3 } {
  const N = unit(n);
  const ax = unit(
    Math.abs(N.x) < 1 / 64 && Math.abs(N.y) < 1 / 64
      ? cross({ x: 0, y: 1, z: 0 }, N)
      : cross({ x: 0, y: 0, z: 1 }, N),
  );
  return { ax, ay: unit(cross(N, ax)), n: N };
}
const extrusion = (g: readonly Group[]): V3 => ({
  x: num(g, 210),
  y: num(g, 220),
  z: num(g, 230, 1),
});
const tilted = (n: V3): boolean => Math.hypot(n.x, n.y) > 1e-9 * Math.hypot(n.x, n.y, n.z);

/** WCS plan view of an OCS point. */
function plan(p: { x: number; y: number; z?: number }, n: V3): Vec2 {
  const { ax, ay, n: N } = ocs(n);
  const z = p.z ?? 0;
  return { x: p.x * ax.x + p.y * ay.x + z * N.x, y: p.x * ax.y + p.y * ay.y + z * N.y };
}

const close = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const near = (a: Vec2, b: Vec2): boolean => close(a.x, b.x) && close(a.y, b.y);
const fmt = (p: Vec2): string => `(${p.x}, ${p.y})`;

interface Mismatch {
  readonly kind: string;
  readonly text: string;
}

const COMMON = new Set(['8', '6', '62', '420', '370', '48', '60', '440']);

/** Where acad-ts itself does not keep what the file states (M1-32). Same ratchet as tables. */
const ACAD_TS_GAPS: Record<string, string> = {
  'entity 6':
    'R12 files have no BYBLOCK/BYLAYER LTYPE records; acad-ts falls back to ByLayer for an entity whose 6 is BYBLOCK',
  'ACAD_TABLE unmapped':
    'acad-ts drops ACAD_TABLE entities of ezdxf-written files from their block',
};

/** Types this part maps; the others must be reported as not mapped yet. */
const MAPPED = new Set([
  'LINE',
  'XLINE',
  'RAY',
  'CIRCLE',
  'ARC',
  'ELLIPSE',
  'POINT',
  'LWPOLYLINE',
  'POLYLINE',
  'SPLINE',
  'SOLID',
  'TRACE',
  '3DFACE',
]);

const ARC_POINT = (c: Vec2, r: number, a: number): Vec2 => ({
  x: c.x + r * Math.cos(a),
  y: c.y + r * Math.sin(a),
});
const ccwSweep = (s: number, e: number): number => {
  const d = (((e - s) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return d === 0 ? 2 * Math.PI : d;
};

/** Start, middle and end of a bulged segment in its own (OCS) plane. */
function bulgeMid(a: Vec2, b: Vec2, bulge: number): Vec2 {
  // The sagitta is bulge · half-chord, on the right of a→b for a positive (CCW) bulge.
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const s = (bulge * Math.hypot(dx, dy)) / 2;
  const l = Math.hypot(dx, dy) || 1;
  return { x: mx + (dy / l) * s, y: my - (dx / l) * s };
}

function compareEntity(
  d: DxfEntity,
  e: EntityInit,
  t: MappedTables,
  report: (kind: string, text: string) => void,
): void {
  const g = d.groups;
  // ── common properties ──
  const layer = t.layers.find((l) => l.handle === e.layer)?.name;
  if (layer?.toUpperCase() !== (first(g, 8) ?? '0').trim().toUpperCase())
    report('8', `${first(g, 8)} → ${layer}`);
  const lt = first(g, 6)?.trim().toUpperCase() ?? 'BYLAYER';
  const gotLt =
    typeof e.linetype === 'string' && (e.linetype === 'ByLayer' || e.linetype === 'ByBlock')
      ? e.linetype.toUpperCase()
      : t.linetypes.find((l) => l.handle === e.linetype)?.name.toUpperCase();
  if (gotLt !== lt) report('6', `${lt} → ${gotLt}`);
  const tc = first(g, 420);
  const aci = num(g, 62, 256);
  const want =
    tc !== undefined
      ? {
          kind: 'rgb',
          r: (Number(tc) >> 16) & 255,
          g: (Number(tc) >> 8) & 255,
          b: Number(tc) & 255,
        }
      : aci === 0
        ? { kind: 'byBlock' }
        : aci === 256
          ? { kind: 'byLayer' }
          : { kind: 'aci', index: Math.abs(aci) };
  const { bookName: _b, colorName: _c, ...gotColor } = e.color as Record<string, unknown>;
  if (JSON.stringify(gotColor) !== JSON.stringify(want))
    report(tc !== undefined ? '420' : '62', `${JSON.stringify(want)} → ${JSON.stringify(e.color)}`);
  const lw = num(g, 370, -1);
  const gotLw = { ByLayer: -1, ByBlock: -2, Default: -3 }[e.lineweight as string] ?? e.lineweight;
  if (gotLw !== lw) report('370', `${lw} → ${String(e.lineweight)}`);
  if (!close(e.ltScale, num(g, 48, 1))) report('48', `${num(g, 48, 1)} → ${e.ltScale}`);
  if (e.visible !== (num(g, 60) === 0)) report('60', `${num(g, 60)} → ${e.visible}`);
  const tr = first(g, 440);
  if (tr !== undefined) {
    const v = Number(tr);
    const got = e.transparency;
    const ok =
      (v & 0x01000000) !== 0
        ? got === 'ByBlock'
        : typeof got === 'object' && Math.abs(got.alpha - (v & 0xff)) <= 1; // acad-ts keeps %
    if (!ok) report('440', `${v} → ${JSON.stringify(got)}`);
  }

  // ── geometry ──
  const geom = e.geom;
  const n = extrusion(g);
  const bad = (code: string, file: unknown, got: unknown): void =>
    report(code, `${String(file)} → ${String(got)}`);
  switch (d.type) {
    case 'LINE': {
      if (geom.kind !== 'LINE') return bad('type', d.type, geom.kind);
      if (!near(geom.start, pt(g, 10))) bad('10', fmt(pt(g, 10)), fmt(geom.start));
      if (!near(geom.end, pt(g, 11))) bad('11', fmt(pt(g, 11)), fmt(geom.end));
      if (!close(geom.thickness ?? 0, num(g, 39))) bad('39', num(g, 39), geom.thickness);
      return;
    }
    case 'XLINE':
    case 'RAY': {
      if (geom.kind !== 'XLINE' && geom.kind !== 'RAY') return bad('type', d.type, geom.kind);
      const dir = pt(g, 11);
      const l = Math.hypot(dir.x, dir.y);
      if (!near(geom.base, pt(g, 10))) bad('10', fmt(pt(g, 10)), fmt(geom.base));
      if (!near(geom.direction, { x: dir.x / l, y: dir.y / l }))
        bad('11', fmt(dir), fmt(geom.direction));
      return;
    }
    case 'CIRCLE':
    case 'ARC': {
      if (geom.kind !== 'CIRCLE' && geom.kind !== 'ARC') return bad('type', d.type, geom.kind);
      const c = pt(g, 10);
      const r = num(g, 40);
      if (!near(geom.center, plan(c, n))) bad('10', fmt(plan(c, n)), fmt(geom.center));
      if (!close(geom.radius, r)) bad('40', r, geom.radius);
      if (geom.kind === 'ARC') {
        // Compare the arc's ends and middle, mapped from its OCS, with Triya's.
        const s = (num(g, 50) * Math.PI) / 180;
        const en = (num(g, 51) * Math.PI) / 180;
        const mid = s + ccwSweep(s, en) / 2;
        const want = [s, mid, en].map((a) => plan({ ...ARC_POINT(c, r, a), z: c.z }, n));
        const gm = geom.startAngle + ccwSweep(geom.startAngle, geom.endAngle) / 2;
        const got = [geom.startAngle, gm, geom.endAngle].map((a) => ARC_POINT(geom.center, r, a));
        // A mirrored plane reverses the arc, so its start is the file's end.
        const ok =
          near(got[1]!, want[1]!) &&
          ((near(got[0]!, want[0]!) && near(got[2]!, want[2]!)) ||
            (near(got[0]!, want[2]!) && near(got[2]!, want[0]!)));
        if (!ok) bad('50', want.map(fmt).join(' '), got.map(fmt).join(' '));
      }
      return;
    }
    case 'ELLIPSE': {
      if (geom.kind !== 'ELLIPSE') return bad('type', d.type, geom.kind);
      const c = pt(g, 10);
      const M = pt(g, 11);
      const ratio = num(g, 40);
      const N = unit(n);
      const minor = cross(N, M);
      const at = (u: number): Vec2 => ({
        x: c.x + Math.cos(u) * M.x + Math.sin(u) * ratio * minor.x,
        y: c.y + Math.cos(u) * M.y + Math.sin(u) * ratio * minor.y,
      });
      const s = num(g, 41);
      const en = num(g, 42, 2 * Math.PI);
      const want = [s, s + ccwSweep(s, en) / 2, en].map(at);
      const perp = { x: -geom.majorAxis.y, y: geom.majorAxis.x };
      const tat = (u: number): Vec2 => ({
        x: geom.center.x + Math.cos(u) * geom.majorAxis.x + Math.sin(u) * geom.ratio * perp.x,
        y: geom.center.y + Math.cos(u) * geom.majorAxis.y + Math.sin(u) * geom.ratio * perp.y,
      });
      const got = [
        geom.startParam,
        geom.startParam + ccwSweep(geom.startParam, geom.endParam) / 2,
        geom.endParam,
      ].map(tat);
      const ok =
        near(got[1]!, want[1]!) &&
        ((near(got[0]!, want[0]!) && near(got[2]!, want[2]!)) ||
          (near(got[0]!, want[2]!) && near(got[2]!, want[0]!)));
      if (!ok) bad('41', want.map(fmt).join(' '), got.map(fmt).join(' '));
      return;
    }
    case 'POINT': {
      if (geom.kind !== 'POINT') return bad('type', d.type, geom.kind);
      if (!near(geom.position, pt(g, 10))) bad('10', fmt(pt(g, 10)), fmt(geom.position));
      if (!close(geom.xAxisAngle ?? 0, (num(g, 50) * Math.PI) / 180))
        bad('50', num(g, 50), geom.xAxisAngle);
      return;
    }
    case 'LWPOLYLINE': {
      if (geom.kind !== 'LWPOLYLINE') return bad('type', d.type, geom.kind);
      const xs = all(g, 10).map(Number);
      const ys = all(g, 20).map(Number);
      // 42/40/41 belong to the vertex whose 10 precedes them.
      const per = (code: number): number[] => {
        const out: number[] = [];
        for (const [c, v] of g) {
          if (c === 10) out.push(0);
          else if (c === code && out.length > 0) out[out.length - 1] = Number(v);
        }
        return out;
      };
      const bulges = per(42);
      const pts = xs.map((x, k) => ({ x, y: ys[k]! }));
      checkVertices(pts, bulges, num(g, 38), n, geom.vertices, (num(g, 70) & 1) !== 0, bad);
      if (geom.closed !== ((num(g, 70) & 1) !== 0)) bad('70', num(g, 70), geom.closed);
      if (!close(geom.constantWidth ?? 0, num(g, 43))) bad('43', num(g, 43), geom.constantWidth);
      const sw = per(40);
      const ew = per(41);
      geom.vertices.forEach((v, k) => {
        if (!close(v.startWidth ?? 0, sw[k] ?? 0)) bad('40', sw[k], v.startWidth);
        if (!close(v.endWidth ?? 0, ew[k] ?? 0)) bad('41', ew[k], v.endWidth);
      });
      return;
    }
    case 'POLYLINE': {
      const flags = num(g, 70);
      if (flags & (16 | 64)) return; // meshes: reported as not mapped yet, checked below
      if (geom.kind !== 'POLYLINE') return bad('type', d.type, geom.kind);
      const is3d = (flags & 8) !== 0;
      const drawn = d.children
        .filter((c) => c.type === 'VERTEX')
        .map((c) => c.groups)
        .filter((v) => (num(v, 70) & 16) === 0);
      const pts = drawn.map((v) => ({ x: num(v, 10), y: num(v, 20) }));
      const elevation = num(g, 30);
      checkVertices(
        pts,
        drawn.map((v) => (is3d ? 0 : num(v, 42))),
        is3d ? 0 : elevation,
        is3d ? { x: 0, y: 0, z: 1 } : n,
        geom.vertices,
        (flags & 1) !== 0,
        bad,
      );
      if (geom.is3d !== is3d) bad('70', flags, `is3d ${geom.is3d}`);
      if (geom.closed !== ((flags & 1) !== 0)) bad('70', flags, geom.closed);
      return;
    }
    case 'SPLINE': {
      if (geom.kind !== 'SPLINE') return bad('type', d.type, geom.kind);
      if (geom.degree !== num(g, 71)) bad('71', num(g, 71), geom.degree);
      const knots = all(g, 40).map(Number);
      if (knots.length !== geom.knots.length || knots.some((k, i) => !close(k, geom.knots[i]!)))
        bad('40', knots.join(','), geom.knots.join(','));
      const cps = all(g, 10).map((x, k) => ({ x: Number(x), y: Number(all(g, 20)[k]) }));
      if (
        cps.length !== geom.controlPoints.length ||
        cps.some((p, k) => !near(p, geom.controlPoints[k]!))
      )
        bad('10', cps.map(fmt).join(' '), geom.controlPoints.map(fmt).join(' '));
      const w = all(g, 41).map(Number);
      const gw = geom.weights ?? cps.map(() => 1);
      if (w.length > 0 && (w.length !== gw.length || w.some((x, k) => !close(x, gw[k]!))))
        bad('41', w.join(','), gw.join(','));
      const fits = all(g, 11).map((x, k) => ({ x: Number(x), y: Number(all(g, 21)[k]) }));
      const gf = geom.fitPoints ?? [];
      if (fits.length !== gf.length || fits.some((p, k) => !near(p, gf[k]!)))
        bad('11', fits.map(fmt).join(' '), gf.map(fmt).join(' '));
      if (geom.closed !== ((num(g, 70) & 1) !== 0)) bad('70', num(g, 70), `closed ${geom.closed}`);
      return;
    }
    case 'SOLID':
    case 'TRACE':
    case '3DFACE': {
      if (geom.kind !== 'SOLID' && geom.kind !== 'TRACE' && geom.kind !== '3DFACE')
        return bad('type', d.type, geom.kind);
      if (geom.kind !== (d.type === 'TRACE' ? 'TRACE' : d.type)) bad('type', d.type, geom.kind);
      const ocsPlane = d.type === '3DFACE' ? { x: 0, y: 0, z: 1 } : n;
      // An omitted fourth corner is the third (DXF reference, SOLID and 3DFACE).
      const corners = [10, 11, 12, 13].map((c) =>
        first(g, c) === undefined ? pt(g, 12) : pt(g, c),
      );
      corners.forEach((c, k) => {
        const w = plan(c, ocsPlane);
        if (!near(geom.corners[k]!, w)) bad(String(10 + k), fmt(w), fmt(geom.corners[k]!));
      });
      if (geom.kind === '3DFACE' && geom.hiddenEdges !== num(g, 70))
        bad('70', num(g, 70), geom.hiddenEdges);
      return;
    }
  }
}

/** Plan positions of polyline vertices, and each bulged segment's midpoint. */
function checkVertices(
  pts: readonly Vec2[],
  bulges: readonly number[],
  elevation: number,
  n: V3,
  got: readonly { x: number; y: number; bulge: number }[],
  closed: boolean,
  bad: (code: string, file: unknown, got: unknown) => void,
): void {
  if (pts.length !== got.length) return bad('90', pts.length, got.length);
  pts.forEach((p, k) => {
    const w = plan({ ...p, z: elevation }, n);
    if (!near(got[k]!, w)) bad('10', fmt(w), fmt(got[k]!));
    const nextK = k + 1 < pts.length ? k + 1 : closed ? 0 : -1;
    if (nextK < 0 || (bulges[k] ?? 0) === 0) return;
    const want = plan({ ...bulgeMid(p, pts[nextK]!, bulges[k]!), z: elevation }, n);
    const mid = bulgeMid(got[k]!, got[nextK]!, got[k]!.bulge);
    if (!near(mid, want))
      bad('42', `${bulges[k]} mid ${fmt(want)}`, `${got[k]!.bulge} mid ${fmt(mid)}`);
  });
}

const handleOf = (d: DxfEntity): string | undefined =>
  first(d.groups, 5)
    ?.trim()
    .replace(/^0+(?=.)/, '')
    .toUpperCase();

function load(path: string): Uint8Array {
  return new Uint8Array(readFileSync(`${corpusDir}${path}`));
}

describe('AcadToTriya entities on the public corpus (M1-04)', () => {
  const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

  it('maps every entity an ASCII DXF states, in plan view, unchanged', () => {
    const mismatches: Mismatch[] = [];
    let compared = 0;
    for (const f of readable) {
      if (f.format !== 'dxf-ascii') continue;
      const bytes = load(f.path);
      let doc;
      try {
        doc = readCadDocument(bytes);
      } catch {
        continue; // read failures are the round-trip suite's concern
      }
      const tables = mapTables(doc);
      const { entities, unmapped } = mapEntities(doc);
      const byHandle = new Map(entities.map((e) => [e.handle, e]));
      const skipped = new Map(unmapped.map((u) => [u.handle, u]));
      for (const d of readDxfOracle(bytes).entities) {
        const h = handleOf(d);
        if (h === undefined) continue; // R12 entities have no handle to find them by
        const where = `${f.path} ${d.type} ${h}`;
        // Common entity properties are reported as `entity <code>`, geometry per type.
        const report = (code: string, text: string): void => {
          const kind = COMMON.has(code) ? `entity ${code}` : `${d.type} ${code}`;
          mismatches.push({ kind, text: `${where} ${code}: ${text}` });
        };
        const e = byHandle.get(h);
        const u = skipped.get(h);
        const mesh = d.type === 'POLYLINE' && (num(d.groups, 70) & (16 | 64)) !== 0;
        const plane = extrusion(d.groups);
        const expectTilted =
          tilted(plane) && !['LINE', 'POINT', 'SPLINE', 'XLINE', 'RAY', '3DFACE'].includes(d.type);
        if (!MAPPED.has(d.type) || mesh) {
          if (!u) report('unmapped', e ? `mapped as ${e.type}` : 'missing');
          continue;
        }
        if (expectTilted) {
          if (u?.reason !== 'tilted plane') report('tilted', u ? u.reason : 'mapped');
          continue;
        }
        if (!e) {
          report('mapped', u ? u.reason : 'missing');
          continue;
        }
        compared++;
        compareEntity(d, e, tables, report);
      }
    }
    expect(compared).toBeGreaterThan(5000);
    expect(mismatches.filter((m) => !(m.kind in ACAD_TS_GAPS)).map((m) => m.text)).toEqual([]);
    expect([...new Set(mismatches.map((m) => m.kind))].sort()).toEqual(
      Object.keys(ACAD_TS_GAPS).sort(),
    );
  }, 300_000);

  it('accounts for every entity of every block record of every readable file', () => {
    const problems: string[] = [];
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(load(f.path));
      } catch {
        continue;
      }
      const { entities, unmapped } = mapEntities(doc);
      const seen = new Set([...entities.map((e) => e.handle), ...unmapped.map((u) => u.handle)]);
      let total = 0;
      for (const b of doc.blockRecords ?? []) {
        for (const e of b.entities) {
          total++;
          if (!seen.has(e.handle.toString(16).toUpperCase()))
            problems.push(`${f.path} ${e.objectName} ${e.handle.toString(16)}`);
        }
      }
      if (entities.length + unmapped.length !== total)
        problems.push(`${f.path}: ${total} entities → ${entities.length} + ${unmapped.length}`);
      const blocks = new Set(
        (doc.blockRecords ? [...doc.blockRecords] : []).map((b) =>
          b.handle.toString(16).toUpperCase(),
        ),
      );
      for (const e of entities)
        if (!blocks.has(e.owner)) problems.push(`${f.path} ${e.handle}: owner ${e.owner}`);
    }
    expect(problems).toEqual([]);
  }, 300_000);
});
