// M2-14 part 2 acceptance: cross-document paste. Every readable public corpus file's model space
// is copied (COPYCLIP's `copyToClipboard`, through a structured clone as the app's Clipboard holds
// it) and pasted into a self-authored AC1032 drawing, which is then saved as the app saves
// (`saveSession`: the change log replayed onto a fresh read of the target's file).
//
// The save must take every pasted object, the definitions that came with it and its new handle:
// read back, each pasted entity is there under its handle with its type, owner and layer name,
// and every record the paste added is there under its handle and name. Nothing the source holds
// leaks in under the source's handles, and every new handle is above the target's $HANDSEED.
//
// M2-32: the target is taken in other units than each source with units of its own (inches,
// or millimetres for an inch drawing), so every such paste is scaled (`pasteScale`) and the
// save takes the scaled objects too.
//
// M2-32 part 2: images and PDF underlays come with their IMAGEDEFs and PDFDEFINITIONs, which the
// save files in the target's ACAD_IMAGE_DICT and ACAD_PDFDEFINITIONS (made on the first one).
// Read back, each pasted definition is there under its handle, name and file, and each pasted
// image or underlay shows it.
//
// M2-32 part 3: records keep their xdata, which the save writes on each record it adds, and
// multileaders whose content block holds attribute definitions paste naming the pasted (or the
// target's) ATTDEFs. Read back, each added record has the xdata it was pasted with, and each
// such multileader names its ATTDEFs, which are there.
//
// M2-32 part 4: a dynamic block reference stays dynamic. The definition comes with its graph and
// the anonymous states with their link to it (CodedObjects in its records' and references'
// extension dictionaries). Read back, each pasted reference to a dynamic block still names a
// dynamic block of the same name, and every pasted coded object is there under its handle,
// owner and key with the codes it was pasted with.
//
// M2-32 part 5: the Clipboard goes from the source to the target as the system clipboard's text
// (`clipboardData`), as it does between two Triya windows, and reads back equal to the structured
// clone one window's drawings share.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  clipboardData,
  compareHandles,
  copyToClipboard,
  dynamicBlockOf,
  isCodedObject,
  pasteObjects,
  pasteScale,
  readClipboardData,
  type ChangeSet,
  type Clipboard,
  type SymbolTableRecord,
} from '@triya/engine';
import { documentInit, readCadDocument, saveSession } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);
const TARGET = 'public/self-authored/traces.dxf';
const PER_FILE_BUDGET_MS = 30_000;

const modelSpace = (model: DocumentModel): string | undefined =>
  [...model.blocks.values()].find((b) => b.name.toUpperCase() === '*MODEL_SPACE')?.handle;

const open = (bytes: Uint8Array, insUnits?: number) =>
  withPinnedClock(() => {
    const init = documentInit(readCadDocument(bytes));
    return DocumentModel.create(
      insUnits === undefined ? init : { ...init, meta: { ...init.meta, insUnits } },
    );
  });

/** INSUNITS 1 is inches, 4 millimetres. */
const otherUnits = (insUnits: number): number | undefined =>
  insUnits === 0 ? undefined : insUnits === 1 ? 4 : 1;

