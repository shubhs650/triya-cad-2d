// M4-05 part 5: TABLESTYLE's Table Style dialog on the PromptBus (Set Current, New, Modify,
// Rename, Delete), the Insert Table dialog's style launcher, and MATCHPROP's Table setting.
import { describe, expect, it } from 'vitest';
import {
  ALL_MATCH_SETTINGS,
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  builtinCommands,
  standardTableStyle,
  tableStylePreview,
  tableStyleProblem,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type HeaderValue,
  type InsertTableSettings,
  type TableGeometry,
  type TableStyleAction,
  type TableStyleRequest,
  type TableStyleRecord,
  type TableStyleSettings,
  type TextStyleRecord,
  type ViewHost,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

const text = (handle: string, name: string): TextStyleRecord => ({
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

const STANDARD: TableStyleRecord = { handle: '90', ...standardTableStyle(true, '16') };
const PARTS: TableStyleRecord = {
  ...STANDARD,
  handle: '91',
  name: 'Parts',
  description: 'Parts list',
};

type Table = Entity & { geom: TableGeometry };

function setup(
  o: {
    tableStyles?: TableStyleRecord[];
    textStyles?: TextStyleRecord[];
    header?: [string, HeaderValue][];
    view?: ViewHost;
  } = {},
) {
  const init = sampleInit();
  const withStyles: DocumentInit = {
    ...init,
    header: new Map([...(init.header ?? []), ...(o.header ?? [['CTABLESTYLE', 'Standard']])]),
    tables: {
      ...init.tables,
      textStyles: o.textStyles ?? [text('16', 'Standard'), text('17', 'Notes')],
      tableStyles: o.tableStyles ?? [STANDARD, PARTS],
    },
  };
  const model = DocumentModel.create(withStyles);
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: o.view ?? { request: () => Promise.resolve({ ok: false, message: 'no view' }) },
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => e.type === 'log' && log.push(e.line));
  const request = () => {
    const p = bus.prompt;
    if (p?.kind !== 'dialog' || p.dialog.type !== 'tablestyle') return undefined;
    return p.dialog as TableStyleRequest;
  };
  const act = async (tablestyle: TableStyleAction) => {
    await bus.answer({ kind: 'dialog', action: 'apply', tablestyle });
    return request()!;
  };
  const style = (name: string) =>
    [...model.tables.tableStyles.values()].find((s) => s.name === name);
  const tables = () =>
    [...model.entities()].filter((e): e is Table => e.geom.kind === 'ACAD_TABLE');
  return { model, bus, log, request, act, style, tables };
}

/** The settings with every field the dialog sets changed. */
function changed(s: TableStyleSettings): TableStyleSettings {
  return {
    description: 'Changed',
    up: true,
    horizontalMargin: 2,
    verticalMargin: 2.5,
    data: {
      ...s.data,
      fill: { kind: 'aci', index: 2 },
      alignment: 6,
      textStyle: 'Notes',
      textHeight: 5,
      textColor: { kind: 'aci', index: 3 },
      borders: s.data.borders.map((b, k) => ({
        lineweight: 35,
        color: { kind: 'aci', index: 1 },
        visible: k !== 1,
      })),
    },
    header: { ...s.header, fill: { kind: 'byLayer' }, alignment: 1 },
    title: { ...s.title, textHeight: 8, fill: null },
  };
}

describe('TABLESTYLE', () => {
  it('lists the styles, the current one, their settings and the text styles', async () => {
    const t = setup();
    await t.bus.script(['TS']);
    const r = t.request()!;
    expect(r.styles.map((s) => s.name)).toEqual(['Parts', 'Standard']);
    expect(r).toMatchObject({ current: 'Standard', selected: 'Standard' });
    expect(r.textStyles).toEqual(['Notes', 'Standard']);
    const s = r.styles[1]!.settings;
    expect(s).toMatchObject({ up: false, horizontalMargin: 1.5, verticalMargin: 1.5 });
    expect(s.data).toMatchObject({
      fill: null,
      alignment: 2,
      textStyle: 'Standard',
      textHeight: 4.5,
    });
    expect(s.title).toMatchObject({ alignment: 5, textHeight: 6 });
    expect(s.header.borders).toHaveLength(6);
    expect(r.styles[0]!.settings.description).toBe('Parts list');
    // Close ends it.
    await t.bus.answer({ kind: 'dialog', action: 'ok' });
    expect(t.bus.command).toBeUndefined();
  });

  it('makes a style current where the drawing keeps CTABLESTYLE, and says why not elsewhere', async () => {
    const t = setup();
    await t.bus.script(['TABLESTYLE']);
    let r = await t.act({ op: 'current', name: 'parts' });
    expect(t.model.header.get('CTABLESTYLE')).toBe('Parts');
    expect(r).toMatchObject({ current: 'Parts', selected: 'Parts' });
    r = await t.act({ op: 'current', name: 'Parts' });
    expect(r.note).toBeUndefined();
    await t.act({ op: 'current', name: 'Nothing' });

    const u = setup({ header: [] });
    await u.bus.script(['TABLESTYLE']);
    r = await u.act({ op: 'current', name: 'Parts' });
    expect(r.note).toBe(
      'This drawing keeps no CTABLESTYLE variable, so another style cannot be made current.',
    );
    expect(r.current).toBe('Standard');
  });

  it('makes a new style from the settings, and refuses a taken or invalid name and bad settings', async () => {
    const t = setup();
    await t.bus.script(['TABLESTYLE']);
    const base = t.request()!.styles[1]!.settings;
    const settings = changed(base);
    let r = await t.act({ op: 'new', name: ' Schedule ', settings });
    expect(r.selected).toBe('Schedule');
    expect(r.styles.find((s) => s.name === 'Schedule')!.settings).toEqual(settings);
    const made = t.style('Schedule')!;
    expect(made.flowDirection).toBe(1);
    expect(made.cellStyles[0]).toMatchObject({
      textStyle: '17',
      fillOn: true,
      fillColor: { kind: 'aci', index: 2 },
      alignment: 6,
    });
    // The title's fill off keeps the colour the style held.
    expect(made.cellStyles[1]).toMatchObject({ fillOn: false, textHeight: 8 });
    expect(made.cellStyles[0]!.borders[1]!.visible).toBe(false);
    // Not current: New does not make it so.
    expect(r.current).toBe('Standard');

    r = await t.act({ op: 'new', name: 'schedule', settings });
    expect(r.note).toBe('A table style with this name already exists.');
    r = await t.act({ op: 'new', name: 'a<b', settings });
    expect(r.note).toBe('Invalid table style name.');
    r = await t.act({ op: 'new', name: 'Bad', settings: { ...settings, verticalMargin: -1 } });
    expect(r.note).toBe('A cell margin must be 0 or more.');
    const bad = (data: Partial<TableStyleSettings['data']>) =>
      t.act({
        op: 'new',
        name: 'Bad',
        settings: { ...settings, data: { ...settings.data, ...data } },
      });
    expect((await bad({ textHeight: 0 })).note).toBe(
      'Data cell style: the text height must be greater than 0.',
    );
    expect((await bad({ alignment: 10 })).note).toBe('Data cell style: choose an alignment.');
    expect((await bad({ textStyle: 'Gone' })).note).toBe(
      'Data cell style: choose a text style of the drawing.',
    );
    expect((await bad({ fill: { kind: 'rgb', r: 1, g: 2, b: 3 } })).note).toBe(
      'Data cell style: a table style takes index colors only.',
    );
    const borders = settings.data.borders.map((b) => ({ ...b, lineweight: 7 }));
    expect((await bad({ borders })).note).toBe(
      'Data cell style: choose a lineweight from the list.',
    );
    // Malformed settings (not from the dialog) do nothing.
    r = await t.act({ op: 'new', name: 'Odd', settings: { up: 1 } as never });
    expect(r.note).toBeUndefined();
    expect(t.style('Bad')).toBeUndefined();
    expect(t.style('Odd')).toBeUndefined();
  });

  it('modifies a style, drawing its tables again with their rows grown to the new text', async () => {
    const t = setup();
    await t.bus.script(['-TABLE', '2', '2', '0,0']);
    await t.bus.cancel();
    await t.bus.script(['-TABLE', '2', '1', 'Style', 'Parts', '0,100']);
    await t.bus.cancel();
    const [standard, parts] = t.tables();
    const block = (tbl: Table) => [...t.model.blockEntities(tbl.geom.block!)].length;
    const before = { heights: standard!.geom.rowHeights, parts: parts!.geom };
    await t.bus.script(['TABLESTYLE']);
    const settings = changed(t.request()!.styles[1]!.settings);
    const version = t.model.version;
    let r = await t.act({ op: 'modify', name: 'Standard', settings });
    expect(r.note).toBeUndefined();
    expect(r.styles.find((s) => s.name === 'Standard')!.settings).toEqual(settings);
    const now = t.model.entity(standard!.id) as Table;
    // Data rows of 5 high text and 2.5 margins: 10 high; the title row 8 + 5.
    expect(now.geom.rowHeights[2]).toBeCloseTo(10);
    expect(now.geom.rowHeights[0]).toBeCloseTo(13);
    expect(now.geom.rowHeights.every((h, k) => h >= before.heights[k]!)).toBe(true);
    // Its block is drawn again: the data rows' fill is a SOLID per cell now.
    const solids = [...t.model.blockEntities(now.geom.block!)]
      .map((id) => t.model.entity(id)!.geom.kind)
      .filter((k) => k === 'SOLID');
    expect(solids.length).toBeGreaterThanOrEqual(4);
    expect(block(now)).toBeGreaterThan(0);
    // A table in another style is left as it was.
    expect((t.model.entity(parts!.id) as Table).geom).toEqual(before.parts);
    // Modify with nothing changed makes no edit.
    const after = t.model.version;
    expect(after).toBeGreaterThan(version);
    await t.act({ op: 'modify', name: 'Standard', settings });
    expect(t.model.version).toBe(after);
    r = await t.act({
      op: 'modify',
      name: 'Standard',
      settings: { ...settings, horizontalMargin: NaN },
    });
    expect(r.note).toBe('A cell margin must be 0 or more.');
    r = await t.act({ op: 'modify', name: 'Nothing', settings });
    expect(r.note).toBeUndefined();
    // The edit is one undo step with the command.
    await t.bus.answer({ kind: 'dialog', action: 'ok' });
    await t.bus.script(['U']);
    expect((t.model.entity(standard!.id) as Table).geom.rowHeights).toEqual(before.heights);
  });

  it('keeps a row as high as the renderer lays its text out', async () => {
    // A canvas where every text takes two lines.
    const view: ViewHost = {
      request: (q) =>
        Promise.resolve(
          q.op === 'textBox'
            ? { ok: true, box: { minX: 0, minY: 0, maxX: 1, maxY: q.text.height * (1 + 5 / 3) } }
            : { ok: false, message: 'no' },
        ),
    };
    const t = setup({ view });
    await t.bus.script(['-TABLE', '1', '1', '0,0']);
    for (const [k, value] of ['T', 'H', 'D'].entries())
      await t.bus.answer({ kind: 'string', value, editor: true, ...(k < 2 && { cell: 'next' }) });
    const [table] = t.tables();
    await t.bus.script(['TABLESTYLE']);
    const s = t.request()!.styles[1]!.settings;
    await t.act({
      op: 'modify',
      name: 'Standard',
      settings: { ...s, data: { ...s.data, textHeight: 6 } },
    });
    const g = (t.model.entity(table!.id) as Table).geom;
    // Two lines of 6 high text, 5/3 apart, and a 1.5 margin above and below.
    expect(g.rowHeights[2]).toBeCloseTo(6 * (1 + 5 / 3) + 3);
  });

  it('renames a style, CTABLESTYLE following, but not Standard or onto a taken name', async () => {
    const t = setup({ header: [['CTABLESTYLE', 'PARTS']] });
    await t.bus.script(['TABLESTYLE']);
    let r = await t.act({ op: 'rename', name: 'Parts', to: 'Bill' });
    expect(r).toMatchObject({ selected: 'Bill', current: 'Bill' });
    expect(t.model.header.get('CTABLESTYLE')).toBe('Bill');
    r = await t.act({ op: 'rename', name: 'Standard', to: 'X' });
    expect(r.note).toBe('Standard cannot be renamed.');
    r = await t.act({ op: 'rename', name: 'Bill', to: 'standard' });
    expect(r.note).toBe('A table style with this name already exists.');
    r = await t.act({ op: 'rename', name: 'Bill', to: 'Bill' });
    expect(r.note).toBeUndefined();
    r = await t.act({ op: 'rename', name: 'Gone', to: 'X' });
    expect(r.selected).toBe('Bill');
    // A style that is not current renames without CTABLESTYLE.
    await t.act({ op: 'current', name: 'Standard' });
    await t.act({ op: 'rename', name: 'Bill', to: 'Parts' });
    expect(t.model.header.get('CTABLESTYLE')).toBe('Standard');
  });

  it('deletes a spare style, never Standard, the current style or one in use', async () => {
    const extra: TableStyleRecord = { ...PARTS, handle: '92', name: 'Spare' };
    const t = setup({ tableStyles: [STANDARD, PARTS, extra], header: [['CTABLESTYLE', 'Parts']] });
    await t.bus.script(['-TABLE', '1', '1', '0,0']);
    await t.bus.cancel();
    await t.bus.script(['TABLESTYLE']);
    let r = await t.act({ op: 'delete', name: 'Standard' });
    expect(r.note).toBe('Standard cannot be deleted.');
    r = await t.act({ op: 'delete', name: 'Parts' });
    expect(r.note).toBe('The current table style cannot be deleted.');
    await t.act({ op: 'current', name: 'Spare' });
    r = await t.act({ op: 'delete', name: 'Parts' });
    expect(r.note).toBe('Style in use, can’t be deleted.');
    expect(r.styles.find((s) => s.name === 'Parts')!.used).toBe(true);
    await t.act({ op: 'current', name: 'Standard' });
    r = await t.act({ op: 'delete', name: 'Spare' });
    expect(r.note).toBeUndefined();
    expect(r.selected).toBe('Standard');
    expect(t.style('Spare')).toBeUndefined();
    r = await t.act({ op: 'delete', name: 'Gone' });
    expect(r.note).toBeUndefined();
  });

  it('lists AutoCAD’s Standard in a drawing without table styles, added by the first action', async () => {
    const t = setup({ tableStyles: [] });
    await t.bus.script(['TABLESTYLE']);
    let r = t.request()!;
    expect(r.styles).toMatchObject([{ name: 'Standard', unsaved: true, used: false }]);
    expect(r.current).toBe('Standard');
    // Set Current on it is already so.
    r = await t.act({ op: 'current', name: 'Standard' });
    expect(t.model.tables.tableStyles.size).toBe(0);
    // Modify with nothing changed adds nothing.
    r = await t.act({ op: 'modify', name: 'Standard', settings: r.styles[0]!.settings });
    expect(t.model.tables.tableStyles.size).toBe(0);
    const settings = changed(r.styles[0]!.settings);
    r = await t.act({ op: 'modify', name: 'Standard', settings });
    expect(t.model.tables.tableStyles.size).toBe(1);
    expect(r.styles).toMatchObject([{ name: 'Standard', settings }]);
    expect(r.styles[0]!.unsaved).toBeUndefined();

    const u = setup({ tableStyles: [] });
    await u.bus.script(['TABLESTYLE']);
    const s = u.request()!.styles[0]!.settings;
    r = await u.act({ op: 'new', name: 'Mine', settings: s });
    expect(r.styles.map((x) => x.name)).toEqual(['Mine', 'Standard']);
  });

  it('lists no style in a drawing without text styles, and makes none', async () => {
    const v = setup();
    await v.bus.script(['TABLESTYLE']);
    const settings = v.request()!.styles[1]!.settings;
    const t = setup({ tableStyles: [], textStyles: [] });
    await t.bus.script(['TABLESTYLE']);
    expect(t.request()).toMatchObject({ styles: [], current: '', selected: '', textStyles: [] });
    const r = await t.act({ op: 'new', name: 'Mine', settings });
    expect(r.note).toBe('The drawing has no text style, which a table style needs.');
  });

  it('checks settings against the drawing’s text styles', () => {
    const settings = {
      description: '',
      up: false,
      horizontalMargin: 1,
      verticalMargin: 1,
      data: {
        fill: null,
        alignment: 1,
        textStyle: 'standard',
        textHeight: 1,
        textColor: { kind: 'byBlock' },
        borders: [],
      },
    } as unknown as TableStyleSettings;
    const all = { ...settings, header: settings.data, title: settings.data };
    expect(tableStyleProblem(all, ['Standard'])).toBeUndefined();
    expect(tableStyleProblem(all, [])).toBe('Data cell style: choose a text style of the drawing.');
  });
});

describe('the Insert Table dialog’s table style launcher', () => {
  type Insert = { kind: string; dialog: { type: string; settings: InsertTableSettings } };
  it('opens the Table Style dialog and comes back on the style chosen before', async () => {
    const t = setup();
    await t.bus.script(['TABLE']);
    let p = t.bus.prompt as Insert;
    expect(p.dialog.type).toBe('inserttable');
    const settings = { ...p.dialog.settings, columns: 3 };
    await t.bus.answer({
      kind: 'dialog',
      action: 'select',
      table: { ...settings, style: 'Parts' },
    });
    expect(t.request()!.selected).toBe('Parts');
    await t.act({ op: 'new', name: 'Fresh', settings: t.request()!.styles[0]!.settings });
    await t.bus.answer({ kind: 'dialog', action: 'ok' });
    p = t.bus.prompt as Insert;
    expect(p.dialog.type).toBe('inserttable');
    expect(p.dialog.settings).toMatchObject({ style: 'Parts', columns: 3 });
    const listed = (p.dialog as unknown as { styles: { name: string }[] }).styles;
    expect(listed.map((s) => s.name)).toContain('Fresh');
    await t.bus.cancel();
  });

  it('comes back on the style made current there, or Standard when the one chosen is gone', async () => {
    const t = setup();
    await t.bus.script(['TABLE']);
    let p = t.bus.prompt as Insert;
    await t.bus.answer({ kind: 'dialog', action: 'select', table: p.dialog.settings });
    await t.act({ op: 'current', name: 'Parts' });
    await t.bus.answer({ kind: 'dialog', action: 'ok' });
    p = t.bus.prompt as Insert;
    expect(p.dialog.settings.style).toBe('Parts');
    // A style chosen that is gone by then: back on the current style.
    await t.bus.answer({
      kind: 'dialog',
      action: 'select',
      table: { ...p.dialog.settings, style: 'Gone' },
    });
    await t.bus.answer({ kind: 'dialog', action: 'ok' });
    p = t.bus.prompt as Insert;
    expect(p.dialog.settings.style).toBe('Parts');
    await t.bus.cancel();
    // In a drawing without table styles the chosen Standard stays.
    const u = setup({ tableStyles: [] });
    await u.bus.script(['TABLE']);
    let q = u.bus.prompt as Insert;
    await u.bus.answer({ kind: 'dialog', action: 'select', table: q.dialog.settings });
    await u.bus.answer({ kind: 'dialog', action: 'ok' });
    q = u.bus.prompt as Insert;
    expect(q.dialog.settings.style).toBe('Standard');
    await u.bus.cancel();
  });
});

describe('MATCHPROP Table', () => {
  it('gives a table the source table’s style and draws it again', async () => {
    const t = setup();
    await t.bus.script(['-TABLE', '2', '1', '0,0']);
    await t.bus.cancel();
    await t.bus.script(['-TABLE', '2', '1', 'Style', 'Parts', '0,100']);
    await t.bus.cancel();
    // Parts draws taller text, so the Standard table's rows grow to it.
    const b = new ChangeSetBuilder(t.model);
    const p = t.style('Parts')!;
    b.updateTableRecord('tableStyles', p.handle, {
      cellStyles: p.cellStyles.map((c) => ({ ...c, textHeight: 9 })),
    });
    t.model.apply(b.build());
    const [standard, parts] = t.tables();
    const picks = [parts!.id, standard!.id];
    const u = new PromptBus({
      model: t.model,
      registry: builtinCommands(),
      view: {
        request: (r) =>
          Promise.resolve(
            r.op === 'pick' ? { ok: true, ids: [picks.shift()!] } : { ok: false, message: 'no' },
          ),
      },
    });
    await u.script(['MATCHPROP']);
    await u.pick({ x: 1, y: 101 });
    await u.pick({ x: 1, y: -1 });
    const g = (t.model.entity(standard!.id) as Table).geom;
    expect(g.style).toBe(PARTS.handle);
    expect(g.rowHeights[2]).toBeCloseTo(9 + 3);
    // Its block is drawn in the source's style: the cells' text at the new height.
    const heights = [...t.model.blockEntities(g.block!)]
      .map((id) => t.model.entity(id)!.geom)
      .flatMap((x) => (x.kind === 'MTEXT' ? [x.height] : []));
    expect(heights.every((h) => h === 9)).toBe(true);
    await u.script(['']);
    expect(ALL_MATCH_SETTINGS.table).toBe(true);
  });

  it('leaves the style alone with Table off, and a non-table alone', async () => {
    const t = setup();
    await t.bus.script(['-TABLE', '2', '1', '0,0']);
    await t.bus.cancel();
    await t.bus.script(['-TABLE', '2', '1', 'Style', 'Parts', '0,100']);
    await t.bus.cancel();
    const [standard, parts] = t.tables();
    const { matchedPatch } = await import('../../src/index');
    const off = { ...ALL_MATCH_SETTINGS, table: false };
    expect(matchedPatch(t.model, parts!, standard!, off)).toBeUndefined();
    expect(matchedPatch(t.model, parts!, standard!, ALL_MATCH_SETTINGS)?.geom).toMatchObject({
      style: PARTS.handle,
    });
  });
});

describe('tableStylePreview', () => {
  it('draws AutoCAD’s sample table in the style: title, header and data rows of three columns', async () => {
    const t = setup();
    await t.bus.script(['TABLESTYLE']);
    const s = t.request()!.styles[1]!.settings;
    const p = tableStylePreview(s);
    const words = p.parts.flatMap((x) => (x.geom.kind === 'MTEXT' ? [x.geom.contents] : []));
    expect(words).toEqual(['Title', ...Array(3).fill('Header'), ...Array(12).fill('Data')]);
    expect(p.parts.some((x) => x.geom.kind === 'SOLID')).toBe(false);
    expect(p.maxY).toBe(0);
    expect(p.minY).toBeLessThan(0);
    // 5 times the tallest text and the margins a column.
    expect(p.width).toBeCloseTo(3 * (5 * 6 + 3));
    const up = tableStylePreview({ ...changed(s), up: true });
    expect(up.minY).toBe(0);
    expect(up.maxY).toBeGreaterThan(0);
    expect(up.parts.filter((x) => x.geom.kind === 'SOLID')).toHaveLength(15);
  });
});

describe('TABLESTYLE Select table to start from (M4-16 part 4)', () => {
  /** A Parts table of two columns and two data rows whose cells and overrides restyle it. */
  async function formattedTable(view?: ViewHost) {
    const t = setup(view ? { view } : {});
    await t.bus.script(['-TABLE', '2', '2', 'Style', 'Parts', '0,0']);
    await t.bus.cancel();
    const [table] = t.tables();
    const g = table!.geom;
    const cells = g.cells.map((row, i) =>
      row.map((c, j) => {
        if (i === 0 && j === 0)
          return {
            ...c,
            format: {
              alignment: 1,
              textHeight: 7,
              contentColor: { kind: 'aci', index: 1 },
              background: { kind: 'aci', index: 4 },
            },
          };
        if (i === 1 && j === 0)
          return {
            ...c,
            format: {
              textStyle: '17',
              borders: {
                top: { color: { kind: 'aci', index: 3 }, lineweight: 50 },
                bottom: { hidden: true },
              },
            },
          };
        if (i === 2 && j === 0)
          return {
            ...c,
            format: {
              background: null,
              borders: { bottom: { color: { kind: 'aci', index: 5 } }, right: { lineweight: 30 } },
            },
          };
        return c;
      }),
    ) as TableGeometry['cells'];
    const b = new ChangeSetBuilder(t.model);
    b.updateEntity(table!.id, {
      geom: { ...g, cells, overrides: { margins: { left: 3, top: 0.5 } } },
    });
    t.model.apply(b.build());
    return { ...t, table: t.model.entity(table!.id) as Table };
  }

  it('takes a table’s direction, margins and the first cell of each row type as the cell styles', async () => {
    const t = await formattedTable();
    const { tableStartSettings } = await import('../../src/index');
    await t.bus.script(['TABLESTYLE']);
    const was = changed(t.request()!.styles[1]!.settings);
    const s = tableStartSettings(t.model, t.table.geom, was);
    // The description is the style's being made; the rest is the table's.
    expect(s.description).toBe('Changed');
    expect(s).toMatchObject({ up: false, horizontalMargin: 3, verticalMargin: 0.5 });
    expect(s.title).toMatchObject({
      alignment: 1,
      textHeight: 7,
      textColor: { kind: 'aci', index: 1 },
      fill: { kind: 'aci', index: 4 },
      textStyle: 'Standard',
    });
    // The header row is one row: its first cell's bottom edge is the cell style's bottom border.
    expect(s.header.textStyle).toBe('Notes');
    expect(s.header.borders[0]).toEqual({
      lineweight: 50,
      color: { kind: 'aci', index: 3 },
      visible: true,
    });
    expect(s.header.borders[2]!.visible).toBe(false);
    expect(s.header.borders[1]).toEqual(STANDARD.cellStyles[2]!.borders[1]);
    // A data cell with rows below and columns to its right: its bottom and right edges are the
    // inside borders.
    expect(s.data.fill).toBeNull();
    expect(s.data.borders[1]!.color).toEqual({ kind: 'aci', index: 5 });
    expect(s.data.borders[4]!.lineweight).toBe(30);
    expect(s.data.borders[2]).toEqual(STANDARD.cellStyles[0]!.borders[2]);
    expect(s.data).toMatchObject({ alignment: 2, textHeight: 4.5 });
  });

  it('keeps a row type the table does not have as the style had it', async () => {
    const t = await formattedTable();
    const { tableStartSettings } = await import('../../src/index');
    await t.bus.script(['TABLESTYLE']);
    const was = changed(t.request()!.styles[1]!.settings);
    const g = t.table.geom;
    // A table of one row is a title row alone.
    const one = {
      ...g,
      rowHeights: g.rowHeights.slice(0, 1),
      cells: g.cells.slice(0, 1),
    };
    const s = tableStartSettings(t.model, one, was);
    expect(s.title.textHeight).toBe(7);
    expect(s.header).toEqual(was.header);
    expect(s.data).toEqual(was.data);
    // A table without a style of the drawing keeps the settings' direction and margins.
    const loose = tableStartSettings(t.model, { ...one, style: 'FFFF', overrides: {} }, was);
    expect(loose).toMatchObject({ up: true, horizontalMargin: 2, verticalMargin: 2.5 });
  });

  it('asks for a table and opens the style’s dialog again on what it gives', async () => {
    const picks: Entity['id'][][] = [];
    const t = await formattedTable({
      request: (r) =>
        Promise.resolve(
          r.op === 'pick' ? { ok: true, ids: picks.shift() ?? [] } : { ok: false, message: 'no' },
        ),
    });
    const line = [...t.model.entities()].find((e) => e.geom.kind === 'LINE');
    picks.push([line!.id], [t.table.id]);
    await t.bus.script(['TABLESTYLE']);
    const settings = changed(t.request()!.styles[1]!.settings);
    await t.bus.answer({
      kind: 'dialog',
      action: 'apply',
      tablestyle: { op: 'start', name: 'Copy of Standard', isNew: true, settings },
    });
    expect(t.bus.prompt).toMatchObject({ kind: 'selection', message: 'Select a table' });
    await t.bus.pick({ x: 0, y: 0 });
    expect(t.log.some((l) => l.includes('The object selected is not a table.'))).toBe(true);
    expect(t.bus.prompt).toMatchObject({ kind: 'selection' });
    await t.bus.pick({ x: 0, y: 0 });
    const r = t.request()!;
    expect(r.editing).toMatchObject({ name: 'Copy of Standard', isNew: true });
    expect(r.editing!.settings).toMatchObject({ horizontalMargin: 3, verticalMargin: 0.5 });
    expect(r.editing!.settings.title.textHeight).toBe(7);
    // Nothing is made until the dialog's OK.
    expect(t.style('Copy of Standard')).toBeUndefined();
    await t.act({ op: 'new', name: 'Copy of Standard', settings: r.editing!.settings });
    expect(t.style('Copy of Standard')!.horizontalMargin).toBe(3);
    expect(t.request()!.editing).toBeUndefined();
  });

  it('comes back on the settings it had when no table is picked', async () => {
    const t = await formattedTable();
    await t.bus.script(['TABLESTYLE']);
    const settings = changed(t.request()!.styles[1]!.settings);
    await t.act({ op: 'start', name: 'Parts', isNew: false, settings });
    await t.bus.cancel();
    expect(t.request()!.editing).toEqual({ name: 'Parts', isNew: false, settings });
    // Ill-formed settings are not shown again.
    await t.act({
      op: 'start',
      name: 'Parts',
      isNew: false,
      settings: { up: 1 } as unknown as TableStyleSettings,
    });
    expect(t.bus.prompt?.kind).toBe('dialog');
    expect(t.request()!.editing).toBeUndefined();
  });
});
