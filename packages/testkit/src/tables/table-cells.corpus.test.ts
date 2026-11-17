// The cell editor's added row saved (M4-05 part 2), rows and columns inserted and deleted and
// cells merged (part 3), cells formatted, grips dragged and the table scaled (part 4), cell grips
// dragged, Ctrl with a column grip and a spreadsheet's cells pasted into cells (part 6, M4-13), Match Cell and Remove All Property Overrides (part 7): Tab in a table's last cell adds a row, which
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
  tableDataFormatOf,
  tableDrawingOf,
  tableToPlan,
  type Entity,
  type EntityId,
  type TableCell,
  type TableDataFormat,
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

describe('Match Cell and Remove All Property Overrides (M4-05 part 7)', () => {
  const bytes = new Uint8Array(readFileSync(`${corpusDir}${FILE}`));

  /**
   * Formats the last row's first cell, matches the cells of the row above to it, and removes the
   * overrides of the last row's second cell.
   */
  async function edit(model: DocumentModel, id: () => EntityId) {
    const bus = new PromptBus({ model, registry: builtinCommands() });
    const g = () => (model.entity(id()) as Table).geom;
    const style = () => model.tables.tableStyles.get(g().style!);
    const centre = (i: number, j: number) => {
      const b = tableCellBox(g(), style(), { r0: i, c0: j, r1: i, c1: j });
      return tableToPlan(g(), { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
    };
    const last = g().rowHeights.length - 1;
    const run = async (cell: [number, number], ...answers: string[]) => {
      await bus.pick(centre(...cell), { grip: 1e-6 });
      expect(bus.command).toBe('TABLECELL');
      for (const x of answers) await bus.submit(x);
    };
    await run([last, 0], 'BA', '3');
    await run([last, 0], 'AL', 'BR');
    await run([last, 1], 'AL', 'ML');
    await run([last, 0], 'M');
    for (let j = 0; j < g().columnWidths.length; j++) await bus.pick(centre(last - 1, j));
    await bus.submit('');
    await run([last, 1], 'RO');
    expect(bus.promptText).toBe('Command:');
    return g();
  }

  const formats = (t: TableGeometry) => t.cells.map((r) => r.map((c) => c.format));

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
    const matched = { background: { kind: 'aci', index: 3 }, alignment: 9 };
    expect(formats(g).slice(2)).toEqual([
      [matched, matched],
      [matched, undefined],
    ]);
    expect(formats(saved(bytes, model, made.handle))).toEqual(formats(g));
  });

  it('saves in a table the drawing came with', async () => {
    const model = read(bytes);
    const table = [...model.entities()].find(
      (e): e is Table => e.geom.kind === 'ACAD_TABLE' && e.handle === 'A35',
    )!;
    const g = await edit(model, () => table.id);
    const last = g.cells.length - 1;
    expect(g.cells[last - 1]!.every((c) => c.merged || c.format?.alignment === 9)).toBe(true);
    expect(formats(saved(bytes, model, table.handle))).toEqual(formats(g));
  });
});

