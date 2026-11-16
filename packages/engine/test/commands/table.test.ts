// M4-05: -TABLE on AutoCAD 2024's prompts ("-TABLE (Command)"): columns, data rows, then the
// insertion point with the Style, Width and Height options; the table gets a title and header
// row, the current table style (AutoCAD's Standard in a drawing without one), and a `*T` block
// drawn by the table engine on its layer.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  standardTableStyle,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type HeaderValue,
  type TableGeometry,
  type TableStyleRecord,
} from '../../src/index';
import { LAYER_WALLS, sampleInit } from '../model/fixtures';

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

function setup(
  options: {
    styles?: TableStyleRecord[];
    header?: [string, HeaderValue][];
    imperial?: boolean;
  } = {},
) {
  const init = sampleInit();
  const withStyles: DocumentInit = {
    ...init,
    meta: { ...init.meta, measurement: options.imperial ? 'imperial' : 'metric' },
    tables: {
      ...init.tables,
      textStyles: [textStyle('16', 'Standard'), textStyle('17', 'Notes')],
      ...(options.styles && { tableStyles: options.styles }),
    },
  };
  for (const [k, v] of options.header ?? [])
    (withStyles.header as Map<string, HeaderValue>).set(k, v);
  const model = DocumentModel.create(withStyles);
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const messages: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') messages.push(e.line);
  });
  const tables = (): (Entity & { geom: TableGeometry })[] =>
    [...model.entities()].filter(
      (e): e is Entity & { geom: TableGeometry } =>
        !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
    );
  return { model, bus, messages, tables };
}

const ACADISO: TableStyleRecord = { handle: '90', ...standardTableStyle(true, '16') };
const TALL: TableStyleRecord = {
  ...ACADISO,
  handle: '91',
  name: 'Tall',
  suppressTitle: true,
  cellStyles: ACADISO.cellStyles.map((c) => ({ ...c, textHeight: 10 })),
};

