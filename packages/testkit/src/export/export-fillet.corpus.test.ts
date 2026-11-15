// FILLET and CHAMFER (M3-02 part 3) on every readable public corpus file: lines in model space
// that share an end at a corner are filleted (one pair in two) or chamfered (the other) there,
// and every 2D polyline has its corners filleted with the Polyline option, as the commands
// make them (`filletCorner`/`chamferCorner` + `cornerEdit`, `polylineCorners`) and put them in
// the drawing (`reshapeObject`, a new arc or line on the objects' layer). The drawing saves as
// AC1032 DXF (DEC-047) and reopens with each object where FILLET or CHAMFER left it. M3-12 part 5
// adds every ellipse, elliptical arc and open spline filleted to a line drawn across it, and
// every open polyline of four or more segments closed by filleting its first and last segments.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  chamferCorner,
  cornerEdit,
  curveBounds,
  derivativeAt,
  domain,
  filletCorner,
  legOf,
  offsetCurveOf,
  pointAt,
  samePolylineCorner,
  polylineCorners,
  reshapeObject,
  toleranceForSize,
  toleranceFromExtents,
  type Entity,
  type EntityId,
  type Vec2,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);
const PER_FILE_BUDGET_MS = 30_000;
/** Corners per file: enough to cover each drawing's kinds without a long run. */
const MAX_CORNERS = 150;

/** Equal up to float noise relative to the numbers' size. */
function near(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return Object.is(a, b);
  }
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

const isPoint = (v: unknown): v is Vec2 =>
  typeof v === 'object' && v !== null && 'x' in v && 'y' in v;
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const len = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);

