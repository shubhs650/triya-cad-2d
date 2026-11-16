// M4-05 part 3: table cells selected by a click inside them (Shift+click adds to the range) and
// the Table Cell menu (TABLECELL): rows and columns inserted and deleted, cells merged and
// unmerged, a cell's text edited.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  standardTableStyle,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type EntityGeometry,
  type EntityId,
  type PointPrompt,
  type StringPrompt,
  type TableGeometry,
  type TableStyleRecord,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

const ACADISO: TableStyleRecord = { handle: '90', ...standardTableStyle(true, '16') };

function setup(picked: () => EntityId[] = () => []) {
  const init = sampleInit();
  const withStyles: DocumentInit = {
    ...init,
    meta: { ...init.meta, measurement: 'metric' },
    tables: {
      ...init.tables,
      textStyles: [
        {
          handle: '16',
          name: 'Standard',
          font: 'txt',
          height: 0,
          widthFactor: 1,
          obliqueAngle: 0,
          lastHeight: 2.5,
          generation: 0,
          trueTypeFlags: 0,
        },
      ],
      tableStyles: [ACADISO],
    },
  };
  const model = DocumentModel.create(withStyles);
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r) =>
        Promise.resolve(
          r.op === 'pick' ? { ok: true, ids: picked() } : { ok: false, message: 'no' },
        ),
    },
  });
  const messages: string[] = [];
  let preview: readonly EntityGeometry[] = [];
  let selected: readonly EntityId[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') messages.push(e.line);
    if (e.type === 'preview') preview = e.geometry;
    if (e.type === 'selection') selected = e.ids;
  });
  const table = () =>
    [...model.entities()].find(
      (e): e is Entity & { geom: TableGeometry } =>
        !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
    )!;
  const texts = () => table().geom.cells.map((r) => r.map((c) => (c.merged ? '^' : c.text)));
  return {
    model,
    bus,
    messages,
    table,
    texts,
    preview: () => preview,
    selected: () => selected,
    prompt: () => bus.prompt as PointPrompt | undefined,
  };
}

/**
 * -TABLE at 0,0: two columns 63.5 wide, three data rows, with texts. Rows: title 0 to −11,
 * header to −20, data rows to −29, −38 and −47.
 */
async function nozzles(s: ReturnType<typeof setup>) {
  await s.bus.script(['-TABLE', '2', '3', '0,0']);
  for (const [k, t] of ['NOZZLES', 'Mark', 'Size', 'N1', 'DN50', 'N2', 'DN80', 'N3'].entries()) {
    await s.bus.answer({ kind: 'string', value: t, editor: true, ...(k < 7 && { cell: 'next' }) });
  }
  expect(s.bus.promptText).toBe('Command:');
}

/** A cell's centre: row `i` (0 title, 1 header, 2… data), column `j`. */
const at = (i: number, j: number) => ({
  x: 31.75 + 63.5 * j,
  y: i === 0 ? -5.5 : i === 1 ? -15.5 : -24.5 - 9 * (i - 2),
});

const OPTIONS =
  'Enter a table cell option [Text/BAckground/ALignment/BOrders/Height/Above/Below/DeleteRows/Left/Right/DeleteColumns/MergeAll/MergeRows/MergeColumns/Unmerge]:';

