// M1-04 acceptance: the entities AcadToTriya produces for every public-corpus ASCII DXF match
// what the file states, read by an independent group-code reader (dxf-oracle.ts) and taken to
// plan view with AutoCAD's arbitrary-axis algorithm written out here (DXF reference, "Object
// Coordinate Systems"), not with the mapper's own conversion.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  Color,
  DimensionGeometry,
  EntityInit,
  HatchGeometry,
  InsertGeometry,
  LeaderGeometry,
  MTextGeometry,
  MultiLeaderGeometry,
  TableGeometry,
  ImageGeometry,
  UnderlayGeometry,
  MLineGeometry,
  RegionGeometry,
  ViewportGeometry,
  TextFields,
  Vec2,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { mapEntities, mapTables, readCadDocument, type MappedTables } from '@triya/io';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { all, first, readDxfOracle, type DxfEntity, type Group } from './dxf-oracle.ts';

const hex = (h: number): string => h.toString(16).toUpperCase();
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

/**
 * Where acad-ts itself does not keep what the file states (M1-32). Same ratchet as tables. Empty
 * since M1-32 part 4 (acad-ts patches 0115–0119); keep it for the next gap a new corpus file shows.
 */
const ACAD_TS_GAPS: Record<string, string> = {};

/**
 * What a reader repairs in the intentionally malformed ezdxf recover inputs, so the file's own
 * value is no value to keep (M2-49 brought them into this suite; DEC-047). Keyed by file, then
 * mismatch kind; a listed repair that no longer happens fails the test, as ACAD_TS_GAPS does.
 */
const MALFORMED_REPAIRS: Record<string, Record<string, string>> = {
  'public/third-party/ezdxf/examples_dxf/circle_radius_le_0.dxf': {
    'CIRCLE 40': 'a radius of -1 is no circle; acad-ts keeps the smallest positive one',
  },
  'public/third-party/ezdxf/integration_tests/duplicate_handles.dxf': {
    'LINE mapped':
      'each LINE repeats a table, record or section handle; the reader gives it a new one',
    'TEXT 1': 'two TEXTs share each handle; the reader gives the second a new one',
    'TEXT 10': 'two TEXTs share each handle; the reader gives the second a new one',
    'TEXT 50': 'two TEXTs share each handle; the reader gives the second a new one',
    'DIMENSION 2': 'its *D0/*D1 block is missing; the dimension is drawn by the engine (M2-30)',
    'DIMENSION 3': 'its style DIMSTYLE1 is missing from the DIMSTYLE table; it reads as STANDARD',
    'ELLIPSE 41':
      'a minor-to-major ratio of 1.0095 (more than 1) is refused by acad-ts, which keeps 1',
  },
};

const repaired = (path: string, m: Mismatch): boolean =>
  m.text.startsWith(`${path} `) && m.kind in (MALFORMED_REPAIRS[path] ?? {});

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
  'TEXT',
  'MTEXT',
  'ATTDEF',
  'INSERT',
  'DIMENSION',
  'ARC_DIMENSION',
  'LARGE_RADIAL_DIMENSION',
  'LEADER',
  'TOLERANCE',
  'HATCH',
  'MULTILEADER',
  'ACAD_TABLE',
  'IMAGE',
  'WIPEOUT',
  'PDFUNDERLAY',
  'MLINE',
  'VIEWPORT',
  'REGION',
  'OLE2FRAME',
  'ACAD_PROXY_ENTITY',
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

type Report = (code: string, text: string) => void;

/** AcDbEntity properties: an entity's, or those of an ATTRIB folded into its INSERT. */
function compareCommon(
  g: readonly Group[],
  e: Omit<EntityInit, 'type' | 'owner' | 'geom'>,
  t: MappedTables,
  report: Report,
): void {
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
}

function compareEntity(d: DxfEntity, e: EntityInit, t: MappedTables, report: Report): void {
  const g = d.groups;
  compareCommon(g, e, t, report);
  const geom = e.geom;
  const n = extrusion(g);
  const bad: Bad = (code, file, got) => report(code, `${String(file)} → ${String(got)}`);
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
    case 'TEXT':
    case 'ATTDEF': {
      if (geom.kind !== d.type) return bad('type', d.type, geom.kind);
      compareText(g, geom, d.type, t, bad);
      if (geom.kind === 'ATTDEF') {
        compareAttribute(g, geom, bad);
        const prompt = first(attributeGroups(g), 3) ?? '';
        if (geom.prompt !== prompt) bad('3', prompt, geom.prompt);
      }
      return;
    }
    case 'MTEXT': {
      if (geom.kind !== 'MTEXT') return bad('type', d.type, geom.kind);
      compareMText(g, geom, t, bad);
      return;
    }
    case 'DIMENSION':
    case 'ARC_DIMENSION':
    case 'LARGE_RADIAL_DIMENSION': {
      if (
        geom.kind !== 'DIMENSION' &&
        geom.kind !== 'ARC_DIMENSION' &&
        geom.kind !== 'LARGE_RADIAL_DIMENSION'
      )
        return bad('type', d.type, geom.kind);
      compareDimension(g, d.type, geom, t, bad);
      return;
    }
    case 'LEADER': {
      if (geom.kind !== 'LEADER') return bad('type', d.type, geom.kind);
      compareLeader(g, geom, t, bad);
      return;
    }
    case 'TOLERANCE': {
      if (geom.kind !== 'TOLERANCE') return bad('type', d.type, geom.kind);
      const style = (first(g, 3) ?? 'STANDARD').trim().toUpperCase();
      if (nameOf(t.dimStyles, geom.style) !== style)
        bad('3', style, nameOf(t.dimStyles, geom.style));
      if (!near(geom.position, pt(g, 10))) bad('10', fmt(pt(g, 10)), fmt(geom.position));
      if (!sameText(first(g, 1), geom.text)) bad('1', first(g, 1), geom.text);
      const dir = pt(g, 11);
      if (!sameAngle(geom.rotation, Math.atan2(dir.y, dir.x))) bad('11', fmt(dir), geom.rotation);
      return;
    }
    case 'MULTILEADER': {
      if (geom.kind !== 'MULTILEADER') return bad('type', d.type, geom.kind);
      compareMultiLeader(g, geom, bad);
      return;
    }
    case 'ACAD_TABLE': {
      if (geom.kind !== 'ACAD_TABLE') return bad('type', d.type, geom.kind);
      compareTable(g, n, geom, t, bad);
      return;
    }
    case 'IMAGE':
    case 'WIPEOUT': {
      if (geom.kind !== d.type) return bad('type', d.type, geom.kind);
      compareImage(
        subclass(g, d.type === 'IMAGE' ? 'AcDbRasterImage' : 'AcDbWipeout'),
        geom as ImageGeometry,
        bad,
      );
      return;
    }
    case 'PDFUNDERLAY': {
      if (geom.kind !== 'PDFUNDERLAY') return bad('type', d.type, geom.kind);
      compareUnderlay(subclass(g, 'AcDbUnderlayReference'), n, geom, bad);
      return;
    }
    case 'MLINE': {
      if (geom.kind !== 'MLINE') return bad('type', d.type, geom.kind);
      compareMLine(subclass(g, 'AcDbMline'), geom, bad);
      return;
    }
    case 'VIEWPORT': {
      if (geom.kind !== 'VIEWPORT') return bad('type', d.type, geom.kind);
      compareViewport(g, geom, bad);
      return;
    }
    case 'REGION': {
      if (geom.kind !== 'REGION') return bad('type', d.type, geom.kind);
      compareRegion(subclass(g, 'AcDbModelerGeometry'), geom, bad);
      return;
    }
    case 'HATCH': {
      if (geom.kind !== 'HATCH') return bad('type', d.type, geom.kind);
      compareHatch(subclass(g, 'AcDbHatch'), n, geom, bad);
      return;
    }
    case 'INSERT': {
      if (geom.kind !== 'INSERT') return bad('type', d.type, geom.kind);
      compareInsert(g, geom, t, bad);
      const atts = d.children.filter((c) => c.type === 'ATTRIB');
      if (atts.length !== geom.attributes.length)
        return bad('66', `${atts.length} ATTRIB`, geom.attributes.length);
      atts.forEach((a, k) => {
        const got = geom.attributes[k]!;
        const h = first(a.groups, 5)
          ?.trim()
          .replace(/^0+(?=.)/, '')
          .toUpperCase();
        if (h !== undefined && got.handle !== h) bad('ATTRIB 5', h, got.handle);
        compareCommon(a.groups, got, t, report);
        compareText(a.groups, got, 'ATTRIB', t, (c, f, x) => bad(`ATTRIB ${c}`, f, x));
        compareAttribute(a.groups, got, (c, f, x) => bad(`ATTRIB ${c}`, f, x));
      });
      return;
    }
  }
}

type Bad = (code: string, file: unknown, got: unknown) => void;
const deg = (g: readonly Group[], code: number, dflt = 0): number =>
  (num(g, code, dflt) * Math.PI) / 180;
const nameOf = (rs: readonly { handle: string; name: string }[], h: string): string | undefined =>
  rs.find((r) => r.handle === h)?.name.toUpperCase();

/** A DXF string as acad-ts should decode it; the oracle has already decoded the file's text. */
function sameText(file: string | undefined, got: string): boolean {
  return caret(file ?? '') === got;
}

/** DXF caret notation: `^J` is the control character J − 64, and `^ ` a literal caret. */
const caret = (v: string): string =>
  v.replace(/\^([@-_ ])/g, (_, c: string) =>
    c === ' ' ? '^' : String.fromCharCode(c.charCodeAt(0) - 64),
  );

