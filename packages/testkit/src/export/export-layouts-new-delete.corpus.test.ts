// LAYOUT New and Delete on every readable public corpus file (M1-75 part 28): every layout but
// Model and the current one (on *Paper_Space) is deleted with its sheet, and a new layout is
// made with a line drawn on it. The reopened file has the new layout on a new *Paper_Space block
// listed in ACAD_LAYOUT, nothing of the deleted ones, and everything else exactly as read. A
// dangling reference the save left would read back as a changed field of the object holding it.
// A file before R2000, which introduced layouts, refuses both.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACadVersion, CadDictionary, type CadDocument, type CadObject } from '@node-projects/acad-ts';
import { ChangeSetBuilder, DocumentModel, type Layout, type LayoutPlot } from '@triya/engine';
import {
  documentInit,
  documentObjects,
  exportDocument,
  readCadDocument,
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

const comparable = ({ raw: _raw, ...rest }: Layout) => rest;

/** An A3 sheet at a custom scale (flag 16 off, so no DXF 75). */
const A3: LayoutPlot = {
  paperSize: 'ISO_A3_(420.00_x_297.00_MM)',
  paperWidth: 420,
  paperHeight: 297,
  margins: { left: 7.5, bottom: 20, right: 7.5, top: 20 },
  paperUnits: 'millimeters',
  rotation: 0,
  origin: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 },
  plotType: 5,
  flags: 688 & ~16,
};

let deletedLayouts = 0;
let madeLayouts = 0;

describe('TriyaToAcad LAYOUT New and Delete on the public corpus', () => {
  it.each(readable.map((f) => [f.path, f] as const))(
    'deletes the other layouts of %s and makes a new one',
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
        const deleted = model.layouts.filter(
          (l) => space(l) !== '*MODEL_SPACE' && space(l) !== '*PAPER_SPACE',
        );
        const layer0 = [...model.tables.layers.values()].find((l) => l.name === '0')!.handle;
        const b = new ChangeSetBuilder(model);
        for (const l of deleted) b.removeLayout(l.handle);
        const made = b.addLayout({
          name: 'Triya sheet',
          limits: { min: { x: 0, y: 0 }, max: { x: 420, y: 297 } },
          plot: A3,
        });
        const line = b.addEntity({
          owner: made.blockRecord,
          layer: layer0,
          geom: { kind: 'LINE', start: { x: 10, y: 10 }, end: { x: 410, y: 287 } },
        });
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
        expect(
          init.tables!.blockRecords!.find((r) => r.handle === made.blockRecord),
          f.path,
        ).toMatchObject({ name: model.tables.blockRecords.get(made.blockRecord)!.name });
        expect(init.entities!.find((e) => e.handle === line.handle)?.geom, f.path).toEqual(
          line.geom,
        );
        // A LAYOUT whose block record is missing maps no layout (ezdxf's
        // layout_missing_block_record.dxf, M2-49): kept as read, its entry stays.
        const layoutsOf = (d: CadDocument) =>
          d.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadLayout)!;
        const entries = (d: CadDocument) => [...layoutsOf(d).entryNames];
        const dict = layoutsOf(reopened);
        const mapped = new Set(documentInit(original).layouts!.map((l) => l.name));
        const unmapped = entries(original).filter((n) => !mapped.has(n));
        expect(entries(reopened).sort(), f.path).toEqual(
          [...model.layouts.map((l) => l.name), ...unmapped].sort(),
        );
        deletedLayouts += deleted.length;
        madeLayouts++;

        // Everything a deleted layout or its block owned goes with it.
        const going = new Set<CadObject>(
          deleted.flatMap((l) =>
            [l.handle, l.blockRecord].map((h) => original.getCadObject(Number.parseInt(h, 16))!),
          ),
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
        const back = documentObjects(reopened);
        expect(
          [...gone].filter((h) => back.has(h)).map((h) => h.toString(16)),
          f.path,
        ).toEqual([]);
        // ACAD_LAYOUT and the block record table list what they keep; what the save made is new.
        const before = documentObjects(original);
        const lists = new Set([dict.handle, original.blockRecords!.handle]);
        const added = [...back.keys()].filter((h) => !before.has(h));
        const pointsAtGone = (a: string | undefined) => {
          const h = /#([0-9A-F]+)$/.exec(a ?? '')?.[1];
          return h !== undefined && gone.has(Number.parseInt(h, 16));
        };
        const diff = structuralDiff(original, reopened, {
          ignoreHandles: new Set([...gone, ...lists, ...added]),
        }).differences.filter(
          (d) =>
            !(d.handle === '0' && d.path.startsWith('$HANDSEED')) &&
            // The tabs after a deleted one move up (checked against the model above).
            !(d.objectName === 'LAYOUT' && d.path === 'tabOrder') &&
            // A pointer an object Triya does not map held to an entity deleted with its sheet
            // reads back as none, as AutoCAD saves a pointer to an erased object.
            !(d.kind === 'value' && (d.b === '0' || d.b === 'null') && pointsAtGone(d.a)),
        );
        expect(diff.slice(0, 5), f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('deletes and makes layouts somewhere in the corpus', () => {
    expect(deletedLayouts).toBeGreaterThan(0);
    expect(madeLayouts).toBeGreaterThan(0);
  });
});