describe('-TABLE', () => {
  it('inserts a table of the current style with a title, header and data rows', async () => {
    const { bus, model, messages, tables } = setup({ styles: [ACADISO, TALL] });
    await bus.submit('-TABLE');
    expect(messages).toContain(
      'Current table style: Standard  Cell width: 63.5000  Cell height: 1 line(s)',
    );
    expect(bus.promptText).toBe('Enter number of columns or [Auto] <5>:');
    await bus.submit('3');
    expect(bus.promptText).toBe('Enter number of rows or [Auto] <1>:');
    await bus.submit('2');
    expect(bus.promptText).toBe('Specify insertion point or [Style/Width/Height]:');
    await bus.submit('10,20');
    expect(bus.promptText).toBe('Command:');
    const [t] = tables();
    expect(tables()).toHaveLength(1);
    expect(t).toMatchObject({ layer: LAYER_WALLS });
    const g = t!.geom;
    expect(g).toMatchObject({
      style: '90',
      position: { x: 10, y: 20 },
      direction: { x: 1, y: 0 },
      columnWidths: [63.5, 63.5, 63.5],
    });
    // Title 6 high, the rest 4.5: 4/3 a line and 1.5 margins.
    expect(g.rowHeights.map(r4)).toEqual([11, 9, 9, 9]);
    expect(g.cells[0]!.map((c) => [c.columnSpan, c.merged])).toEqual([
      [3, false],
      [1, true],
      [1, true],
    ]);
    expect(g.cells.flat().every((c) => c.type === 'text' && c.text === '')).toBe(true);
    // Its block is the engine's: four row lines... on the table's layer, a Defpoints line.
    const block = model.blocks.get(g.block!)!;
    expect(block.name).toMatch(/^\*T\d+$/);
    const inside = model.blockEntities(g.block!).map((id) => model.entity(id)!);
    expect(inside.filter((e) => e.geom.kind === 'LINE')).toHaveLength(5 + 4 + 1);
    expect(
      inside
        .filter((e) => e.geom.kind === 'LINE')
        .slice(0, -1)
        .every((e) => e.layer === LAYER_WALLS),
    ).toBe(true);
    const defpoints = [...model.tables.layers.values()].find((l) => l.name === 'Defpoints');
    expect(defpoints).toMatchObject({ plot: false });
    expect(inside.at(-1)).toMatchObject({
      layer: defpoints!.handle,
      color: { kind: 'aci', index: 8 },
    });
    // One undo takes it all back.
    await bus.submit('U');
    expect(tables()).toEqual([]);
    expect(model.blocks.has(g.block!)).toBe(false);
  });

  it('keeps the columns, rows, width and height for the next table', async () => {
    const { bus, tables } = setup({ styles: [ACADISO] });
    await bus.submit('-TABLE');
    await bus.submit('2');
    await bus.submit('3');
    await bus.submit('W');
    expect(bus.promptText).toBe('Specify column width <63.5000>:');
    await bus.submit('-1');
    expect(bus.promptText).toBe('Specify column width <63.5000>:');
    await bus.submit('40');
    expect(bus.promptText).toBe('Specify insertion point or [Style/Width/Height]:');
    await bus.submit('H');
    expect(bus.promptText).toBe('Enter row height (in lines) <1>:');
    await bus.submit('0');
    await bus.submit('2');
    await bus.submit('0,0');
    expect(tables()[0]!.geom.columnWidths).toEqual([40, 40]);
    expect(tables()[0]!.geom.rowHeights.map(r4)).toEqual([19, 15, 15, 15, 15]);
    await bus.submit('-TABLE');
    expect(bus.promptText).toBe('Enter number of columns or [Auto] <2>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Enter number of rows or [Auto] <3>:');
    await bus.submit('');
    await bus.submit('0,-100');
    expect(tables()[1]!.geom.columnWidths).toEqual([40, 40]);
    expect(tables()[1]!.geom.rowHeights).toHaveLength(5);
  });

  it('takes another style by name, lists them with ?, refuses unknown names', async () => {
    const { bus, messages, tables } = setup({ styles: [ACADISO, TALL] });
    await bus.submit('-TABLE');
    await bus.submit('1');
    await bus.submit('1');
    await bus.submit('S');
    expect(bus.promptText).toBe('Enter a table style name or [?] <Standard>:');
    await bus.submit('?');
    expect(messages).toEqual(expect.arrayContaining(['Table styles:', '  Standard', '  Tall']));
    await bus.submit('nope');
    expect(messages).toContain('Cannot find table style "nope".');
    await bus.submit('tall');
    await bus.submit('0,0');
    const g = tables()[0]!.geom;
    // Tall has no title row: a header and a data row of 10 text.
    expect(g.style).toBe('91');
    expect(g.rowHeights.map(r4)).toEqual([16.3333, 16.3333]);
    expect(g.cells[0]![0]!.columnSpan).toBe(1);
  });

  it('takes the style CTABLESTYLE names', async () => {
    const { bus, messages, tables } = setup({
      styles: [ACADISO, TALL],
      header: [['CTABLESTYLE', 'Tall']],
    });
    await bus.submit('-TABLE');
    expect(messages[1]).toMatch(/^Current table style: Tall/);
    await bus.submit('');
    await bus.submit('');
    await bus.submit('0,0');
    expect(tables()[0]!.geom.style).toBe('91');
  });

  it('gives a drawing without table styles AutoCAD’s Standard', async () => {
    const { bus, model, messages, tables } = setup({ imperial: true });
    await bus.submit('-TABLE');
    expect(messages[1]).toBe(
      'Current table style: Standard  Cell width: 2.5000  Cell height: 1 line(s)',
    );
    await bus.submit('');
    await bus.submit('');
    await bus.submit('S');
    await bus.submit('Standard');
    await bus.submit('0,0');
    const styles = [...model.tables.tableStyles.values()];
    expect(styles).toHaveLength(1);
    expect(styles[0]).toMatchObject({ name: 'Standard', horizontalMargin: 0.06 });
    const g = tables()[0]!.geom;
    expect(g.style).toBe(styles[0]!.handle);
    expect(g.columnWidths).toEqual([2.5, 2.5, 2.5, 2.5, 2.5]);
    expect(g.rowHeights.map(r4)).toEqual([0.4533, 0.36, 0.36]);
    // The texts the cells will hold take Standard's text style.
    expect(styles[0]!.cellStyles.every((c) => c.textStyle === '16')).toBe(true);
  });

  it('makes no table in a drawing without text styles, which a table style needs', async () => {
    const init = sampleInit();
    const model = DocumentModel.create(init);
    const bus = new PromptBus({ model, registry: builtinCommands() });
    await bus.submit('-TABLE');
    expect(bus.history).toContain('The drawing has no text style, which a table style needs.');
    expect(bus.promptText).toBe('Command:');
    expect(model.tables.tableStyles.size).toBe(0);
  });

  it('asks again for a count out of range or Auto, and ends on Esc', async () => {
    const { bus, messages, tables } = setup({ styles: [ACADISO] });
    await bus.submit('-TABLE');
    await bus.submit('0');
    expect(messages).toContain('Value must be between 1 and 32767.');
    await bus.submit('A');
    expect(messages).toContain('Auto is not available yet: enter a number.');
    expect(bus.promptText).toBe('Enter number of columns or [Auto] <5>:');
    await bus.cancel();
    expect(bus.promptText).toBe('Command:');
    for (const answers of [['2'], ['2', '1', 'S'], ['2', '1', 'W'], ['2', '1', 'H'], ['2', '1']]) {
      await bus.submit('-TABLE');
      for (const a of answers) await bus.submit(a);
      await bus.cancel();
      expect(bus.promptText).toBe('Command:');
    }
    expect(tables()).toEqual([]);
  });
});
