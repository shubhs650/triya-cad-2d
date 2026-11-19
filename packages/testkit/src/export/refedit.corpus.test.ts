// A block reference edited in place saves as DXF and reads back (M5-02 part 3). On every readable
// public corpus file with a model-space reference REFEDIT can edit, -REFEDIT carries its block's
// objects out where the reference draws them, ERASE takes one, LINE draws a new one and REFCLOSE
// Save carries the working set back: the objects not edited come back exactly as the file had
// them, under their own handles. The drawing saves as AC1032 DXF (DEC-047), audited by ezdxf as
// kind `refedit`, and reopens with the block as edited and every reference to it still drawing
// it. REFCLOSE Discard leaves the block exactly as the file had it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  modelSpaceOf,
  referencePlacement,
  wholeWorkingSet,
  type Entity,
  type Group,
  type Handle,
  type InsertGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

const open = (bytes: Uint8Array) =>
  withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));

interface Target {
  /** The reference edited. */
  readonly reference: Entity;
  readonly block: Handle;
  /**
   * An object of the block on an unlocked layer that no group holds and nothing else follows (no
   * reactors: an associative dimension or hatch would change with it), which ERASE takes.
   */
  readonly erased: Handle;
}

/** The first model-space reference REFEDIT edits whose block holds an object ERASE can take. */
function referenceToEdit(model: DocumentModel): Target | undefined {
  const locked = new Set(
    [...model.tables.layers.values()].filter((l) => l.locked).map((l) => l.handle),
  );
  const grouped = new Set(
    [...model.objects.values()].flatMap((o) => (o.type === 'GROUP' ? (o as Group).entities : [])),
  );
  for (const id of model.blockEntities(modelSpaceOf(model))) {
    const e = model.entity(id)!;
    if (e.geom.kind !== 'INSERT' || locked.has(e.layer)) continue;
    const g = e.geom;
    if (model.blocks.get(g.block)?.dynamic) continue;
    if (typeof referencePlacement(model, g) === 'string') continue;
    const erased = wholeWorkingSet(model, g.block, false)
      .map((i) => model.entity(i)!)
      .find((c) => !locked.has(c.layer) && !grouped.has(c.handle) && !c.reactors?.length);
    if (erased) return { reference: e, block: g.block, erased: erased.handle };
  }
  return undefined;
}

/** Drawings with no reference the test can edit. */
const NO_REFERENCE = 89;

const bus = (model: DocumentModel) =>
  new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: () => Promise.resolve({ ok: false, message: 'no view' }) },
  });

/** -REFEDIT on the target's reference, all its objects (attribute definitions not shown). */
async function refedit(b: PromptBus, t: Target): Promise<void> {
  await b.submit('-REFEDIT');
  await b.answer({ kind: 'selection', ids: [t.reference.id] });
  await b.script(['', '']);
}

describe('REFEDIT on the public corpus (M5-02 part 3)', () => {
  let edited = 0;
  const skipped: string[] = [];

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves a block reference edited in place',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = open(bytes);
      const target = referenceToEdit(model);
      if (!target) {
        skipped.push(f.path);
        writeAuditSave(f.path, 'refedit', () =>
          withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), open(bytes))),
        );
        return;
      }
      const before = new Map(
        model.blockEntities(target.block).map((id) => [id, model.entity(id)!] as const),
      );
      const refs = [...model.entities()]
        .filter((e) => e.geom.kind === 'INSERT' && e.geom.block === target.block)
        .map((e) => e.handle);
      const b = bus(model);
      await refedit(b, target);
      expect(b.promptText, f.path).toBe('Command:');
      await b.submit('ERASE');
      await b.answer({ kind: 'selection', ids: [model.ids.idOf(target.erased)!] });
      await b.script(['LINE', '0,0', '1,1', '', 'REFCLOSE', 'S']);
      expect(b.promptText, f.path).toBe('Command:');
      const after = model.blockEntities(target.block).map((id) => model.entity(id)!);
      const kept = after.filter((e) => before.has(e.id));
      // Every object not edited, exactly as the file had it.
      for (const e of kept) expect(e, f.path).toEqual(before.get(e.id));
      expect(
        kept.map((e) => e.handle),
        f.path,
      ).not.toContain(target.erased);
      expect(kept, f.path).toHaveLength(before.size - 1);
      expect(after.at(-1)?.geom.kind, f.path).toBe('LINE');

      const save = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      writeAuditSave(f.path, 'refedit', () => save);
      const back = open(save);
      expect(
        back.blockEntities(target.block).map((id) => back.entity(id)!.handle),
        f.path,
      ).toEqual(after.map((e) => e.handle));
      for (const h of refs) {
        const ref = back.entityByHandle(h);
        expect((ref?.geom as InsertGeometry | undefined)?.block, f.path).toBe(target.block);
      }
      edited++;
    },
  );

  it('edited a reference on every readable file that has one', () => {
    expect(edited + skipped.length).toBe(readable.length);
    expect(skipped).toHaveLength(NO_REFERENCE);
  });
});

describe('REFCLOSE Discard on the public corpus (M5-02 part 3)', () => {
  it.each(readable.slice(0, 12).map((f) => [f.path, f] as const))(
    '%s keeps the block as the file had it',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = open(bytes);
      const target = referenceToEdit(model);
      if (!target) return;
      const before = model.blockEntities(target.block).map((id) => model.entity(id)!);
      const b = bus(model);
      await refedit(b, target);
      await b.submit('ERASE');
      await b.answer({ kind: 'selection', ids: [model.ids.idOf(target.erased)!] });
      await b.script(['LINE', '0,0', '1,1', '', 'REFCLOSE', 'D']);
      expect(b.promptText, f.path).toBe('Command:');
      const after = model.blockEntities(target.block).map((id) => model.entity(id)!);
      expect(after, f.path).toEqual(before);
    },
  );
});