/**
 * The groups of the named subclass (every `100` run of that name), up to an embedded object
 * (`101`), whose groups reuse the entity's codes. R12 files have no subclass markers, so their
 * groups are all of one.
 */
function subclass(g: readonly Group[], name: string): readonly Group[] {
  const end = g.findIndex(([c]) => c === 101);
  const own = end < 0 ? g : g.slice(0, end);
  if (!own.some(([c]) => c === 100)) return own;
  const out: Group[] = [];
  let inside = false;
  for (const grp of own) {
    if (grp[0] === 100) inside = grp[1].trim() === name;
    else if (inside) out.push(grp);
  }
  return out;
}
const attributeGroups = (g: readonly Group[]): readonly Group[] =>
  subclass(
    g,
    g.some(([c, v]) => c === 100 && v.trim() === 'AcDbAttribute')
      ? 'AcDbAttribute'
      : 'AcDbAttributeDefinition',
  );

/**
 * TEXT, ATTDEF and ATTRIB: the values, and where three glyph-space points of the text frame
 * land, from the file's OCS frame insert + R(θ)·mirror·(u, v) taken to plan view.
 */
function compareText(
  all: readonly Group[],
  geom: TextFields,
  type: string,
  t: MappedTables,
  bad: Bad,
): void {
  const n = extrusion(all);
  const g = subclass(all, 'AcDbText');
  if (!sameText(first(g, 1), geom.value)) bad('1', first(g, 1), geom.value);
  const style = (first(g, 7) ?? 'STANDARD').trim().toUpperCase();
  if (nameOf(t.textStyles, geom.style) !== style) bad('7', style, nameOf(t.textStyles, geom.style));
  const p = pt(g, 10);
  if (!near(geom.position, plan(p, n))) bad('10', fmt(plan(p, n)), fmt(geom.position));
  const h = num(g, 40);
  if (!close(geom.height, h)) bad('40', h, geom.height);
  if (!close(geom.widthFactor, num(g, 41, 1))) bad('41', num(g, 41, 1), geom.widthFactor);
  if (!close(geom.oblique, deg(g, 51))) bad('51', deg(g, 51), geom.oblique);
  if (!close(geom.thickness ?? 0, num(g, 39))) bad('39', num(g, 39), geom.thickness);
  const halign = num(g, 72);
  // TEXT keeps its vertical alignment in 73; ATTDEF and ATTRIB in 74 (DXF reference).
  const valign = type === 'TEXT' ? num(g, 73) : num(attributeGroups(all), 74);
  if (geom.halign !== halign) bad('72', halign, geom.halign);
  if (geom.valign !== valign) bad(type === 'TEXT' ? '73' : '74', valign, geom.valign);
  if (halign !== 0 || valign !== 0) {
    const a = plan(pt(g, 11), n);
    if (!geom.alignmentPoint || !near(geom.alignmentPoint, a))
      bad('11', fmt(a), geom.alignmentPoint && fmt(geom.alignmentPoint));
  }
  const th = deg(g, 50);
  const mirror = num(g, 71);
  // A −Z plane mirrors the frame, which shows as the text turned upside down (DEC-039).
  const flip = n.z < 0;
  if (geom.backward !== ((mirror & 2) !== 0) || (geom.upsideDown !== ((mirror & 4) !== 0)) !== flip)
    return bad('71', mirror, `backward ${geom.backward} upsideDown ${geom.upsideDown}`);
  const file = (u: number, v: number): Vec2 => {
    const su = mirror & 2 ? -u : u;
    const sv = mirror & 4 ? -v : v;
    return plan(
      {
        x: p.x + Math.cos(th) * su - Math.sin(th) * sv,
        y: p.y + Math.sin(th) * su + Math.cos(th) * sv,
        z: p.z,
      },
      n,
    );
  };
  const got = (u: number, v: number): Vec2 => {
    const su = geom.backward ? -u : u;
    const sv = geom.upsideDown ? -v : v;
    const c = Math.cos(geom.rotation);
    const s = Math.sin(geom.rotation);
    return { x: geom.position.x + c * su - s * sv, y: geom.position.y + s * su + c * sv };
  };
  const probes: [number, number][] = [
    [h || 1, 0],
    [0, h || 1],
  ];
  for (const [u, v] of probes)
    if (!near(got(u, v), file(u, v))) bad('50', `${fmt(file(u, v))}`, `${fmt(got(u, v))}`);
}

function compareAttribute(
  all: readonly Group[],
  geom: { tag: string; flags: number },
  bad: Bad,
): void {
  const g = attributeGroups(all);
  if (geom.tag !== (first(g, 2) ?? '')) bad('2', first(g, 2), geom.tag);
  if (geom.flags !== num(g, 70)) bad('70', num(g, 70), geom.flags);
}

/** MTEXT groups up to its embedded column data (101), which repeats some codes. */
function mtextGroups(g: readonly Group[]): readonly Group[] {
  const k = g.findIndex(([c]) => c === 101);
  return k < 0 ? g : g.slice(0, k);
}

function compareMText(all: readonly Group[], geom: MTextGeometry, t: MappedTables, bad: Bad): void {
  const g = mtextGroups(all);
  const n = extrusion(g);
  const contents = g
    .filter(([c]) => c === 3 || c === 1)
    .map(([, v]) => v)
    .join('');
  if (!sameText(contents, geom.contents)) bad('1', contents, geom.contents);
  const style = (first(g, 7) ?? 'STANDARD').trim().toUpperCase();
  if (nameOf(t.textStyles, geom.style) !== style) bad('7', style, nameOf(t.textStyles, geom.style));
  // 10 and 11 are WCS (DXF reference, MTEXT).
  const p = pt(g, 10);
  if (!near(geom.position, p)) bad('10', fmt(p), fmt(geom.position));
  if (!close(geom.height, num(g, 40))) bad('40', num(g, 40), geom.height);
  if (!close(geom.width, num(g, 41))) bad('41', num(g, 41), geom.width);
  if (!close(geom.definedHeight ?? 0, num(g, 46))) bad('46', num(g, 46), geom.definedHeight);
  if (geom.attachment !== num(g, 71, 1)) bad('71', num(g, 71, 1), geom.attachment);
  if (geom.direction !== num(g, 72, 1)) bad('72', num(g, 72, 1), geom.direction);
  if (geom.lineSpacingStyle !== num(g, 73, 1)) bad('73', num(g, 73, 1), geom.lineSpacingStyle);
  if (!close(geom.lineSpacing, num(g, 44, 1))) bad('44', num(g, 44, 1), geom.lineSpacing);
  // The X direction: 11 when stated, else the 50 rotation in the OCS.
  const dir =
    first(g, 11) !== undefined
      ? pt(g, 11)
      : (() => {
          const w = plan({ x: Math.cos(deg(g, 50)), y: Math.sin(deg(g, 50)) }, n);
          return { x: w.x, y: w.y, z: 0 };
        })();
  const want = Math.atan2(dir.y, dir.x);
  const dGot = { x: Math.cos(geom.rotation), y: Math.sin(geom.rotation) };
  if (!near(dGot, { x: Math.cos(want), y: Math.sin(want) })) bad('11', fmt(dir), geom.rotation);
  // The text's Y axis is normal × X; it is reversed in plan view when the normal is −Z.
  if ((geom.upsideDown ?? false) !== n.z < 0) bad('210', fmt(n), `upsideDown ${geom.upsideDown}`);
  const bg = num(g, 90);
  if ((geom.background?.flags ?? 0) !== bg) bad('90', bg, geom.background?.flags);
  if (bg !== 0 && !close(geom.background!.scale, num(g, 45, 1.5)))
    bad('45', num(g, 45, 1.5), geom.background!.scale);
}

function compareInsert(g: readonly Group[], geom: InsertGeometry, t: MappedTables, bad: Bad): void {
  const n = extrusion(g);
  const name = (first(g, 2) ?? '').trim().toUpperCase();
  if (nameOf(t.blockRecords, geom.block) !== name)
    bad('2', name, nameOf(t.blockRecords, geom.block));
  const p = pt(g, 10);
  const sx = num(g, 41, 1);
  const sy = num(g, 42, 1);
  const th = deg(g, 50);
  // Block point q lands at OCS insert + R(θ)·S·q, taken to plan view.
  const file = (q: Vec2): Vec2 =>
    plan(
      {
        x: p.x + Math.cos(th) * sx * q.x - Math.sin(th) * sy * q.y,
        y: p.y + Math.sin(th) * sx * q.x + Math.cos(th) * sy * q.y,
        z: p.z,
      },
      n,
    );
  const got = (q: Vec2): Vec2 => {
    const x = q.x * geom.scale.x;
    const y = q.y * geom.scale.y;
    const c = Math.cos(geom.rotation);
    const s = Math.sin(geom.rotation);
    return { x: geom.position.x + c * x - s * y, y: geom.position.y + s * x + c * y };
  };
  for (const q of [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ])
    if (!near(got(q), file(q))) bad('10', fmt(file(q)), fmt(got(q)));
  if (!close(Math.abs(geom.scale.z), Math.abs(num(g, 43, 1))))
    bad('43', num(g, 43, 1), geom.scale.z);
  const cols = num(g, 70, 1);
  const rows = num(g, 71, 1);
  if ((geom.array?.columns ?? 1) !== Math.max(cols, 1)) bad('70', cols, geom.array?.columns);
  if ((geom.array?.rows ?? 1) !== Math.max(rows, 1)) bad('71', rows, geom.array?.rows);
  if (geom.array) {
    // Columns run along the block's rotated X axis, rows along its Y, in the OCS.
    const step = (dc: number, dr: number): Vec2 =>
      plan(
        {
          x: p.x + Math.cos(th) * dc - Math.sin(th) * dr,
          y: p.y + Math.sin(th) * dc + Math.cos(th) * dr,
          z: p.z,
        },
        n,
      );
    const c = Math.cos(geom.rotation);
    const s = Math.sin(geom.rotation);
    const a = geom.array;
    const gotStep = {
      x: geom.position.x + c * a.columnSpacing - s * a.rowSpacing,
      y: geom.position.y + s * a.columnSpacing + c * a.rowSpacing,
    };
    const want = step(num(g, 44), num(g, 45));
    if (!near(gotStep, want)) bad('44', fmt(want), fmt(gotStep));
  }
}

