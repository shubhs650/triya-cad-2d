// Table rows and columns inserted and deleted on every readable public corpus file (M1-75 part
// 34): what the Table Cell ribbon's Insert Below, Insert Right and Delete Rows do. In every
// ACAD_TABLE a row is inserted below the last one, a column right of the first one (widening a
// merge it falls inside), and the last plain row left of the old ones is deleted. The tables map
// back as edited and nothing else in the drawing changes.
//
// A new cell takes the format of the cell it is inserted next to, as AutoCAD formats an inserted
// row or column like its neighbour. A DWG from R2010 states formats in cell styles, which are not
// written yet: there a new row or column takes its neighbour's cell style, and a new cell maps
// with what its row gives it, which in the corpus tables is the table-wide override of its row
// type (rows by place: title, header, then data, as every corpus table has them).
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

/** What a new cell holds: `text`, or the block of `like` when that is a block cell. */
function newCell(like: TableCell, text: string, format: TableCellFormat | undefined): TableCell {
  return {
    type: like.type,
    text: like.type === 'block' ? '' : text,
    ...(like.type === 'block' && like.block ? { block: like.block } : {}),
    rowSpan: 1,
    columnSpan: 1,
    merged: false,
    rotation: 0,
    ...(format ? { format } : {}),
  };
}

/** The table-wide override of row `i`'s type, by place: what a DWG from R2010 gives a new cell. */
const rowTypeFormat = (g: TableGeometry, i: number): TableCellFormat | undefined =>
  i === 0 ? g.overrides?.title : i === 1 ? g.overrides?.header : g.overrides?.data;

/** A row inserted below the last one, its cells like the last row's. */
function rowBelow(g: TableGeometry, dwgFrom2010: boolean): TableGeometry {
  const last = g.cells.length - 1;
  const row = g.cells[last]!.map((c, j) =>
    newCell(c, `R+${j}`, dwgFrom2010 ? rowTypeFormat(g, last + 1) : c.format),
  );
  return {
    ...g,
    rowHeights: [...g.rowHeights, g.rowHeights[last]!],
    cells: [...g.cells, row],
    rowOrigins: [...(g.rowOrigins ?? g.cells.map((_, i) => i)), null],
  };
}

/** A column inserted right of the first one; a merge it falls inside widens over it. */
function columnRight(g: TableGeometry, dwgFrom2010: boolean): TableGeometry {
  const covered = new Set<number>();
  const cells = g.cells.map((row) => [...row]);
  for (const [i, row] of g.cells.entries()) {
    const head = row[0]!;
    if (head.columnSpan > 1) {
      cells[i]![0] = { ...head, columnSpan: head.columnSpan + 1 };
      for (let k = i; k < i + head.rowSpan; k++) covered.add(k);
    }
  }
  return {
    ...g,
    columnWidths: [g.columnWidths[0]!, g.columnWidths[0]!, ...g.columnWidths.slice(1)],
    cells: cells.map((row, i) => {
      const fresh = newCell(
        { ...row[0]!, type: 'text' },
        i === 0 ? '' : `C+${i}`,
        dwgFrom2010 ? rowTypeFormat(g, i) : row[0]!.format,
      );
      const cell = covered.has(i) ? { ...fresh, text: '', merged: true } : fresh;
      return [row[0]!, cell, ...row.slice(1)];
    }),
    columnOrigins: [0, null, ...g.columnWidths.slice(1).map((_, j) => j + 1)],
  };
}

/** The last row of the table as read, other than the first, whose cells are all plain. */
function rowDeleted(g: TableGeometry): TableGeometry {
  const origins = g.rowOrigins ?? g.cells.map((_, i) => i);
  const plain = (row: readonly TableCell[]) =>
    row.every((c) => !c.merged && c.rowSpan === 1 && c.columnSpan === 1);
  let at = -1;
  for (let i = g.cells.length - 1; i > 0; i--) {
    if (origins[i] !== null && plain(g.cells[i]!)) {
      at = i;
      break;
    }
  }
  if (at < 0) return g;
  const without = <T>(xs: readonly T[]) => xs.filter((_, i) => i !== at);
  return {
    ...g,
    rowHeights: without(g.rowHeights),
    cells: without(g.cells),
    rowOrigins: without(origins),
  };
}

/** `g` as the file states it: without where its rows and columns came from. */
function stated(g: TableGeometry): TableGeometry {
  const { rowOrigins: _r, columnOrigins: _c, ...rest } = g;
  return rest;
}

describe('TriyaToAcad table rows and columns on the public corpus', () => {
  it('finds tables in the corpus', () => {
    const files = readable.filter((f) =>
      /ACAD_TABLE/.test(readFileSync(`${corpusDir}${f.path}`, 'latin1')),
    );
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(readable.map((f) => [f.path, f] as const))(
    'inserts and deletes table rows and columns in %s',
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
          b.updateEntity(t.id, {
            geom: rowDeleted(columnRight(rowBelow(t.geom, dwgFrom2010), dwgFrom2010)),
          });
        }
        model.apply(b.build());
        const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, options));
        const back = new Map(documentInit(reopened).entities?.map((e) => [e.handle, e.geom]));
        for (const t of tables) {
          const g = model.entityByHandle(t.handle)!.geom as TableGeometry;
          expect(g.cells.length, `${f.path} ${t.handle}`).toBeGreaterThan(0);
          expect(back.get(t.handle), `${f.path} ${t.handle}`).toEqual(stated(g));
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
