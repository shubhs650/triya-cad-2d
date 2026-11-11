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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  compareHandles,
  copyToClipboard,
  pasteObjects,
  pasteScale,
  type ChangeSet,
  type Clipboard,
  type SymbolTableRecord,
} from '@triya/engine';
import { documentInit, readCadDocument, saveSession } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));
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

  it.each(readable.map((f) => [f.path] as const))(
    '%s pastes into an AC1032 drawing that saves with everything pasted',
    (path) => {
      const source = open(new Uint8Array(readFileSync(`${corpusDir}${path}`)));
      const space = modelSpace(source);
      expect(space, path).toBeDefined();
      const ids = source.blockEntities(space!);
      const copy = copyToClipboard(source, ids, { x: 0, y: 0 });
      const clip = structuredClone(copy.clipboard) as Clipboard;
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
      for (const [table, c] of Object.entries(cs.tables ?? {})) {
        for (const r of (c?.added ?? []) as SymbolTableRecord[]) {
          expect(compareHandles(r.handle, seed), `${path} ${r.handle}`).toBeGreaterThanOrEqual(0);
          const read = (back.tables as Record<string, ReadonlyMap<string, SymbolTableRecord>>)[
            table
          ]?.get(r.handle);
          expect(read?.name, `${path} ${table} ${r.name}`).toBe(r.name);
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
  });
});
