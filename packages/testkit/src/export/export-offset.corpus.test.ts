// OFFSET (M3-02 part 1) on every readable public corpus file: every line, arc, circle, ellipse,
// ray, xline, polyline (LWPOLYLINE and 2D POLYLINE) and spline a drafter can select in model
// space is offset to both sides by a fiftieth of its size, as OFFSET makes the offsets
// (`offsetGeometry`, with the source's properties), and the drawing saves as AC1032 DXF
// (DEC-047) and reopens with each offset where OFFSET put it: polylines with their widths, an
// ellipse's or spline's offset a SPLINE with its knots and control points.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  boxOf,
  flatten,
  offsetCurveOf,
  offsetGeometry,
  toleranceFromExtents,
  toleranceForSize,
  type Entity,
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

describe('OFFSET on the public corpus', () => {
  let offsets = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves the offsets of its curves',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      withPinnedClock(() => {
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const space = model.layouts.find((l) => l.name === 'Model')?.blockRecord;
        if (space === undefined || !model.hasBlock(space)) return;
        const min = model.header.get('$EXTMIN');
        const max = model.header.get('$EXTMAX');
        const sources = model
          .blockEntities(space)
          .map((id) => model.entity(id)!)
          .filter((e) => model.tables.layers.get(e.layer)?.locked !== true);
        const b = new ChangeSetBuilder(model);
        const made: Entity[] = [];
        for (const e of sources) {
          const c = offsetCurveOf(e.geom);
          if (!c) continue;
          const box =
            c.kind === 'XLINE' || c.kind === 'RAY' ? undefined : boxOf(flatten(c, Infinity).points);
          const size = box ? Math.max(box.maxX - box.minX, box.maxY - box.minY) : 50;
          if (!(size > 0)) continue;
          const reach = box
            ? Math.max(
                Math.abs(box.minX),
                Math.abs(box.minY),
                Math.abs(box.maxX),
                Math.abs(box.maxY),
              )
            : 0;
          const tol =
            isPoint(min) && isPoint(max)
              ? (() => {
                  const t = toleranceFromExtents(min, max);
                  const u = toleranceForSize(reach);
                  return t.linear >= u.linear ? t : u;
                })()
              : toleranceForSize(reach);
          for (const d of [size / 50, -size / 50]) {
            for (const geom of offsetGeometry(e.geom, d, tol)) {
              made.push(
                b.addEntity({
                  owner: space,
                  layer: e.layer,
                  color: e.color,
                  linetype: e.linetype,
                  lineweight: e.lineweight,
                  transparency: e.transparency,
                  ltScale: e.ltScale,
                  visible: e.visible,
                  geom,
                }),
              );
            }
          }
        }
        if (made.length === 0) return;
        model.apply(b.build());
        offsets += made.length;
        const saved = saveAc1032Dxf(readCadDocument(bytes), model);
        const back = DocumentModel.create(documentInit(readCadDocument(saved)));
        for (const e of made) {
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

  it('offset objects', () => {
    // Most corpus files hold lines, arcs, circles and polylines; the counts guard the sweep.
    expect(offsets).toBeGreaterThan(1000);
  });
});
