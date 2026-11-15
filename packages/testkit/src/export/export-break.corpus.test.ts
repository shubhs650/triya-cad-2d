// BREAK, LENGTHEN, REVERSE, EXPLODE and JOIN (M3-02 part 4) on every readable public corpus
// file. On one copy of the drawing every line, arc, circle, ellipse, ray, xline, polyline and
// spline a drafter can select in model space is, in turn, broken (its middle third erased, as
// BREAK leaves it), lengthened by a tenth at its end (shortened by a tenth when it cannot grow:
// a spline) or reversed. On a second copy every polyline, block reference and dimension is
// exploded and then everything in model space is joined at once. Both save as AC1032 DXF
// (DEC-047) and reopen with each object where the command put it; what an explode copied out of
// a block (any kind) reopens under its handle.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  breakCurveOf,
  breakGeometry,
  curveLength,
  domain,
  eraseObjects,
  explodeObjects,
  isClosedCurve,
  joinObjects,
  lengthenGeometry,
  reshapeObject,
  reverseGeometry,
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

/** The objects of `ids` that do not reopen as they were saved (geometry), or at all. */
function wrongAfterSave(
  bytes: Uint8Array,
  model: DocumentModel,
  checked: readonly EntityId[],
  present: readonly EntityId[],
): string[] {
  const saved = saveAc1032Dxf(readCadDocument(bytes), model);
  const back = DocumentModel.create(documentInit(readCadDocument(saved)));
  const out: string[] = [];
  for (const id of checked) {
    const e = model.entity(id);
    if (!e) continue;
    const r = back.entityByHandle(e.handle);
    if (!r || r.type !== e.type) out.push(`${e.type} ${e.handle} missing`);
    else if (!near(r.geom, e.geom)) out.push(`${e.type} ${e.handle} ${JSON.stringify(r.geom)}`);
  }
  for (const id of present) {
    const e = model.entity(id);
    if (e && !back.entityByHandle(e.handle)) out.push(`${e.type} ${e.handle} missing`);
  }
  return out;
}

describe('BREAK, LENGTHEN, REVERSE, EXPLODE and JOIN on the public corpus', () => {
  let reshaped = 0;
  let exploded = 0;
  let joined = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves its curves broken, lengthened, reversed, exploded and joined',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      withPinnedClock(() => {
        const first = open(bytes);
        if (!first) return;
        const { model, ids, tol } = first;
        const b = new ChangeSetBuilder(model);
        const made: EntityId[] = [];
        ids.forEach((id, i) => {
          const e = model.entity(id)!;
          const c = breakCurveOf(e.geom);
          if (!c) return;
          const d = domain(c);
          if (i % 3 === 0) {
            const [t0, t1] =
              c.kind === 'XLINE'
                ? [-5, 5]
                : c.kind === 'RAY'
                  ? [5, 10]
                  : [d.start + (d.end - d.start) / 3, d.start + (2 * (d.end - d.start)) / 3];
            const r = breakGeometry(e.geom, c, t0, t1, tol);
            if (typeof r !== 'string') made.push(...reshapeObject(b, model, id, r));
          } else if (i % 3 === 1) {
            if (c.kind === 'RAY' || c.kind === 'XLINE' || isClosedCurve(c, tol)) return;
            const l = curveLength(c);
            const grown = lengthenGeometry(e.geom, c, true, l * 1.1, tol);
            const r = grown === 'spline' ? lengthenGeometry(e.geom, c, true, l * 0.9, tol) : grown;
            if (typeof r !== 'string') made.push(...reshapeObject(b, model, id, [r]));
          } else {
            const r = reverseGeometry(e.geom);
            if (r) {
              b.updateEntity(id, { geom: r });
              made.push(id);
            }
          }
        });
        if (made.length > 0) {
          model.apply(b.build());
          reshaped += made.length;
          expect(wrongAfterSave(bytes, model, made, []).slice(0, 10), f.path).toEqual([]);
        }

        const second = open(bytes)!;
        const m2 = second.model;
        const b2 = new ChangeSetBuilder(m2);
        const r = explodeObjects(b2, m2, second.ids);
        m2.apply(b2.build());
        exploded += r.exploded;
        const space = m2.layouts.find((l) => l.name === 'Model')!.blockRecord;
        const all = m2
          .blockEntities(space)
          .filter((id) => m2.tables.layers.get(m2.entity(id)!.layer)?.locked !== true);
        const j = joinObjects(
          all.map((id) => ({ id, geom: m2.entity(id)!.geom })),
          undefined,
          second.tol,
        );
        const b3 = new ChangeSetBuilder(m2);
        const kept: EntityId[] = [];
        for (const one of j.joined) {
          kept.push(...reshapeObject(b3, m2, one.keep, [one.geom]));
          eraseObjects(
            b3,
            m2,
            one.parts.filter((p) => p !== one.keep),
          );
        }
        m2.apply(b3.build());
        joined += j.joined.length;
        const pieces = r.made.filter((id) => {
          const e: Entity | undefined = m2.entity(id);
          return e !== undefined && (e.geom.kind === 'LINE' || e.geom.kind === 'ARC');
        });
        const rest = r.made.filter((id) => !pieces.includes(id));
        if (kept.length + r.made.length > 0) {
          expect(
            wrongAfterSave(bytes, m2, [...kept, ...pieces], rest).slice(0, 10),
            f.path,
          ).toEqual([]);
        }
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('changed objects', () => {
    // Most corpus files hold lines, arcs, circles, polylines and blocks; the counts guard the sweep.
    expect(reshaped).toBeGreaterThan(1000);
    expect(exploded).toBeGreaterThan(100);
    expect(joined).toBeGreaterThan(50);
  });
});