const sameAngle = (a: number, b: number): boolean =>
  near({ x: Math.cos(a), y: Math.sin(a) }, { x: Math.cos(b), y: Math.sin(b) });

/** The groups after the AcDbDimension subclass (the per-type subclasses); all of R12's. */
function afterDimension(g: readonly Group[]): readonly Group[] {
  const k = g.findIndex(([c, v]) => c === 100 && v.trim() === 'AcDbDimension');
  if (k < 0) return g;
  const next = g.findIndex(([c], i) => i > k && c === 100);
  return next < 0 ? [] : g.slice(next);
}

const DIM_TYPES = ['linear', 'aligned', 'angular', 'diameter', 'radius', 'angular3pt', 'ordinate'];

function compareDimension(
  all: readonly Group[],
  type: string,
  geom: DimensionGeometry,
  t: MappedTables,
  bad: Bad,
): void {
  const n = extrusion(all);
  const g = subclass(all, 'AcDbDimension');
  const sub = afterDimension(all);
  // OCS angles (DXF 50–53) are WCS π − θ under −Z.
  const ocsAngle = (code: number, groups: readonly Group[]): number =>
    n.z < 0 ? Math.PI - deg(groups, code) : deg(groups, code);
  const flags = num(g, 70);
  // A jogged radius dimension stores type 9 in 70 (uncommon.dxf: 169 = 9 | 32 | 128).
  const want =
    type === 'ARC_DIMENSION'
      ? 'arc'
      : type === 'LARGE_RADIAL_DIMENSION'
        ? 'jogged'
        : DIM_TYPES[flags & 7];
  if (geom.dimType !== want) return bad('70', `${flags} ${want}`, geom.dimType);
  const style = (first(g, 3) ?? 'STANDARD').trim().toUpperCase();
  if (nameOf(t.dimStyles, geom.style) !== style) bad('3', style, nameOf(t.dimStyles, geom.style));
  const block = first(g, 2)?.trim().toUpperCase();
  const gotBlock = geom.block && nameOf(t.blockRecords, geom.block);
  if ((block || undefined) !== gotBlock) bad('2', block, gotBlock);
  if (!near(geom.definitionPoint, pt(g, 10))) bad('10', fmt(pt(g, 10)), fmt(geom.definitionPoint));
  const tp = plan(pt(g, 11), n);
  if (!near(geom.textPosition, tp)) bad('11', fmt(tp), fmt(geom.textPosition));
  if (geom.textUserPositioned !== ((flags & 128) !== 0)) bad('70', flags, geom.textUserPositioned);
  if (!sameText(first(g, 1) ?? '', geom.text)) bad('1', first(g, 1), geom.text);
  if (!sameAngle(geom.textRotation, ocsAngle(53, g))) bad('53', num(g, 53), geom.textRotation);
  if (first(g, 51) !== undefined && !sameAngle(geom.horizontalDirection, ocsAngle(51, g)))
    bad('51', num(g, 51), geom.horizontalDirection);
  // R12 dimensions have no 71; a value the file does not state is not compared.
  if (first(g, 71) !== undefined && geom.attachment !== num(g, 71))
    bad('71', num(g, 71), geom.attachment);
  if (first(g, 41) !== undefined && !close(geom.lineSpacing, num(g, 41)))
    bad('41', num(g, 41), geom.lineSpacing);
  const p = (code: number): Vec2 => ({ x: num(sub, code), y: num(sub, code + 10) });
  const check = (code: number, got: Vec2, want = p(code)): void => {
    if (!near(got, want)) bad(String(code), fmt(want), fmt(got));
  };
  switch (geom.dimType) {
    case 'linear':
    case 'aligned':
      check(13, geom.first);
      check(14, geom.second);
      if (geom.dimType === 'linear' && !sameAngle(geom.rotation ?? 0, ocsAngle(50, sub)))
        bad('50', num(sub, 50), geom.rotation);
      if (!sameAngle(geom.oblique ?? 0, first(sub, 52) ? ocsAngle(52, sub) : 0))
        bad('52', num(sub, 52), geom.oblique);
      return;
    case 'angular':
      check(13, geom.line1Start);
      check(14, geom.line1End);
      check(15, geom.line2Start);
      check(16, geom.arcPoint, plan({ ...p(16), z: num(sub, 36) }, n));
      return;
    case 'angular3pt':
      check(13, geom.first);
      check(14, geom.second);
      check(15, geom.vertex);
      return;
    case 'radius':
    case 'diameter':
      check(15, geom.chordPoint);
      if (!close(geom.leaderLength, num(sub, 40))) bad('40', num(sub, 40), geom.leaderLength);
      return;
    case 'jogged':
      check(13, geom.overrideCenter);
      check(14, geom.jogPoint);
      check(15, geom.chordPoint);
      if (!close(geom.leaderLength, num(sub, 40))) bad('40', num(sub, 40), geom.leaderLength);
      return;
    case 'ordinate':
      check(13, geom.feature);
      check(14, geom.leaderEnd);
      if (geom.axis !== (flags & 64 ? 'x' : 'y')) bad('70', flags, geom.axis);
      return;
    case 'arc':
      check(13, geom.first);
      check(14, geom.second);
      check(15, geom.center);
      if (geom.partial !== (num(sub, 70) !== 0)) bad('70', num(sub, 70), geom.partial);
      if (!!geom.leader !== (num(sub, 71) !== 0)) bad('71', num(sub, 71), !!geom.leader);
      if (geom.leader) {
        check(16, geom.leader[0]);
        check(17, geom.leader[1]);
      }
      if (!close(geom.startAngle, num(sub, 40))) bad('40', num(sub, 40), geom.startAngle);
      if (!close(geom.endAngle, num(sub, 41))) bad('41', num(sub, 41), geom.endAngle);
      return;
  }
}

function compareLeader(g: readonly Group[], geom: LeaderGeometry, t: MappedTables, bad: Bad): void {
  const style = (first(g, 3) ?? 'STANDARD').trim().toUpperCase();
  if (nameOf(t.dimStyles, geom.style) !== style) bad('3', style, nameOf(t.dimStyles, geom.style));
  const xs = all(g, 10).map(Number);
  const ys = all(g, 20).map(Number);
  const vs = xs.map((x, k) => ({ x, y: ys[k]! }));
  if (vs.length !== geom.vertices.length || vs.some((v, k) => !near(v, geom.vertices[k]!)))
    bad('10', vs.map(fmt).join(' '), geom.vertices.map(fmt).join(' '));
  // DXF 71 defaults to 1: files omit it when the arrowhead is on (acad-ts patch 0074).
  if (geom.arrowhead !== (num(g, 71, 1) !== 0)) bad('71', num(g, 71, 1), geom.arrowhead);
  if (geom.spline !== (num(g, 72) === 1)) bad('72', num(g, 72), geom.spline);
  if (geom.creationType !== num(g, 73, 3)) bad('73', num(g, 73, 3), geom.creationType);
  if (!!geom.hookline !== (num(g, 75) !== 0)) bad('75', num(g, 75), !!geom.hookline);
  if (geom.hookline && geom.hookline.sameDirection !== (num(g, 74) === 1))
    bad('74', num(g, 74), geom.hookline.sameDirection);
  if (!close(geom.textHeight, num(g, 40))) bad('40', num(g, 40), geom.textHeight);
  if (!close(geom.textWidth, num(g, 41))) bad('41', num(g, 41), geom.textWidth);
  const ann = first(g, 340)
    ?.trim()
    .replace(/^0+(?=.)/, '')
    .toUpperCase();
  if ((ann && ann !== '0' ? ann : undefined) !== geom.annotation) bad('340', ann, geom.annotation);
  if (first(g, 211) !== undefined && !near(geom.horizontalDirection, pt(g, 211)))
    bad('211', fmt(pt(g, 211)), fmt(geom.horizontalDirection));
}

/** A handle group as the mapper states it: no leading zeros, upper case, 0 for none. */
const handleIn = (g: readonly Group[], code: number): string | undefined => {
  const h = first(g, code)
    ?.trim()
    .replace(/^0+(?=.)/, '')
    .toUpperCase();
  return h && h !== '0' ? h : undefined;
};

/**
 * An AcCmEntityColor as MULTILEADER writes it (DXF 91/92/93 and context 90): a signed 32-bit
 * value whose high byte is the method, 0xC0 ByLayer, 0xC1 ByBlock, 0xC2 RGB, 0xC3 ACI.
 */
function cmColor(g: readonly Group[], code: number): string {
  const v = Number(first(g, code) ?? '0') >>> 0;
  const method = v >>> 24;
  if (method === 0xc0) return 'byLayer';
  if (method === 0xc2) return `rgb ${(v >>> 16) & 255},${(v >>> 8) & 255},${v & 255}`;
  if (method === 0xc3) {
    const i = v & 255;
    return i === 0 ? 'byBlock' : i === 256 ? 'byLayer' : `aci ${i}`;
  }
  return 'byBlock';
}
const colorText = (c: Color): string =>
  c.kind === 'rgb' ? `rgb ${c.r},${c.g},${c.b}` : c.kind === 'aci' ? `aci ${c.index}` : c.kind;

