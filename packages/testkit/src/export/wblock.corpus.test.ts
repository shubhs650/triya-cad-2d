// M5-01 part 4 acceptance: WBLOCK and a drawing file inserted as a block, on every readable public
// corpus file.
//
// WBLOCK: each file's model space (`drawingContent`: based at its $INSBASE, as INSERT reads a
// drawing) is written as a new drawing (`writeBlockDrawing`: the objects pasted into a blank
// AC1032 drawing, base point at the origin, saved as every save is). The new file passes ezdxf's
// audit (audit kind `wblock`) and reads back with every object written in its model space, each
// of the type written, moved by minus the base point.
//
// A drawing file as a block: the file WBLOCK wrote is then inserted into a self-authored drawing
// as block WBLOCKED (`blockFromClipboard`, what INSERT's Browse... and -INSERT `name=file` make),
// with one reference; the save reads back with the block holding as many objects as the file's
// model space, based at its origin, and the reference naming it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  blockFromClipboard,
  drawingContent,
  wblockCopy,
  type Clipboard,
} from '@triya/engine';
import { documentInit, readCadDocument, saveSession, writeBlockDrawing } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);
const TARGET = 'public/self-authored/traces.dxf';
const PER_FILE_BUDGET_MS = 30_000;

const modelSpace = (model: DocumentModel): string =>
  [...model.tables.blockRecords.values()].find((b) => b.name.toUpperCase() === '*MODEL_SPACE')!
    .handle;

const open = (bytes: Uint8Array) =>
  withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));

/** The types of `entities`, counted. */
const typesOf = (entities: readonly { readonly type: string }[]) => {
  const out: Record<string, number> = {};
  for (const e of entities) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
};

describe('WBLOCK and a drawing file as a block, on every public corpus file (M5-01 part 4)', () => {
  const targetBytes = new Uint8Array(readFileSync(`${corpusDir}${TARGET}`));
  let written = 0;
  let inserted = 0;
  let empty = 0;
  let blockless = 0;

  it.each(readable.map((f) => [f.path] as const))(
    '%s writes as a new drawing, which inserts as a block',
    (path) => {
      const source = open(new Uint8Array(readFileSync(`${corpusDir}${path}`)));
      // As WBLOCK takes them: its model space at its $INSBASE, dimensions without a block left out.
      const ins = drawingContent(source).clipboard.base;
      const copy = wblockCopy(source, source.blockEntities(modelSpace(source)), ins);
      blockless += copy.refused.get('a dimension without its block') ?? 0;
      // Through a structured clone, as the content crosses to the I/O worker.
      const clip = structuredClone(copy.clipboard) as Clipboard;
      if (clip.entities.length === 0) empty++;
      const units = source.meta.insUnits;
      const out = withPinnedClock(() =>
        writeBlockDrawing(clip, { $INSUNITS: units, $INSBASE: { x: 0, y: 0, z: 0 } }),
      );
      writeAuditSave(path, 'wblock', () => out);

      // The new drawing holds every object written, in model space, the base point at its origin.
      const back = open(out);
      const space = back.blockEntities(modelSpace(back)).map((id) => back.entity(id)!);
      expect(typesOf(space), path).toEqual(typesOf(clip.entities));
      expect(back.header.get('$INSUNITS') ?? 0, path).toBe(units);
      written += space.length;

      // The new drawing as block WBLOCKED of another drawing, with one reference.
      const file = drawingContent(back).clipboard;
      expect(file.base, path).toEqual({ x: 0, y: 0 });
      const target = open(targetBytes);
      const b = new ChangeSetBuilder(target);
      const made = blockFromClipboard(b, target, structuredClone(file) as Clipboard, 'WBLOCKED');
      expect(made.redefined, path).toBe(false);
      b.addEntity({
        owner: modelSpace(target),
        layer: [...target.tables.layers.values()][0]!.handle,
        geom: {
          kind: 'INSERT',
          block: made.block,
          position: { x: 10, y: 10 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: 0,
          attributes: [],
        },
      });
      const cs = b.build();
      const saved = withPinnedClock(() => saveSession(targetBytes, [cs]));
      const reread = open(saved);
      const block = [...reread.tables.blockRecords.values()].find((r) => r.name === 'WBLOCKED');
      expect(block, path).toBeDefined();
      const held = reread.blockEntities(block!.handle).map((id) => reread.entity(id)!);
      expect(typesOf(held), path).toEqual(typesOf(file.entities));
      expect(reread.blocks.get(block!.handle)?.basePoint, path).toEqual({ x: 0, y: 0 });
      const refs = reread
        .blockEntities(modelSpace(reread))
        .map((id) => reread.entity(id)!.geom)
        .filter((g) => g.kind === 'INSERT' && g.block === block!.handle);
      expect(refs, path).toHaveLength(1);
      inserted += held.length;
    },
    PER_FILE_BUDGET_MS,
  );

  it('wrote and inserted the corpus model spaces', () => {
    // A floor, so that a WBLOCK that quietly writes nothing fails here.
    expect(written).toBeGreaterThan(2000);
    expect(inserted).toBe(written);
    expect(empty).toBeLessThan(readable.length / 2);
    // ezdxf's duplicate_handles.dxf holds dimensions without blocks, which WBLOCK leaves out.
    expect(blockless).toBeGreaterThan(0);
  });
});
