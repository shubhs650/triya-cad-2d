// PEDIT and MATCHPROP (M3-02 part 5) on every readable public corpus file. On one copy of the
// drawing every 2D polyline a drafter can select in model space is, in turn, curve-fit,
// spline-fit, spline-fit and decurved, or given one width; every 3D polyline is spline-fit; every
// line, arc and spline is turned into a polyline. On a second copy every object takes the
// properties of the first line, arc or circle (MATCHPROP with every setting on), and every
// layout viewport takes the switches and scale of its layout's first one (Viewport, M3-16). Both
// save as AC1032 DXF (DEC-047) and reopen with each object where PEDIT put it and with the
// properties MATCHPROP gave it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALL_MATCH_SETTINGS,
  ChangeSetBuilder,
  DocumentModel,
  decurvePolyline,
  fitPolyline,
  isPolyline,
  matchedPatch,
  polylineFrom,
  reshapeObject,
  splineFit,
  toleranceForSize,
  toleranceFromExtents,
  widthPolyline,
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

function open(bytes: Uint8Array) {
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  const space = model.layouts.find((l) => l.name === 'Model')?.blockRecord;
  if (space === undefined || !model.hasBlock(space)) return undefined;
  const ids = model
    .blockEntities(space)
    .filter((id) => model.tables.layers.get(model.entity(id)!.layer)?.locked !== true);
  const min = model.header.get('$EXTMIN');
  const max = model.header.get('$EXTMAX');
  const tol = isPoint(min) && isPoint(max) ? toleranceFromExtents(min, max) : toleranceForSize(1);
  return { model, ids, tol };
}

const PROPS = ['layer', 'color', 'linetype', 'ltScale', 'lineweight', 'transparency'] as const;

/**
 * The handles whose geometry an unedited AC1032 save already does not map back (a DWG table's
 * merged cells): what DEC-047 item 4 leaves to the round-trip baselines. Their properties are
 * still checked.
 */
function conversionLosses(bytes: Uint8Array): ReadonlySet<string> {
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  const back = DocumentModel.create(
    documentInit(readCadDocument(saveAc1032Dxf(readCadDocument(bytes), model))),
  );
  return new Set(
    [...model.entities()]
      .filter((e) => !near(back.entityByHandle(e.handle)?.geom, e.geom))
      .map((e) => e.handle),
  );
}

/** The objects of `ids` that do not reopen as they were saved, or at all. */
function wrongAfterSave(
  bytes: Uint8Array,
  model: DocumentModel,
  ids: readonly EntityId[],
): string[] {
  const saved = saveAc1032Dxf(readCadDocument(bytes), model);
  const back = DocumentModel.create(documentInit(readCadDocument(saved)));
  let lossy: ReadonlySet<string> | undefined;
  const lost = (handle: string) => (lossy ??= conversionLosses(bytes)).has(handle);
  const out: string[] = [];
  for (const id of ids) {
    const e = model.entity(id);
    if (!e) continue;
    const r = back.entityByHandle(e.handle);
    if (!r || r.type !== e.type) out.push(`${e.type} ${e.handle} missing`);
    else if (!near(r.geom, e.geom) && !lost(e.handle)) {
      out.push(`${e.type} ${e.handle} ${JSON.stringify(r.geom)}`);
    } else {
      const p = PROPS.find((k) => !near(r[k], e[k]));
      if (p) out.push(`${e.type} ${e.handle} ${p} ${JSON.stringify(r[p])}`);
    }
  }
  return out;
}

const plainEnough = (g: EntityGeometry): boolean => {
  const n = (g as { normal?: { x: number; y: number; z: number } }).normal;
  return !n || (n.x === 0 && n.y === 0 && n.z > 0);
};

/**
 * Each layout's viewports after its first given the first's on/off, lock, snap, grid, UCS icon
 * and scale (MATCHPROP's Viewport, M3-16), saved and reopened: the number changed.
 */
function matchViewports(bytes: Uint8Array, model: DocumentModel): number {
  const b = new ChangeSetBuilder(model);
  const changed: EntityId[] = [];
  const viewportOnly = Object.fromEntries(
    Object.keys(ALL_MATCH_SETTINGS).map((k) => [k, k === 'viewport']),
  ) as unknown as typeof ALL_MATCH_SETTINGS;
  for (const layout of model.layouts) {
    if (!model.hasBlock(layout.blockRecord)) continue;
    const vps = model
      .blockEntities(layout.blockRecord)
      .map((id) => model.entity(id)!)
      .filter((e) => e.geom.kind === 'VIEWPORT' && e.geom.id !== 1);
    const [source, ...rest] = vps;
    for (const t of rest) {
      const patch = matchedPatch(model, source!, t, viewportOnly);
      if (!patch) continue;
      b.updateEntity(t.id, patch);
      changed.push(t.id);
    }
  }
  if (changed.length === 0) return 0;
  model.apply(b.build());
  expect(wrongAfterSave(bytes, model, changed).slice(0, 10), 'viewports').toEqual([]);
  return changed.length;
}

describe('PEDIT and MATCHPROP on the public corpus', () => {
  let edited = 0;
  let matched = 0;
  let matchedViewports = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves its polylines fit, splined, decurved and widened, and matched properties',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      withPinnedClock(() => {
        const first = open(bytes);
        if (!first) return;
        const { model, ids, tol } = first;
        const b = new ChangeSetBuilder(model);
        const made: EntityId[] = [];
        ids.forEach((id, i) => {
          const g = model.entity(id)!.geom;
          if (!plainEnough(g)) return;
          let out: EntityGeometry | undefined;
          if (isPolyline(g)) {
            if (g.vertices.length < 2) return;
            if (g.kind === 'POLYLINE' && g.is3d) out = splineFit(g, 6, 4);
            else if (i % 4 === 0) out = fitPolyline(g, [], tol);
            else if (i % 4 === 1) out = splineFit(g, i % 8 === 1 ? 5 : 6, 4);
            else if (i % 4 === 2) out = decurvePolyline(splineFit(g, 6, 4));
            else out = widthPolyline(g, 0.25);
          } else if (g.kind === 'LINE' || g.kind === 'ARC' || g.kind === 'SPLINE') {
            out = polylineFrom(g, 2);
          }
          if (out) made.push(...reshapeObject(b, model, id, [out]));
        });
        if (made.length > 0) {
          model.apply(b.build());
          edited += made.length;
          expect(wrongAfterSave(bytes, model, made).slice(0, 10), f.path).toEqual([]);
        }

        const second = open(bytes)!;
        const m2 = second.model;
        matchedViewports += matchViewports(bytes, m2);
        const source = second.ids
          .map((id) => m2.entity(id)!)
          .find((e) => e.geom.kind === 'LINE' || e.geom.kind === 'ARC' || e.geom.kind === 'CIRCLE');
        if (!source) return;
        const b2 = new ChangeSetBuilder(m2);
        const changed: EntityId[] = [];
        for (const id of second.ids) {
          if (id === source.id) continue;
          const patch = matchedPatch(m2, source, m2.entity(id)!, ALL_MATCH_SETTINGS);
          if (!patch) continue;
          b2.updateEntity(id, patch);
          changed.push(id);
        }
        m2.apply(b2.build());
        matched += changed.length;
        if (changed.length > 0) {
          expect(wrongAfterSave(bytes, m2, changed).slice(0, 10), f.path).toEqual([]);
        }
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('changed objects', () => {
    expect(edited).toBeGreaterThan(1000);
    expect(matched).toBeGreaterThan(1000);
    expect(matchedViewports).toBeGreaterThan(10);
  });
});
