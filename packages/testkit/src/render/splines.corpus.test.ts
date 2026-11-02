// M1-47 on the public corpus: every SPLINE stored only as fit points (the acadsharp R2013+
// samples hold one, the same spline in three files) draws through its fit points and is
// bounded by what it draws; and every spline AutoCAD saved with both its fit points and the
// control points it computed (uncommon.dxf) gets those control points back from `fitSpline`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  fitSpline,
  splineCurve,
  splineDomain,
  splinePoint,
  validateSpline,
  type SplineGeometry,
} from '@triya/engine';
import { readCadDocument } from '@triya/io';
import { defaultPaint, tessellate } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { corpusDrawing } from './document.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const files = manifest.files.filter((f) => f.path.startsWith('public/'));

/** The points of a packed M / L path. */
function points(path: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < path.length; i += 3) out.push([path[i + 1]!, path[i + 2]!]);
  return out;
}

const isNurbs = (g: SplineGeometry): boolean => {
  try {
    validateSpline(g);
    return true;
  } catch {
    return false;
  }
};

let fitOnly = 0;
let oracles = 0;
// Ratchets: what the public corpus holds today.
const FIT_ONLY = 3;
const ORACLES = 1;

describe('fit-point splines on the public corpus', () => {
  it.each(files.map((f) => [f.path]))('%s', (path) => {
    let doc;
    try {
      doc = readCadDocument(new Uint8Array(readFileSync(corpusDir + path)));
    } catch {
      return; // unreadable files are the read-error baseline's business
    }
    const { model, index } = corpusDrawing(doc);
    const bad: string[] = [];
    for (const e of model.entities()) {
      if (e.geom.kind !== 'SPLINE' || !e.geom.fitPoints) continue;
      const g = e.geom;
      const fit = g.fitPoints!;
      const key = `${e.handle} SPLINE`;
      const size = Math.max(
        ...fit.map((p) => Math.hypot(p.x - fit[0]!.x, p.y - fit[0]!.y)),
        Number.MIN_VALUE,
      );
      if (isNurbs(g)) {
        // AutoCAD's own control points next to its fit points: ours must agree. A spline with
        // a fit tolerance is approximated, not interpolated, and would differ (M1-65).
        oracles++;
        const ours = fitSpline({
          fitPoints: fit,
          startTangent: g.startTangent,
          endTangent: g.endTangent,
          closed: g.closed,
          parameterization: g.knotParameterization,
        });
        const far =
          !ours ||
          ours.controlPoints.length !== g.controlPoints.length ||
          ours.controlPoints.some(
            (p, i) =>
              Math.hypot(p.x - g.controlPoints[i]!.x, p.y - g.controlPoints[i]!.y) > 1e-9 * size,
          );
        if (far) bad.push(`${key}: control points differ from AutoCAD's`);
        continue;
      }
      fitOnly++;
      const curve = splineCurve(g);
      if (!curve) {
        bad.push(`${key}: no curve`);
        continue;
      }
      // Through every fit point, at the knots.
      const { start, end } = splineDomain(curve);
      const at = [...new Set(curve.knots)].filter((u) => u >= start && u <= end);
      const missed = fit.some((p, i) => {
        const q = splinePoint(curve, at[i]!);
        return Math.hypot(p.x - q.x, p.y - q.y) > 1e-9 * size;
      });
      if (at.length !== fit.length || missed) bad.push(`${key}: misses a fit point`);
      // Drawn from the first fit point to the last.
      const paint = defaultPaint(e, model) ?? { color: 'foreground' };
      const stroke = tessellate(g, paint).find((p) => p.kind === 'stroke');
      if (!stroke || !('path' in stroke)) {
        bad.push(`${key}: not drawn`);
        continue;
      }
      const drawn = points(stroke.path);
      const [a, b] = [drawn[0]!, drawn[drawn.length - 1]!];
      const first = fit[0]!;
      const last = fit[fit.length - 1]!;
      if (Math.hypot(a[0] - first.x, a[1] - first.y) > 1e-9 * size) bad.push(`${key}: starts off`);
      if (Math.hypot(b[0] - last.x, b[1] - last.y) > 1e-9 * size) bad.push(`${key}: ends off`);
      // Bounded by the index, around everything it draws.
      const bounds = index.bounds(model.ids.idOf(e.handle)!);
      if (bounds?.kind !== 'box') {
        bad.push(`${key}: bounds ${bounds?.kind}`);
        continue;
      }
      const tol = 1e-6 * size;
      const outside = drawn.some(
        ([x, y]) =>
          x < bounds.box.minX - tol ||
          x > bounds.box.maxX + tol ||
          y < bounds.box.minY - tol ||
          y > bounds.box.maxY + tol,
      );
      if (outside) bad.push(`${key}: draws outside its bounds`);
    }
    expect(bad).toEqual([]);
  });

  it('covers every fit-point spline the corpus holds', () => {
    expect({ fitOnly, oracles }).toEqual({ fitOnly: FIT_ONLY, oracles: ORACLES });
  });
});
