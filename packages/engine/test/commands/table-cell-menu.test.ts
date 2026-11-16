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
  'Enter a table cell option [Text/Above/Below/DeleteRows/Left/Right/DeleteColumns/MergeAll/MergeRows/MergeColumns/Unmerge]:';

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
