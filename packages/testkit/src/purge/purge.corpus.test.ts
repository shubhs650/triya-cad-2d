// PURGE on every readable public corpus file (M5-09): everything the engine's PURGE takes, all
// categories at once with Purge Nested Items, zero-length geometry and empty text too, must
// save without a refusal (the reader's `purgePinned` keeps what the file still refers to), and
// the reopened file must not have what went while keeping every record PURGE left.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  PURGE_RULES,
  emptyTextObjects,
  eraseObjects,
  purgeClosure,
  purgeInto,
  purgeState,
  zeroLengthObjects,
  type PurgeCategory,
} from '@triya/engine';
import { documentInit, exportDocument, readCadDocument, type CadFormat } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const readable = readableFiles(loadManifest(`${corpusDir}corpus.json`));

/** Generous for the largest corpus files under full-suite load. */
const PER_FILE_BUDGET_MS = 20_000;

const purgedPer = new Map<PurgeCategory, number>();

describe('PURGE on the public corpus', () => {
  it.each(readable.map((f) => [f.path, f] as const))(
    'purges everything unused in %s and saves',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const { format } = sniffCadFile(bytes);
      const options = {
        format: (format === 'dwg' ? 'dwg' : 'dxf') as CadFormat,
        binary: format === 'dxf-binary',
      };
      withPinnedClock(() => {
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const purgeable = purgeState(model).purgeable;
        const items = purgeClosure(
          model,
          purgeable.map((i) => i.handle),
          true,
        );
        const b = new ChangeSetBuilder(model);
        purgeInto(b, model, items);
        eraseObjects(b, model, [...zeroLengthObjects(model), ...emptyTextObjects(model)]);
        model.apply(b.build());
        for (const i of items) purgedPer.set(i.category, (purgedPer.get(i.category) ?? 0) + 1);

        // The save takes it all: nothing PURGE offered is refused.
        const written = exportDocument(readCadDocument(bytes), model, options);
        const back = DocumentModel.create(documentInit(readCadDocument(written)));
        for (const i of items) {
          const table = PURGE_RULES[i.category].table;
          const still = table ? back.tables[table].has(i.handle) : back.objects.has(i.handle);
          expect(still, `${f.path}: ${i.category} ${i.name}`).toBe(false);
        }
        // What stayed is all still there, and nothing more is purgeable one level down
        // than what nesting would not reach (the closure is complete).
        for (const [name, records] of Object.entries(model.tables))
          for (const h of records.keys())
            expect(back.tables[name as keyof typeof back.tables].has(h), `${f.path}: ${h}`).toBe(
              true,
            );
        expect(
          purgeState(back).purgeable.map((i) => `${i.category} ${i.name}`),
          f.path,
        ).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('purges something of the common categories somewhere in the corpus', () => {
    for (const c of ['blocks', 'layers', 'linetypes', 'textStyles', 'appIds'] as const)
      expect(purgedPer.get(c) ?? 0, c).toBeGreaterThan(0);
  });
});
