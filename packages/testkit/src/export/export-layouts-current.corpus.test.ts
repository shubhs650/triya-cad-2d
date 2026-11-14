// Making another layout current on every readable public corpus file (M1-75 part 30): the paper
// layout first in tab order after the current one is made current, and in another save from the
// same file it is made current and the layout that was current is deleted. The reopened file has the two sheet blocks' names swapped
// (each keeping its handle and its entities), the header's $P… variables stating the new current
// layout's limits, flags and space, and everything else exactly as read.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACadVersion, type BlockRecord } from '@node-projects/acad-ts';
import { ChangeSetBuilder, DocumentModel, type Layout } from '@triya/engine';
import { documentInit, exportDocument, readCadDocument, type CadFormat } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/** Generous for the largest corpus files read four times and written twice under load. */
const PER_FILE_BUDGET_MS = 15_000;

const comparable = ({ raw: _raw, ...rest }: Layout) => rest;
const paperHeader = (m: Iterable<readonly [string, unknown]>) =>
  Object.fromEntries(
    [...m].filter(([k]) => /^\$P(LIM|SLTSCALE|INSBASE|EXT|ELEVATION|UCS)/.test(k)),
  );

let switched = 0;
let deleted = 0;

describe('TriyaToAcad making another layout current on the public corpus', () => {
  it.each(readable.map((f) => [f.path, f] as const))(
    'makes another layout of %s current, then deletes the one that was',
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
        const space = (l: Layout) =>
          model.tables.blockRecords.get(l.blockRecord)?.name.toUpperCase() ?? '';
        const was = model.layouts.find((l) => space(l) === '*PAPER_SPACE');
        const next = model.layouts.find(
          (l) => space(l) !== '*PAPER_SPACE' && space(l) !== '*MODEL_SPACE',
        );
        if (!was || !next) return;
        const names = [was, next].map((l) => model.tables.blockRecords.get(l.blockRecord)!.name);
        const b = new ChangeSetBuilder(model);
        b.setCurrentLayout(next.handle);
        model.apply(b.build());
        const version = original.header?.version ?? ACadVersion.AC1032;
        if (version < ACadVersion.AC1015) {
          expect(() => exportDocument(readCadDocument(bytes), model, options)).toThrow(
            /has no layouts \(R2000 added them\)/,
          );
          return;
        }

        const saved = exportDocument(readCadDocument(bytes), model, options);
        const reopened = readCadDocument(saved);
        const init = documentInit(reopened);
        const record = (h: string) =>
          reopened.getCadObject(Number.parseInt(h, 16)) as BlockRecord | null;
        expect([record(next.blockRecord)?.name, record(was.blockRecord)?.name], f.path).toEqual(
          names,
        );
        expect(init.layouts!.map(comparable), f.path).toEqual(model.layouts.map(comparable));
        expect(paperHeader(init.header ?? []), f.path).toEqual(paperHeader(model.header));
        switched++;

        // The two names and the header's $P… variables change; nothing else does.
        const diff = structuralDiff(original, reopened).differences.filter(
          (d) =>
            !(d.handle === '0' && d.path.startsWith('$HANDSEED')) &&
            !(d.handle === '0' && /^\$P(LIM|SLTSCALE|INSBASE|EXT|ELEVATION|UCS)/.test(d.path)) &&
            // The table lists the two blocks under their new names.
            !(d.objectName === 'BLOCK_RECORD' && /^entries\[\*PAPER_SPACE\d*\]$/.test(d.path)) &&
            // A DWG lists the current sheet's BLOCK and ENDBLK among its owned objects (acad-ts
            // reads them so), which go with the name.
            !(
              [next.blockRecord, was.blockRecord].includes(d.handle) &&
              /^(_name$|ownedObjectHandles)/.test(d.path)
            ),
        );
        expect(diff.slice(0, 5), f.path).toEqual([]);

        // In one save, as AutoCAD deletes the current layout: another is made current first.
        const both = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const c = new ChangeSetBuilder(both);
        c.setCurrentLayout(next.handle);
        c.removeLayout(was.handle);
        both.apply(c.build());
        const again = readCadDocument(exportDocument(readCadDocument(bytes), both, options));
        expect(documentInit(again).layouts!.map(comparable), f.path).toEqual(
          both.layouts.map(comparable),
        );
        expect(again.getCadObject(Number.parseInt(was.blockRecord, 16)), f.path).toBeNull();
        expect(again.getCadObject(Number.parseInt(was.handle, 16)), f.path).toBeNull();
        expect(again.paperSpace?.handle.toString(16).toUpperCase(), f.path).toBe(next.blockRecord);
        deleted++;
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('makes layouts current somewhere in the corpus', () => {
    expect(switched).toBeGreaterThan(0);
    expect(deleted).toBe(switched);
  });
});
