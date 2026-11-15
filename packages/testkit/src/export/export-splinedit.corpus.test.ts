// SPLINEDIT and OVERKILL (M3-02 part 6) on every readable public corpus file. On one copy of
// the drawing every spline a drafter can select in model space is, in turn, given a moved fit
// point (or control vertex), a control vertex added, its order raised, closed or opened, or a
// kink (or a weight); on a second copy every line, arc, circle and lightweight polyline is
// drawn twice and OVERKILL, with AutoCAD's default settings, takes every copy out again. Both
// save as AC1032 DXF (DEC-047) and reopen with each object as SPLINEDIT and OVERKILL left it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DEFAULT_OVERKILL,
  DocumentModel,
  addControlVertex,
  closeControlFrame,
  eraseObjects,
  elevateOrder,
  fitEditOf,
  hasFitData,
  moveControlVertex,
  planOverkill,
  reshapeObject,
  splineCurve,
  splineDomain,
  splinePoint,
  toleranceForSize,
  toleranceFromExtents,
  weightControlVertex,
  withFitData,
  type EntityGeometry,
  type EntityId,
  type SplineGeometry,
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
  return { model, ids, tol, space };
}

/**
 * The handles whose geometry an unedited AC1032 save already does not map back (a DWG table's
 * merged cells): what DEC-047 item 4 leaves to the round-trip baselines.
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

/** The objects of `ids` that do not reopen as they were saved, and those `gone` that do. */
function wrongAfterSave(
  bytes: Uint8Array,
  model: DocumentModel,
  ids: readonly EntityId[],
  gone: readonly string[] = [],
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
    }
  }
  for (const h of gone) if (back.entityByHandle(h)) out.push(`${h} came back`);
  return out;
}

const plainEnough = (g: EntityGeometry): boolean => {
  const n = (g as { normal?: { x: number; y: number; z: number } }).normal;
  return !n || (n.x === 0 && n.y === 0 && n.z > 0);
};

/** SPLINEDIT's edit number `i` (of five) on `g`. */
function splineEdit(g: SplineGeometry, i: number, tol: ReturnType<typeof toleranceForSize>) {
  const c = splineCurve(g);
  if (!c) return undefined;
  const { start, end } = splineDomain(c);
  const mid = splinePoint(c, (start + end) / 2);
  const fit = hasFitData(g) ? fitEditOf(g, tol) : undefined;
  const nudge = (p: Vec2): Vec2 => ({ x: p.x + 0.5, y: p.y + 0.25 });
  switch (i % 5) {
    case 0:
      return fit
        ? withFitData(g, { ...fit, points: fit.points.map((p, k) => (k === 0 ? nudge(p) : p)) })
        : moveControlVertex(g, 0, nudge(g.controlPoints[0]!));
    case 1:
      return addControlVertex(g, mid, tol);
    case 2:
      return g.degree < 6 ? elevateOrder(g, g.degree + 2) : undefined;
    case 3:
      return fit ? withFitData(g, { ...fit, closed: !g.closed }) : closeControlFrame(g, !g.closed);
    default:
      return fit && fit.points.length > 2
        ? withFitData(g, { ...fit, kinks: fit.kinks.map((k, j) => k || j === 1) })
        : weightControlVertex(g, 0, 2);
  }
}

const DOUBLED = new Set(['LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE']);

describe('SPLINEDIT and OVERKILL on the public corpus', () => {
  let edited = 0;
  let removed = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves its splines edited and its doubled objects overkilled',
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
          if (g.kind !== 'SPLINE' || !plainEnough(g)) return;
          const out = splineEdit(g, i, tol);
          if (out) made.push(...reshapeObject(b, model, id, [out]));
        });
        if (made.length > 0) {
          model.apply(b.build());
          edited += made.length;
          expect(wrongAfterSave(bytes, model, made).slice(0, 10), f.path).toEqual([]);
        }

        const second = open(bytes)!;
        const m2 = second.model;
        // Duplicates OVERKILL already finds in the drawing are its business, not this test's.
        const before = planOverkill(m2, second.ids, DEFAULT_OVERKILL);
        const own = new Set([...before.erase, ...before.reshape.keys()]);
        const doubled = second.ids.filter((id) => {
          const e = m2.entity(id)!;
          // Associative ones (hatch boundaries) are left alone, so their copies would stay.
          return (
            DOUBLED.has(e.geom.kind) &&
            plainEnough(e.geom) &&
            !own.has(id) &&
            (e.reactors?.length ?? 0) === 0
          );
        });
        if (doubled.length === 0) return;
        const b2 = new ChangeSetBuilder(m2);
        const copies = doubled.map((id) => {
          const e = m2.entity(id)!;
          return b2.addEntity({
            owner: e.owner,
            layer: e.layer,
            color: e.color,
            linetype: e.linetype,
            lineweight: e.lineweight,
            transparency: e.transparency,
            ltScale: e.ltScale,
            visible: e.visible,
            ...(e.plotStyle !== undefined && { plotStyle: e.plotStyle }),
            ...(e.material !== undefined && { material: e.material }),
            geom: e.geom,
          });
        });
        m2.apply(b2.build());
        const all = [...second.ids, ...copies.map((c) => c.id)];
        const plan = planOverkill(m2, all, DEFAULT_OVERKILL);
        const erased = new Set(plan.erase);
        const kept = copies.filter((c) => !erased.has(c.id)).map((c) => c.handle);
        expect(kept.slice(0, 10), f.path).toEqual([]);
        const b3 = new ChangeSetBuilder(m2);
        for (const [id, g] of plan.reshape) reshapeObject(b3, m2, id, [g]);
        eraseObjects(b3, m2, plan.erase);
        m2.apply(b3.build());
        removed += copies.length;
        expect(
          wrongAfterSave(
            bytes,
            m2,
            doubled,
            copies.map((c) => c.handle),
          ).slice(0, 10),
          f.path,
        ).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('changed objects', () => {
    expect(edited).toBeGreaterThan(20);
    expect(removed).toBeGreaterThan(1000);
  });
});
