// M1-105: the unedited AC1032 DXF save of every readable public corpus file. Each must save and
// read back as AC1032 with every entity it had; with TRIYA_DXF_AUDIT_DIR set the saves are also
// written for the ezdxf audit (scripts/dxf-audit/audit.py). The edited saves come from
// export/export.corpus.test.ts.
//
// M2-40: a drafter opens what Triya saved and saves it again. The save, reopened and saved
// unedited once more, must keep every object the first save wrote (every handle it declares is
// read back from the second, `handleCoverage`), and the second save goes to the audit as the
// file's `resaved` save. The round-trip suite compares a file only with its own first save.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACadVersion } from '@node-projects/acad-ts';
import { DocumentModel } from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { declaredHandles, documentHandles, handleCoverage } from '../roundtrip/handle-coverage.ts';
import { saveAc1032Dxf, writeAuditSave } from './saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

describe('AC1032 DXF save of the public corpus, and of that save (M1-105, M2-40)', () => {
  it.each(readable.map((f) => [f.path, f] as const))(
    '%s',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      withPinnedClock(() => {
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const saved = saveAc1032Dxf(readCadDocument(bytes), model);
        writeAuditSave(f.path, 'unedited', () => saved);
        const reopened = readCadDocument(saved);
        expect(reopened.header?.version).toBe(ACadVersion.AC1032);
        const handles = (m: DocumentModel): string[] =>
          [...m.entities()].map((e) => e.handle).sort();
        expect(handles(DocumentModel.create(documentInit(reopened)))).toEqual(handles(model));

        const again = DocumentModel.create(documentInit(reopened));
        const resaved = saveAc1032Dxf(readCadDocument(saved), again);
        writeAuditSave(f.path, 'resaved', () => resaved);
        const { lost } = handleCoverage(
          declaredHandles(saved).handles,
          documentHandles(reopened),
          documentHandles(readCadDocument(resaved)),
        );
        expect(lost).toEqual([]);
        expect(handles(DocumentModel.create(documentInit(readCadDocument(resaved))))).toEqual(
          handles(model),
        );
      });
    },
    20_000,
  );
});
