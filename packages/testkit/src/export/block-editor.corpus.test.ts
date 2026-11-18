// A block edited in the Block Editor saves as DXF and reads back (M5-02 part 1). On every
// readable public corpus file with a block the editor opens, -BEDIT opens it, ERASE takes one of
// its objects and LINE draws a new one in it, BSAVE keeps them and BCLOSE closes the editor; the
// drawing saves as AC1032 DXF (DEC-047), audited by ezdxf as kind `bedit`, and reopens with the
// block as edited and every reference to it still drawing it. Edits BCLOSE discards leave the
// block as the file had it, its objects under their own handles.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  isXrefRecord,
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

/**
 * The block each drawing's test edits: the first by name that the editor opens (named, not an
 * xref's or a layout's, not dynamic, whose evaluation Triya leaves alone) holding an object on an
 * unlocked layer that no group holds.
 */
function blockToEdit(model: DocumentModel): { name: string; handle: Handle; erased: Handle } | undefined {
  const locked = new Set(
    [...model.tables.layers.values()].filter((l) => l.locked).map((l) => l.handle),
  );
  const grouped = new Set(
    [...model.objects.values()].flatMap((o) => (o.type === 'GROUP' ? (o as Group).entities : [])),
  );
  const records = [...model.tables.blockRecords.values()]
    .filter((r) => !r.name.startsWith('*') && !r.name.includes('|') && model.hasBlock(r.handle))
    .filter((r) => !isXrefRecord(r) && !model.blocks.get(r.handle)?.dynamic)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  for (const r of records) {
    const erased = model
      .blockEntities(r.handle)
      .map((id) => model.entity(id)!)
      .find((e) => !locked.has(e.layer) && !grouped.has(e.handle) && e.geom.kind !== 'ATTDEF');
    if (erased) return { name: r.name, handle: r.handle, erased: erased.handle };
  }
  return undefined;
}

/** Drawings with no block the test can edit. */
const NO_BLOCK = 76;

describe('the Block Editor on the public corpus (M5-02 part 1)', () => {
  let edited = 0;
  const skipped: string[] = [];

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves a block edited in the Block Editor',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = open(bytes);
      const target = blockToEdit(model);
      if (!target) {
        skipped.push(f.path);
        writeAuditSave(f.path, 'bedit', () =>
          withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), open(bytes))),
        );
        return;
      }
      const refs = [...model.entities()]
        .filter((e) => e.geom.kind === 'INSERT' && e.geom.block === target.handle)
        .map((e) => e.handle);
      const bus = new PromptBus({
        model,
        registry: builtinCommands(),
        view: { request: () => Promise.resolve({ ok: false, message: 'no view' }) },
      });
      await bus.script(['-BEDIT', target.name, 'ERASE']);
      await bus.answer({ kind: 'selection', ids: [model.ids.idOf(target.erased)!] });
      await bus.script(['LINE', '0,0', '1,1', '', 'BSAVE', 'BCLOSE']);
      expect(bus.promptText, f.path).toBe('Command:');
      const kept = model.blockEntities(target.handle).map((id) => model.entity(id)!.handle);
      expect(kept, f.path).not.toContain(target.erased);

      const save = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      writeAuditSave(f.path, 'bedit', () => save);
      const back = open(save);
      const r = [...back.tables.blockRecords.values()].find((b) => b.name === target.name)!;
      expect(r.handle, f.path).toBe(target.handle);
      const contents = back.blockEntities(r.handle).map((id) => back.entity(id)!);
      expect(
        contents.map((e) => e.handle),
        f.path,
      ).toEqual(kept);
      expect(contents.at(-1)?.geom.kind, f.path).toBe('LINE');
      for (const h of refs) {
        const ref = back.entityByHandle(h);
        expect((ref?.geom as InsertGeometry | undefined)?.block, f.path).toBe(r.handle);
      }
      edited++;
    },
  );

  it('edited a block on every readable file that has one', () => {
    expect(edited + skipped.length).toBe(readable.length);
    expect(skipped).toHaveLength(NO_BLOCK);
  });
});

describe('BCLOSE Discard on the public corpus (M5-02 part 1)', () => {
  it.each(readable.slice(0, 12).map((f) => [f.path, f] as const))(
    '%s keeps the block as the file had it',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = open(bytes);
      const target = blockToEdit(model);
      if (!target) return;
      const before = model.blockEntities(target.handle).map((id) => model.entity(id)!);
      const bus = new PromptBus({ model, registry: builtinCommands() });
      await bus.script(['-BEDIT', target.name, 'ERASE']);
      await bus.answer({ kind: 'selection', ids: [model.ids.idOf(target.erased)!] });
      await bus.script(['LINE', '0,0', '1,1', '', 'BCLOSE']);
      await bus.answer({ kind: 'dialog', action: 'ok', bclose: 'discard' });
      expect(bus.promptText, f.path).toBe('Command:');
      const after = model.blockEntities(target.handle).map((id) => model.entity(id)!);
      expect(after, f.path).toEqual(before);
    },
  );
});