describe('a table cell selected at Command:', () => {
  it('is a click inside it, shown by its outline, with the Table Cell options', async () => {
    const s = setup();
    await nozzles(s);
    await s.bus.pick(at(2, 1), { grip: 1 });
    expect(s.bus.command).toBe('TABLECELL');
    expect(s.bus.promptText).toBe(OPTIONS);
    expect(s.preview()).toEqual([
      {
        kind: 'LWPOLYLINE',
        closed: true,
        vertices: [
          { x: 63.5, y: -29, bulge: 0 },
          { x: 127, y: -29, bulge: 0 },
          { x: 127, y: -20, bulge: 0 },
          { x: 63.5, y: -20, bulge: 0 },
        ],
      },
    ]);
    // The right-click menu: AutoCAD's labels, what does not apply greyed.
    const menu = s.prompt()!.shortcutMenu!;
    expect(menu.map((m) => `${m.label}${m.disabled ? ' (off)' : ''}`)).toEqual([
      'Edit Text',
      'Background Fill',
      'Alignment',
      'Borders',
      'Text Height',
      'Insert Rows Above',
      'Insert Rows Below',
      'Delete Rows',
      'Insert Columns Left',
      'Insert Columns Right',
      'Delete Columns',
      'Merge All (off)',
      'Merge By Row (off)',
      'Merge By Column (off)',
      'Unmerge (off)',
    ]);
    expect(menu.find((m) => m.label === 'Delete Rows')!.keyword).toBe('DeleteRows');
    // Shift+click adds the cells up to the one clicked; a click alone starts again.
    await s.bus.pick(at(3, 0), { shift: true });
    expect(s.preview()[0]).toMatchObject({
      vertices: [
        { x: 0, y: -38 },
        { x: 127, y: -38 },
        { x: 127, y: -20 },
        { x: 0, y: -20 },
      ],
    });
    await s.bus.pick(at(4, 0));
    expect(s.preview()[0]).toMatchObject({ vertices: [{ x: 0, y: -47 }, {}, {}, {}] });
    // A click outside the table, or Esc, ends it.
    await s.bus.pick({ x: 500, y: 500 });
    expect(s.bus.promptText).toBe('Command:');
    expect(s.preview()).toEqual([]);
  });

  it('is not taken by a click on the table’s lines, which selects the table', async () => {
    let ids: EntityId[] = [];
    const s = setup(() => ids);
    await nozzles(s);
    ids = [s.table().id];
    await s.bus.pick({ x: 63.8, y: -24.5 }, { grip: 1 });
    expect(s.bus.command).toBeUndefined();
    expect(s.selected()).toEqual([s.table().id]);
    // PICKFIRST off: no cell either.
    await s.bus.clearSelection();
    await s.bus.setPickfirst(false);
    await s.bus.pick(at(2, 0), { grip: 1 });
    expect(s.bus.command).toBeUndefined();
  });

  it('inserts rows below as many as are selected, in one undo step', async () => {
    const s = setup();
    await nozzles(s);
    await s.bus.pick(at(2, 0));
    await s.bus.pick(at(3, 0), { shift: true });
    await s.bus.answer({ kind: 'keyword', keyword: 'Below' });
    expect(s.bus.promptText).toBe('Command:');
    expect(s.texts()).toEqual([
      ['NOZZLES', '^'],
      ['Mark', 'Size'],
      ['N1', 'DN50'],
      ['N2', 'DN80'],
      ['', ''],
      ['', ''],
      ['N3', ''],
    ]);
    expect(s.table().geom.rowOrigins).toEqual([0, 1, 2, 3, null, null, 4]);
    // The block is drawn again: the bottom line is at −65.
    const ys = s.model
      .blockEntities(s.table().geom.block!)
      .map((id) => s.model.entity(id)!.geom)
      .filter((g) => g.kind === 'LINE')
      .map((g) => (g as { start: { y: number } }).start.y);
    expect(Math.min(...ys)).toBe(-65);
    await s.bus.submit('U');
    expect(s.table().geom.rowHeights).toHaveLength(5);
  });

  it('inserts and deletes columns, and rows above', async () => {
    const s = setup();
    await nozzles(s);
    await s.bus.pick(at(2, 1));
    await s.bus.submit('R');
    expect(s.texts()[0]).toEqual(['NOZZLES', '^', '^']);
    expect(s.texts()[1]).toEqual(['Mark', 'Size', '']);
    expect(s.table().geom.columnWidths).toEqual([63.5, 63.5, 63.5]);
    await s.bus.pick(at(2, 0));
    await s.bus.submit('DC');
    expect(s.texts()[1]).toEqual(['Size', '']);
    await s.bus.pick(at(2, 0));
    await s.bus.submit('A');
    expect(s.texts().map((r) => r[0])).toEqual(['NOZZLES', 'Size', '', 'DN50', 'DN80', '']);
    await s.bus.pick(at(2, 0));
    await s.bus.submit('DR');
    expect(s.texts().map((r) => r[0])).toEqual(['NOZZLES', 'Size', 'DN50', 'DN80', '']);
  });

  it('refuses what does not apply, asking again', async () => {
    const s = setup();
    await nozzles(s);
    await s.bus.pick(at(1, 0));
    await s.bus.submit('A');
    expect(s.messages).toContain(
      'Rows can be inserted above and deleted only among the data rows.',
    );
    expect(s.bus.promptText).toBe(OPTIONS);
    await s.bus.submit('MA');
    expect(s.messages).toContain('Select more than one cell to merge.');
    await s.bus.submit('U');
    expect(s.messages).toContain('No merged cell is selected.');
    expect(s.bus.command).toBe('TABLECELL');
  });

  it('merges and unmerges cells', async () => {
    const s = setup();
    await nozzles(s);
    await s.bus.pick(at(2, 0));
    await s.bus.pick(at(3, 1), { shift: true });
    await s.bus.submit('MA');
    expect(s.texts().slice(2, 4)).toEqual([
      ['N1', '^'],
      ['^', '^'],
    ]);
    expect(s.table().geom.cells[2]![0]).toMatchObject({ rowSpan: 2, columnSpan: 2 });
    // A click in any cell of the merged cell selects it whole; Unmerge.
    await s.bus.pick(at(3, 1));
    expect(s.preview()[0]).toMatchObject({ vertices: [{ x: 0, y: -38 }, {}, {}, {}] });
    await s.bus.submit('U');
    expect(s.texts().slice(2, 4)).toEqual([
      ['N1', ''],
      ['', ''],
    ]);
    await s.bus.pick(at(3, 0));
    await s.bus.pick(at(4, 1), { shift: true });
    await s.bus.submit('MR');
    expect(s.texts().slice(3, 5)).toEqual([
      ['', '^'],
      ['N3', '^'],
    ]);
  });

  it('edits the text of the first cell selected', async () => {
    const s = setup();
    await nozzles(s);
    await s.bus.pick(at(3, 1));
    await s.bus.submit('T');
    expect((s.bus.prompt as StringPrompt).editor).toMatchObject({ value: 'DN80', cell: true });
    await s.bus.answer({ kind: 'string', value: 'DN100', editor: true });
    expect(s.texts()[3]).toEqual(['N2', 'DN100']);
  });

  it('gives way to a double click, which edits the cell', async () => {
    const s = setup();
    await nozzles(s);
    await s.bus.pick(at(2, 1));
    await s.bus.pick(at(2, 1));
    await s.bus.doubleClick(at(2, 1));
    expect(s.bus.command).toBe('TABLEDIT');
    expect((s.bus.prompt as StringPrompt).editor).toMatchObject({ value: 'DN50' });
  });

  it('is asked for at the command line', async () => {
    let ids: EntityId[] = [];
    const s = setup(() => ids);
    await nozzles(s);
    ids = [s.table().id];
    await s.bus.submit('TABLECELL');
    expect(s.bus.promptText).toBe('Pick a table cell:');
    await s.bus.pick(at(4, 1));
    expect(s.bus.promptText).toBe(OPTIONS);
    await s.bus.submit('DR');
    expect(s.texts()).toHaveLength(4);
    // Something that is not a table cell.
    await s.bus.submit('TABLECELL');
    ids = [];
    await s.bus.pick({ x: 500, y: 500 });
    await s.bus.cancel();
    ids = [[...s.model.entities()][0]!.id];
    await s.bus.submit('TABLECELL');
    await s.bus.pick({ x: 500, y: 500 });
    expect(s.messages).toContain('The object selected is not a table cell.');
  });
});