/** The groups between an opening marker group and its closing `}` group, nesting aside. */
function braces(
  g: readonly Group[],
  open: Group,
  close: number,
): { inner: Group[]; outer: Group[] }[] {
  const out: { inner: Group[]; outer: Group[] }[] = [];
  let i = 0;
  while (i < g.length) {
    const s = g.findIndex(([c, v], k) => k >= i && c === open[0] && v.trim() === open[1]);
    if (s < 0) break;
    const e = g.findIndex(([c, v], k) => k > s && c === close && v.trim() === '}');
    out.push({ inner: g.slice(s + 1, e), outer: [] });
    i = e + 1;
  }
  return out;
}
const without = (g: readonly Group[], open: Group, close: number): Group[] => {
  const out: Group[] = [];
  let depth = 0;
  for (const grp of g) {
    if (grp[0] === open[0] && grp[1].trim() === open[1]) depth++;
    else if (depth > 0 && grp[0] === close && grp[1].trim() === '}') depth--;
    else if (depth === 0) out.push(grp);
  }
  return out;
};

/**
 * MULTILEADER (DXF reference, MLEADER): the AcDbMLeader groups, its CONTEXT_DATA{ block and
 * that block's LEADER{ and LEADER_LINE{ blocks, read apart. All points are WCS.
 */
function compareMultiLeader(groups: readonly Group[], geom: MultiLeaderGeometry, bad: Bad): void {
  const ml = subclass(groups, 'AcDbMLeader');
  const CTX: Group = [300, 'CONTEXT_DATA{'];
  const LEADER: Group = [302, 'LEADER{'];
  const LINE: Group = [304, 'LEADER_LINE{'];
  const own = without(ml, CTX, 301);
  const ctxAll = braces(ml, CTX, 301)[0]?.inner ?? [];
  const ctx = without(ctxAll, LEADER, 303);
  const pt2 = (g: readonly Group[], code: number): Vec2 => ({
    x: num(g, code),
    y: num(g, code + 10),
  });
  const ints: [string, number, number][] = [
    ['90', num(own, 90), geom.overrideFlags],
    ['170', num(own, 170), geom.pathType],
    ['172', num(own, 172), geom.contentType],
    ['173', num(own, 173), geom.textLeftAttachment],
    ['95', num(own, 95), geom.textRightAttachment],
    ['271', num(own, 271), geom.textAttachmentDirection],
    ['174', num(own, 174), geom.textAngleType],
    ['175', num(own, 175), geom.textAlignment],
  ];
  for (const [code, file, got] of ints) if (file !== got) bad(code, file, got);
  // 272/273 arrived with R2010; older files omit them, leaving the reader's default.
  if (first(own, 273) !== undefined && num(own, 273) !== geom.textTopAttachment)
    bad('273', num(own, 273), geom.textTopAttachment);
  if (first(own, 272) !== undefined && num(own, 272) !== geom.textBottomAttachment)
    bad('272', num(own, 272), geom.textBottomAttachment);
  const flags: [string, boolean][] = [
    ['290', geom.landing],
    ['291', geom.dogleg],
    ['292', geom.textFrame],
    ['293', geom.annotative],
  ];
  for (const [code, got] of flags)
    if ((num(own, Number(code)) !== 0) !== got) bad(code, num(own, Number(code)), got);
  const reals: [string, readonly Group[], number, number][] = [
    ['41', own, num(own, 41), geom.doglegLength],
    ['42', own, num(own, 42), geom.arrowheadSize],
    ['45', own, num(own, 45, 1), geom.scale],
    ['ctx 145', ctx, num(ctx, 145), geom.landingGap],
  ];
  for (const [code, , file, got] of reals) if (!close(file, got)) bad(code, file, got);
  if (handleIn(own, 340) !== geom.style) bad('340', handleIn(own, 340), geom.style);
  if (handleIn(own, 341) !== geom.linetype) bad('341', handleIn(own, 341), geom.linetype);
  if (handleIn(own, 342) !== geom.arrowhead) bad('342', handleIn(own, 342), geom.arrowhead);
  if (cmColor(own, 91) !== colorText(geom.lineColor))
    bad('91', cmColor(own, 91), colorText(geom.lineColor));
  const lw = num(own, 171);
  const lwGot = geom.lineweight;
  if ((lw === -1 ? 'ByLayer' : lw === -2 ? 'ByBlock' : lw === -3 ? 'Default' : lw) !== lwGot)
    bad('171', lw, lwGot);
  if (!near(pt2(ctx, 10), geom.contentBase))
    bad('ctx 10', fmt(pt2(ctx, 10)), fmt(geom.contentBase));

  const text = geom.text;
  if ((num(ctx, 290) !== 0) !== !!text) bad('ctx 290', num(ctx, 290), !!text);
  if (text) {
    if (!sameText(first(ctx, 304), text.content)) bad('ctx 304', first(ctx, 304), text.content);
    if (handleIn(ctx, 340) !== text.style) bad('ctx 340', handleIn(ctx, 340), text.style);
    if (!near(pt2(ctx, 12), text.position)) bad('ctx 12', fmt(pt2(ctx, 12)), fmt(text.position));
    const dir = pt2(ctx, 13);
    if ((dir.x !== 0 || dir.y !== 0) && !sameAngle(text.rotation, Math.atan2(dir.y, dir.x)))
      bad('ctx 13', fmt(dir), text.rotation);
    if (num(ctx, 31, 1) < 0 !== !!text.upsideDown) bad('ctx 31', num(ctx, 31, 1), text.upsideDown);
    const tr: [string, number, number][] = [
      ['ctx 41', num(ctx, 41), text.height],
      ['ctx 43', num(ctx, 43), text.width],
      ['ctx 44', num(ctx, 44), text.boundaryHeight],
      ['ctx 45', num(ctx, 45), text.lineSpacing],
    ];
    for (const [code, file, got] of tr) if (!close(file, got)) bad(code, file, got);
    const ti: [string, number, number][] = [
      ['ctx 170', num(ctx, 170), text.lineSpacingStyle],
      ['ctx 171', num(ctx, 171), text.attachment],
      ['ctx 172', num(ctx, 172), text.flow],
    ];
    for (const [code, file, got] of ti) if (file !== got) bad(code, file, got);
    if (cmColor(ctx, 90) !== colorText(text.color))
      bad('ctx 90', cmColor(ctx, 90), colorText(text.color));
  }
  const block = geom.block;
  if ((num(ctx, 296) !== 0) !== !!block) bad('ctx 296', num(ctx, 296), !!block);
  if (block) {
    if (handleIn(ctx, 341) !== block.block) bad('ctx 341', handleIn(ctx, 341), block.block);
    if (!near(pt2(ctx, 15), block.position)) bad('ctx 15', fmt(pt2(ctx, 15)), fmt(block.position));
    const sc = pt(ctx, 16);
    if (
      ![sc.x, sc.y, sc.z].every((v, k) =>
        close(v, [block.scale.x, block.scale.y, block.scale.z][k]!),
      )
    )
      bad('ctx 16', JSON.stringify(sc), JSON.stringify(block.scale));
    if (!close(num(ctx, 46), block.rotation)) bad('ctx 46', num(ctx, 46), block.rotation);
    if (cmColor(ctx, 93) !== colorText(block.color))
      bad('ctx 93', cmColor(ctx, 93), colorText(block.color));
  }

  const roots = braces(ctxAll, LEADER, 303).map((b) => b.inner);
  if (roots.length !== geom.branches.length)
    return bad('LEADER{', roots.length, geom.branches.length);
  roots.forEach((r, k) => {
    const got = geom.branches[k]!;
    const rg = without(r, LINE, 305);
    if (num(rg, 90) !== got.index) bad('LEADER{ 90', num(rg, 90), got.index);
    if (!near(pt2(rg, 10), got.connection))
      bad('LEADER{ 10', fmt(pt2(rg, 10)), fmt(got.connection));
    if (!near(pt2(rg, 11), got.direction)) bad('LEADER{ 11', fmt(pt2(rg, 11)), fmt(got.direction));
    if (!close(num(rg, 40), got.doglegLength)) bad('LEADER{ 40', num(rg, 40), got.doglegLength);
    const lines = braces(r, LINE, 305).map((b) => b.inner);
    if (lines.length !== got.lines.length)
      return bad('LEADER_LINE{', lines.length, got.lines.length);
    lines.forEach((l, j) => {
      const gl = got.lines[j]!;
      if (num(l, 91) !== gl.index) bad('LEADER_LINE{ 91', num(l, 91), gl.index);
      const xs = all(l, 10).map(Number);
      const ys = all(l, 20).map(Number);
      const vs = xs.map((x, q) => ({ x, y: ys[q]! }));
      if (vs.length !== gl.vertices.length || vs.some((v, q) => !near(v, gl.vertices[q]!)))
        bad('LEADER_LINE{ 10', vs.map(fmt).join(' '), gl.vertices.map(fmt).join(' '));
    });
  });
}

/**
 * ACAD_TABLE (DXF reference): the AcDbTable header up to the first cell, then one cell per
 * 171 group, each with an optional CELL_VALUE block (301 … 304) whose codes repeat the cell's.
 */