describe('a block put in a cell, a block cell typed in (M4-16 part 1, TINSERT)', () => {
  const bytes = new Uint8Array(readFileSync(`${corpusDir}${FILE}`));
  /** acadsharp's `my_block`, the block A35's AutoFit block cell holds. */
  const MY_BLOCK = 'A0B';

  /**
   * TINSERT `block` into cell (`i`, `j`) at `scale` (AutoFit off unless `scale` is 'fit'), then
   * the text `typed` into cell (`ti`, `tj`) through the Table Cell menu's Edit Text.
   */
  async function edit(
    model: DocumentModel,
    id: EntityId,
    [i, j]: [number, number],
    block: string,
    scale: number | 'fit',
    [ti, tj]: [number, number],
    typed: string,
  ): Promise<TableGeometry> {
    const g = () => (model.entity(id) as Table).geom;
    const style = () => model.tables.tableStyles.get(g().style!);
    const centre = (r: number, c: number) => {
      const b = tableCellBox(g(), style(), { r0: r, c0: c, r1: r, c1: c });
      return tableToPlan(g(), { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
    };
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) =>
          Promise.resolve(r.op === 'pick' ? { ok: true, ids: [id] } : { ok: false, message: 'no' }),
      },
    });
    await bus.submit('TINSERT');
    await bus.pick(centre(i, j));
    for (let k = 0; k < 100 && bus.prompt?.kind !== 'dialog'; k++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      tableBlock: {
        block,
        scale: scale === 'fit' ? 1 : scale,
        autoFit: scale === 'fit',
        rotation: 0,
        alignment: 5,
      },
    });
    expect(bus.promptText).toBe('Command:');
    await bus.pick(centre(ti, tj), { grip: 1e-6 });
    expect(bus.command).toBe('TABLECELL');
    await bus.submit('T');
    await bus.answer({ kind: 'string', value: typed, editor: true });
    expect(bus.promptText).toBe('Command:');
    return g();
  }

  /** What each cell holds: its text, or its block with its scale and AutoFit. */
  const held = (t: TableGeometry) =>
    t.cells.map((r) =>
      r.map((c) =>
        c.type === 'block'
          ? { block: c.block, scale: Number(c.blockScale?.toFixed(6)), fit: c.autoFit }
          : c.text,
      ),
    );

  it('saves in a table made in the drawing', async () => {
    const model = read(bytes);
    const before = new Set([...model.entities()].map((e) => e.id));
    const bus = new PromptBus({ model, registry: builtinCommands() });
    for (const a of ['-TABLE', '2', '2', '0,-500']) await bus.submit(a);
    await typeCells(bus, ['T', 'A', 'B', '1', '2', '3', '4']);
    const made = [...model.entities()].find(
      (e): e is Table => !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
    )!;
    const g = await edit(model, made.id, [2, 1], MY_BLOCK, 0.01, [3, 0], 'x');
    expect(held(g)[2]).toEqual(['1', { block: MY_BLOCK, scale: 0.01, fit: false }]);
    expect(held(saved(bytes, model, made.handle))).toEqual(held(g));
  });

  it('saves in a table the drawing came with: text to block and block to text', async () => {
    const model = read(bytes);
    const table = [...model.entities()].find(
      (e): e is Table => e.geom.kind === 'ACAD_TABLE' && e.handle === 'A35',
    )!;
    // The file's two block cells: my_block fitted, an anonymous block at scale 1.
    expect(held(table.geom)[1]!.slice(3)).toEqual([
      { block: MY_BLOCK, scale: 0.005964, fit: true },
      { block: expect.any(String), scale: 1, fit: false },
    ]);
    const last = table.geom.rowHeights.length - 1;
    const g = await edit(model, table.id, [last, 0], MY_BLOCK, 'fit', [1, 3], 'was a block');
    expect(held(g)[1]![3]).toBe('was a block');
    expect(held(g)[last]![0]).toEqual({ block: MY_BLOCK, scale: expect.any(Number), fit: true });
    const back = saved(bytes, model, table.handle);
    expect(held(back)).toEqual(held(g));
    expect(back.cells[last]![0]!.format?.alignment).toBe(5);
  });
});

