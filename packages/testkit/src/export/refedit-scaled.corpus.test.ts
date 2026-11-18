// A block reference scaled differently in X and Y edited in place (M5-02 part 8). On every
// readable public corpus file with a model-space reference REFEDIT can edit, that reference is
// scaled by 2 in Y alone, then -REFEDIT carries its block's objects out by the scale (a circle or
// an arc as an ellipse standing in for it) and:
//
// - REFCLOSE Discard, after a line is drawn, leaves the block exactly as the file had it;
// - REFCLOSE Save, after a line and a circle are drawn, puts every object not edited back exactly
//   as the file had it, under its own handle (each circle and arc a circle or arc again), and
//   adds the line and the circle, which the inverse scale makes an ellipse. The drawing saves as
//   AC1032 DXF (DEC-047) and reopens with the block as saved.
//
// One of those saves, of a drawing whose block has circles, is audited by ezdxf as kind
// `refedit-scaled` (scripts/dxf-audit/audit.py FIXTURE_SAVES).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  builtinCommands,
  modelSpaceOf,
  referencePlacement,
  wholeWorkingSet,
  type Entity,
  type InsertGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect } from 'vitest';
import { eachCorpusFile } from '../corpus/each-file.ts';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/** The drawing whose save the ezdxf audit checks: its block's circles come back as circles. */
const AUDITED = 'third-party/ezdxf/examples_dxf/colors.dxf';

const open = (bytes: Uint8Array) =>
  withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));

/** The first model-space reference on an unlocked layer REFEDIT edits whose block holds objects. */
function referenceToEdit(model: DocumentModel): Entity | undefined {
  const locked = new Set(
    [...model.tables.layers.values()].filter((l) => l.locked).map((l) => l.handle),
  );
  for (const id of model.blockEntities(modelSpaceOf(model))) {
    const e = model.entity(id)!;
    if (e.geom.kind !== 'INSERT' || locked.has(e.layer)) continue;
    const g = e.geom;
    if (model.blocks.get(g.block)?.dynamic) continue;
    if (typeof referencePlacement(model, g) === 'string') continue;
    if (wholeWorkingSet(model, g.block, false).length > 0) return e;
  }
  return undefined;
}

/** The reference scaled by 2 in Y alone. */
function stretch(model: DocumentModel, reference: Entity): void {
  const b = new ChangeSetBuilder(model);
  const g = reference.geom as InsertGeometry;
  b.updateEntity(reference.id, { geom: { ...g, scale: { ...g.scale, y: g.scale.y * 2 } } });
  model.apply(b.build());
}

const bus = (model: DocumentModel) => {
  const log: string[] = [];
  const b = new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: () => Promise.resolve({ ok: false, message: 'no view' }) },
  });
  b.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  return { b, log };
};

/** -REFEDIT on `reference`, all its objects (attribute definitions not shown). */
async function refedit(b: PromptBus, reference: Entity): Promise<void> {
  await b.submit('-REFEDIT');
  await b.answer({ kind: 'selection', ids: [reference.id] });
  await b.script(['', '']);
}

/** Readable drawings with no reference the test can edit (as refedit.corpus.test.ts's). */
const NO_REFERENCE = 87;
/** Drawings whose edited block has circles or arcs, which ellipses stand in for. */
const WITH_STAND_INS = 27;

describe('REFEDIT of a reference scaled differently in X and Y on the public corpus (M5-02 part 8)', () => {
  let edited = 0;
  let withStandIns = 0;
  const skipped: string[] = [];

  eachCorpusFile(
    readable,
    async (f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = open(bytes);
      const reference = referenceToEdit(model);
      if (!reference) {
        skipped.push(f.path);
        return;
      }
      stretch(model, reference);
      const block = (reference.geom as InsertGeometry).block;
      const before = model.blockEntities(block).map((id) => model.entity(id)!);
      const { b, log } = bus(model);

      // Discard: the block exactly as the file had it.
      await refedit(b, model.entity(reference.id)!);
      expect(b.promptText, f.path).toBe('Command:');
      if (log.some((l) => / edited as (an )?ellipses? /.test(l))) withStandIns++;
      await b.script(['LINE', '0,0', '1,1', '', 'REFCLOSE', 'D']);
      expect(
        model.blockEntities(block).map((id) => model.entity(id)!),
        f.path,
      ).toEqual(before);

      // Save: what was not edited exactly as it was, the line and the circle drawn added.
      await refedit(b, model.entity(reference.id)!);
      await b.script(['LINE', '0,0', '1,1', '', 'CIRCLE', '0,0', '1', 'REFCLOSE', 'S']);
      expect(b.promptText, f.path).toBe('Command:');
      expect(
        log.filter((l) => /could not be carried back/.test(l)),
        f.path,
      ).toEqual([]);
      const was = new Map(before.map((e) => [e.id, e]));
      const after = model.blockEntities(block).map((id) => model.entity(id)!);
      const kept = after.filter((e) => was.has(e.id));
      for (const e of kept) expect(e, f.path).toEqual(was.get(e.id));
      expect(kept, f.path).toHaveLength(before.length);
      expect(
        after
          .filter((e) => !was.has(e.id))
          .map((e) => e.geom.kind)
          .sort(),
        f.path,
      ).toEqual(['ELLIPSE', 'LINE']);

      const save = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      if (f.path.endsWith(AUDITED)) writeAuditSave(AUDITED, 'refedit-scaled', () => save);
      const back = open(save);
      expect(
        back.blockEntities(block).map((id) => back.entity(id)!.handle),
        f.path,
      ).toEqual(after.map((e) => e.handle));
      const ref = back.entityByHandle(reference.handle)?.geom as InsertGeometry | undefined;
      expect(ref?.scale.y, f.path).toBeCloseTo((reference.geom as InsertGeometry).scale.y * 2, 12);
      edited++;
    },
    () => {
      expect(edited + skipped.length).toBe(readable.length);
      expect(skipped).toHaveLength(NO_REFERENCE);
      expect(withStandIns).toBe(WITH_STAND_INS);
    },
  );
});
