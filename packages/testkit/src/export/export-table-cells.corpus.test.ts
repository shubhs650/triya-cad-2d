// Table cell edits on every readable public corpus file (M1-75 part 26): what Merge Cells,
// Unmerge Cells and the Table Cell ribbon's cell format controls do. In every ACAD_TABLE the
// first merge is unmerged, the last two plain cells of the last row are merged, one plain cell
// gets another alignment, a red content colour and a 0.50 mm top edge, and the first other cell
// with a format loses it. The edits map back and nothing else in the drawing changes. A DWG from
// R2010 states cell formats in cell styles (M1-75 part 36), where a cell cannot take off what
// its row states: there the cell losing its format keeps what its row gives it, which in the
// corpus tables is the table-wide override of its row type (rows by place: title, header, data).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACadVersion } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type TableCell,
  type TableCellFormat,
  type TableGeometry,
} from '@triya/engine';
import { documentInit, exportDocument, readCadDocument, type CadFormat } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

/** Generous for the largest corpus files read three times and written twice under load. */
const PER_FILE_BUDGET_MS = 10_000;

type Table = Entity & { geom: TableGeometry };

const plain = (c: TableCell | undefined): boolean =>
  c !== undefined && !c.merged && c.rowSpan === 1 && c.columnSpan === 1;

/** `g` with each cell `change` returns a value for replaced. */
function cells(
  g: TableGeometry,
  change: (c: TableCell, i: number, j: number) => TableCell | undefined,
): TableGeometry {
  return {
    ...g,
    cells: g.cells.map((row, i) => row.map((c, j) => change(c, i, j) ?? c)),
  };
}

/** The first merge undone, and the last row's last two plain cells merged. */
function merged(g: TableGeometry): TableGeometry {
  let out = g;
  const head = g.cells
    .flatMap((row, i) => row.map((c, j) => ({ c, i, j })))
    .find(({ c }) => c.rowSpan > 1 || c.columnSpan > 1);
  if (head) {
    const { i: top, j: left, c } = head;
    out = cells(out, (x, i, j) => {
      if (i < top || i >= top + c.rowSpan || j < left || j >= left + c.columnSpan) return;
      return i === top && j === left
        ? { ...x, rowSpan: 1, columnSpan: 1 }
        : { ...x, merged: false };
    });
  }
  const last = out.cells.length - 1;
  const row = out.cells[last]!;
  const j = row.length - 2;
  if (j >= 0 && plain(row[j]) && plain(row[j + 1])) {
    out = cells(out, (x, i, k) => {
      if (i !== last) return;
      if (k === j) return { ...x, columnSpan: 2 };
      if (k === j + 1) return { ...x, merged: true };
      return;
    });
  }
  return out;
}

/** The table-wide override of row `i`'s type, by place: what a DWG from R2010 row gives a cell. */
const rowTypeFormat = (g: TableGeometry, i: number): TableCellFormat | undefined =>
  i === 0 ? g.overrides?.title : i === 1 ? g.overrides?.header : g.overrides?.data;

/**
 * One plain cell's format changed, and the first other cell with a format left without, or with
 * only what its row gives it (`dwgFrom2010`).
 */
function formatted(g: TableGeometry, dwgFrom2010: boolean): TableGeometry {
  const all = g.cells.flatMap((row, i) => row.map((c, j) => ({ c, i, j })));
  const target = all.find(({ c }) => plain(c));
  const cleared = all.find(({ c }) => c.format !== undefined && c !== target?.c);
  return cells(g, (c, i, j) => {
    if (target && i === target.i && j === target.j) {
      return {
        ...c,
        format: {
          ...c.format,
          alignment: c.format?.alignment === 5 ? 4 : 5,
          contentColor: { kind: 'aci', index: 1 },
          borders: { ...c.format?.borders, top: { ...c.format?.borders?.top, lineweight: 50 } },
        },
      };
    }
    if (cleared && i === cleared.i && j === cleared.j) {
      const { format: _format, ...rest } = c;
      const kept = dwgFrom2010 ? rowTypeFormat(g, i) : undefined;
      return kept ? { ...rest, format: kept } : rest;
    }
    return;
  });
}

describe('TriyaToAcad table cell edits on the public corpus', () => {
  it('finds tables with merges and cell formats in the corpus', () => {
    const files = readable.filter((f) =>
      /ACAD_TABLE/.test(readFileSync(`${corpusDir}${f.path}`, 'latin1')),
    );
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(readable.map((f) => [f.path, f] as const))(
    'merges, unmerges and formats the table cells of %s',
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
        const tables = [...model.entities()].filter(
          (e): e is Table => e.geom.kind === 'ACAD_TABLE',
        );
        if (tables.length === 0) return;
        const version = original.header?.version ?? ACadVersion.AC1032;
        const dwgFrom2010 = options.format === 'dwg' && version >= ACadVersion.AC1024;

        const b = new ChangeSetBuilder(model);
        for (const t of tables) {
          b.updateEntity(t.id, { geom: formatted(merged(t.geom), dwgFrom2010) });
        }
        model.apply(b.build());
        const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, options));
        const back = new Map(documentInit(reopened).entities?.map((e) => [e.handle, e.geom]));
        for (const t of tables) {
          expect(back.get(t.handle), `${f.path} ${t.handle}`).toEqual(
            model.entityByHandle(t.handle)!.geom,
          );
        }
        // Nothing else changes: the tables are the edit.
        const ignoreHandles = new Set(tables.map((t) => Number.parseInt(t.handle, 16)));
        const diff = structuralDiff(original, reopened, { ignoreHandles }).differences.filter(
          (d) => !(d.handle === '0' && d.path.startsWith('$HANDSEED')),
        );
        expect(diff.slice(0, 5), f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );
});
