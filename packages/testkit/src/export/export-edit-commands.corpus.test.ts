// The core edit commands on every readable public corpus file (M2-06): a save never fails after
// a markup session. Every object a drafter can select (model space and each layout's paper
// space, not on a locked layer) is first turned, scaled and moved, then mirrored, as ROTATE,
// SCALE, MOVE and MIRROR leave it; on a second copy of the drawing every object is copied and
// every other original erased, as COPY and ERASE leave them. Both edits save as AC1032 DXF
// (DEC-047) and reopen with the edited objects where the edit put them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  copyObjects,
  DocumentModel,
  eraseObjects,
  mirrorIn,
  moveBy,
  scaleAbout,
  transformObjects,
  turnAbout,
  type Entity,
  type EntityId,
  type Similarity,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));
/** Each file opens three times and saves and reopens twice; the largest take a few seconds. */
const PER_FILE_BUDGET_MS = 30_000;

/** What a drafter can select: the objects of model space and the layouts, off locked layers. */
function selectable(model: DocumentModel): EntityId[] {
  const spaces = new Set(model.layouts.map((l) => l.blockRecord));
  return [...model.entities()]
    .filter((e) => spaces.has(e.owner))
    .filter((e) => model.tables.layers.get(e.layer)?.locked !== true)
    .map((e) => e.id);
}

function apply(model: DocumentModel, edit: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  edit(b);
  model.apply(b.build());
}

/** Equal up to float noise relative to the numbers' size; angles compared mod 2π. */
function near(a: unknown, b: unknown, key = ''): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b))) return true;
    if (/angle|rotation|param|twist|direction/i.test(key)) {
      const d = Math.abs(a - b) % (2 * Math.PI);
      return Math.min(d, 2 * Math.PI - d) <= 1e-8;
    }
    return false;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return Object.is(a, b);
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], k),
  );
}

/** The first path at which `a` and `b` differ beyond `near`, for the failure message. */
function firstDifference(a: unknown, b: unknown, path = ''): string | undefined {
  if (near(a, b, path.split('.').at(-1))) return undefined;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDifference(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
      path ? `${path}.${k}` : k,
    );
    if (d) return d;
  }
  return path;
}

/** The geometry fields Triya maps back from a save (`raw` and handles aside). */
const shape = (e: Entity | undefined) => e && { type: e.type, owner: e.owner, geom: e.geom };

/**
 * The objects an unedited AC1032 save already does not map back (a DWG table's merged cells, a
 * DWG spline's knot parameterization): what DEC-047 item 4 leaves to the round-trip baselines.
 * The edit's own check skips them. Computed only when asked.
 */
function conversionLosses(bytes: Uint8Array): () => ReadonlySet<string> {
  let losses: Set<string> | undefined;
  return () => {
    if (losses) return losses;
    const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
    const back = new Map(
      documentInit(readCadDocument(saveAc1032Dxf(readCadDocument(bytes), model))).entities?.map(
        (e) => [e.handle, e],
      ),
    );
    losses = new Set(
      [...model.entities()]
        .filter((e) => !near(shape(back.get(e.handle) as Entity | undefined), shape(e)))
        .map((e) => e.handle),
    );
    return losses;
  };
}

describe('the core edit commands on the public corpus', () => {
  let edited = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves after ROTATE, SCALE, MOVE, MIRROR, COPY and ERASE',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      withPinnedClock(() => {
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const ids = selectable(model);
        if (ids.length === 0) return;
        edited++;
        const base = { x: 3, y: -2 };
        const turned: Similarity[] = [
          turnAbout(base, 0.5),
          scaleAbout(base, 1.5),
          moveBy({ x: 7, y: 11 }),
          mirrorIn(base, { x: 4, y: 0 }),
        ];
        const refusedMoves: string[] = [];
        for (const t of turned) {
          apply(model, (b) => {
            const r = transformObjects(b, model, ids, t);
            refusedMoves.push(...r.refused.keys());
          });
        }
        const saved = saveAc1032Dxf(readCadDocument(bytes), model);
        const back = new Map(
          documentInit(readCadDocument(saved)).entities?.map((e) => [e.handle, e]),
        );
        const lossy = conversionLosses(bytes);
        const wrong = ids
          .map((id) => model.entity(id)!)
          .filter((e) => !lossy().has(e.handle))
          .map(
            (e) =>
              [
                e,
                firstDifference(shape(back.get(e.handle) as Entity | undefined), shape(e)),
              ] as const,
          )
          .filter(([, d]) => d !== undefined)
          .map(([e, d]) => `${e.type} ${e.handle} ${d}`);
        expect(wrong.slice(0, 10), f.path).toEqual([]);

        const copied = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const originals = selectable(copied);
        let copies: readonly EntityId[] = [];
        apply(copied, (b) => {
          copies = copyObjects(b, copied, originals, moveBy({ x: 5, y: 5 })).ids;
        });
        apply(copied, (b) => {
          eraseObjects(
            b,
            copied,
            originals.filter((_id, i) => i % 2 === 0),
          );
        });
        const savedCopies = saveAc1032Dxf(readCadDocument(bytes), copied);
        const reopened = new Map(
          documentInit(readCadDocument(savedCopies)).entities?.map((e) => [e.handle, e]),
        );
        const lost = copies
          .map((id) => copied.entity(id)!)
          .filter((e) => !reopened.has(e.handle))
          .map((e) => `${e.type} ${e.handle}`);
        expect(lost.slice(0, 10), f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('edited files', () => {
    expect(edited).toBeGreaterThanOrEqual(90);
  });
});
