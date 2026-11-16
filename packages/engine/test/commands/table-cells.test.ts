// M4-05 part 2: the Insert Table dialog (TABLE) and -TABLE's Auto, the table dragged until it is
// placed, and the cell editor (TABLEDIT, a double click, the first cell of a new table) with
// Tab, Shift+Tab and the arrows, rows grown to fit their text.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  standardTableStyle,
  windowTableSize,
  laidOutLines,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type EntityGeometry,
  type EntityId,
  type InsertTableSettings,
  type Prompt,
  type StringPrompt,
  type TableGeometry,
  type TableStyleRecord,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

const textStyle = (handle: string, name: string) => ({
  handle,
  name,
  font: 'txt',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
});

const ACADISO: TableStyleRecord = { handle: '90', ...standardTableStyle(true, '16') };
const UP: TableStyleRecord = { ...ACADISO, handle: '91', name: 'Up', flowDirection: 1 };

/**
 * A canvas that lays text out at 0.6 of its height a character, wrapping at the MTEXT's width,
 * one line 1 high in text heights and each more 5/3; picks return `picked`.
 */
function canvas(picked: () => EntityId[] = () => []): ViewHost {
  return {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') return Promise.resolve({ ok: true, ids: picked() });
      if (r.op !== 'textBox') return Promise.resolve({ ok: false, message: 'no' });
      const t = r.text;
      const perLine = t.width > 0 ? Math.max(1, Math.floor(t.width / (0.6 * t.height))) : Infinity;
      const lines = Math.max(1, Math.ceil(t.contents.length / perLine));
      const h = t.height * (1 + ((lines - 1) * 5) / 3);
      return Promise.resolve({
        ok: true,
        box: { minX: 0, maxX: 1, minY: t.position.y - h, maxY: t.position.y },
      });
    },
  };
}

function setup(
  o: { styles?: TableStyleRecord[]; view?: ViewHost; picked?: () => EntityId[] } = {},
) {
  const init = sampleInit();
  const withStyles: DocumentInit = {
    ...init,
    meta: { ...init.meta, measurement: 'metric' },
    tables: {
      ...init.tables,
      textStyles: [textStyle('16', 'Standard')],
      tableStyles: o.styles ?? [ACADISO],
    },
  };
  const model = DocumentModel.create(withStyles);
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: o.view ?? canvas(o.picked),
  });
  const messages: string[] = [];
  let preview: readonly EntityGeometry[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') messages.push(e.line);
    if (e.type === 'preview') preview = e.geometry;
  });
  const tables = (): (Entity & { geom: TableGeometry })[] =>
    [...model.entities()].filter(
      (e): e is Entity & { geom: TableGeometry } =>
        !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
    );
  const editor = () => (bus.prompt as StringPrompt | undefined)?.editor;
  /** Closes the cell editor with `value`, moving `cell` when given. */
  const type = (value: string, cell?: 'next' | 'previous' | 'left' | 'right' | 'up' | 'down') =>
    bus.answer({ kind: 'string', value, editor: true, ...(cell && { cell }) });
  return { model, bus, messages, tables, editor, type, preview: () => preview };
}

/** -TABLE: two columns, two data rows at 0,0 (title, header, two data rows). */
async function twoByTwo(s: ReturnType<typeof setup>) {
  await s.bus.script(['-TABLE', '2', '2', '0,0']);
}

