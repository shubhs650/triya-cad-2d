// The cell editor's added row saved (M4-05 part 2): Tab in a table's last cell adds a row, which
// the save writes as an inserted row (`rowOrigins`, DEC-046), for a table made in the drawing
// (-TABLE) and for one the drawing came with (acadsharp's AC1032 sample table A35). The drawing
// is saved as AC1032 DXF (DEC-047) and read back: the table has the row and its text.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  tableCellText,
  tableDrawingOf,
  tableToPlan,
  type Entity,
  type EntityId,
  type TableGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const FILE = 'public/third-party/acadsharp/sample_AC1032_ascii.dxf';

type Table = Entity & { geom: TableGeometry };

const read = (bytes: Uint8Array) =>
  withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));

/** Types `texts` into the cells from the open editor on, Tab between them. */
async function typeCells(bus: PromptBus, texts: readonly string[]): Promise<void> {
  for (const [k, value] of texts.entries()) {
    expect(bus.promptText).toBe('Enter text:');
    await bus.answer({
      kind: 'string',
      value,
      editor: true,
      ...(k < texts.length - 1 && { cell: 'next' as const }),
    });
  }
}

/** The table `handle` after a save and a read back. */
function saved(bytes: Uint8Array, model: DocumentModel, handle: string): TableGeometry {
  const back = read(withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model)));
  return (back.entityByHandle(handle) as Table).geom;
}

describe('a row added by Tab in the last cell (M4-05 part 2)', () => {
  const bytes = new Uint8Array(readFileSync(`${corpusDir}${FILE}`));

  it('saves in a table made in the drawing', async () => {
    const model = read(bytes);
    const before = new Set([...model.entities()].map((e) => e.id));
    const bus = new PromptBus({ model, registry: builtinCommands() });
    for (const a of ['-TABLE', '2', '1', '0,-500']) await bus.submit(a);
    // Title, two header cells, two data cells, then Tab: the new row's first cell.
    await typeCells(bus, ['T', 'A', 'B', '1', '2', '3']);
    const table = [...model.entities()].find(
      (e): e is Table => !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
    )!;
    expect(table.geom.rowOrigins).toEqual([0, 1, 2, null]);
    const g = saved(bytes, model, table.handle);
    expect(g.cells.map((r) => r.map((c) => c.text))).toEqual([
      ['T', ''],
      ['A', 'B'],
      ['1', '2'],
      ['3', ''],
    ]);
    expect(g.rowHeights).toHaveLength(4);
  });

  it('saves in a table the drawing came with', async () => {
    const model = read(bytes);
    const table = [...model.entities()].find(
      (e): e is Table => e.geom.kind === 'ACAD_TABLE' && e.handle === 'A35',
    )!;
    expect(table).toBeDefined();
    const rows = table.geom.rowHeights.length;
    const last = table.geom.cells[rows - 1]!;
    const lastColumn = last.length - 1 - [...last].reverse().findIndex((c) => !c.merged);
    const style = model.tables.tableStyles.get(table.geom.style!);
    const local = tableCellText(table.geom, style, tableDrawingOf(model), rows - 1, lastColumn);
    const id: EntityId = table.id;
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) =>
          Promise.resolve(
            r.op === 'pick' ? { ok: true, ids: [id] } : { ok: false, message: 'no view' },
          ),
      },
    });
    // TABLEDIT on its last cell, as a double click there opens it; Tab adds a row.
    await bus.submit('TABLEDIT');
    await bus.pick(tableToPlan(table.geom, local.position));
    // The pick is answered once the bus has asked the view what lies there.
    for (let k = 0; k < 100 && bus.promptText !== 'Enter text:'; k++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await typeCells(bus, [last[lastColumn]!.text, 'X']);
    const now = (model.entity(id) as Table).geom;
    expect(now.rowOrigins).toEqual([...Array(rows).keys(), null]);
    const g = saved(bytes, model, table.handle);
    expect(g.rowHeights).toHaveLength(rows + 1);
    expect(g.cells.at(-1)![0]!.text).toBe('X');
    expect(g.cells.slice(0, rows).map((r) => r.map((c) => c.text))).toEqual(
      table.geom.cells.map((r) => r.map((c) => c.text)),
    );
  });
});
