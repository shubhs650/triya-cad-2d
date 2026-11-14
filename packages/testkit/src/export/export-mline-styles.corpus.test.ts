// MLSTYLE on every readable public corpus file (M1-75 part 31): every MLINE style gets a new
// description (which AutoCAD lets change even on Standard and on a style in use), and a new
// three-line style is made current ($CMLSTYLE), as MLSTYLE New and Set Current do. The reopened
// file maps the styles back as edited, lists the new one in ACAD_MLINESTYLE, and has everything
// else exactly as read. A file before R13, which has no MLINE styles, refuses the new one.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACadVersion } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type MLineStyleElement,
  type MLineStyleRecord,
} from '@triya/engine';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  UnsupportedChangeError,
  type CadFormat,
} from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/** Generous for the largest corpus files read three times and written once under load. */
const PER_FILE_BUDGET_MS = 15_000;

const DEG = Math.PI / 180;

/** A record without the reader's link, its keys sorted (a new record's are in builder order). */
const comparable = ({ raw: _raw, ...rest }: MLineStyleRecord): string =>
  JSON.stringify(Object.fromEntries(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b))));

let edited = 0;
let made = 0;
let refused = 0;

describe('TriyaToAcad MLINE styles on the public corpus', () => {
  it.each(readable.map((f) => [f.path, f] as const))(
    'describes every MLINE style of %s and makes a new current one',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const { format } = sniffCadFile(bytes);
      const options = {
        format: (format === 'dwg' ? 'dwg' : 'dxf') as CadFormat,
        binary: format === 'dxf-binary',
      };
      withPinnedClock(() => {
        const original = readCadDocument(bytes);
        const version = original.header?.version ?? ACadVersion.AC1032;
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const styles = [...model.tables.mlineStyles.values()];
        const byLayer = [...model.tables.linetypes.values()].find(
          (l) => l.name.toUpperCase() === 'BYLAYER',
        );
        const b = new ChangeSetBuilder(model);
        for (const s of styles)
          b.updateTableRecord('mlineStyles', s.handle, {
            description: `${s.description} (edited)`,
          });
        const added = b.addTableRecord('mlineStyles', {
          name: 'TRIYA CAVITY',
          description: 'Two leaves and a cavity line',
          styleFlags: 1 | 2 | 16 | 1024,
          fillColor: { kind: 'aci', index: 9 },
          startAngle: 90 * DEG,
          endAngle: 45 * DEG,
          elements: (
            [
              { offset: 0.15, color: { kind: 'aci', index: 1 } },
              { offset: 0, color: { kind: 'byBlock' } },
              { offset: -0.15, color: { kind: 'byLayer' } },
            ] as MLineStyleElement[]
          ).map((e) => (byLayer ? { ...e, linetype: byLayer.handle } : e)),
        }).handle;
        b.setHeader('$CMLSTYLE', 'TRIYA CAVITY');
        model.apply(b.build());

        if (version < ACadVersion.AC1012) {
          let problems: readonly string[] = [];
          try {
            exportDocument(readCadDocument(bytes), model, options);
          } catch (e) {
            if (!(e instanceof UnsupportedChangeError)) throw e;
            problems = e.problems;
          }
          expect(problems.join('\n'), f.path).toMatch(
            /has no MLINE styles \(R13 introduced them\)/,
          );
          refused++;
          return;
        }

        const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, options));
        const init = documentInit(reopened);
        const back = new Map(init.tables?.mlineStyles?.map((s) => [s.handle, s]));
        const wrong = [...styles.map((s) => s.handle), added]
          .map((h) => model.tables.mlineStyles.get(h)!)
          .filter((s) => {
            const got = back.get(s.handle);
            return !got || comparable(got) !== comparable(s);
          })
          .map((s) => s.name);
        expect(wrong, f.path).toEqual([]);
        expect(new Map(init.header).get('$CMLSTYLE'), f.path).toBe('TRIYA CAVITY');
        edited += styles.length;
        made++;

        // The styles, the dictionary that lists them (the new entry, or a new dictionary in a
        // file without one), and the root dictionary when that is new, are the edit.
        const dictionary = reopened.rootDictionary?.get('ACAD_MLINESTYLE');
        const ignoreHandles = new Set([
          ...styles.map((s) => Number.parseInt(s.handle, 16)),
          Number.parseInt(added, 16),
          ...(dictionary ? [dictionary.handle] : []),
          ...(original.rootDictionary?.get('ACAD_MLINESTYLE') || !reopened.rootDictionary
            ? []
            : [reopened.rootDictionary.handle]),
        ]);
        const diff = structuralDiff(original, reopened, { ignoreHandles }).differences.filter(
          (d) =>
            !(
              d.handle === '0' &&
              ['$HANDSEED', '$CMLSTYLE', '_currentMLineStyle'].some(
                (n) => d.path === n || d.path.startsWith(`${n}.`),
              )
            ),
        );
        expect(diff.slice(0, 5), f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('edited and made styles across the corpus', () => {
    // A few files have no MLINE style (an R13+ DXF without the dictionary): the save makes it.
    expect(made).toBeGreaterThan(50);
    expect(edited).toBeGreaterThan(50);
    expect(refused).toBeGreaterThan(0);
  });
});