describe('the cell editor', () => {
  it('opens in a new table’s title cell, where the cell draws its text', async () => {
    const s = setup();
    await twoByTwo(s);
    expect(s.bus.promptText).toBe('Enter text:');
    // The title: 127 wide, 11 high, text 6 middle centre, wrapping inside the 1.5 margins.
    expect(s.editor()).toMatchObject({
      kind: 'mtext',
      cell: true,
      position: { x: 63.5, y: -5.5 },
      attachment: 5,
      height: 6,
      width: 124,
      rotation: 0,
      value: '',
    });
  });

  it('moves with Tab, Shift+Tab and the arrows, each cell its own text', async () => {
    const s = setup();
    await twoByTwo(s);
    await s.type('NOZZLE SCHEDULE', 'next');
    // The title is merged across: Tab goes to the header row's first cell.
    expect(s.editor()).toMatchObject({ position: { x: 31.75, y: -15.5 }, height: 4.5 });
    await s.type('Mark', 'next');
    await s.type('Size', 'down');
    // Data cells are top centre.
    expect(s.editor()).toMatchObject({ position: { x: 95.25, y: -21.5 }, attachment: 2 });
    await s.type('DN50', 'left');
    await s.type('N1', 'up');
    expect(s.editor()).toMatchObject({ value: 'Mark' });
    await s.type('Mark', 'up');
    expect(s.editor()).toMatchObject({ value: 'NOZZLE SCHEDULE' });
    // Up from the top row stays in the cell; Shift+Tab from the first cell too.
    await s.type('NOZZLE SCHEDULE', 'up');
    await s.type('NOZZLE SCHEDULE', 'previous');
    expect(s.editor()).toMatchObject({ value: 'NOZZLE SCHEDULE' });
    await s.type('NOZZLE SCHEDULE');
    expect(s.bus.promptText).toBe('Command:');
    const g = s.tables()[0]!.geom;
    expect(g.cells.map((r) => r.map((c) => c.text))).toEqual([
      ['NOZZLE SCHEDULE', ''],
      ['Mark', 'Size'],
      ['N1', 'DN50'],
      ['', ''],
    ]);
    // The block holds the texts the engine draws.
    const texts = s.model
      .blockEntities(g.block!)
      .map((id) => s.model.entity(id)!.geom)
      .filter((x) => x.kind === 'MTEXT')
      .map((x) => (x as { contents: string }).contents);
    expect(texts).toEqual(['NOZZLE SCHEDULE', 'Mark', 'Size', 'N1', 'DN50']);
    // The table and every cell typed are one undo step.
    await s.bus.submit('U');
    expect(s.tables()).toEqual([]);
  });

  it('adds a row on Tab in the last cell', async () => {
    const s = setup();
    await s.bus.script(['-TABLE', '1', '1', '0,0']);
    await s.type('T', 'next');
    await s.type('H', 'next');
    await s.type('D', 'next');
    const g = s.tables()[0]!.geom;
    expect(g.rowHeights.map(r4)).toEqual([11, 9, 9, 9]);
    expect(g.rowOrigins).toEqual([0, 1, 2, null]);
    expect(s.editor()).toMatchObject({ position: { x: 31.75, y: -30.5 } });
    await s.bus.cancel();
    expect(s.tables()[0]!.geom.cells.map((r) => r[0]!.text)).toEqual(['T', 'H', 'D', '']);
  });

  it('grows a row to fit its text, never shrinking it', async () => {
    const s = setup();
    await twoByTwo(s);
    await s.type('', 'next');
    await s.type('', 'next');
    await s.type('', 'next');
    // A data cell 60.5 wide holds 22 characters of 4.5 text a line: 50 make three lines.
    await s.type('x'.repeat(50), 'next');
    const g = () => s.tables()[0]!.geom;
    // 4.5 × (1 + 2 × 5/3) + 2 × 1.5.
    expect(g().rowHeights.map(r4)).toEqual([11, 9, 22.5, 9]);
    // A shorter text in the same row leaves it.
    await s.type('short');
    expect(g().rowHeights.map(r4)).toEqual([11, 9, 22.5, 9]);
    // Two lines fit the 9 a two-line row would have had: the row stays.
    expect(laidOutLines(4.5 * (1 + 5 / 3), 4.5)).toBe(2);
    expect(laidOutLines(4.5 * 1.3, 4.5)).toBe(1);
  });

  it('keeps a row’s height without the fonts to lay the text out', async () => {
    const s = setup({ view: { request: () => Promise.resolve({ ok: false, message: 'no' }) } });
    await twoByTwo(s);
    await s.type('x'.repeat(200));
    expect(s.tables()[0]!.geom.rowHeights.map(r4)).toEqual([11, 9, 9, 9]);
    expect(s.tables()[0]!.geom.cells[0]![0]!.text).toBe('x'.repeat(200));
  });

  it('opens on the cell TABLEDIT picks or a double click hits', async () => {
    let ids: EntityId[] = [];
    const s = setup({ picked: () => ids });
    await twoByTwo(s);
    await s.bus.cancel();
    ids = [s.tables()[0]!.id];
    await s.bus.submit('TABLEDIT');
    expect(s.bus.promptText).toBe('Pick a table cell:');
    await s.bus.pick({ x: 100, y: -25 });
    expect(s.editor()).toMatchObject({ position: { x: 95.25, y: -21.5 } });
    await s.type('DN80');
    expect(s.bus.promptText).toBe('Command:');
    expect(s.tables()[0]!.geom.cells[2]![1]!.text).toBe('DN80');
    // A double click on the merged title opens its head cell.
    await s.bus.doubleClick({ x: 120, y: -3 });
    expect(s.bus.command).toBe('TABLEDIT');
    expect(s.editor()).toMatchObject({ position: { x: 63.5, y: -5.5 }, value: '' });
    await s.bus.cancel();
    // A pick that takes no table cell is refused.
    ids = [];
    await s.bus.submit('TABLEDIT');
    ids = [[...s.model.entities()][0]!.id];
    await s.bus.pick({ x: 1000, y: 1000 });
    expect(s.messages).toContain('The object selected is not a table cell.');
  });

  it('moves up and down as drawn in a table that reads upwards', async () => {
    const s = setup({ styles: [UP] });
    await twoByTwo(s);
    // The title is the bottom row, its text above the insertion point.
    expect(s.editor()).toMatchObject({ position: { x: 63.5, y: 5.5 } });
    await s.type('T', 'up');
    expect(s.editor()).toMatchObject({ position: { x: 31.75, y: 15.5 } });
    await s.type('H', 'down');
    expect(s.editor()).toMatchObject({ value: 'T' });
  });
});

