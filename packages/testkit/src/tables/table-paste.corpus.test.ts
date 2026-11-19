// PASTECLIP of a spreadsheet's cells on every readable public corpus file (M4-06): an equipment
// list copied in a spreadsheet, as its HTML table (a title merged across the columns, a cell
// spanning two rows, a cell with a line break, entities) and, separately, as its tab-separated
// rows, pasted as tables in the drawing's current table style (AutoCAD's Standard where it has
// none). The drawing is saved as AC1032 DXF (DEC-047) and read back by acad-ts: each table maps
// back as it was pasted, its block as the engine drew it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  htmlTableCells,
  type Entity,
  type TableGeometry,
  type ViewReply,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);
const PER_FILE_BUDGET_MS = 30_000;
/** Readable files that get the tables: all but the R1 and R2.5 ones, which have no text style. */
const PASTED = 119;

type Table = Entity & { geom: TableGeometry };

const HTML = `<html><body><!--StartFragment--><table>
<col width=80><col width=120><col width=64>
<tr><td colspan=3>EQUIPMENT LIST</td></tr>
<tr><td>TAG</td><td>DESCRIPTION</td><td>QTY</td></tr>
<tr><td rowspan=2>P-101</td><td>Pump &amp; motor<br>7.5&nbsp;kW</td><td>2</td></tr>
<tr><td>Spare seal {kit}</td><td>4</td></tr>
</table><!--EndFragment--></body></html>`;
const TSV = 'TAG\tDESCRIPTION\tQTY\r\nV-201\t"Vessel\r\n2 m³"\t1\r\nE-301\tHeat exchanger\t3\r\n';

/** Numbers to 9 significant figures, so geometry compares across the DXF's 16-digit text. */
function rounded(v: unknown): unknown {
  if (typeof v === 'number') return Number(v.toPrecision(9)) + 0;
  if (Array.isArray(v)) return v.map(rounded);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rounded(x)]));
  }
  return v;
}

const kept = (g: TableGeometry) => {
  const { block: _b, ...rest } = g;
  return rounded(rest);
};

const unedited = (bytes: Uint8Array) =>
  withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));

describe("PASTECLIP of a spreadsheet's cells on the public corpus (M4-06)", () => {
  let pasted = 0;
  const skipped: string[] = [];

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves the pasted tables, which read back as pasted',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = unedited(bytes);
      const zero = [...model.tables.layers.values()].some((l) => l.name === '0');
      const styleless = model.tables.tableStyles.size === 0 && model.tables.textStyles.size === 0;
      if (!zero || styleless) {
        skipped.push(f.path);
        return;
      }
      let reply: ViewReply = { ok: true, cells: htmlTableCells(HTML)! };
      const bus = new PromptBus({
        model,
        registry: builtinCommands(),
        view: {
          request: (r) =>
            Promise.resolve(r.op === 'clipboard' ? reply : { ok: false, message: 'no view' }),
        },
      });
      const before = new Set([...model.entities()].map((e) => e.id));
      for (const answer of ['PASTECLIP', '0,-500']) await bus.submit(answer);
      reply = { ok: true, text: TSV };
      for (const answer of ['PASTECLIP', '0,-1000']) await bus.submit(answer);
      expect(bus.promptText, f.path).toBe('Command:');
      const tables = [...model.entities()].filter(
        (e): e is Table => !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
      );
      expect(
        tables.map((t) => t.geom.cells.length),
        f.path,
      ).toEqual([4, 3]);
      expect(tables[0]!.geom.cells[2]![1]!.text).toBe('Pump & motor\\P7.5 kW');
      expect(tables[0]!.geom.cells[2]![0]).toMatchObject({ text: 'P-101', rowSpan: 2 });
      expect(tables[1]!.geom.cells[1]![1]!.text).toBe('Vessel\\P2 m³');

      const save = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      const back = unedited(save);
      for (const t of tables) {
        const reread = back.entityByHandle(t.handle) as Table | undefined;
        expect(reread, f.path).toBeDefined();
        expect(kept(reread!.geom), f.path).toEqual(kept(t.geom));
        expect(back.blockEntities(reread!.geom.block!).length, f.path).toBe(
          model.blockEntities(t.geom.block!).length,
        );
      }
      pasted++;
    },
    PER_FILE_BUDGET_MS,
  );

  it('pasted the tables in every drawing with a layer 0 and a text style', () => {
    expect({ pasted, skipped: skipped.length }).toEqual({ pasted: PASTED, skipped: 4 });
  });
});
