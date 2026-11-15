// TRIM's edges of objects that are not curves (M3-12 part 4) on every readable public corpus
// file: each block reference, dimension, table, leader, multileader, region, hatch and floating
// viewport of every layout gets a line drawn square across the first of its edge curves
// (`objectEdgeCurves`, which carries a block's objects by every reference's transform) at its
// middle, and the line's far half is trimmed away with that object as the only edge, as TRIM
// makes the piece (`trimGeometry`). The line must keep at least its near half, so the object
// cuts it where its own edge runs; the drawing saves as AC1032 DXF (DEC-047) and reopens with
// each trimmed line where TRIM put it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  boxOf,
  cutParams,
  domain,
  flatten,
  objectEdgeCurves,
  pointAt,
  toleranceForSize,
  toleranceFromExtents,
  trimCurveOf,
  trimGeometry,
  type Curve,
  type EntityGeometry,
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

const KINDS = new Set([
  'INSERT',
  'DIMENSION',
  'ARC_DIMENSION',
  'LARGE_RADIAL_DIMENSION',
  'ACAD_TABLE',
  'LEADER',
  'MULTILEADER',
  'REGION',
  'HATCH',
  'VIEWPORT',
]);

const isPoint = (v: unknown): v is Vec2 =>
  typeof v === 'object' && v !== null && 'x' in v && 'y' in v;

const near = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));

/** A line square across `c` at its middle, `h` either side; undefined where `c` has no length. */
function across(c: Curve, minimum: number): { start: Vec2; end: Vec2; h: number } | undefined {
  if (c.kind === 'XLINE' || c.kind === 'RAY') return undefined;
  const d = domain(c);
  const box = boxOf(flatten(c, Infinity).points);
  const h = Math.max(box.maxX - box.minX, box.maxY - box.minY) / 4;
  if (!(h > minimum)) return undefined;
  const t = (d.start + d.end) / 2;
  const k = (d.end - d.start) * 1e-4;
  const a = pointAt(c, t - k);
  const b = pointAt(c, t + k);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(len > 0)) return undefined;
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const p = pointAt(c, t);
  return {
    start: { x: p.x - n.x * h, y: p.y - n.y * h },
    end: { x: p.x + n.x * h, y: p.y + n.y * h },
    h,
  };
}

describe('TRIM with objects that are not curves as edges, on the public corpus', () => {
  let trimmed = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s trims a line across each object to the object',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      withPinnedClock(() => {
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const min = model.header.get('$EXTMIN');
        const max = model.header.get('$EXTMAX');
        const tol =
          isPoint(min) && isPoint(max) ? toleranceFromExtents(min, max) : toleranceForSize(1);
        const b = new ChangeSetBuilder(model);
        const made: EntityId[] = [];
        for (const layout of model.layouts) {
          if (!model.hasBlock(layout.blockRecord)) continue;
          for (const id of model.blockEntities(layout.blockRecord)) {
            const e = model.entity(id)!;
            if (!KINDS.has(e.geom.kind)) continue;
            const edges = objectEdgeCurves({ model, tol }, e, { extend: false, hatches: true });
            const first = edges.find((c) => across(c, tol.linear * 1e3));
            if (!first) continue;
            const x = across(first, tol.linear * 1e3)!;
            const g: EntityGeometry = { kind: 'LINE', start: x.start, end: x.end };
            const c = trimCurveOf(g)!;
            const d = domain(c);
            // Picked near its far end: the far side of the nearest cut goes.
            const pick = d.start + (d.end - d.start) * 0.999;
            const pieces = trimGeometry(g, c, cutParams(c, edges, tol), pick, tol);
            expect(pieces, `${e.type} ${e.handle}`).toBeDefined();
            const kept = pieces![0]! as Extract<EntityGeometry, { kind: 'LINE' }>;
            const length = Math.hypot(kept.end.x - kept.start.x, kept.end.y - kept.start.y);
            expect(length, `${e.type} ${e.handle}`).toBeGreaterThanOrEqual(x.h - tol.linear * 10);
            made.push(b.addEntity({ owner: e.owner, layer: e.layer, geom: kept }).id);
          }
        }
        if (made.length === 0) return;
        model.apply(b.build());
        trimmed += made.length;
        const saved = saveAc1032Dxf(readCadDocument(bytes), model);
        const back = DocumentModel.create(documentInit(readCadDocument(saved)));
        for (const id of made) {
          const e = model.entity(id)!;
          const r = back.entityByHandle(e.handle);
          expect(r, `${e.type} ${e.handle}`).toBeDefined();
          const g = e.geom as Extract<EntityGeometry, { kind: 'LINE' }>;
          const rg = r!.geom as Extract<EntityGeometry, { kind: 'LINE' }>;
          expect(
            [rg.start.x, rg.start.y, rg.end.x, rg.end.y].every((v, i) =>
              near(v, [g.start.x, g.start.y, g.end.x, g.end.y][i]!),
            ),
            `${e.handle}`,
          ).toBe(true);
        }
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('trimmed lines', () => {
    // The corpus holds over a thousand block references, dimensions and hatches; the count guards
    // the sweep.
    expect(trimmed).toBeGreaterThan(1000);
  });
});
