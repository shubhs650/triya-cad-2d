// The cell editor's added row saved (M4-05 part 2), rows and columns inserted and deleted and
// cells merged (part 3), cells formatted, grips dragged and the table scaled (part 4), cell grips
// dragged, Ctrl with a column grip and a spreadsheet's cells pasted into cells (part 6, M4-13): Tab in a table's last cell adds a row, which
// the save writes as an inserted row (`rowOrigins`, DEC-046), for a table made in the drawing
// (-TABLE) and for one the drawing came with (acadsharp's AC1032 sample table A35). The drawing
// is saved as AC1032 DXF (DEC-047) and read back: the table is as edited.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  tableCellBox,
  tableCellGrips,
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

/** Each cell's text, `^` for a covered one, a merged head's span after it. */
const layout = (g: TableGeometry) =>
  g.cells.map((r) =>
    r.map((c) =>
      c.merged
        ? '^'
        : `${c.text}${c.rowSpan * c.columnSpan > 1 ? `/${c.rowSpan}x${c.columnSpan}` : ''}`,
    ),
  );

describe('rows and columns inserted and deleted, cells merged (M4-05 part 3)', () => {
  const bytes = new Uint8Array(readFileSync(`${corpusDir}${FILE}`));

  /** The bus with table `id` picked wherever the view is asked, and TABLECELL's steps on it. */
  function cells(model: DocumentModel, id: () => EntityId | undefined) {
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) =>
          Promise.resolve(
            r.op === 'pick' ? { ok: true, ids: [] } : { ok: false, message: 'no view' },
          ),
      },
    });
    const centre = (i: number, j: number) => {
      const g = (model.entity(id()!) as Table).geom;
      const style = g.style !== undefined ? model.tables.tableStyles.get(g.style) : undefined;
      const b = tableCellBox(g, style, { r0: i, c0: j, r1: i, c1: j });
      return tableToPlan(g, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
    };
    /** Selects cells (`a` to `b`) and runs `option` on them. */
    const run = async (a: [number, number], b: [number, number], option: string) => {
      await bus.pick(centre(...a), { grip: 1e-6 });
      expect(bus.command).toBe('TABLECELL');
      if (b !== a) await bus.pick(centre(...b), { shift: true });
      await bus.submit(option);
      expect(bus.promptText).toBe('Command:');
    };
    return { bus, run };
  }

  it('saves in a table made in the drawing', async () => {
    const model = read(bytes);
    const before = new Set([...model.entities()].map((e) => e.id));
    const made = () =>
      [...model.entities()].find(
        (e): e is Table => !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
      );
    const { bus, run } = cells(model, () => made()?.id);
    for (const a of ['-TABLE', '3', '3', '0,-500']) await bus.submit(a);
    await typeCells(bus, ['T', 'A', 'B', 'C', '1', '2', '3', '4', '5', '6']);
    await run([2, 0], [3, 1], 'MA');
    await run([2, 2], [2, 2], 'R');
    await run([4, 0], [4, 0], 'B');
    await run([1, 1], [1, 1], 'DC');
    const g = made()!.geom;
    expect(layout(g)).toEqual([
      ['T/1x3', '^', '^'],
      ['A', 'C', ''],
      ['1/2x1', '3', ''],
      ['^', '6', ''],
      ['', '', ''],
      ['', '', ''],
    ]);
    const back = saved(bytes, model, made()!.handle);
    expect(layout(back)).toEqual(layout(g));
    expect(back.columnWidths).toEqual(g.columnWidths);
    expect(back.rowHeights).toEqual(g.rowHeights);
  });

  it('saves in a table the drawing came with', async () => {
    const model = read(bytes);
    const table = [...model.entities()].find(
      (e): e is Table => e.geom.kind === 'ACAD_TABLE' && e.handle === 'A35',
    )!;
    const { run } = cells(model, () => table.id);
    const rows = table.geom.rowHeights.length;
    const columns = table.geom.columnWidths.length;
    await run([rows - 1, 0], [rows - 1, 0], 'B');
    await run([rows - 1, columns - 1], [rows - 1, columns - 1], 'R');
    await run([rows, 0], [rows, 1], 'MA');
    const g = (model.entity(table.id) as Table).geom;
    expect(g.rowHeights).toHaveLength(rows + 1);
    expect(g.columnWidths).toHaveLength(columns + 1);
    expect(g.cells[rows]![0]).toMatchObject({ columnSpan: 2 });
    const back = saved(bytes, model, table.handle);
    expect(layout(back)).toEqual(layout(g));
    expect(back.columnWidths).toEqual(g.columnWidths);
  });
});

