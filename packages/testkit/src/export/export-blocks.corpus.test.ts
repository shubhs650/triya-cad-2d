// Block definition edits on every readable public corpus file (M1-75 part 22): what BASE in the
// block editor, RENAME and BLOCK do. Every named block that is not a layout's, an xref's or
// anonymous gets a new base point, the short-named ones a new name, and model space gains a new
// block (two lines on layer 0) with an INSERT of it. The edits map back and nothing else in the
// drawing changes. An R12 file has no BLOCK_RECORD table: acad-ts makes up the records' handles on
// read, and a new block would move every one of them, so R12 files take the edits without the new
// block here (packages/io/test/export-blocks.test.ts saves a new one to R12).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACadVersion, type BlockRecord } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type BlockDefinition,
  type BlockTableRecord,
  type Handle,
} from '@triya/engine';
import { documentInit, exportDocument, readCadDocument, type CadFormat } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

/** Generous for the largest corpus files read twice and written once under full-suite load. */
const PER_FILE_BUDGET_MS = 10_000;

/** BLOCK DXF 70 bits of an xref (4 xref, 8 overlay) and of what an xref brings (16, 32). */
const XREF_FLAGS = 4 | 8 | 16 | 32;
/** A renamed block stays within the 31 characters names had up to R2000. */
const RENAMED = (name: string) => `${name}-R`;
const NEW_BLOCK = 'TRIYA_NEW_BLOCK';
/** The header variables that name a block. */
const ARROW_VARIABLES = ['$DIMBLK', '$DIMBLK1', '$DIMBLK2', '$DIMLDRBLK'];

const editable = (r: BlockTableRecord, d: BlockDefinition): boolean =>
  !r.name.startsWith('*') &&
  r.layout === undefined &&
  ((r.flags ?? 0) & (XREF_FLAGS | 1)) === 0 &&
  d.dynamic === undefined;

/** A block as it maps back, by name, without handles (R12 makes up the record handles). */
function comparable(model: DocumentModel, name: string) {
  const def = [...model.blocks.values()].find((d) => d.name === name);
  if (!def) return undefined;
  const { raw: _r, handle: _h, ...record } = model.tables.blockRecords.get(def.handle)!;
  const { handle: _d, ...rest } = def;
  return {
    record,
    def: rest,
    entities: model.blockEntities(def.handle).map((id) => {
      const { id: _id, raw: _e, owner: _o, ...e } = model.entity(id)!;
      return e;
    }),
  };
}

describe('TriyaToAcad block edits on the public corpus', () => {
  it.each(readable.map((f) => [f.path, f] as const))(
    'moves base points, renames and adds blocks in %s',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const { format } = sniffCadFile(bytes);
      const options = {
        format: (format === 'dwg' ? 'dwg' : 'dxf') as CadFormat,
        binary: format === 'dxf-binary',
      };
      withPinnedClock(() => {
        const original = readCadDocument(bytes);
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const version = original.header?.version ?? ACadVersion.AC1032;
        const r12 = version <= ACadVersion.AC1009;
        const names = new Set([...model.blocks.values()].map((d) => d.name.toUpperCase()));
        const targets = [...model.blocks.values()].filter((d) =>
          editable(model.tables.blockRecords.get(d.handle)!, d),
        );
        const renamed = targets.filter(
          (d) => d.name.length <= 29 && !names.has(RENAMED(d.name).toUpperCase()),
        );
        const modelSpace = [...model.blocks.values()].find(
          (d) => d.name.toUpperCase() === '*MODEL_SPACE',
        )!.handle;
        const layer0 = [...model.tables.layers.values()].find((l) => l.name === '0');
        const adds = !r12 && layer0 !== undefined && !names.has(NEW_BLOCK);
        const b = new ChangeSetBuilder(model);
        for (const [i, d] of targets.entries())
          b.updateBlock(d.handle, {
            basePoint: { x: d.basePoint.x + 1 + i, y: d.basePoint.y - 2 },
          });
        for (const d of renamed) b.updateBlock(d.handle, { name: RENAMED(d.name) });
        // RENAME takes the arrowhead variables naming a renamed block along.
        const header = new Map<string, string>();
        for (const name of ARROW_VARIABLES) {
          const value = model.header.get(name);
          const d = renamed.find((x) => x.name === value);
          if (d) header.set(name, RENAMED(d.name));
        }
        for (const [name, value] of header) b.setHeader(name, value);
        let added: Handle | undefined;
        if (adds) {
          added = b.addBlock({ name: NEW_BLOCK, basePoint: { x: 1, y: 2 } }).handle;
          for (const x of [1, 3])
            b.addEntity({
              owner: added,
              layer: layer0.handle,
              geom: { kind: 'LINE', start: { x, y: 0 }, end: { x, y: 5 } },
            });
          b.addEntity({
            owner: modelSpace,
            layer: layer0.handle,
            geom: {
              kind: 'INSERT',
              block: added,
              position: { x: 10, y: 10 },
              scale: { x: 1, y: 1, z: 1 },
              rotation: 0,
              attributes: [],
            },
          });
        }
        model.apply(b.build());

        const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, options));
        const back = DocumentModel.create(documentInit(reopened));
        for (const d of targets) {
          const name = model.blocks.get(d.handle)!.name;
          expect(comparable(back, name), `${f.path} ${name}`).toEqual(comparable(model, name));
        }
        if (added) {
          expect(comparable(back, NEW_BLOCK), f.path).toEqual(comparable(model, NEW_BLOCK));
          expect(back.blocks.get(added)?.name, f.path).toBe(NEW_BLOCK);
        }

        // Nothing else changes: the edited records with their BLOCK entities, and the block
        // table, model space and what the new block brings.
        const ignoreHandles = new Set<number>();
        for (const d of targets) {
          const acad = original.getCadObject(Number.parseInt(d.handle, 16)) as BlockRecord;
          ignoreHandles.add(acad.handle).add(acad.blockEntity.handle);
        }
        // A renamed block is listed under its new name.
        if (renamed.length > 0) ignoreHandles.add(original.blockRecords!.handle);
        if (added) {
          ignoreHandles.add(original.blockRecords!.handle);
          ignoreHandles.add(Number.parseInt(modelSpace, 16));
          const seed = Number.parseInt(model.handSeed, 16);
          const now = reopened.header!.handleSeed;
          for (let h = seed - 4; h < now; h++) ignoreHandles.add(h);
        }
        const backHeader = new Map(back.header);
        for (const [name, value] of header) expect(backHeader.get(name), f.path).toBe(value);
        const diff = structuralDiff(original, reopened, { ignoreHandles }).differences.filter(
          (d) =>
            d.handle !== '0' ||
            // The handle seed rises past the new block's BLOCK and ENDBLK.
            !((added && d.path === 'handleSeed') || header.has(d.path)),
        );
        expect(diff.slice(0, 5), f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );
});