function compareTable(
  groups: readonly Group[],
  n: V3,
  geom: TableGeometry,
  t: MappedTables,
  bad: Bad,
): void {
  const ref = subclass(groups, 'AcDbBlockReference');
  const g = subclass(groups, 'AcDbTable');
  const firstCell = g.findIndex(([c]) => c === 171);
  const head = firstCell < 0 ? g : g.slice(0, firstCell);
  if (handleIn(head, 342) !== geom.style) bad('342', handleIn(head, 342), geom.style);
  if (first(head, 343) !== undefined && handleIn(head, 343) !== geom.block)
    bad('343', handleIn(head, 343), geom.block);
  const at = plan(pt(ref, 10), n);
  if (!near(at, geom.position)) bad('10', fmt(at), fmt(geom.position));
  const dir = { x: num(head, 11), y: num(head, 21) };
  if (!near(dir, geom.direction)) bad('11', fmt(dir), fmt(geom.direction));
  const heights = all(head, 141).map(Number);
  const widths = all(head, 142).map(Number);
  if (num(head, 91) !== heights.length) bad('91', num(head, 91), heights.length);
  if (num(head, 92) !== widths.length) bad('92', num(head, 92), widths.length);
  if (
    heights.length !== geom.rowHeights.length ||
    heights.some((h, k) => !close(h, geom.rowHeights[k]!))
  )
    bad('141', heights.join(' '), geom.rowHeights.join(' '));
  if (
    widths.length !== geom.columnWidths.length ||
    widths.some((w, k) => !close(w, geom.columnWidths[k]!))
  )
    bad('142', widths.join(' '), geom.columnWidths.join(' '));

  const fileOverrides = JSON.stringify(digits(tableOverridesOf(head, t)));
  const mappedOverrides = JSON.stringify(digits(geom.overrides));
  if (fileOverrides !== mappedOverrides) bad('93', fileOverrides, mappedOverrides);

  const cells: Group[][] = [];
  let inValue = false;
  for (const grp of firstCell < 0 ? [] : g.slice(firstCell)) {
    if (grp[0] === 301 && grp[1].trim() === 'CELL_VALUE') inValue = true;
    else if (grp[0] === 304 && grp[1].trim() === 'ACVALUE_END') inValue = false;
    else if (grp[0] === 171 && !inValue) cells.push([]);
    cells.at(-1)?.push(grp);
  }
  const got = geom.cells.flat();
  if (cells.length !== got.length) return bad('cells', cells.length, got.length);
  if (geom.cells.some((r) => r.length !== widths.length)) bad('cells', 'rows of 92', 'ragged');
  cells.forEach((c, k) => {
    const e = got[k]!;
    const at = `${Math.floor(k / Math.max(1, widths.length))},${k % Math.max(1, widths.length)}`;
    const type = num(c, 171) === 2 ? 'block' : 'text';
    if (type !== e.type) bad('cell 171', `${at} ${type}`, e.type);
    if ((num(c, 173) !== 0) !== e.merged) bad('cell 173', `${at} ${num(c, 173)}`, e.merged);
    if (Math.max(1, num(c, 175)) !== e.columnSpan)
      bad('cell 175', `${at} ${num(c, 175)}`, e.columnSpan);
    if (Math.max(1, num(c, 176)) !== e.rowSpan) bad('cell 176', `${at} ${num(c, 176)}`, e.rowSpan);
    if (!close(num(c, 145), e.rotation)) bad('cell 145', `${at} ${num(c, 145)}`, e.rotation);
    if (type === 'block' && handleIn(c, 340) !== e.block)
      bad('cell 340', `${at} ${handleIn(c, 340)}`, e.block);
    const one = c.findIndex(([code]) => code === 1);
    const text =
      one < 0
        ? (first(c, 302) ?? '')
        : c
            .slice(0, one)
            .filter(([code]) => code === 2)
            .map(([, v]) => v)
            .join('') + c[one]![1];
    if (type === 'text' && !sameText(text, e.text)) bad('cell 1', `${at} ${text}`, e.text);
    const fileFormat = JSON.stringify(digits(cellFormatOf(c, t)));
    const mappedFormat = JSON.stringify(digits(e.format));
    if (fileFormat !== mappedFormat) bad('cell format', `${at} ${fileFormat}`, mappedFormat);
  });
}

/** Numbers to the 12 significant digits ASCII DXF keeps of them. */
function digits(v: unknown): unknown {
  return typeof v === 'number'
    ? Number(v.toPrecision(12))
    : Array.isArray(v)
      ? v.map(digits)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, digits(x)]))
        : v;
}

/**
 * The table-wide overrides of a DXF ACAD_TABLE (M1-77): the flag word 93 says which apply, and
 * their values follow 93–96 in flag order, with the DXF codes the ODA specification gives them
 * (40 / 41 margins; per row type 64 content colour, 283 fill none, 63 fill colour, 170
 * alignment, 7 text style, 140 text height). Each per-row-type code repeats for the row types
 * whose bit is set, in AcDb::RowType order: data, title, header (sample table 528 states
 * title 0.1425 in DWG, which DXF writes second). The flag bits are title, header, data. The
 * horizontal margin is the left and right one, the vertical margin the top and bottom one.
 */
function tableOverridesOf(head: readonly Group[], t: MappedTables): unknown {
  const flags = num(head, 93);
  const values = (code: number): string[] => {
    const from = head.findIndex(([c]) => c === 93);
    return head
      .slice(from)
      .filter(([c]) => c === code)
      .map(([, v]) => v.trim());
  };
  const o: Record<string, unknown> = {};
  const margins: Record<string, number> = {};
  if (flags & 0x08) margins.left = margins.right = Number(values(40)[0]);
  if (flags & 0x10) margins.top = margins.bottom = Number(values(41)[0]);
  if (Object.keys(margins).length > 0)
    o.margins = {
      left: margins.left,
      top: margins.top,
      right: margins.right,
      bottom: margins.bottom,
    };
  // Bits per row type, title / header / data, from 0x20 content colour on.
  const bit = (property: number, row: number) => 1 << (5 + 3 * property + row);
  const order = [2, 0, 1]; // data, title, header
  const rows: Record<string, unknown>[] = [{}, {}, {}];
  const fillNone = [false, false, false];
  const take = (property: number, code: number, set: (row: number, v: string) => void) => {
    const vs = values(code);
    let k = 0;
    for (const row of order) if (flags & bit(property, row)) set(row, vs[k++]!);
  };
  take(0, 64, (row, v) => (rows[row]!.contentColor = aciOf(Number(v))));
  take(1, 283, (row, v) => (fillNone[row] = Number(v) === 1));
  take(2, 63, (row, v) => (rows[row]!.background = aciOf(Number(v))));
  fillNone.forEach((none, row) => none && (rows[row]!.background = null));
  take(3, 170, (row, v) => (rows[row]!.alignment = Number(v)));
  take(4, 7, (row, v) => {
    const style = t.textStyles.find((s) => s.name.toUpperCase() === v.toUpperCase())?.handle;
    if (style) rows[row]!.textStyle = style;
  });
  take(5, 140, (row, v) => (rows[row]!.textHeight = Number(v)));
  const keys = ['alignment', 'textStyle', 'textHeight', 'contentColor', 'background'];
  const sorted = (r: Record<string, unknown>) =>
    Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]]));
  for (const [k, name] of ['title', 'header', 'data'].entries())
    if (Object.keys(rows[k]!).length > 0) o[name] = sorted(rows[k]!);
  return Object.keys(o).length > 0 ? o : undefined;
}

/** An ACI colour group (6x of a table cell): 0 ByBlock, 256 ByLayer. */
function aciOf(index: number): unknown {
  return index === 0
    ? { kind: 'byBlock' }
    : index === 256
      ? { kind: 'byLayer' }
      : { kind: 'aci', index: Math.abs(index) };
}

/**
 * The format a DXF ACAD_TABLE cell overrides (M1-36), read from its own groups: the override
 * flag word (177 before R2007, a 16-bit word, then 91) says which of 170, 283, 63, 64, 7, 140
 * and the edge groups (colour 69 / 65 / 66 / 68, lineweight 279 / 275 / 276 / 278 for top,
 * right, bottom, left) apply. 283 is "background fill none". The groups of the cell's
 * CELL_VALUE block are not the cell's.
 */
function cellFormatOf(cell: readonly Group[], t: MappedTables): unknown {
  const own: Group[] = [];
  let inValue = false;
  for (const grp of cell) {
    if (grp[0] === 301 && grp[1].trim() === 'CELL_VALUE') inValue = true;
    else if (grp[0] === 304 && grp[1].trim() === 'ACVALUE_END') inValue = false;
    else if (!inValue) own.push(grp);
  }
  const flags = first(own, 91) !== undefined ? num(own, 91) : num(own, 177) & 0xffff;
  const f: Record<string, unknown> = {};
  if (flags & 0x01) f.alignment = num(own, 170);
  if (flags & 0x04) f.background = aciOf(num(own, 63));
  if (flags & 0x02 && num(own, 283) === 1) f.background = null;
  if (flags & 0x08) f.contentColor = aciOf(num(own, 64));
  const style = first(own, 7)?.trim().toUpperCase();
  const styleHandle = t.textStyles.find((s) => s.name.toUpperCase() === style)?.handle;
  if (flags & 0x10 && styleHandle) f.textStyle = styleHandle;
  if (flags & 0x20) f.textHeight = num(own, 140);
  const lw = (v: number) => ({ [-1]: 'ByLayer', [-2]: 'ByBlock', [-3]: 'Default' })[v] ?? v;
  const borders: Record<string, Record<string, unknown>> = {};
  const edges = [
    ['top', 0x40, 0x400, 69, 279],
    ['right', 0x80, 0x800, 65, 275],
    ['bottom', 0x100, 0x1000, 66, 276],
    ['left', 0x200, 0x2000, 68, 278],
  ] as const;
  for (const [side, color, weight, colorCode, weightCode] of edges) {
    const b: Record<string, unknown> = {};
    if (flags & color) b.color = aciOf(num(own, colorCode));
    if (flags & weight) b.lineweight = lw(num(own, weightCode));
    if (Object.keys(b).length > 0) borders[side] = b;
  }
  if (Object.keys(borders).length > 0) f.borders = borders;
  return Object.keys(f).length > 0 ? f : undefined;
}

