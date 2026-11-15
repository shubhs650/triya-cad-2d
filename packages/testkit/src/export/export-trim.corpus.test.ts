// TRIM (M3-02 part 2) on every readable public corpus file: every line, arc, circle, ellipse,
// ray, xline, polyline (LWPOLYLINE and 2D POLYLINE) and spline a drafter can select in model
// space has its middle third trimmed away, as TRIM makes the pieces (`trimGeometry`) and puts
// them in the drawing (`reshapeObject`: the first piece keeps the object's handle when it keeps
// its kind, a circle becomes a new arc, a hatch or dimension associated with it lets go). The
// drawing saves as AC1032 DXF (DEC-047) and reopens with each piece where TRIM put it: a
// polyline with fewer vertices and its widths, a spline as the NURBS of its part with no fit
// points, an xline as two rays.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  domain,
  reshapeObject,
  toleranceForSize,
  toleranceFromExtents,
  trimCurveOf,
  trimGeometry,
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

describe('TRIM on the public corpus', () => {
  let trimmed = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves its curves with their middles trimmed',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      withPinnedClock(() => {
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const space = model.layouts.find((l) => l.name === 'Model')?.blockRecord;
        if (space === undefined || !model.hasBlock(space)) return;
        const sources = model
          .blockEntities(space)
          .map((id) => model.entity(id)!)
          .filter((e) => model.tables.layers.get(e.layer)?.locked !== true);
        const min = model.header.get('$EXTMIN');
        const max = model.header.get('$EXTMAX');
        const drawingTol =
          isPoint(min) && isPoint(max) ? toleranceFromExtents(min, max) : toleranceForSize(1);
        const b = new ChangeSetBuilder(model);
        const made: EntityId[] = [];
        for (const e of sources) {
          const c = trimCurveOf(e.geom);
          if (!c) continue;
          const d = domain(c);
          // The thirds of a bounded curve; 5 units either side of an xline's base, 5 to 10 along a ray.
          const [t0, t1] =
            c.kind === 'XLINE'
              ? [-5, 5]
              : c.kind === 'RAY'
                ? [5, 10]
                : [d.start + (d.end - d.start) / 3, d.start + (2 * (d.end - d.start)) / 3];
          const tol = drawingTol;
          const geoms = trimGeometry(e.geom, c, [t0, t1], (t0 + t1) / 2, tol);
          if (!geoms || geoms.length === 0) continue;
          made.push(...reshapeObject(b, model, e.id, geoms));
        }
        if (made.length === 0) return;
        const cs = b.build();
        model.apply(cs);
        trimmed += made.length;
        const saved = saveAc1032Dxf(readCadDocument(bytes), model);
        const back = DocumentModel.create(documentInit(readCadDocument(saved)));
        for (const id of made) {
          const e = model.entity(id)!;
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

  it('trimmed objects', () => {
    // Most corpus files hold lines, arcs, circles and polylines; the count guards the sweep.
    expect(trimmed).toBeGreaterThan(1000);
  });
});
