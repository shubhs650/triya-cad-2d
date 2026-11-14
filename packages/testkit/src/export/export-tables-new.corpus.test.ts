// New tables on every readable public corpus file (M1-75 part 32): what COPY makes of each
// ACAD_TABLE in the drawing, and what the TABLE command adds to a drawing with a table style and
// no table, each on an anonymous `*T` block of its own that the same save adds. The new tables
// map back as they were saved and nothing else in the drawing changes. A DWG from R2010 states
// rotations and table-wide overrides in cell styles (M1-75 part 38) and cell formats in the new
// cells' own cell styles (M1-75 part 36), so a copy there carries all of them. A file before R14 holds no
// tables and refuses one.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACadVersion } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type Handle,
  type TableCell,
  type TableGeometry,
} from '@triya/engine';
import { documentInit, exportDocument, readCadDocument, type CadFormat } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/** Generous for the largest corpus files read three times and written twice under load. */
const PER_FILE_BUDGET_MS = 10_000;

type Table = Entity & { geom: TableGeometry };

const text = (t: string, more: Partial<TableCell> = {}): TableCell => ({
  type: 'text',
  text: t,
  rowSpan: 1,
  columnSpan: 1,
  merged: false,
  rotation: 0,
  ...more,
});

/** What the TABLE command leaves after typing: a title over two columns, a header and a row. */
const typed = (style: Handle, block: Handle): TableGeometry => ({
  kind: 'ACAD_TABLE',
  style,
  block,
  position: { x: 5, y: 5 },
  direction: { x: 1, y: 0 },
  rowHeights: [0.9, 0.6, 0.6],
  columnWidths: [2.5, 3],
  cells: [
    [text('Schedule', { columnSpan: 2 }), text('', { merged: true })],
    [text('Tag'), text('Size')],
    [text('T-1'), text('')],
  ],
});

describe('TriyaToAcad new tables on the public corpus', () => {
  it('finds files to copy tables in and files to add one to', () => {
    const files = readable.filter((f) =>
      /ACAD_TABLE/.test(readFileSync(`${corpusDir}${f.path}`, 'latin1')),
    );
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(readable.map((f) => [f.path, f] as const))(
    'adds new tables to %s',
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
        const open = () => DocumentModel.create(documentInit(readCadDocument(bytes)));
        const model = open();
        const style = [...model.tables.tableStyles.values()][0];
        const layer0 = [...model.tables.layers.values()].find((l) => l.name === '0');
        if (!style || !layer0) return;
        const modelSpace = [...model.blocks.values()].find(
          (d) => d.name.toUpperCase() === '*MODEL_SPACE',
        )!.handle;
        const tables = [...model.entities()].filter(
          (e): e is Table => e.geom.kind === 'ACAD_TABLE',
        );
        const names = new Set([...model.blocks.values()].map((d) => d.name.toUpperCase()));
        let n = 1000;
        const blockName = () => {
          while (names.has(`*T${n}`)) n++;
          names.add(`*T${n}`);
          return `*T${n}`;
        };

        /** Adds each table `geoms` gives on a new `*T` block; returns the new tables. */
        const add = (m: DocumentModel, geoms: ((block: Handle) => TableGeometry)[]) => {
          const b = new ChangeSetBuilder(m);
          const added = geoms.map((geom) => {
            const block = b.addBlock({ name: blockName(), basePoint: { x: 0, y: 0 }, flags: 1 });
            b.addEntity({
              owner: block.handle,
              layer: layer0.handle,
              geom: { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 5, y: -2 } },
            });
            return b.addEntity({
              owner: modelSpace,
              layer: layer0.handle,
              geom: geom(block.handle),
            });
          });
          m.apply(b.build());
          return added.map((t) => m.entity(t.id) as Table);
        };

        const copies = tables.map((t) => (block: Handle) => ({
          ...t.geom,
          block,
          position: { x: 0, y: -50 },
        }));
        if (version < ACadVersion.AC1014) {
          add(model, [(block) => typed(style.handle, block)]);
          expect(() => exportDocument(readCadDocument(bytes), model, options), f.path).toThrow(
            /holds no tables/,
          );
          return;
        }
        const added = add(
          model,
          tables.length === 0 ? [(block) => typed(style.handle, block)] : copies,
        );

        const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, options));
        const back = new Map(documentInit(reopened).entities?.map((e) => [e.handle, e.geom]));
        for (const t of added) expect(back.get(t.handle), `${f.path} ${t.handle}`).toEqual(t.geom);

        // Nothing else changes: model space, the block table and what the new tables bring.
        const ignoreHandles = new Set<number>([
          original.blockRecords!.handle,
          Number.parseInt(modelSpace, 16),
        ]);
        const seed = Number.parseInt(model.handSeed, 16);
        for (let h = seed - 4 * added.length; h < reopened.header!.handleSeed; h++)
          ignoreHandles.add(h);
        const diff = structuralDiff(original, reopened, { ignoreHandles }).differences.filter(
          (d) => !(d.handle === '0' && /^(\$HANDSEED|handleSeed|classes)/.test(d.path)),
        );
        expect(diff.slice(0, 5), f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );
});