/** IMAGE / WIPEOUT (DXF AcDbRasterImage): WCS points and vectors, clip vertices in pixels. */
function compareImage(g: readonly Group[], geom: ImageGeometry, bad: Bad): void {
  const p2 = (code: number): Vec2 => ({ x: num(g, code), y: num(g, code + 10) });
  for (const [code, got] of [
    [10, geom.position],
    [11, geom.u],
    [12, geom.v],
    [13, geom.size],
  ] as const)
    if (!near(p2(code), got)) bad(String(code), fmt(p2(code)), fmt(got));
  if (handleIn(g, 340) !== geom.definition) bad('340', handleIn(g, 340), geom.definition);
  const ints: [string, number, number][] = [
    ['70', num(g, 70), geom.displayFlags],
    ['281', num(g, 281, 50), geom.brightness],
    ['282', num(g, 282, 50), geom.contrast],
    ['283', num(g, 283), geom.fade],
  ];
  for (const [code, file, got] of ints) if (file !== got) bad(code, file, got);
  if ((num(g, 280) !== 0) !== geom.clipping) bad('280', num(g, 280), geom.clipping);
  if ((num(g, 290) === 1) !== geom.clip.inverted) bad('290', num(g, 290), geom.clip.inverted);
  const type = num(g, 71, 1) === 2 ? 'polygon' : 'rectangle';
  if (type !== geom.clip.type) bad('71', num(g, 71, 1), geom.clip.type);
  const xs = all(g, 14).map(Number);
  const ys = all(g, 24).map(Number);
  const vs = xs.map((x, k) => ({ x, y: ys[k]! }));
  if (
    vs.length !== geom.clip.vertices.length ||
    vs.some((v, k) => !near(v, geom.clip.vertices[k]!))
  )
    bad('14', vs.map(fmt).join(' '), geom.clip.vertices.map(fmt).join(' '));
}

/** PDFUNDERLAY (DXF AcDbUnderlayReference): 10 WCS, 50 about the normal 210, 11 own frame. */
function compareUnderlay(g: readonly Group[], n: V3, geom: UnderlayGeometry, bad: Bad): void {
  if (handleIn(g, 340) !== geom.definition) bad('340', handleIn(g, 340), geom.definition);
  const at = { x: num(g, 10), y: num(g, 20) };
  if (!near(at, geom.position)) bad('10', fmt(at), fmt(geom.position));
  const sc = [num(g, 41, 1), num(g, 42, 1), num(g, 43, 1)];
  if (!sc.every((v, k) => close(v, [geom.scale.x, geom.scale.y, geom.scale.z][k]!)))
    bad('41', sc.join(' '), JSON.stringify(geom.scale));
  // The X axis at 50 in the OCS of 210, taken to plan view.
  const x = plan({ x: Math.cos(deg(g, 50)), y: Math.sin(deg(g, 50)) }, n);
  if (!sameAngle(geom.rotation, Math.atan2(x.y, x.x))) bad('50', num(g, 50), geom.rotation);
  for (const [code, file, got] of [
    ['280', num(g, 280), geom.flags],
    ['281', num(g, 281, 100), geom.contrast],
    ['282', num(g, 282), geom.fade],
  ] as const)
    if (file !== got) bad(code, file, got);
  const xs = all(g, 11).map(Number);
  const ys = all(g, 21).map(Number);
  const vs = xs.map((x, k) => ({ x, y: ys[k]! }));
  if (vs.length !== geom.clip.length || vs.some((v, k) => !near(v, geom.clip[k]!)))
    bad('11', vs.map(fmt).join(' '), geom.clip.map(fmt).join(' '));
}

/** MLINE (DXF AcDbMline): WCS points; per vertex 11–13, then 74/41 and 75/42 per element. */
function compareMLine(g: readonly Group[], geom: MLineGeometry, bad: Bad): void {
  if (handleIn(g, 340) !== geom.style) bad('340', handleIn(g, 340), geom.style);
  if (!close(num(g, 40, 1), geom.scale)) bad('40', num(g, 40, 1), geom.scale);
  if (num(g, 70) !== geom.justification) bad('70', num(g, 70), geom.justification);
  if (num(g, 71) !== geom.flags) bad('71', num(g, 71), geom.flags);
  const p2 = (grp: readonly Group[], code: number): Vec2 => ({
    x: num(grp, code),
    y: num(grp, code + 10),
  });
  if (!near(p2(g, 10), geom.start)) bad('10', fmt(p2(g, 10)), fmt(geom.start));
  const starts = g.flatMap(([c], k) => (c === 11 ? [k] : []));
  if (starts.length !== geom.vertices.length || num(g, 72) !== starts.length)
    return bad('72', `${num(g, 72)} / ${starts.length}`, geom.vertices.length);
  const elements = num(g, 73);
  starts.forEach((s, k) => {
    const v = g.slice(s, starts[k + 1] ?? g.length);
    const got = geom.vertices[k]!;
    for (const [code, want] of [
      [11, got.position],
      [12, got.direction],
      [13, got.miter],
    ] as const)
      if (!near(p2(v, code), want)) bad(String(code), `${k} ${fmt(p2(v, code))}`, fmt(want));
    // Element runs: 74 n, n × 41, 75 m, m × 42.
    const runs: { parameters: number[]; fillParameters: number[] }[] = [];
    let i = v.findIndex(([c]) => c === 74);
    while (i >= 0 && i < v.length && v[i]![0] === 74) {
      const n = Number(v[i]![1]);
      const parameters = v.slice(i + 1, i + 1 + n).map(([, x]) => Number(x));
      i += 1 + n;
      const m = v[i]?.[0] === 75 ? Number(v[i]![1]) : 0;
      const fillParameters = v.slice(i + 1, i + 1 + m).map(([, x]) => Number(x));
      i += 1 + m;
      runs.push({ parameters, fillParameters });
    }
    if (runs.length !== elements) bad('73', `${k} ${elements}`, runs.length);
    if (JSON.stringify(runs) !== JSON.stringify(got.elements))
      bad('41', `${k} ${JSON.stringify(runs)}`, JSON.stringify(got.elements));
  });
}

/**
 * VIEWPORT (DXF AcDbViewport). R12 files state only the frame (10, 40, 41, 68, 69) as groups
 * and the view in the ACAD `MVIEW` xdata (DXF R12 reference, VIEWPORT): version, target,
 * direction, twist, view height, view center, lens length, front and back clip, view mode, ….
 */
/**
 * REGION: the SAT text in groups 1 (a line) and 3 (its continuation), which R2000–R2004 files
 * also encipher (each character but space becomes 159 − code). R2013+ files keep SAB in the
 * ACDSDATA section instead; those are compared through the DWG test below. The check is
 * independent of the mapper's ACIS reader: every `point` record, moved by the body transform,
 * must be an endpoint of a mapped edge and every edge endpoint a point; there is one mapped edge
 * per `edge` record and one LINE per `straight-curve`.
 */
function compareRegion(g: readonly Group[], geom: RegionGeometry, bad: Bad): void {
  const lines: string[] = [];
  for (const [c, v] of g)
    if (c === 1) lines.push(v);
    else if (c === 3 && lines.length > 0) lines[lines.length - 1] += v;
  if (lines.length === 0) return; // SAB in ACDSDATA
  const plain = /^\d/.test(lines[0]!.trim());
  const text = lines
    .map((l) =>
      plain
        ? l
        : [...l]
            .map((ch) => (ch === ' ' ? ' ' : String.fromCharCode(159 - ch.charCodeAt(0))))
            .join(''),
    )
    .join('\n');
  const recs = text
    .split('\n')
    .slice(3)
    .join(' ')
    .split('#')
    .map((r) => r.trim().split(/\s+/))
    .filter((t) => t[0] !== '' && t[0] !== undefined);
  const nums = (t: string[]) => t.filter((x) => /^-?\d/.test(x) && !x.includes('$')).map(Number);
  const xf = recs.find((t) => t[0] === 'transform');
  // Transform numbers after the header: 9 matrix entries, translation, scale (identity matrix in the corpus).
  const xn = xf ? nums(xf).slice(-13) : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  const points = recs
    .filter((t) => t[0] === 'point')
    .map((t) => {
      const [x, y] = nums(t).slice(-3);
      return { x: x! * xn[12]! + xn[9]!, y: y! * xn[12]! + xn[10]! };
    });
  const ends: Vec2[] = geom.loops.flatMap((l) =>
    l.edges.flatMap((e): Vec2[] => {
      if (e.kind === 'LINE') return [e.start, e.end];
      if (e.kind === 'ARC')
        return [e.startAngle, e.endAngle].map((a) => ARC_POINT(e.center, e.radius, a));
      return [];
    }),
  );
  const fmtAll = (ps: Vec2[]) => ps.map(fmt).sort().join(' ');
  if (
    !points.every((p) => ends.some((q) => near(p, q))) ||
    !ends.every((q) => points.some((p) => near(p, q)))
  )
    bad('point', fmtAll(points), fmtAll(ends));
  const edges = geom.loops.reduce((n, l) => n + l.edges.length, 0);
  const count = (type: string) => recs.filter((t) => t[0] === type).length;
  if (count('edge') !== edges) bad('edge', count('edge'), edges);
  const linesMapped = geom.loops.reduce(
    (n, l) => n + l.edges.filter((e) => e.kind === 'LINE').length,
    0,
  );
  if (count('straight-curve') !== linesMapped)
    bad('straight-curve', count('straight-curve'), linesMapped);
}

