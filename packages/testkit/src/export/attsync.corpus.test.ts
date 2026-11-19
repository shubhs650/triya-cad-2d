// A new block made in the Block Editor and references given their block's attributes by ATTSYNC
// save as DXF and read back (M5-02 part 2). On every readable public corpus file:
//   - -BEDIT names a block no drawing has (TRIYA_NEW), LINE draws in it, BSAVE keeps it;
//   - where the drawing has a block with attribute definitions and references to it, -BEDIT
//     opens it, COPY doubles its first attribute definition (each reference gains an attribute)
//     and, where it has more than one, ERASE takes its last (each reference loses one); BSAVE,
//     BCLOSE, then ATTSYNC Name gives every reference the attributes the definition now has;
// the drawing saves as AC1032 DXF (DEC-047), audited by ezdxf as kind `attsync`, and reopens
// with the new block, and every reference holding one attribute per definition, tag by tag, the
// attributes it kept under their own handles.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  isXrefRecord,
  type AttdefGeometry,
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

/** A definition the references carry: an ATTDEF not constant. */
const carried = (g: { kind: string }) =>
  g.kind === 'ATTDEF' && ((g as AttdefGeometry).flags & 2) === 0;

/**
 * The block each drawing's ATTSYNC takes: the first by name that the editor opens (named, not an
 * xref's, not dynamic) whose attribute definitions lie on unlocked layers no group holds, with a
 * reference in model space or a layout.
 */
function blockToSync(
  model: DocumentModel,
): { name: string; handle: Handle; first: Handle; last?: Handle; refs: Handle[] } | undefined {
  const locked = new Set(
    [...model.tables.layers.values()].filter((l) => l.locked).map((l) => l.handle),
  );
  const grouped = new Set(
    [...model.objects.values()].flatMap((o) => (o.type === 'GROUP' ? (o as Group).entities : [])),
  );
  const spaces = new Set(
    [...model.tables.blockRecords.values()]
      .filter((r) => /^\*(model|paper)_space/i.test(r.name))
      .map((r) => r.handle),
  );
  const records = [...model.tables.blockRecords.values()]
    .filter((r) => !r.name.startsWith('*') && !r.name.includes('|') && model.hasBlock(r.handle))
    .filter((r) => !isXrefRecord(r) && !model.blocks.get(r.handle)?.dynamic)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  for (const r of records) {
    const defs = model
      .blockEntities(r.handle)
      .map((id) => model.entity(id)!)
      .filter((e) => carried(e.geom));
    if (defs.length === 0) continue;
    if (defs.some((e) => locked.has(e.layer) || grouped.has(e.handle))) continue;
    const refs = [...model.entities()]
      .filter((e) => e.geom.kind === 'INSERT' && e.geom.block === r.handle)
      .filter((e) => spaces.has(e.owner) && !locked.has(e.layer))
      .map((e) => e.handle);
    if (refs.length === 0) continue;
    return {
      name: r.name,
      handle: r.handle,
      first: defs[0]!.handle,
      ...(defs.length > 1 && { last: defs.at(-1)!.handle }),
      refs,
    };
  }
  return undefined;
}

/** Drawings with no block ATTSYNC can take. */
const NO_ATTRIBUTE_BLOCK = 97;

describe('a new block and ATTSYNC on the public corpus (M5-02 part 2)', () => {
  let synced = 0;
  const skipped: string[] = [];

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves a new block and synchronized references',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = open(bytes);
      const bus = new PromptBus({
        model,
        registry: builtinCommands(),
        view: { request: () => Promise.resolve({ ok: false, message: 'no view' }) },
      });
      await bus.script(['-BEDIT', 'TRIYA_NEW', 'LINE', '0,0', '1,1', '', 'BSAVE', 'BCLOSE']);
      expect(bus.promptText, f.path).toBe('Command:');

      const target = blockToSync(model);
      const before = new Map<Handle, Handle[]>();
      if (target) {
        for (const h of target.refs) {
          const g = model.entityByHandle(h)!.geom as InsertGeometry;
          before.set(
            h,
            g.attributes.map((a) => a.handle),
          );
        }
        await bus.script(['-BEDIT', target.name, 'COPY']);
        await bus.answer({ kind: 'selection', ids: [model.ids.idOf(target.first)!] });
        await bus.script(['0,0', '1,1', '']);
        if (target.last) {
          await bus.script(['ERASE']);
          await bus.answer({ kind: 'selection', ids: [model.ids.idOf(target.last)!] });
        }
        await bus.script(['BSAVE', 'BCLOSE', 'ATTSYNC', 'N', target.name]);
        expect(bus.promptText, f.path).toBe('Command:');
      } else skipped.push(f.path);

      const save = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      writeAuditSave(f.path, 'attsync', () => save);
      const back = open(save);
      const made = [...back.tables.blockRecords.values()].find((r) => r.name === 'TRIYA_NEW');
      expect(made, f.path).toBeDefined();
      expect(
        back.blockEntities(made!.handle).map((id) => back.entity(id)!.geom.kind),
        f.path,
      ).toEqual(['LINE']);
      if (!target) return;

      const tags = back
        .blockEntities(target.handle)
        .map((id) => back.entity(id)!.geom)
        .filter(carried)
        .map((g) => (g as AttdefGeometry).tag.toUpperCase());
      for (const h of target.refs) {
        const g = back.entityByHandle(h)?.geom as InsertGeometry | undefined;
        expect(
          g?.attributes.map((a) => a.tag.toUpperCase()),
          `${f.path} ${h}`,
        ).toEqual(tags);
        const had = before.get(h)!;
        // The copy's attribute is new; the others keep the handles they had.
        const kept = g!.attributes.filter((a) => had.includes(a.handle));
        expect(kept.length, `${f.path} ${h}`).toBeLessThan(g!.attributes.length);
      }
      synced++;
    },
  );

  it('synchronized a block on every readable file that has one', () => {
    expect(synced + skipped.length).toBe(readable.length);
    expect(skipped).toHaveLength(NO_ATTRIBUTE_BLOCK);
  });
});