describe('FILLET and CHAMFER on the public corpus', () => {
  let corners = 0;
  let polylines = 0;
  let curves = 0;
  let closed = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves its corners filleted and chamfered',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      withPinnedClock(() => {
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const space = model.layouts.find((l) => l.name === 'Model')?.blockRecord;
        if (space === undefined || !model.hasBlock(space)) return;
        const min = model.header.get('$EXTMIN');
        const max = model.header.get('$EXTMAX');
        const tol =
          isPoint(min) && isPoint(max) ? toleranceFromExtents(min, max) : toleranceForSize(1);
        const usable = model
          .blockEntities(space)
          .map((id) => model.entity(id)!)
          .filter((e) => model.tables.layers.get(e.layer)?.locked !== true);
        const b = new ChangeSetBuilder(model);
        const touched = new Set<EntityId>();
        const made: EntityId[] = [];
        // Lines sharing an end: one corner each, its lines used once.
        const lines = usable.filter(
          (e): e is Entity & { geom: { kind: 'LINE'; start: Vec2; end: Vec2 } } =>
            e.geom.kind === 'LINE' && len(e.geom.start, e.geom.end) > tol.linear * 1e6,
        );
        const byEnd = new Map<string, (typeof lines)[number][]>();
        const key = (p: Vec2) => `${p.x},${p.y}`;
        for (const l of lines) {
          for (const p of [l.geom.start, l.geom.end]) {
            byEnd.set(key(p), [...(byEnd.get(key(p)) ?? []), l]);
          }
        }
        let n = 0;
        for (const [, at] of byEnd) {
          if (n >= MAX_CORNERS) break;
          const pair = at.filter((l) => !touched.has(l.id)).slice(0, 2);
          if (pair.length < 2) continue;
          const [la, lb] = pair as [(typeof lines)[number], (typeof lines)[number]];
          const corner =
            key(la.geom.start) === key(lb.geom.start) || key(la.geom.start) === key(lb.geom.end)
              ? la.geom.start
              : la.geom.end;
          const far = (l: typeof la) =>
            key(l.geom.start) === key(corner) ? l.geom.end : l.geom.start;
          // Picks half way along; a radius (distance) a tenth of the shorter line.
          const a = legOf(la.geom, lerp(corner, far(la), 0.5), tol);
          const c = legOf(lb.geom, lerp(corner, far(lb), 0.5), tol);
          if (!a || !c) continue;
          const size = Math.min(len(corner, far(la)), len(corner, far(lb))) / 10;
          const fillet = n % 2 === 0;
          const k = fillet
            ? filletCorner(a, c, size, tol)
            : chamferCorner(a, c, { method: 'distance', d1: size, d2: size }, tol);
          if (typeof k === 'string') continue;
          const edit = cornerEdit(a, c, k, true, tol);
          if (typeof edit === 'string') continue;
          touched.add(la.id).add(lb.id);
          if (edit.first) made.push(...reshapeObject(b, model, la.id, [edit.first]));
          if (edit.second) made.push(...reshapeObject(b, model, lb.id, [edit.second]));
          if (edit.added) {
            made.push(b.addEntity({ owner: space, layer: la.layer, geom: edit.added }).id);
          }
          n++;
        }
        corners += n;
        // Every 2D polyline's corners, at a radius a tenth of its shortest line segment.
        for (const e of usable) {
          if (e.geom.kind !== 'LWPOLYLINE' && !(e.geom.kind === 'POLYLINE' && !e.geom.is3d))
            continue;
          const vs = e.geom.vertices;
          let shortest = Infinity;
          for (let i = 0; i + 1 < vs.length; i++) {
            const d = len(vs[i]!, vs[i + 1]!);
            if (vs[i]!.bulge === 0 && d > tol.linear * 1e6) shortest = Math.min(shortest, d);
          }
          if (!Number.isFinite(shortest)) continue;
          // An open one of four or more segments is closed by its first and last (M3-12 part 5).
          const segments = vs.length - 1;
          if (!e.geom.closed && segments >= 4) {
            const ends = (i: number) => lerp(vs[i]!, vs[i + 1]!, 0.5);
            const a = legOf(e.geom, ends(segments - 1), tol);
            const c = legOf(e.geom, ends(0), tol);
            const k = a && c && filletCorner(a, c, shortest / 10, tol);
            const g = a && c && k && typeof k !== 'string' && samePolylineCorner(a, c, k, tol);
            if (g && typeof g !== 'string') {
              made.push(...reshapeObject(b, model, e.id, [g]));
              closed++;
              continue;
            }
          }
          const r = polylineCorners(e.geom, { fillet: shortest / 10 }, tol);
          if (!r || r.done === 0) continue;
          made.push(...reshapeObject(b, model, e.id, [r.geom]));
          polylines++;
        }
        // Every ellipse and open spline (M3-12 part 5): a line drawn square across it half way,
        // filleted to it at a radius a fiftieth of its size.
        for (const e of usable) {
          if (touched.has(e.id)) continue;
          if (e.geom.kind !== 'ELLIPSE' && e.geom.kind !== 'SPLINE') continue;
          const c = offsetCurveOf(e.geom);
          if (!c) continue;
          const box = curveBounds(c, tol);
          const r = Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 50;
          if (!(r > tol.linear * 1e6)) continue;
          const d = domain(c);
          const mid = (d.start + d.end) / 2;
          const p = pointAt(c, mid);
          const der = derivativeAt(c, mid);
          const speed = Math.hypot(der.x, der.y);
          if (speed === 0) continue;
          const t = { x: der.x / speed, y: der.y / speed };
          const n = { x: -t.y, y: t.x };
          const across = {
            kind: 'LINE' as const,
            start: { x: p.x - n.x * 10 * r, y: p.y - n.y * 10 * r },
            end: { x: p.x + n.x * 10 * r, y: p.y + n.y * 10 * r },
          };
          const a = legOf(e.geom, { x: p.x + t.x * 5 * r, y: p.y + t.y * 5 * r }, tol);
          const l = legOf(across, { x: p.x + n.x * 5 * r, y: p.y + n.y * 5 * r }, tol);
          if (!a || !l) continue;
          const k = filletCorner(a, l, r, tol);
          if (typeof k === 'string') continue;
          const edit = cornerEdit(a, l, k, true, tol);
          if (typeof edit === 'string') continue;
          touched.add(e.id);
          if (edit.first) made.push(...reshapeObject(b, model, e.id, [edit.first]));
          const line = edit.second === undefined ? across : edit.second;
          if (line) made.push(b.addEntity({ owner: space, layer: e.layer, geom: line }).id);
          if (edit.added)
            made.push(b.addEntity({ owner: space, layer: e.layer, geom: edit.added }).id);
          curves++;
        }
        if (made.length === 0) return;
        model.apply(b.build());
        const saved = saveAc1032Dxf(readCadDocument(bytes), model);
        const back = DocumentModel.create(documentInit(readCadDocument(saved)));
        for (const id of made) {
          const e = model.entity(id);
          if (!e) continue;
          const r = back.entityByHandle(e.handle);
          expect(r, `${e.type} ${e.handle}`).toBeDefined();
          expect(r!.type).toBe(e.type);
          if (!near(r!.geom, e.geom)) {
            expect(JSON.stringify(r!.geom), `${e.type} ${e.handle}`).toBe(JSON.stringify(e.geom));
          }
        }
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('filleted and chamfered corners', () => {
    // The corpus has many line corners and polylines; the counts guard the sweep.
    expect(corners).toBeGreaterThan(100);
    expect(polylines).toBeGreaterThan(50);
    expect(curves).toBeGreaterThan(50);
    expect(closed).toBeGreaterThan(40);
  });
});