function compareViewport(all: readonly Group[], geom: ViewportGeometry, bad: Bad): void {
  const r12 = !all.some(([c, v]) => c === 100 && v.trim() === 'AcDbViewport');
  const g = r12 ? all.filter(([c]) => c < 1000) : subclass(all, 'AcDbViewport');
  const p2 = (code: number): Vec2 => ({ x: num(g, code), y: num(g, code + 10) });
  if (!near(p2(10), geom.center)) bad('10', fmt(p2(10)), fmt(geom.center));
  for (const [code, want, got] of [
    ['40', num(g, 40), geom.width],
    ['41', num(g, 41), geom.height],
  ] as const)
    if (!close(want, got)) bad(code, want, got);
  if (num(g, 68) !== geom.status) bad('68', num(g, 68), geom.status);
  if (num(g, 69) !== geom.id) bad('69', num(g, 69), geom.id);
  const v3 = (p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`;
  const same3 = (a: V3, b: V3) => close(a.x, b.x) && close(a.y, b.y) && close(a.z, b.z);
  let view: {
    target: V3;
    direction: V3;
    twist: number;
    height: number;
    center: Vec2;
    lens: number;
    front: number;
    back: number;
  };
  if (r12) {
    const x = all.filter(([c]) => c >= 1000);
    const reals = x.filter(([c]) => c === 1040).map(([, v]) => Number(v));
    const pts = x.flatMap(([c], k) =>
      c === 1010 ? [{ x: Number(x[k]![1]), y: Number(x[k + 1]![1]), z: Number(x[k + 2]![1]) }] : [],
    );
    if (pts.length < 2 || reals.length < 7) return bad('MVIEW', 'short xdata', '');
    view = {
      target: pts[0]!,
      direction: pts[1]!,
      twist: reals[0]!,
      height: reals[1]!,
      center: { x: reals[2]!, y: reals[3]! },
      lens: reals[4]!,
      front: reals[5]!,
      back: reals[6]!,
    };
  } else {
    view = {
      target: pt(g, 17),
      direction: { x: num(g, 16), y: num(g, 26), z: num(g, 36, 1) },
      twist: deg(g, 51),
      height: num(g, 45),
      center: p2(12),
      lens: num(g, 42, 50),
      front: num(g, 43),
      back: num(g, 44),
    };
    if (num(g, 90) !== geom.flags) bad('90', num(g, 90), geom.flags);
    if (handleIn(g, 340) !== geom.clipBoundary) bad('340', handleIn(g, 340), geom.clipBoundary);
    // Some writers put the viewport's visual style (348) in the AcDbEntity group; there is
    // only ever one, so take it from wherever it is.
    const style = handleIn(g, 348) ?? handleIn(subclass(all, 'AcDbEntity'), 348);
    if (style !== geom.visualStyle) bad('348', style, geom.visualStyle);
    // Frozen layers are 331, one per layer (DXF reference, VIEWPORT).
    const frozen = g
      .filter(([c]) => c === 331)
      .map(([, h]) =>
        h
          .trim()
          .replace(/^0+(?=.)/, '')
          .toUpperCase(),
      );
    if (frozen.join(' ') !== geom.frozenLayers.join(' '))
      bad('331', frozen.join(' '), geom.frozenLayers.join(' '));
    if ((first(g, 1) ?? '').trim() !== geom.plotStyleSheet)
      bad('1', first(g, 1), geom.plotStyleSheet);
    if (num(g, 281) !== geom.renderMode) bad('281', num(g, 281), geom.renderMode);
  }
  const s = r12 ? 'MVIEW ' : '';
  if (!same3(view.target, geom.viewTarget)) bad(`${s}17`, v3(view.target), v3(geom.viewTarget));
  if (!same3(view.direction, geom.viewDirection))
    bad(`${s}16`, v3(view.direction), v3(geom.viewDirection));
  if (!sameAngle(view.twist, geom.twist)) bad(`${s}51`, view.twist, geom.twist);
  if (!close(view.height, geom.viewHeight)) bad(`${s}45`, view.height, geom.viewHeight);
  if (!near(view.center, geom.viewCenter)) bad(`${s}12`, fmt(view.center), fmt(geom.viewCenter));
  if (!close(view.lens, geom.lensLength)) bad(`${s}42`, view.lens, geom.lensLength);
  if (!close(view.front, geom.frontClip)) bad(`${s}43`, view.front, geom.frontClip);
  if (!close(view.back, geom.backClip)) bad(`${s}44`, view.back, geom.backClip);
}

/** A HATCH boundary as the file states it, read group by group (DXF reference, HATCH). */
interface FileEdge {
  readonly type: number;
  readonly g: Group[];
}
interface FileLoop {
  readonly flags: number;
  readonly edges: FileEdge[];
  readonly poly?: { closed: boolean; pts: { x: number; y: number; bulge: number }[] };
  readonly sources: string[];
}

function readHatchLoops(g: readonly Group[]): { loops: FileLoop[]; after: number } {
  let i = g.findIndex(([c]) => c === 91);
  const loops: FileLoop[] = [];
  if (i < 0) return { loops, after: 0 };
  const count = Number(g[i]![1]);
  i++;
  const code = (): number | undefined => g[i]?.[0];
  const take = (): string => g[i++]![1];
  for (let k = 0; k < count && code() === 92; k++) {
    const flags = Number(take());
    const edges: FileEdge[] = [];
    let poly: FileLoop['poly'];
    if (flags & 2) {
      const hasBulge = code() === 72 ? Number(take()) !== 0 : false;
      const closed = code() === 73 ? Number(take()) !== 0 : false;
      const n = Number(take()); // 93
      const pts = [];
      for (let v = 0; v < n; v++) {
        const x = Number(take());
        const y = Number(take());
        const bulge = hasBulge && code() === 42 ? Number(take()) : 0;
        pts.push({ x, y, bulge });
      }
      poly = { closed, pts };
    } else {
      const n = Number(take()); // 93
      for (let e = 0; e < n; e++) {
        const type = Number(take()); // 72
        const eg: Group[] = [];
        const fixed: Record<number, number[]> = {
          1: [10, 20, 11, 21],
          2: [10, 20, 40, 50, 51, 73],
          3: [10, 20, 11, 21, 40, 50, 51, 73],
        };
        if (type !== 4) {
          for (const c of fixed[type] ?? []) if (code() === c) eg.push(g[i++]!);
        } else {
          for (const c of [94, 73, 74, 95, 96]) if (code() === c) eg.push(g[i++]!);
          while (code() === 40 || code() === 10 || code() === 20 || code() === 42) eg.push(g[i++]!);
          // R2010+ adds the fit data, led by its own 97 (DXF reference, spline edge data); the
          // loop's source count is also 97, but only after its last edge.
          const next = g[i + 1]?.[0];
          if (code() === 97 && (e < n - 1 || next === 11 || next === 12 || next === 97)) {
            eg.push(g[i++]!);
            while ([11, 21, 12, 22, 13, 23].includes(code() ?? -1)) eg.push(g[i++]!);
          }
        }
        edges.push({ type, g: eg });
      }
    }
    const sources: string[] = [];
    if (code() === 97) {
      const ns = Number(take());
      for (let q = 0; q < ns && code() === 330; q++)
        sources.push(
          take()
            .trim()
            .replace(/^0+(?=.)/, '')
            .toUpperCase(),
        );
    }
    loops.push({ flags, edges, ...(poly ? { poly } : {}), sources });
  }
  return { loops, after: i };
}

/** Points along an arc or ellipse edge; AutoCAD stores a clockwise edge's angles negated. */
function edgePoints(
  e:
    | { type: 'arc'; center: Vec2; radius: number; s: number; e: number; ccw: boolean }
    | {
        type: 'ellipse';
        center: Vec2;
        major: Vec2;
        ratio: number;
        s: number;
        e: number;
        ccw: boolean;
      },
): Vec2[] {
  const dir = e.ccw ? 1 : -1;
  const s = dir * e.s;
  let en = dir * e.e;
  while (dir * (en - s) <= 1e-12) en += dir * 2 * Math.PI;
  return [0, 0.5, 1].map((t) => {
    const a = s + (en - s) * t;
    if (e.type === 'arc')
      return { x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a) };
    const M = e.major;
    return {
      x: e.center.x + Math.cos(a) * M.x - Math.sin(a) * e.ratio * M.y,
      y: e.center.y + Math.cos(a) * M.y + Math.sin(a) * e.ratio * M.x,
    };
  });
}

function compareHatch(g: readonly Group[], n: V3, geom: HatchGeometry, bad: Bad): void {
  if (geom.pattern !== (first(g, 2) ?? '').trim()) bad('2', first(g, 2), geom.pattern);
  if (geom.solid !== (num(g, 70) !== 0)) bad('70', num(g, 70), geom.solid);
  if (geom.associative !== (num(g, 71) !== 0)) bad('71', num(g, 71), geom.associative);
  const { loops, after } = readHatchLoops(g);
  if (loops.length !== geom.loops.length) return bad('91', loops.length, geom.loops.length);
  const vplan = (v: Vec2): Vec2 => plan(v, n);
  loops.forEach((f, k) => {
    const got = geom.loops[k]!;
    if (got.flags !== f.flags) bad('92', f.flags, got.flags);
    if ((got.sources ?? []).join(',') !== f.sources.join(','))
      bad('330', f.sources.join(','), (got.sources ?? []).join(','));
    if (f.poly) {
      if (!got.polyline) return bad('92', f.flags, 'no polyline');
      if (got.polyline.closed !== f.poly.closed) bad('73', f.poly.closed, got.polyline.closed);
      checkVertices(
        f.poly.pts,
        f.poly.pts.map((p) => p.bulge),
        num(g, 30),
        n,
        got.polyline.vertices,
        f.poly.closed,
        bad,
      );
      return;
    }
    const edges = got.edges ?? [];
    if (edges.length !== f.edges.length) return bad('93', f.edges.length, edges.length);
    f.edges.forEach((fe, j) => {
      const e = edges[j]!;
      const c = (code: number) => num(fe.g, code);
      const at = (code: number): Vec2 => ({ x: c(code), y: c(code + 10) });
      const check = (code: string, want: readonly Vec2[], have: readonly Vec2[]): void => {
        if (want.length !== have.length || want.some((w, q) => !near(w, have[q]!)))
          bad(code, want.map(fmt).join(' '), have.map(fmt).join(' '));
      };
      const deg2 = (code: number) => (c(code) * Math.PI) / 180;
      switch (fe.type) {
        case 1:
          if (e.type !== 'line') return bad('72', fe.type, e.type);
          return check('10', [vplan(at(10)), vplan(at(11))], [e.start, e.end]);
        case 2: {
          if (e.type !== 'arc') return bad('72', fe.type, e.type);
          const want = edgePoints({
            type: 'arc',
            center: at(10),
            radius: c(40),
            s: deg2(50),
            e: deg2(51),
            ccw: c(73) !== 0,
          }).map(vplan);
          const have = edgePoints({ ...e, s: e.startAngle, e: e.endAngle });
          return check('50', want, have);
        }
        case 3: {
          if (e.type !== 'ellipse') return bad('72', fe.type, e.type);
          // The file's major axis turns with the plane; its points are compared in plan.
          const want = edgePoints({
            type: 'ellipse',
            center: at(10),
            major: at(11),
            ratio: c(40),
            s: deg2(50),
            e: deg2(51),
            ccw: c(73) !== 0,
          }).map(vplan);
          const have = edgePoints({
            type: 'ellipse',
            center: e.center,
            major: e.majorAxis,
            ratio: e.ratio,
            s: e.startAngle,
            e: e.endAngle,
            ccw: e.ccw,
          });
          return check('11', want, have);
        }
        case 4: {
          if (e.type !== 'spline') return bad('72', fe.type, e.type);
          const xs = all(fe.g, 10).map(Number);
          const ys = all(fe.g, 20).map(Number);
          check(
            '10',
            xs.map((x, q) => vplan({ x, y: ys[q]! })),
            e.controlPoints,
          );
          const knots = all(fe.g, 40).map(Number);
          if (knots.join(',') !== e.knots.join(',')) bad('40', knots.join(','), e.knots.join(','));
          if (e.degree !== c(94)) bad('94', c(94), e.degree);
          return;
        }
      }
    });
  });
  const rest = g.slice(after);
  if (geom.style !== num(rest, 75)) bad('75', num(rest, 75), geom.style);
  if (geom.patternType !== num(rest, 76)) bad('76', num(rest, 76), geom.patternType);
  if (!geom.solid) {
    const ang = n.z < 0 ? Math.PI - deg(rest, 52) : deg(rest, 52);
    if (!sameAngle(geom.patternAngle, ang)) bad('52', num(rest, 52), geom.patternAngle);
    if (!close(geom.patternScale, num(rest, 41, 1))) bad('41', num(rest, 41, 1), geom.patternScale);
    if (geom.double !== (num(rest, 77) !== 0)) bad('77', num(rest, 77), geom.double);
    const lines = all(rest, 53);
    if (lines.length !== geom.patternLines.length)
      bad('78', lines.length, geom.patternLines.length);
    else {
      const a = lines.map((v) => (Number(v) * Math.PI) / 180);
      a.forEach((v, q) => {
        const want = n.z < 0 ? Math.PI - v : v;
        if (!sameAngle(geom.patternLines[q]!.angle, want))
          bad('53', v, geom.patternLines[q]!.angle);
      });
    }
  }
  const seeds = num(rest, 98);
  if (seeds !== geom.seedPoints.length) bad('98', seeds, geom.seedPoints.length);
  const grad = num(rest, 450) !== 0;
  if (grad !== !!geom.gradient) bad('450', num(rest, 450), !!geom.gradient);
  if (grad && geom.gradient) {
    if (geom.gradient.name !== (first(rest, 470) ?? '').trim())
      bad('470', first(rest, 470), geom.gradient.name);
    if (geom.gradient.colors.length !== all(rest, 463).length)
      bad('463', all(rest, 463).length, geom.gradient.colors.length);
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
  const readable = readableFiles(manifest);

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
    const repairs = Object.keys(MALFORMED_REPAIRS);
    const isRepair = (m: Mismatch) => repairs.some((path) => repaired(path, m));
    expect(
      mismatches.filter((m) => !(m.kind in ACAD_TS_GAPS) && !isRepair(m)).map((m) => m.text),
    ).toEqual([]);
    expect([...new Set(mismatches.filter((m) => !isRepair(m)).map((m) => m.kind))].sort()).toEqual(
      Object.keys(ACAD_TS_GAPS).sort(),
    );
    for (const [path, kinds] of Object.entries(MALFORMED_REPAIRS))
      expect(
        Object.keys(kinds).filter((k) => !mismatches.some((m) => m.kind === k && repaired(path, m))),
        `${path}: repairs that no longer happen`,
      ).toEqual([]);
  }, 300_000);

  // The oracle reads DXF only. DWG states table merges as ranges, not per cell, and a block
  // cell as a block content; from R2010 it also keeps cell formats as cell, row and column
  // cell styles and content formats (M1-36). The mapped cells must still come out the same,
  // numbers to the 12 significant digits ASCII DXF keeps of them.
  it('maps the tables of a DWG like those of the same drawing saved as DXF', () => {
    const digits = (v: unknown): unknown =>
      typeof v === 'number'
        ? Number(v.toPrecision(12))
        : Array.isArray(v)
          ? v.map(digits)
          : v && typeof v === 'object'
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, digits(x)]))
            : v;
    const tables = (path: string) => {
      const doc = readCadDocument(load(path));
      // Names are case-insensitive; R14 keeps them in capitals.
      const name = new Map(
        [...(doc.blockRecords ?? [])].map((b) => [hex(b.handle), b.name.toUpperCase()]),
      );
      return mapEntities(doc)
        .entities.filter((e) => e.geom.kind === 'ACAD_TABLE')
        .map((e) => {
          const g = e.geom as TableGeometry;
          return {
            handle: e.handle,
            rows: g.rowHeights.length,
            columns: g.columnWidths.length,
            overrides: digits(g.overrides),
            cells: digits(
              g.cells.map((r) => r.map((c) => ({ ...c, block: c.block && name.get(c.block) }))),
            ),
          };
        });
    };
    // R14 and R2000 DWGs keep an ACAD_TABLE as a custom class object in the R2004 layout
    // (M1-79); R14 has no DXF save of its own, so it is compared with the R2000 one.
    const pairs = ['AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032'].map((v) => [
      `public/third-party/acadsharp/sample_${v}.dwg`,
      `public/third-party/acadsharp/sample_${v}_ascii.dxf`,
    ]);
    pairs.push([
      'public/third-party/acadsharp/sample_AC1014.dwg',
      'public/third-party/acadsharp/sample_AC1015_ascii.dxf',
    ]);
    for (const [dwg, dxf] of pairs) {
      const a = tables(dwg!);
      expect(a.length).toBeGreaterThan(0);
      // Table 528 overrides its margins and row text heights (M1-77).
      expect(a.find((x) => x.handle === '528')?.overrides, dwg).toBeDefined();
      expect(a, dwg).toEqual(tables(dxf!));
    }
  });

  // The oracle reads SAT text only (R12 has no ACIS data). R2013+ files and DWGs keep the region as SAB binary; each
  // sample saves the same drawing, so its region must map like the R2000 SAT one, to 1e-9.
  it('maps the SAB regions of DWG and R2013+ files like the SAT region of the same drawing', () => {
    const rounded = (v: unknown): unknown =>
      typeof v === 'number'
        ? Math.round(v * 1e9) / 1e9 + 0
        : Array.isArray(v)
          ? v.map(rounded)
          : v && typeof v === 'object'
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rounded(x)]))
            : v;
    const regions = (path: string) =>
      mapEntities(readCadDocument(load(path)))
        .entities.filter((e) => e.geom.kind === 'REGION')
        .map((e) => rounded({ handle: e.handle, geom: e.geom }));
    const want = regions('public/third-party/acadsharp/sample_AC1015_ascii.dxf');
    expect(want).toHaveLength(1);
    const files = readable
      .map((f) => f.path)
      .filter((p) =>
        /acadsharp\/sample_AC10(1[4-9]|[23]\d)(_ascii\.dxf|_binary\.dxf|\.dwg)$/.test(p),
      );
    const sab = files.filter((p) => /AC10(2[7-9]|3\d)|\.dwg$/.test(p));
    expect(sab.length).toBeGreaterThan(4);
    for (const p of files) expect(regions(p), p).toEqual(want);
  });

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