describe('Paste from every public corpus file into another drawing (M2-14 part 2)', () => {
  const targetBytes = new Uint8Array(readFileSync(`${corpusDir}${TARGET}`));
  let pastedTotal = 0;
  let refusedTotal = 0;
  let scaledFiles = 0;
  const definitions = { IMAGEDEF: 0, PDFDEFINITION: 0 };
  let recordXdata = 0;
  let attributed = 0;
  let dynamicReferences = 0;
  let codedObjects = 0;

  it.each(readable.map((f) => [f.path] as const))(
    '%s pastes into an AC1032 drawing that saves with everything pasted',
    (path) => {
      const source = open(new Uint8Array(readFileSync(`${corpusDir}${path}`)));
      const space = modelSpace(source);
      expect(space, path).toBeDefined();
      const ids = source.blockEntities(space!);
      const copy = copyToClipboard(source, ids, { x: 0, y: 0 });
      // M2-32 part 5: through the system clipboard, as another window reads it, which must
      // hold all the structured clone between two drawings of one window does.
      const read = readClipboardData(clipboardData(copy.clipboard, 'source-window'));
      expect(read?.source, path).toBe('source-window');
      const clip = read!.clipboard;
      expect(clip, path).toStrictEqual(structuredClone(copy.clipboard) as Clipboard);
      refusedTotal += [...copy.refused.values()].reduce((a, b) => a + b, 0);

      const target = open(targetBytes, otherUnits(source.meta.insUnits));
      const k = pasteScale(target, clip);
      if (k !== 1) scaledFiles++;
      const seed = target.handSeed;
      const b = new ChangeSetBuilder(target);
      const report = pasteObjects(b, target, clip, modelSpace(target)!, { x: 1000, y: 1000 });
      const cs: ChangeSet = b.build();
      target.apply(cs);
      pastedTotal += report.ids.length;
      expect(report.ids.length, path).toBe(clip.entities.length);

      const out = withPinnedClock(() => saveSession(targetBytes, [structuredClone(cs)]));
      writeAuditSave(path, 'paste', () => out);
      const back = DocumentModel.create(documentInit(readCadDocument(out)));

      const layerName = (m: DocumentModel, h: string) => m.tables.layers.get(h)?.name;
      for (const p of cs.entities?.added ?? []) {
        const e = p.entity;
        expect(compareHandles(e.handle, seed), `${path} ${e.handle}`).toBeGreaterThanOrEqual(0);
        const read = back.entityByHandle(e.handle);
        expect(read?.type, `${path} ${e.type} ${e.handle}`).toBe(e.type);
        expect(read?.owner, `${path} ${e.handle} owner`).toBe(e.owner);
        expect(layerName(back, read!.layer), `${path} ${e.handle} layer`).toBe(
          layerName(target, e.layer),
        );
      }
      for (const o of cs.objects?.added ?? []) {
        if (o.type !== 'IMAGEDEF' && o.type !== 'PDFDEFINITION') continue;
        definitions[o.type]++;
        const { reactors: _a, raw: _r, ...read } = back.objects.get(o.handle) ?? {};
        const { reactors: _b, ...want } = o;
        expect(read, `${path} ${o.type} ${o.handle}`).toEqual(want);
      }
      for (const p of cs.entities?.added ?? []) {
        const g = p.entity.geom;
        if ((g.kind !== 'IMAGE' && g.kind !== 'PDFUNDERLAY') || g.definition === undefined)
          continue;
        const read = back.entityByHandle(p.entity.handle)!.geom as { definition?: string };
        expect(read.definition, `${path} ${p.entity.handle}`).toBe(g.definition);
        expect(back.objects.has(g.definition), `${path} ${g.definition}`).toBe(true);
      }
      for (const p of cs.entities?.added ?? []) {
        const g = p.entity.geom;
        if (g.kind !== 'MULTILEADER' || !g.block?.attributes?.some((a) => a.definition)) continue;
        attributed++;
        const read = back.entityByHandle(p.entity.handle)!.geom as typeof g;
        expect(read.block?.attributes, `${path} ${p.entity.handle}`).toEqual(g.block.attributes);
        for (const a of g.block.attributes) {
          if (a.definition === undefined) continue;
          expect(back.entityByHandle(a.definition)?.type, `${path} ${a.definition}`).toBe('ATTDEF');
        }
      }
      // The source's dynamic references, by handle, and the names of their dynamic blocks.
      const dynamicSource = new Map<string, string>();
      for (const id of ids) {
        const e = source.entity(id)!;
        if (e.geom.kind !== 'INSERT') continue;
        const d = dynamicBlockOf(source.blocks, e.geom.block);
        if (d) dynamicSource.set(e.handle, d.name);
      }
      const pastedFrom = new Map(report.ids.map((id, i) => [id, clip.entities[i]!.handle]));
      for (const id of report.ids) {
        const name = dynamicSource.get(pastedFrom.get(id)!);
        if (name === undefined) continue;
        dynamicReferences++;
        const e = target.entity(id)!;
        const g = back.entityByHandle(e.handle)!.geom;
        expect(g.kind, `${path} ${e.handle}`).toBe('INSERT');
        const d = g.kind === 'INSERT' ? dynamicBlockOf(back.blocks, g.block) : undefined;
        expect(d?.name, `${path} ${e.handle} stays dynamic`).toBe(name);
      }
      for (const o of cs.objects?.added ?? []) {
        if (!isCodedObject(o)) continue;
        codedObjects++;
        const read = back.objects.get(o.handle);
        expect(isCodedObject(read), `${path} ${o.dxfName} ${o.handle}`).toBe(true);
        const { raw: _r, ...got } = read!;
        expect(got, `${path} ${o.dxfName} ${o.handle}`).toEqual(o);
      }
      for (const [table, c] of Object.entries(cs.tables ?? {})) {
        for (const r of (c?.added ?? []) as SymbolTableRecord[]) {
          expect(compareHandles(r.handle, seed), `${path} ${r.handle}`).toBeGreaterThanOrEqual(0);
          const read = (back.tables as Record<string, ReadonlyMap<string, SymbolTableRecord>>)[
            table
          ]?.get(r.handle);
          expect(read?.name, `${path} ${table} ${r.name}`).toBe(r.name);
          if (r.xdata) recordXdata++;
          expect(read?.xdata, `${path} ${table} ${r.name} xdata`).toEqual(r.xdata);
        }
      }
    },
    PER_FILE_BUDGET_MS,
  );

  it('pasted objects from the corpus', () => {
    // A floor, so that a paste that quietly takes nothing fails here.
    expect(pastedTotal).toBeGreaterThan(2000);
    expect(refusedTotal).toBeGreaterThanOrEqual(0);
    // Most corpus drawings state their units, so most pastes are scaled.
    expect(scaledFiles).toBeGreaterThan(20);
    // The corpus images and underlays brought their definitions.
    expect(definitions.IMAGEDEF).toBeGreaterThan(10);
    expect(definitions.PDFDEFINITION).toBeGreaterThan(0);
    // Records with xdata (layer descriptions and transparency, dimension style DIMVAR xdata, a
    // block's applications) and the corpus multileaders with block attributes came over.
    expect(recordXdata).toBeGreaterThan(100);
    expect(attributed).toBeGreaterThan(0);
    // The corpus dynamic block references stayed dynamic, their graphs with them.
    expect(dynamicReferences).toBeGreaterThan(10);
    expect(codedObjects).toBeGreaterThan(100);
  });
});