describe('cell data formats (M4-16 part 2, Data Format...)', () => {
  const bytes = new Uint8Array(readFileSync(`${corpusDir}${FILE}`));

  /** Every cell's text, value and format string, by position. */
  const data = (t: TableGeometry) =>
    t.cells.map((r) =>
      r.map((c) => ({
        text: c.text,
        ...(c.value && { value: c.value }),
        ...(c.valueFormat && { format: c.valueFormat }),
      })),
    );

  /** The bus on table `id` and TABLECELL steps: Data Format on a cell, text typed into one. */
  function steps(model: DocumentModel, id: EntityId) {
    const g = () => (model.entity(id) as Table).geom;
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) =>
          Promise.resolve(r.op === 'pick' ? { ok: true, ids: [] } : { ok: false, message: 'no' }),
      },
    });
    const centre = (i: number, j: number) => {
      const style = model.tables.tableStyles.get(g().style!);
      const b = tableCellBox(g(), style, { r0: i, c0: j, r1: i, c1: j });
      return tableToPlan(g(), { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
    };
    const select = async (i: number, j: number) => {
      await bus.pick(centre(i, j), { grip: 1e-6 });
      expect(bus.command).toBe('TABLECELL');
    };
    return {
      g,
      async format(i: number, j: number, f: TableDataFormat) {
        await select(i, j);
        await bus.submit('DF');
        expect(bus.prompt?.kind).toBe('dialog');
        await bus.answer({ kind: 'dialog', action: 'ok', tableDataFormat: f });
        expect(bus.promptText).toBe('Command:');
      },
      async type(i: number, j: number, text: string) {
        await select(i, j);
        await bus.submit('T');
        await bus.answer({ kind: 'string', value: text, editor: true });
        expect(bus.promptText).toBe('Command:');
      },
    };
  }

  it('reads the typed values the drawing’s table holds', () => {
    const model = read(bytes);
    const table = [...model.entities()].find(
      (e): e is Table => e.geom.kind === 'ACAD_TABLE' && e.handle === 'A35',
    )!;
    const typed = table.geom.cells.flat().filter((c) => c.value);
    expect(typed.map((c) => [c.text, c.value!.kind, c.valueFormat ?? ''])).toEqual(
      expect.arrayContaining([
        ['0.500000', 'double', ''],
        ['60', 'double', '%au0'],
        ['0.000000, 0.000000, 0.000000', 'point', ''],
        ['11/15/2024', 'date', ''],
        ['5', 'long', ''],
        ['35.00%', 'double', '%lu2%pr2%ps[,%]'],
        ['$100.00', 'double', '%lu2%pr2%ps[$,]'],
      ]),
    );
    const of = (format: string) => typed.find((c) => c.valueFormat === format)!;
    expect(of('%au0').value).toEqual({
      kind: 'double',
      n: expect.closeTo(Math.PI / 3, 9),
      units: 2,
    });
    expect(of('%lu2%pr2%ps[$,]').value).toEqual({ kind: 'double', n: 100, units: 16 });
    const date = typed.find((c) => c.value!.kind === 'date')!.value!;
    expect(date.kind === 'date' && new Date(date.time).toDateString()).toBe(
      new Date(2024, 10, 15).toDateString(),
    );
  });

  it('saves in a table the drawing came with', async () => {
    const model = read(bytes);
    const table = [...model.entities()].find(
      (e): e is Table => e.geom.kind === 'ACAD_TABLE' && e.handle === 'A35',
    )!;
    const at = (pick: (c: TableCell) => boolean): [number, number] => {
      const i = table.geom.cells.findIndex((r) => r.some(pick));
      return [i, table.geom.cells[i]!.findIndex(pick)];
    };
    const money = at((c) => c.valueFormat === '%lu2%pr2%ps[$,]');
    const angle = at((c) => c.valueFormat === '%au0');
    const day = at((c) => c.value?.kind === 'date');
    const whole = at((c) => c.value?.kind === 'long');
    const text = at((c) => c.text === 'A2 cell');
    const s = steps(model, table.id);
    await s.format(...money, { type: 'percentage', precision: 1 });
    await s.type(...angle, '90');
    await s.format(...day, { type: 'date', date: 'yyyy-MM-dd' });
    await s.type(...whole, '12.4');
    await s.type(...text, '2.5');
    await s.format(...text, { type: 'currency', symbol: '€', appendSymbol: true, precision: 1 });
    const g = s.g();
    const cellOf = ([i, j]: [number, number]) => g.cells[i]![j]!;
    expect(cellOf(money)).toMatchObject({ text: '100.0%', value: { units: 32 } });
    expect(cellOf(angle)).toMatchObject({ text: '90', value: { n: Math.PI / 2, units: 2 } });
    expect(cellOf(day)).toMatchObject({ text: '2024-11-15', valueFormat: 'yyyy-MM-dd' });
    expect(cellOf(whole)).toMatchObject({ text: '12', value: { kind: 'long', n: 12 } });
    expect(cellOf(text)).toMatchObject({ text: '2.5€', value: { n: 2.5, units: 16 } });
    expect(data(saved(bytes, model, table.handle))).toEqual(data(g));
  });

  it('saves in a table made in the drawing', async () => {
    const model = read(bytes);
    const before = new Set([...model.entities()].map((e) => e.id));
    const bus = new PromptBus({ model, registry: builtinCommands() });
    for (const a of ['-TABLE', '2', '2', '0,-500']) await bus.submit(a);
    await typeCells(bus, ['PUMPS', 'Duty', 'Since', '1.5', '3/1/2025', '20', '']);
    const made = [...model.entities()].find(
      (e): e is Table => !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
    )!;
    const s = steps(model, made.id);
    await s.format(2, 0, { type: 'decimal', precision: 2 });
    await s.format(3, 0, { type: 'whole' });
    await s.format(2, 1, { type: 'date', date: 'MMMM d, yyyy' });
    // An empty cell keeps its format: what is typed there after the save is read by it.
    await s.format(3, 1, { type: 'angle', format: 1 });
    await s.format(1, 0, { type: 'text', format: 1 });
    const g = s.g();
    expect(data(g)).toEqual([
      [{ text: 'PUMPS' }, { text: '' }],
      [{ text: 'Duty', format: '%tc1' }, { text: 'Since' }],
      [
        { text: '1.50', value: { kind: 'double', n: 1.5, units: 0 }, format: '%pr2' },
        {
          text: 'March 1, 2025',
          value: { kind: 'date', time: new Date(2025, 2, 1).getTime() },
          format: 'MMMM d, yyyy',
        },
      ],
      [
        { text: '20', value: { kind: 'long', n: 20 } },
        { text: '', format: '%au1' },
      ],
    ]);
    const back = saved(bytes, model, made.handle);
    expect(data(back)).toEqual(data(g));
    expect(tableDataFormatOf(back.cells[3]![1]!)).toEqual({ type: 'angle', format: 1 });
  });

  // M4-16 part 3: Additional Format... and a point's X, Y and Z boxes.
  it('saves the Additional Format and a point’s coordinates', async () => {
    const model = read(bytes);
    const table = [...model.entities()].find(
      (e): e is Table => e.geom.kind === 'ACAD_TABLE' && e.handle === 'A35',
    )!;
    const at = (pick: (c: TableCell) => boolean): [number, number] => {
      const i = table.geom.cells.findIndex((r) => r.some(pick));
      return [i, table.geom.cells[i]!.findIndex(pick)];
    };
    const money = at((c) => c.valueFormat === '%lu2%pr2%ps[$,]');
    const point = at((c) => c.value?.kind === 'point');
    const half = at((c) => c.text === '0.500000');
    const s = steps(model, table.id);
    const metres: TableDataFormat = {
      type: 'decimal',
      format: 2,
      precision: 2,
      additional: { factor: 1000, prefix: 'L=', suffix: ' mm', decimal: ',', thousands: '.' },
    };
    const xy: TableDataFormat = { type: 'point', precision: 1, coordinates: 3 };
    const euros: TableDataFormat = {
      type: 'currency',
      symbol: '€',
      appendSymbol: true,
      precision: 2,
      additional: { decimal: ',', thousands: '.' },
    };
    await s.format(...half, metres);
    await s.format(...point, xy);
    await s.type(...point, '12.5,7,3');
    await s.format(...money, euros);
    await s.type(...money, '1.234,5€');
    const g = s.g();
    const cellOf = ([i, j]: [number, number]) => g.cells[i]![j]!;
    expect(cellOf(half)).toMatchObject({
      text: 'L=500,00 mm',
      value: { kind: 'double', n: 0.5, units: 0 },
      valueFormat: '%lu2%pr2%ps[L=, mm]%ct8[1000]%ds44%th46',
    });
    expect(cellOf(point)).toMatchObject({
      text: '12.5, 7.0',
      value: { kind: 'point', point: [12.5, 7, 3], dimensions: 3 },
      valueFormat: '%pr1%pt3',
    });
    expect(cellOf(money)).toMatchObject({
      text: '1.234,50€',
      value: { kind: 'double', n: 1234.5, units: 16 },
    });
    const back = saved(bytes, model, table.handle);
    expect(data(back)).toEqual(data(g));
    const backOf = ([i, j]: [number, number]) => back.cells[i]![j]!;
    expect(tableDataFormatOf(backOf(half))).toEqual(metres);
    expect(tableDataFormatOf(backOf(point))).toEqual(xy);
    expect(tableDataFormatOf(backOf(money))).toEqual(euros);
  });
});

