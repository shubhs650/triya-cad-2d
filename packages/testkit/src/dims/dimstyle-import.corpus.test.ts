// M4-03 part 3: importing dimension styles from another drawing, on the public corpus. Every
// readable file's dimension styles (with their sub-styles, text styles, linetypes, arrowhead
// blocks and xdata applications) are brought into a self-authored AC1032 drawing as the Dimension
// Style Manager's Import... sends them (through a structured clone, as they cross from one
// drawing's page to the other's engine), duplicates of the target's own styles ignored by the
// import itself (the dialog leaves them out before). The
// drawing is saved as the app saves it and read back: every style imported is there under its
// new handle and name, with every DIMVAR it was imported with (references by the name of the
// record they name) and its `ACAD_DSTYLE_*` settings.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DIMVAR_BY_CODE,
  DocumentModel,
  compareHandles,
  copyDimStyles,
  dimStyleOffers,
  dimStyleXdataVars,
  importDimStyles,
  type Clipboard,
  type DimVarValue,
} from '@triya/engine';
import { documentInit, readCadDocument, saveSession } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);
const TARGET = 'public/self-authored/traces.dxf';

const OBSOLETE = new Set(['DIMFIT', 'DIMUNIT']);
const NAMES = Object.values(DIMVAR_BY_CODE).filter((n) => !OBSOLETE.has(n));
const BLOCKS = new Set(['DIMBLK', 'DIMBLK1', 'DIMBLK2', 'DIMLDRBLK']);
const LINETYPES = new Set(['DIMLTYPE', 'DIMLTEX1', 'DIMLTEX2']);

const open = (bytes: Uint8Array) =>
  withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));

/** A DIMVAR as the comparison sees it: switches as numbers, reals to 12 figures, refs by name. */
function comparable(model: DocumentModel, name: string, v: DimVarValue | undefined): unknown {
  const h = typeof v === 'string' && v !== '0' ? v : '';
  if (name === 'DIMTXSTY') return h && model.tables.textStyles.get(h)?.name.toUpperCase();
  if (BLOCKS.has(name)) return h && model.blocks.get(h)?.name.toUpperCase();
  if (LINETYPES.has(name)) {
    const n = h ? model.tables.linetypes.get(h)?.name.toUpperCase() : '';
    return n === 'BYBLOCK' ? '' : n;
  }
  if (typeof v === 'boolean') return Number(v);
  if (typeof v === 'number') return Number(v.toPrecision(12)) + 0;
  return v;
}

describe('Import dimension styles from every public corpus file (M4-03 part 3)', () => {
  const targetBytes = new Uint8Array(readFileSync(`${corpusDir}${TARGET}`));
  let imported = 0;
  let ignored = 0;

  it.each(readable.map((f) => [f.path] as const))(
    '%s’s dimension styles import into an AC1032 drawing that saves them',
    (path) => {
      const source = open(new Uint8Array(readFileSync(`${corpusDir}${path}`)));
      const offered = dimStyleOffers(source).filter((o) => o.parent === undefined);
      if (offered.length === 0) return;
      const target = open(targetBytes);
      const clip = structuredClone(
        copyDimStyles(
          source,
          offered.map((o) => o.name),
        ),
      ) as Clipboard;
      const seed = target.handSeed;
      const b = new ChangeSetBuilder(target);
      const result = importDimStyles(b, target, clip);
      const cs = b.build();
      target.apply(cs);
      imported += result.added.length;
      ignored += result.ignored.length;

      const out = withPinnedClock(() => saveSession(targetBytes, [structuredClone(cs)]));
      const back = open(out);
      for (const name of result.added) {
        const made = [...target.tables.dimStyles.values()].find((s) => s.name === name)!;
        expect(compareHandles(made.handle, seed), `${path} ${name}`).toBeGreaterThanOrEqual(0);
        const again = back.tables.dimStyles.get(made.handle);
        expect(again?.name, `${path} ${name}`).toBe(name);
        const wrong = NAMES.filter(
          (n) =>
            JSON.stringify(comparable(target, n, made.vars[n])) !==
            JSON.stringify(comparable(back, n, again!.vars[n])),
        ).map((n) => `${n}: ${String(made.vars[n])} → ${String(again!.vars[n])}`);
        expect(wrong, `${path} ${name}`).toEqual([]);
        expect(dimStyleXdataVars(back, again!.xdata), `${path} ${name}`).toEqual(
          dimStyleXdataVars(target, made.xdata),
        );
      }
    },
    30_000,
  );

  it('imported styles from the corpus and ignored the target’s own', () => {
    expect(imported).toBeGreaterThan(20);
    expect(ignored).toBeGreaterThan(0);
  });
});
