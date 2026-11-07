// PURGE on every readable public corpus file (M1-75 parts 25 and 27): every layer, linetype, text
// style, dimension style, multileader style, table style, application, UCS, view, viewport and
// block (a block with the entities in it) is removed at once, the save's refusals take back the records something still refers to until it saves,
// and what it purges must be gone from the reopened file with all it owned, while everything
// else stays exactly as read. A dangling reference the save left would read back as a changed
// field of the object holding it, so the diff also proves that nothing kept refers to what went.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CadObject } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Handle,
  type SymbolTableRecord,
  type TableName,
} from '@triya/engine';
import {
  documentInit,
  documentObjects,
  exportDocument,
  readCadDocument,
  UnsupportedChangeError,
  type CadFormat,
} from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

/** Generous for the largest corpus files, saved a few times, under full-suite load. */
const PER_FILE_BUDGET_MS = 20_000;

const TABLES: readonly TableName[] = [
  'layers',
  'linetypes',
  'textStyles',
  'dimStyles',
  'appIds',
  'ucs',
  'views',
  'vports',
  'mleaderStyles',
  'tableStyles',
  'blockRecords',
];

/** Records purged across the corpus, per table: each table must purge somewhere. */
const purgedPerTable = new Map<TableName, number>();

/** The removal of `records` from a fresh model of `bytes`; a block takes its entities along. */
function purged(bytes: Uint8Array, records: ReadonlyMap<Handle, TableName>): DocumentModel {
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  const b = new ChangeSetBuilder(model);
  for (const [h, table] of records) {
    if (table !== 'blockRecords') {
      b.removeTableRecord(table, h);
      continue;
    }
    for (const id of b.blockEntities(h)) b.removeEntity(id);
    // A draw order table belongs to its block.
    for (const o of model.objects.values()) {
      if (o.type === 'SORTENTSTABLE' && (o as { block?: Handle }).block === h)
        b.removeObject(o.handle);
    }
    b.removeBlock(h);
  }
  model.apply(b.build());
  return model;
}

describe('TriyaToAcad PURGE on the public corpus', () => {
  it.each(readable.map((f) => [f.path, f] as const))(
    'purges what nothing refers to in %s',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const { format } = sniffCadFile(bytes);
      const options = {
        format: (format === 'dwg' ? 'dwg' : 'dxf') as CadFormat,
        binary: format === 'dxf-binary',
      };
      withPinnedClock(() => {
        const original = readCadDocument(bytes);
        const init = documentInit(original);
        const candidates = new Map<Handle, TableName>();
        for (const table of TABLES) {
          for (const r of (init.tables?.[table] ?? []) as SymbolTableRecord[]) {
            candidates.set(r.handle, table);
          }
        }
        // Refused records go back until the save goes through: a refusal names its record's
        // handle, and a record kept may be what kept another (a layer drawn with a linetype).
        let written: Uint8Array | undefined;
        for (let round = 0; round < 10 && !written; round++) {
          try {
            written = exportDocument(readCadDocument(bytes), purged(bytes, candidates), options);
          } catch (e) {
            if (!(e instanceof UnsupportedChangeError)) throw e;
            const refusedNow = new Set(
              e.problems.map((p) => /^[^(]*\(([0-9A-F]+)\): /.exec(p)?.[1]),
            );
            const before = candidates.size;
            for (const h of refusedNow) if (h) candidates.delete(h);
            expect(candidates.size, `${f.path}: ${e.problems.slice(0, 3).join('; ')}`).toBeLessThan(
              before,
            );
          }
        }
        expect(written, f.path).toBeDefined();
        for (const table of candidates.values())
          purgedPerTable.set(table, (purgedPerTable.get(table) ?? 0) + 1);

        // Everything the purged records owned goes with them.
        const going = new Set<CadObject>(
          [...candidates.keys()].map((h) => original.getCadObject(Number.parseInt(h, 16))!),
        );
        const goes = (o: CadObject): boolean => {
          for (
            let at: CadObject | null = o, i = 0;
            at && i < 32;
            at = at.owner as CadObject | null, i++
          ) {
            if (going.has(at)) return true;
          }
          return false;
        };
        const gone = new Set<number>();
        for (const [h, o] of documentObjects(original)) if (goes(o)) gone.add(h);

        const pointsAtGone = (a: string | undefined) => {
          const h = /#([0-9A-F]+)$/.exec(a ?? '')?.[1];
          return h !== undefined && gone.has(Number.parseInt(h, 16));
        };
        const reopened = readCadDocument(written!);
        const back = documentObjects(reopened);
        expect(
          [...gone].filter((h) => back.has(h)).map((h) => h.toString(16)),
          f.path,
        ).toEqual([]);
        // The tables list the records they keep; nothing else changes.
        const tables = new Set(
          [...documentObjects(original).values()]
            .filter((o) => [...gone].some((h) => original.getCadObject(h)?.owner === o))
            .map((o) => o.handle),
        );
        const diff = structuralDiff(original, reopened, {
          ignoreHandles: new Set([...gone, ...tables]),
        }).differences.filter(
          (d) =>
            !(d.handle === '0' && d.path.startsWith('$HANDSEED')) &&
            // An object Triya does not map that pointed at an entity erased with its block
            // (an MTEXT's column XRECORD) reads the pointer back as none, as AutoCAD saves a
            // pointer to an erased object.
            !(d.kind === 'value' && (d.b === '0' || d.b === 'null') && pointsAtGone(d.a)),
        );
        expect(diff.slice(0, 5), f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('purges records of every table somewhere in the corpus', () => {
    // The only corpus UCS record is in the malformed duplicate_handles.dxf, which is not in
    // `readable`; every corpus file has a single VPORT, the current *Active one, which stays, and
    // no table style but Standard, which PURGE never takes: export-purge.test.ts covers those.
    const unpurgeable = new Set<TableName>(['ucs', 'vports', 'tableStyles']);
    for (const table of TABLES.filter((t) => !unpurgeable.has(t)))
      expect(purgedPerTable.get(table) ?? 0, table).toBeGreaterThan(0);
  });
});
