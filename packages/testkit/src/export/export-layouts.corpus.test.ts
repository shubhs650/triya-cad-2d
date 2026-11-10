// LAYOUT edits on every readable public corpus file (M1-75 part 20): what LAYOUT Rename,
// dragging layout tabs, PAGESETUP and LIMITS do. Every paper layout is renamed and the tabs run
// in reverse; each layout gets a custom-scale page setup and new limits, the current ones with
// the header's limits in step, as AutoCAD's LIMITS sets both. The edits map back and nothing
// else in the drawing changes. A file before R2000, which introduced layouts, refuses them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACadVersion, CadDictionary } from '@node-projects/acad-ts';
import { ChangeSetBuilder, DocumentModel, type Layout, type LayoutPlot } from '@triya/engine';
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

/** The header variables the current layouts' limits are kept in. */
const LIMITS = {
  '*MODEL_SPACE': ['$LIMMIN', '$LIMMAX'],
  '*PAPER_SPACE': ['$PLIMMIN', '$PLIMMAX'],
} as const;

const withoutStandardScale = ({ standardScaleType: _, ...plot }: LayoutPlot): LayoutPlot => plot;

const comparable = ({ raw: _raw, ...rest }: Layout) => rest;

describe('TriyaToAcad layout edits on the public corpus', () => {
  it.each(readable.map((f) => [f.path, f] as const))(
    'renames, reorders and sets up the layouts of %s',
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
        if (model.layouts.length === 0) return;
        const version = original.header?.version ?? ACadVersion.AC1032;
        const space = (l: Layout) =>
          model.tables.blockRecords.get(l.blockRecord)?.name.toUpperCase() ?? '';
        const paper = model.layouts.filter((l) => space(l) !== '*MODEL_SPACE');
        const header = new Map<string, { x: number; y: number }>();
        const b = new ChangeSetBuilder(model);
        for (const [i, l] of model.layouts.entries()) {
          const isModel = space(l) === '*MODEL_SPACE';
          const limits = { min: { x: -10 - i, y: -5 }, max: { x: 841 + i, y: 594 } };
          b.updateLayout(l.handle, {
            ...(isModel
              ? {}
              : { name: `${l.name} renamed`, tabOrder: paper.length - paper.indexOf(l) }),
            limits,
            plot: {
              // A custom scale drops the standard one DXF 75 named (M2-17 part 4).
              ...withoutStandardScale(l.plot!),
              paperSize: 'ISO_A1_(841.00_x_594.00_MM)',
              paperWidth: 841,
              paperHeight: 594,
              margins: { left: 5, bottom: 7.5, right: 5, top: 7.5 },
              paperUnits: 'millimeters',
              rotation: 1,
              origin: { x: 1.5, y: -2 },
              scale: { numerator: 1, denominator: 7 + i },
              plotType: isModel ? 1 : 2,
              flags: l.plot!.flags & ~16, // a custom scale
            },
          });
          const vars = LIMITS[space(l) as keyof typeof LIMITS];
          if (vars) {
            header.set(vars[0], limits.min);
            header.set(vars[1], limits.max);
          }
        }
        for (const [name, value] of header) b.setHeader(name, value);
        model.apply(b.build());
        if (version < ACadVersion.AC1015) {
          expect(() => exportDocument(readCadDocument(bytes), model, options)).toThrow(
            /has no layouts \(R2000 added them\)/,
          );
          return;
        }

        const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, options));
        const init = documentInit(reopened);
        expect(init.layouts!.map(comparable), f.path).toEqual(model.layouts.map(comparable));
        const backHeader = new Map(init.header);
        for (const [name, value] of header) expect(backHeader.get(name), f.path).toEqual(value);
        // The ACAD_LAYOUT dictionary lists the same layouts, in the same order, under new names.
        const dict = original.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadLayout)!;
        const back = reopened.getCadObject(dict.handle) as CadDictionary;
        const nameOf = new Map(model.layouts.map((l) => [Number.parseInt(l.handle, 16), l.name]));
        expect({ names: back.entryNames, handles: back.entryHandles }, f.path).toEqual({
          names: dict.entryNames.map((n, i) => nameOf.get(dict.entryHandles[i]!) ?? n),
          handles: dict.entryHandles,
        });
        // Nothing else changes: the layouts, their dictionary and the limits variables are the edit.
        const ignoreHandles = new Set([...nameOf.keys(), dict.handle]);
        const diff = structuralDiff(original, reopened, { ignoreHandles }).differences.filter(
          (d) =>
            d.handle !== '0' ||
            ![...header.keys()].some((n) => d.path === n || d.path.startsWith(`${n}.`)),
        );
        expect(diff.slice(0, 5), f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );
});