describe('-TABLE Auto', () => {
  it('takes as many columns of the width as fit the window', async () => {
    const s = setup();
    await s.bus.script(['-TABLE', 'A', '2']);
    expect(s.bus.promptText).toBe('Specify first corner or [Style/Width/Height]:');
    await s.bus.submit('0,0');
    expect(s.bus.promptText).toBe('Specify second corner:');
    // 200 wide: three columns of 63.5; 2 data rows, 80 high: two lines a row fit.
    await s.bus.submit('200,-80');
    const g = s.tables()[0]!.geom;
    expect(g.position).toEqual({ x: 0, y: 0 });
    expect(g.columnWidths).toEqual([63.5, 63.5, 63.5]);
    expect(g.rowHeights.map(r4)).toEqual([19, 15, 15, 15]);
  });

  it('takes as many data rows as fit, the columns sharing the width', async () => {
    const s = setup();
    await s.bus.script(['-TABLE', '2', 'A', '0,-50', '100,0']);
    const g = s.tables()[0]!.geom;
    // The window's upper left corner; (50 - 11 - 9) / 9: three data rows.
    expect(g.position).toEqual({ x: 0, y: 0 });
    expect(g.columnWidths).toEqual([50, 50]);
    expect(g.rowHeights.map(r4)).toEqual([11, 9, 9, 9, 9]);
  });

  it('refuses a window without a width or height', async () => {
    const s = setup();
    await s.bus.script(['-TABLE', 'A', 'A', '0,0', '0,10']);
    expect(s.messages).toContain('The window must have a width and a height.');
    expect(s.tables()).toEqual([]);
  });

  it('sizes at least one column, row and line', () => {
    const size = { columns: 3, columnWidth: 63.5, dataRows: 5, rowLines: 1 };
    expect(windowTableSize(ACADISO, size, true, true, 10, 10)).toEqual({
      columns: 1,
      columnWidth: 63.5,
      dataRows: 1,
      rowLines: 1,
    });
    expect(windowTableSize(ACADISO, size, false, false, 30, 10)).toEqual({
      columns: 3,
      columnWidth: 10,
      dataRows: 5,
      rowLines: 1,
    });
  });
});