describe('cells formatted, grips dragged and the table scaled (M4-05 part 4)', () => {
  const bytes = new Uint8Array(readFileSync(`${corpusDir}${FILE}`));

  /** Formats table `id`'s cells, drags a column grip and SCALEs it, as a drafter would. */
  async function edit(model: DocumentModel, id: () => EntityId) {
    let picked: EntityId[] = [];
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) =>
          Promise.resolve(
            r.op === 'pick' ? { ok: true, ids: picked } : { ok: false, message: 'no view' },
          ),
      },
    });
    const g = () => (model.entity(id()) as Table).geom;
    const style = () => model.tables.tableStyles.get(g().style!);
    const box = (i: number, j: number) =>
      tableCellBox(g(), style(), { r0: i, c0: j, r1: i, c1: j });
    const centre = (i: number, j: number) => {
      const b = box(i, j);
      return tableToPlan(g(), { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
    };
    const run = async (a: [number, number], b: [number, number], ...answers: string[]) => {
      await bus.pick(centre(...a), { grip: 1e-6 });
      expect(bus.command).toBe('TABLECELL');
      if (b !== a) await bus.pick(centre(...b), { shift: true });
      for (const x of answers) await bus.submit(x);
      expect(bus.promptText).toBe('Command:');
    };
    const rows = g().rowHeights.length;
    const last = rows - 1;
    await run([last - 1, 0], [last, 1], 'AL', 'MR');
    await run([last, 0], [last, 0], 'BA', '3');
    await run([last - 1, 0], [last, 1], 'BO', 'O', '1', '0.5');
    await run([last, 1], [last, 1], 'H', String(box(last, 1).maxY - box(last, 1).minY));
    // The table picked on its left edge, its first column grip dragged, then SCALE.
    picked = [id()];
    await bus.pick(tableToPlan(g(), { x: 0, y: (box(last, 0).minY + box(last, 0).maxY) / 2 }), {
      grip: 1e-6,
    });
    picked = [];
    const grip = tableToPlan(g(), { x: g().columnWidths[0]!, y: 0 });
    await bus.pick(grip, { grip: 1e-6 });
    expect(bus.command).toBe('GRIP');
    await bus.pick({ x: grip.x + g().columnWidths[0]! / 4, y: grip.y });
    await bus.submit('SCALE');
    await bus.submit(`${g().position.x},${g().position.y}`);
    await bus.submit('1.5');
    expect(bus.promptText).toBe('Command:');
    return g();
  }

  /** What a save keeps of a table's edits. */
  const kept = (t: TableGeometry) => ({
    columnWidths: t.columnWidths.map((w) => +w.toFixed(6)),
    rowHeights: t.rowHeights.map((h) => +h.toFixed(6)),
    formats: t.cells.map((r) => r.map((c) => c.format)),
    margins: t.overrides?.margins,
  });

  it('saves in a table made in the drawing', async () => {
    const model = read(bytes);
    const before = new Set([...model.entities()].map((e) => e.id));
    const bus = new PromptBus({ model, registry: builtinCommands() });
    for (const a of ['-TABLE', '2', '2', '0,-500']) await bus.submit(a);
    await typeCells(bus, ['T', 'A', 'B', '1', '2', '3', '4']);
    const made = [...model.entities()].find(
      (e): e is Table => !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
    )!;
    const g = await edit(model, () => made.id);
    expect(g.cells[3]![0]!.format).toMatchObject({
      alignment: 6,
      background: { kind: 'aci', index: 3 },
      borders: { bottom: { color: { kind: 'aci', index: 1 }, lineweight: 50 } },
    });
    expect(g.overrides?.margins?.left).toBeCloseTo(0.09);
    const back = saved(bytes, model, made.handle);
    expect(kept(back)).toEqual(kept(g));
  });

  it('saves in a table the drawing came with', async () => {
    const model = read(bytes);
    const table = [...model.entities()].find(
      (e): e is Table => e.geom.kind === 'ACAD_TABLE' && e.handle === 'A35',
    )!;
    const was = table.geom;
    const g = await edit(model, () => table.id);
    expect(g.columnWidths[0]).toBeCloseTo(was.columnWidths[0]! * 1.25 * 1.5);
    const back = saved(bytes, model, table.handle);
    expect(kept(back)).toEqual(kept(g));
  });
});