describe('rows and cells on cell styles of their own (M4-16 part 5)', () => {
  const bytes = new Uint8Array(readFileSync(`${corpusDir}${FILE}`));

  /**
   * Inserts a row above the title row (a title row too), deletes the header row, puts the last
   * row on the Header cell style and the first data row's second cell on Title of its own.
   */
  async function edit(model: DocumentModel, id: () => EntityId) {
    const bus = new PromptBus({ model, registry: builtinCommands() });
    const g = () => (model.entity(id()) as Table).geom;
    const style = () => model.tables.tableStyles.get(g().style!);
    const centre = (i: number, j: number) => {
      const b = tableCellBox(g(), style(), { r0: i, c0: j, r1: i, c1: j });
      return tableToPlan(g(), { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
    };
    const run = async (cell: [number, number], to: [number, number], ...answers: string[]) => {
      await bus.pick(centre(...cell), { grip: 1e-6 });
      expect(bus.command).toBe('TABLECELL');
      if (to !== cell) await bus.pick(centre(...to), { grip: 1e-6, shift: true });
      for (const x of answers) await bus.submit(x);
      expect(bus.promptText).toBe('Command:');
    };
    await run([0, 0], [0, 0], 'A');
    await run([2, 0], [2, 0], 'DR');
    const last = g().rowHeights.length - 1;
    await run([last, 0], [last, g().columnWidths.length - 1], 'CS', 'H');
    await run([2, 1], [2, 1], 'CS', 'T');
    return g();
  }

  const styles = (t: TableGeometry) => ({
    rows: t.rowStyles,
    own: t.cells.map((r) => r.map((c) => c.cellStyle ?? '')),
  });

  it('saves in a table made in the drawing', async () => {
    const model = read(bytes);
    const before = new Set([...model.entities()].map((e) => e.id));
    const bus = new PromptBus({ model, registry: builtinCommands() });
    for (const a of ['-TABLE', '2', '3', '0,-500']) await bus.submit(a);
    await typeCells(bus, ['T', 'A', 'B', '1', '2']);
    const made = [...model.entities()].find(
      (e): e is Table => !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
    )!;
    const g = await edit(model, () => made.id);
    expect(styles(g)).toEqual({
      rows: ['title', 'title', 'data', 'data', 'header'],
      own: [
        ['', ''],
        ['', ''],
        ['', 'title'],
        ['', ''],
        ['', ''],
      ],
    });
    expect(styles(saved(bytes, model, made.handle))).toEqual(styles(g));
  });

  it('saves in a table the drawing came with', async () => {
    const model = read(bytes);
    const table = [...model.entities()].find(
      (e): e is Table => e.geom.kind === 'ACAD_TABLE' && e.handle === 'A35',
    )!;
    expect(table.geom.rowStyles).toBeUndefined();
    const g = await edit(model, () => table.id);
    expect(g.rowStyles).toEqual(['title', 'title', 'data', 'header']);
    expect(g.cells[2]![1]!.cellStyle).toBe('title');
    expect(styles(saved(bytes, model, table.handle))).toEqual(styles(g));
  });
});