/** Table cell (`i`, `j`)'s format. */
const formatOf = (s: ReturnType<typeof setup>, i: number, j: number) =>
  s.table().geom.cells[i]![j]!.format;

/** The lines of the table's block, as `x0,y0 x1,y1 colour lineweight`. */
const blockLines = (s: ReturnType<typeof setup>) =>
  s.model
    .blockEntities(s.table().geom.block!)
    .map((id) => s.model.entity(id)!)
    .filter((e) => e.geom.kind === 'LINE' && e.lineweight !== 0)
    .map((e) => {
      const g = e.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
      const c = e.color.kind === 'aci' ? e.color.index : e.color.kind;
      return `${g.start.x},${g.start.y} ${g.end.x},${g.end.y} ${c} ${e.lineweight}`;
    });

describe('the Table Cell menu’s formatting (M4-05 part 4)', () => {
  it('aligns the cells selected, each a format of its own, in one undo step', async () => {
    const s = setup();
    await nozzles(s);
    await s.bus.pick(at(2, 0));
    await s.bus.pick(at(3, 1), { shift: true });
    await s.bus.submit('AL');
    // The first cell's alignment is the default: data rows are top centre in the style.
    expect(s.bus.promptText).toBe('Enter cell alignment [TL/TC/TR/ML/MC/MR/BL/BC/BR] <TC>:');
    expect(s.prompt()!.shortcutMenu!.map((m) => m.label)).toEqual([
      'Top Left',
      'Top Center',
      'Top Right',
      'Middle Left',
      'Middle Center',
      'Middle Right',
      'Bottom Left',
      'Bottom Center',
      'Bottom Right',
    ]);
    await s.bus.submit('MR');
    expect(s.bus.promptText).toBe('Command:');
    for (const [i, j] of [
      [2, 0],
      [2, 1],
      [3, 0],
      [3, 1],
    ] as const) {
      expect(formatOf(s, i, j)).toEqual({ alignment: 6 });
    }
    expect(formatOf(s, 4, 0)).toBeUndefined();
    // The block is drawn again: N1 at the middle right of its cell, less the margin.
    const n1 = s.model
      .blockEntities(s.table().geom.block!)
      .map((id) => s.model.entity(id)!.geom)
      .find((g) => g.kind === 'MTEXT' && g.contents === 'N1');
    expect(n1).toMatchObject({ attachment: 6, position: { x: 62, y: -24.5 } });
    await s.bus.submit('U');
    expect(formatOf(s, 2, 0)).toBeUndefined();
  });

  it('fills the cells’ background, or takes the fill off', async () => {
    const s = setup();
    await nozzles(s);
    await s.bus.pick(at(1, 0));
    await s.bus.submit('BA');
    expect(s.bus.promptText).toBe('Enter background fill color [None] <None>:');
    await s.bus.submit('nonsense');
    expect(s.messages).toContain('Invalid color.');
    await s.bus.submit('yellow');
    expect(formatOf(s, 1, 0)).toEqual({ background: { kind: 'aci', index: 2 } });
    const solids = () =>
      s.model
        .blockEntities(s.table().geom.block!)
        .map((id) => s.model.entity(id)!)
        .filter((e) => e.geom.kind === 'SOLID');
    expect(solids().map((e) => e.color)).toEqual([{ kind: 'aci', index: 2 }]);
    await s.bus.pick(at(1, 0));
    await s.bus.submit('BA');
    await s.bus.submit('120,30,200');
    expect(formatOf(s, 1, 0)!.background).toEqual({ kind: 'rgb', r: 120, g: 30, b: 200 });
    await s.bus.pick(at(1, 0));
    await s.bus.submit('BA');
    await s.bus.submit('');
    expect(formatOf(s, 1, 0)).toEqual({ background: null });
    expect(solids()).toEqual([]);
  });

  it('gives the outside borders of the cells selected a colour and lineweight', async () => {
    const s = setup();
    await nozzles(s);
    await s.bus.pick(at(2, 0));
    await s.bus.pick(at(3, 1), { shift: true });
    await s.bus.submit('BO');
    expect(s.bus.promptText).toBe(
      'Apply the border properties to [All/Outside/Inside/Top/Bottom/Left/Right] <All>:',
    );
    await s.bus.submit('O');
    expect(s.bus.promptText).toBe('Enter border color <BYBLOCK>:');
    await s.bus.submit('1');
    expect(s.bus.promptText).toBe('Enter border lineweight <ByBlock>:');
    await s.bus.submit('0.45');
    expect(s.messages).toContain('Invalid lineweight.');
    await s.bus.submit('0.5');
    expect(s.bus.promptText).toBe('Command:');
    const red = { color: { kind: 'aci', index: 1 }, lineweight: 50 };
    expect(formatOf(s, 2, 0)!.borders).toEqual({ top: red, left: red });
    expect(formatOf(s, 3, 1)!.borders).toEqual({ right: red, bottom: red });
    // Drawn red: the range's outline, the line between its rows as the style draws it.
    expect(blockLines(s)).toEqual(
      expect.arrayContaining([
        '0,-20 127,-20 1 50',
        '0,-38 127,-38 1 50',
        '0,-29 127,-29 byBlock ByBlock',
        '0,-20 0,-38 1 50',
        '127,-20 127,-38 1 50',
      ]),
    );
  });

  it('gives inside and one-side borders, Enter taking ByBlock', async () => {
    const s = setup();
    await nozzles(s);
    await s.bus.pick(at(2, 0));
    await s.bus.pick(at(3, 1), { shift: true });
    await s.bus.script(['BO', 'I', 'blue', '']);
    expect(formatOf(s, 2, 0)!.borders).toEqual({
      right: { color: { kind: 'aci', index: 5 }, lineweight: 'ByBlock' },
      bottom: { color: { kind: 'aci', index: 5 }, lineweight: 'ByBlock' },
    });
    await s.bus.pick(at(4, 1));
    await s.bus.script(['BO', 'B', '', '0.3']);
    expect(formatOf(s, 4, 1)!.borders).toEqual({
      bottom: { color: { kind: 'byBlock' }, lineweight: 30 },
    });
  });

  it('sets the text height, its rows growing to fit', async () => {
    const s = setup();
    await nozzles(s);
    await s.bus.pick(at(2, 1));
    await s.bus.submit('H');
    expect(s.bus.promptText).toBe('Specify text height <4.5000>:');
    await s.bus.submit('0');
    expect(s.messages).toContain('Requires a value greater than 0.');
    await s.bus.submit('7');
    expect(formatOf(s, 2, 1)).toEqual({ textHeight: 7 });
    // One line of 7 high text and its 1.5 margins: the row grows from 9 to 10.
    expect(s.table().geom.rowHeights).toEqual([11, 9, 10, 9, 9]);
    // Smaller text leaves the row as high as it is.
    await s.bus.pick({ x: 95.25, y: -25 });
    await s.bus.script(['H', '2']);
    expect(s.table().geom.rowHeights).toEqual([11, 9, 10, 9, 9]);
  });

  it('selects the cells a press is dragged across', async () => {
    const s = setup();
    await nozzles(s);
    await s.bus.pick(at(2, 0), { grip: 1 });
    expect(s.prompt()!.releaseExtends).toBe(true);
    await s.bus.pick(at(4, 1), { release: true });
    expect(s.preview()[0]).toMatchObject({
      vertices: [
        { x: 0, y: -47 },
        { x: 127, y: -47 },
        { x: 127, y: -20 },
        { x: 0, y: -20 },
      ],
    });
    // Let go outside the table, the cells stay selected.
    await s.bus.pick({ x: 500, y: 500 }, { release: true });
    expect(s.bus.command).toBe('TABLECELL');
    await s.bus.submit('MA');
    expect(s.table().geom.cells[2]![0]).toMatchObject({ rowSpan: 3, columnSpan: 2 });
  });
});