describe('cell grips, Ctrl with a column grip and cells pasted (M4-05 part 6, M4-13)', () => {
  const bytes = new Uint8Array(readFileSync(`${corpusDir}${FILE}`));
  const sheet = (rows: string[][]) =>
    rows.map((r) => r.map((text) => ({ text, rowSpan: 1, columnSpan: 1, merged: false })));

  /**
   * Drags the last cell's right and bottom grips, pastes three rows of three cells into the last
   * row's first cell (adding rows and a column), and widens the first column with Ctrl.
   */
  async function edit(model: DocumentModel, id: () => EntityId) {
    let picked: EntityId[] = [];
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) =>
          Promise.resolve(
            r.op === 'pick'
              ? { ok: true, ids: picked }
              : r.op === 'clipboard'
                ? {
                    ok: true,
                    cells: sheet([
                      ['P1', 'Q1', 'R1'],
                      ['P2', 'Q2', 'R2'],
                      ['P3', 'Q3', 'R3'],
                    ]),
                  }
                : { ok: false, message: 'no view' },
          ),
      },
    });
    const g = () => (model.entity(id()) as Table).geom;
    const style = () => model.tables.tableStyles.get(g().style!);
    const one = (i: number, j: number) => ({ r0: i, c0: j, r1: i, c1: j });
    const centre = (i: number, j: number) => {
      const b = tableCellBox(g(), style(), one(i, j));
      return tableToPlan(g(), { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
    };
    const last = g().rowHeights.length - 1;
    const columns = g().columnWidths.length;
    // The right grip half a column further, the bottom one a row lower.
    const w = g().columnWidths[columns - 1]!;
    const h = g().rowHeights[last]!;
    for (const [k, d] of [
      [1, { x: w / 2, y: 0 }],
      [2, { x: 0, y: -h }],
    ] as const) {
      await bus.pick(centre(last, columns - 1), { grip: 1e-6 });
      const grip = tableCellGrips(g(), style(), one(last, columns - 1))[k]!.point;
      await bus.pick(grip);
      await bus.pick({ x: grip.x + d.x, y: grip.y + d.y });
      expect(bus.promptText).toBe('Command:');
    }
    await bus.pick(centre(last, 0), { grip: 1e-6 });
    await bus.submit('P');
    expect(bus.promptText).toBe('Command:');
    // Ctrl with the first column grip: the column a quarter wider, the table with it.
    picked = [id()];
    await bus.pick(
      tableToPlan(g(), {
        x: 0,
        y:
          (tableCellBox(g(), style(), one(last, 0)).minY +
            tableCellBox(g(), style(), one(last, 0)).maxY) /
          2,
      }),
      {
        grip: 1e-6,
      },
    );
    picked = [];
    const grip = tableToPlan(g(), { x: g().columnWidths[0]!, y: 0 });
    await bus.pick(grip, { grip: 1e-6 });
    await bus.pick({ x: grip.x + g().columnWidths[0]! / 4, y: grip.y }, { ctrl: true });
    expect(bus.promptText).toBe('Command:');
    return g();
  }

  /** What a save keeps of a table's edits. */
  const kept = (t: TableGeometry) => ({
    position: { x: +t.position.x.toFixed(6), y: +t.position.y.toFixed(6) },
    columnWidths: t.columnWidths.map((w) => +w.toFixed(6)),
    rowHeights: t.rowHeights.map((h) => +h.toFixed(6)),
    texts: t.cells.map((r) => r.map((c) => (c.merged ? '^' : c.text))),
  });

  it('saves in a table made in the drawing', async () => {
    const model = read(bytes);
    const before = new Set([...model.entities()].map((e) => e.id));
    const bus = new PromptBus({ model, registry: builtinCommands() });
    for (const a of ['-TABLE', '2', '1', '0,-500']) await bus.submit(a);
    await typeCells(bus, ['T', 'A', 'B', '1', '2']);
    const made = [...model.entities()].find(
      (e): e is Table => !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
    )!;
    const was = made.geom;
    const g = await edit(model, () => made.id);
    expect(g.columnWidths).toEqual([
      was.columnWidths[0]! * 1.25,
      was.columnWidths[1]! * 1.5,
      was.columnWidths[1]! * 1.5,
    ]);
    expect(g.rowHeights).toHaveLength(5);
    expect(kept(g).texts.slice(2)).toEqual([
      ['P1', 'Q1', 'R1'],
      ['P2', 'Q2', 'R2'],
      ['P3', 'Q3', 'R3'],
    ]);
    const back = saved(bytes, model, made.handle);
    expect(kept(back)).toEqual(kept(g));
  });

  it('saves in a table the drawing came with', async () => {
    const model = read(bytes);
    const table = [...model.entities()].find(
      (e): e is Table => e.geom.kind === 'ACAD_TABLE' && e.handle === 'A35',
    )!;
    const was = table.geom;
    const g = await edit(model, () => table.id);
    expect(g.rowHeights.length).toBe(was.rowHeights.length + 2);
    const back = saved(bytes, model, table.handle);
    expect(kept(back)).toEqual(kept(g));
  });
});
