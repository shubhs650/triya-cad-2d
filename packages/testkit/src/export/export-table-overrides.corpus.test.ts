// Table-wide override and cell rotation edits on every readable public corpus file (M1-75 part
// 38): what the Properties palette sets with a whole table selected, and a cell's rotation. In
// every ACAD_TABLE the margins grow, the title rows get another text height, the data rows
// another alignment and the header rows lose their overrides, each row type's values carried
// into the formats of its cells (rows by place: title, header, data), as AutoCAD keeps them; the
// first plain cell is turned a quarter. The edits map back and nothing else in the drawing
// changes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type TableGeometry,
  type TableOverrides,
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

const ROW_TYPES = ['title', 'header', 'data'] as const;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The edited overrides of `g`, as the top of this file says. */
function overrides(g: TableGeometry): TableOverrides {
  const o = g.overrides;
  const h = (o?.margins?.left ?? 0.05) + 0.01;
  const v = (o?.margins?.top ?? 0.03) + 0.01;
  const { header: _header, ...rest } = o ?? {};
  return {
    ...rest,
    margins: { left: h, top: v, right: h, bottom: v },
    title: { ...o?.title, textHeight: (o?.title?.textHeight ?? 0.2) * 1.5 },
    data: { ...o?.data, alignment: o?.data?.alignment === 5 ? 4 : 5 },
  };
}

/** `g` with overrides `o`, each row type's values carried into its cells, and a cell turned. */
function edited(g: TableGeometry): TableGeometry {
  const was = g.overrides;
  const o = overrides(g);
  const turned = g.cells
    .flatMap((row, i) => row.map((c, j) => ({ c, i, j })))
    .find(({ c }) => !c.merged && c.rowSpan === 1 && c.columnSpan === 1);
  return {
    ...g,
    overrides: o,
    cells: g.cells.map((row, i) =>
      row.map((c, j) => {
        const type = ROW_TYPES[Math.min(i, 2)]!;
        const old = (was?.[type] ?? {}) as Record<string, unknown>;
        const own = Object.fromEntries(
          Object.entries(c.format ?? {}).filter(([k, x]) => !same(x, old[k])),
        );
        const format = { ...o[type], ...own };
        const { format: _f, ...plain } = c;
        const rotation = turned && turned.i === i && turned.j === j ? Math.PI / 2 : c.rotation;
        return Object.keys(format).length > 0
          ? { ...plain, rotation, format }
          : { ...plain, rotation };
      }),
    ),
  };
}

describe('TriyaToAcad table-wide override edits on the public corpus', () => {
  it('finds tables in the corpus', () => {
    const files = readable.filter((f) =>
      /ACAD_TABLE/.test(readFileSync(`${corpusDir}${f.path}`, 'latin1')),
    );
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(readable.map((f) => [f.path, f] as const))(
    'changes the table-wide overrides and turns a cell of the tables of %s',
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
        const b = new ChangeSetBuilder(model);
        for (const t of tables) b.updateEntity(t.id, { geom: edited(t.geom) });
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