describe('TABLE', () => {
  const settings = (more: Partial<InsertTableSettings> = {}): InsertTableSettings => ({
    style: 'Standard',
    window: false,
    columns: 3,
    width: 40,
    dataRows: 2,
    lines: 1,
    autoColumns: false,
    autoRows: true,
    ...more,
  });

  it('opens Insert Table, then drags the table to its insertion point', async () => {
    const s = setup({ styles: [ACADISO, UP] });
    await s.bus.submit('TB');
    expect(s.bus.command).toBe('TABLE');
    const p = s.bus.prompt as Extract<Prompt, { kind: 'dialog' }>;
    expect(p.dialog).toEqual({
      type: 'inserttable',
      settings: settings({ columns: 5, width: 63.5, dataRows: 1 }),
      styles: [
        { name: 'Standard', suppressTitle: false, suppressHeader: false, up: false },
        { name: 'Up', suppressTitle: false, suppressHeader: false, up: true },
      ],
    });
    await s.bus.answer({ kind: 'dialog', action: 'ok', table: settings() });
    expect(s.bus.promptText).toBe('Specify insertion point:');
    expect(s.bus.prompt).toMatchObject({ drag: { kind: 'preview', from: { x: 0, y: 0 } } });
    // The grid as drawn at the origin: 5 row lines and 4 column lines, the title merged.
    const lines = s.preview();
    expect(lines.every((g) => g.kind === 'LINE')).toBe(true);
    expect(lines).toHaveLength(5 + 4);
    const first = lines[0] as { start: { x: number; y: number }; end: { x: number; y: number } };
    expect([first.start.x, r4(first.start.y), first.end.x, r4(first.end.y)]).toEqual([
      0, 0, 120, 0,
    ]);
    await s.bus.submit('10,10');
    expect(s.preview()).toEqual([]);
    expect(s.bus.promptText).toBe('Enter text:');
    const g = s.tables()[0]!.geom;
    expect(g.position).toEqual({ x: 10, y: 10 });
    expect(g.columnWidths).toEqual([40, 40, 40]);
    expect(g.rowHeights).toHaveLength(4);
    await s.bus.cancel();
    // It opens on the last table's settings.
    await s.bus.submit('TABLE');
    expect((s.bus.prompt as Extract<Prompt, { kind: 'dialog' }>).dialog).toMatchObject({
      settings: settings(),
    });
  });

  it('sizes the table by a window with Specify window', async () => {
    const s = setup({ styles: [ACADISO, UP] });
    await s.bus.submit('TABLE');
    await s.bus.answer({
      kind: 'dialog',
      action: 'ok',
      table: settings({ style: 'up', window: true }),
    });
    expect(s.bus.promptText).toBe('Specify first corner:');
    await s.bus.submit('0,50');
    expect(s.bus.promptText).toBe('Specify second corner:');
    await s.bus.submit('90,0');
    const g = s.tables()[0]!.geom;
    // A table that reads upwards starts at the window's lower left corner.
    expect(g.style).toBe('91');
    expect(g.position).toEqual({ x: 0, y: 0 });
    expect(g.columnWidths).toEqual([30, 30, 30]);
    expect(g.rowHeights.map(r4)).toEqual([11, 9, 9, 9, 9]);
  });

  it('makes nothing on Cancel or settings it cannot use', async () => {
    const s = setup();
    await s.bus.submit('TABLE');
    await s.bus.cancel();
    expect(s.bus.promptText).toBe('Command:');
    for (const [bad, said] of [
      [{ columns: 0 }, 'The number of columns must be between 1 and 32767.'],
      [{ dataRows: 1.5 }, 'The number of data rows must be between 1 and 32767.'],
      [{ width: 0 }, 'The column width must be positive and nonzero.'],
      [{ lines: 0 }, 'The row height must be a whole number of lines from 1.'],
      [{ style: 'Nope' }, 'Cannot find table style "Nope".'],
    ] as const) {
      await s.bus.submit('TABLE');
      await s.bus.answer({ kind: 'dialog', action: 'ok', table: settings(bad) });
      expect(s.messages).toContain(said);
      expect(s.bus.promptText).toBe('Command:');
    }
    expect(s.tables()).toEqual([]);
  });

  it('offers Standard in a drawing without table styles, and makes it', async () => {
    const s = setup({ styles: [] });
    await s.bus.submit('TABLE');
    expect((s.bus.prompt as Extract<Prompt, { kind: 'dialog' }>).dialog).toMatchObject({
      styles: [{ name: 'Standard' }],
    });
    await s.bus.answer({ kind: 'dialog', action: 'ok', table: settings() });
    await s.bus.submit('0,0');
    expect([...s.model.tables.tableStyles.values()].map((x) => x.name)).toEqual(['Standard']);
  });
});