describe('a table’s grips and SCALE (M4-05 part 4)', () => {
  /** The nozzle schedule, selected by a pick on its lines. */
  async function selected() {
    let ids: EntityId[] = [];
    const s = setup(() => ids);
    await nozzles(s);
    ids = [s.table().id];
    await s.bus.pick({ x: 63.8, y: -24.5 }, { grip: 1 });
    ids = [];
    expect(s.selected()).toEqual([s.table().id]);
    return s;
  }

  it('moves the line between two columns by its grip, the block drawn again', async () => {
    const s = await selected();
    await s.bus.pick({ x: 63.5, y: 0 }, { grip: 1 });
    expect(s.bus.command).toBe('GRIP');
    await s.bus.pick({ x: 73.5, y: 5 });
    expect(s.table().geom.columnWidths).toEqual([73.5, 53.5]);
    expect(blockLines(s)).toContain('73.5,-11 73.5,-47 byBlock ByBlock');
    await s.bus.submit('U');
    expect(s.table().geom.columnWidths).toEqual([63.5, 63.5]);
  });

  it('sizes the whole table by its corner grip', async () => {
    const s = await selected();
    await s.bus.pick({ x: 127, y: -47 }, { grip: 1 });
    await s.bus.pick({ x: 254, y: -94 });
    expect(s.table().geom.columnWidths).toEqual([127, 127]);
    expect(s.table().geom.rowHeights).toEqual([22, 18, 18, 18, 18]);
    // Its text keeps its height.
    expect(s.table().geom.cells[2]![0]!.format).toBeUndefined();
  });

  it('is scaled whole by SCALE, its text and margins with it', async () => {
    const s = await selected();
    await s.bus.script(['SCALE', '0,0', '2']);
    const g = s.table().geom;
    expect(g.columnWidths).toEqual([127, 127]);
    expect(g.rowHeights).toEqual([22, 18, 18, 18, 18]);
    expect(g.cells[0]![0]!.format).toEqual({ textHeight: 12 });
    expect(g.cells[2]![1]!.format).toEqual({ textHeight: 9 });
    expect(g.overrides).toEqual({ margins: { left: 3, top: 3, right: 3, bottom: 3 } });
    // Drawn again later, the table is as SCALE left it.
    await s.bus.pick({ x: 63.5 * 3, y: -60 });
    await s.bus.submit('AL');
    await s.bus.submit('TL');
    const n1 = s.model
      .blockEntities(s.table().geom.block!)
      .map((id) => s.model.entity(id)!.geom)
      .find((x) => x.kind === 'MTEXT' && x.contents === 'DN80');
    expect(n1).toMatchObject({ height: 9, position: { x: 130, y: -61 } });
  });
});
