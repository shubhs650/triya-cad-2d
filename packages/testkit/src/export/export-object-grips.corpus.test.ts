// Grips on multilines, multileaders and non-associative hatches (M3-05 part 6) on every readable
// public corpus file: every one a drafter can select has a grip of each new kind dragged (a
// multiline's middle vertex, a multileader's arrowhead and its landing, a hatch's first
// boundary vertex), and every multileader with a dogleg has its landing lengthened. The drawing
// saves as AC1032 DXF (DEC-047) and reopens with each object as the grip left it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  gripFunctionEdit,
  gripFunctionsOf,
  gripObjects,
  gripsOf,
  toleranceForSize,
  type EntityId,
  type GripKind,
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

/** The handles an unedited AC1032 save already does not map back (DEC-047 item 4). */
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

/** The grip of each kind a drag tries on an object. */
const KINDS: readonly GripKind[] = ['mlineVertex', 'leaderVertex', 'landing', 'boundary'];

describe('multiline, multileader and hatch boundary grips on the public corpus', () => {
  let dragged = 0;
  let lengthened = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves its multilines, multileaders and hatches as their grips leave them',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      withPinnedClock(() => {
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const spaces = new Set(model.layouts.map((l) => l.blockRecord));
        const ids = [...model.entities()]
          .filter((e) => spaces.has(e.owner))
          .filter((e) => model.tables.layers.get(e.layer)?.locked !== true)
          .filter((e) => ['MLINE', 'MULTILEADER', 'HATCH'].includes(e.geom.kind))
          .map((e) => e.id);
        const edited: EntityId[] = [];
        for (const id of ids) {
          for (const kind of KINDS) {
            const geom = model.entity(id)!.geom;
            const grips = gripsOf(geom).filter((g) => g.kind === kind);
            // A multiline's middle vertex turns two segments.
            const grip = grips[Math.floor(grips.length / 2)];
            if (!grip) continue;
            const b = new ChangeSetBuilder(model);
            const size = Math.max(1, Math.abs(grip.point.x), Math.abs(grip.point.y));
            const to = { x: grip.point.x + size * 1e-3, y: grip.point.y + size * 5e-4 };
            const r = gripObjects(b, model, [id], grip.point, to);
            if (r.ids.length === 0) continue;
            model.apply(b.build());
            dragged++;
            if (!edited.includes(id)) edited.push(id);
          }
          // Lengthen Landing at the landing's far end.
          const geom = model.entity(id)!.geom;
          const end = gripsOf(geom).find((g) =>
            gripFunctionsOf(geom, g.point).includes('Lengthen Landing'),
          );
          if (end) {
            const at: Vec2 = end.point;
            const tol = toleranceForSize(Math.max(1, Math.abs(at.x), Math.abs(at.y)));
            const branch = geom.kind === 'MULTILEADER' ? geom.branches[0] : undefined;
            const dir = branch?.direction ?? { x: 1, y: 0 };
            const len = Math.hypot(dir.x, dir.y) || 1;
            const step = Math.max(1, branch?.doglegLength ?? 1) / 2;
            const to = { x: at.x + (dir.x / len) * step, y: at.y + (dir.y / len) * step };
            const out = gripFunctionEdit(geom, at, 'Lengthen Landing', to, tol);
            if (typeof out !== 'string') {
              const b = new ChangeSetBuilder(model);
              b.updateEntity(id, { geom: out });
              model.apply(b.build());
              lengthened++;
            }
          }
        }
        if (edited.length === 0) return;
        const saved = saveAc1032Dxf(readCadDocument(bytes), model);
        const back = DocumentModel.create(documentInit(readCadDocument(saved)));
        let lossy: ReadonlySet<string> | undefined;
        const wrong = edited
          .map((id) => model.entity(id)!)
          .filter((e) => {
            const r = back.entityByHandle(e.handle);
            if (r && near(r.geom, e.geom)) return false;
            return !(lossy ??= conversionLosses(bytes)).has(e.handle);
          })
          .map((e) => `${e.type} ${e.handle}`);
        expect(wrong.slice(0, 10), f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('dragged grips', () => {
    // 720 and 288 when written.
    expect(dragged).toBeGreaterThan(500);
    expect(lengthened).toBeGreaterThan(200);
  });
});
