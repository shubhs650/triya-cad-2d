// M4-03: DIMSTYLE's Dimension Style Manager on the PromptBus (AutoCAD 2024 Help, "DIMSTYLE
// (Command)", "Dimension Style Manager", "Create New Dimension Style Dialog Box", "New, Modify,
// and Override Dimension Style Dialog Boxes"): Set Current, New, Modify, Override, Save to
// current style, Rename and Delete, each made at once with the manager opened again, all one
// undo step; the header's DIMVARs follow the current style, its overrides kept.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  dialogVars,
  setField,
  type DimStyleAction,
  type DimStyleRecord,
  type DimStyleRequest,
  type DimensionGeometry,
  type HeaderValue,
} from '../../src/index';
import { entityInit, linetype, record, sampleInit } from '../model/fixtures';

const STANDARD = '27';
const ISO = '28';
const ISO_CHILD = '29';
const SPARE = '2A';
const DIM = '30';
const TEXT_STANDARD = '32';
const BYBLOCK = '15';
const CENTER = '17';

const style = (
  handle: string,
  name: string,
  vars: DimStyleRecord['vars'],
  extra: Partial<DimStyleRecord> = {},
): DimStyleRecord => ({ handle, name, vars, ...extra });

/** Standard as a DXF reader gives it: switches as booleans, the text style by handle. */
const STANDARD_VARS: DimStyleRecord['vars'] = {
  DIMTXT: 0.18,
  DIMASZ: 0.18,
  DIMSCALE: 1,
  DIMTOL: false,
  DIMSAH: false,
  DIMDSEP: '.',
  DIMTXSTY: TEXT_STANDARD,
};

const dimension = (styleHandle: string): DimensionGeometry =>
  ({
    kind: 'DIMENSION',
    dimType: 'linear',
    style: styleHandle,
    first: { x: 0, y: 0 },
    second: { x: 10, y: 0 },
    definitionPoint: { x: 10, y: 5 },
    textPosition: { x: 5, y: 5 },
    textUserPositioned: false,
    text: '',
    textRotation: 0,
    horizontalDirection: 0,
    attachment: 5,
    lineSpacingStyle: 1,
    lineSpacing: 1,
    rotation: 0,
  }) as DimensionGeometry;

function setup(
  header: [string, HeaderValue][] = [],
  styles: DimStyleRecord[] = [],
  apps: ReturnType<typeof record>[] = [],
) {
  const base = sampleInit();
  const model = DocumentModel.create({
    ...base,
    header: new Map<string, HeaderValue>([
      ...(base.header ?? []),
      ['$DIMSTYLE', 'Standard'],
      ['$DIMTXT', 0.18],
      ['$DIMASZ', 0.18],
      ['$DIMTOL', false],
      ['$DIMTXSTY', 'Standard'],
      ['$DIMDSEP', 46],
      ['$DIMLTYPE', ''],
      ...header,
    ]),
    tables: {
      ...base.tables,
      appIds: [record('12', 'ACAD'), ...apps],
      textStyles: [{ ...record(TEXT_STANDARD, 'Standard'), height: 0, widthFactor: 1 } as never],
      linetypes: [
        ...(base.tables?.linetypes ?? []),
        linetype(BYBLOCK, 'ByBlock'),
        linetype(CENTER, 'CENTER'),
      ],
      dimStyles: [
        style(STANDARD, 'Standard', STANDARD_VARS),
        style(ISO, 'ISO-25', { ...STANDARD_VARS, DIMTXT: 2.5, DIMASZ: 2.5 }),
        style(ISO_CHILD, 'ISO-25$2', { ...STANDARD_VARS, DIMTXT: 2.5, DIMASZ: 2.5 }),
        style(SPARE, 'Spare', STANDARD_VARS),
        ...styles,
      ],
    },
    entities: [...(base.entities ?? []), entityInit(DIM, dimension(ISO))],
  });
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const request = () => {
    const p = bus.prompt;
    if (p?.kind !== 'dialog' || p.dialog.type !== 'dimstyle') throw new Error('no manager');
    return p.dialog as DimStyleRequest;
  };
  const act = (dimstyle: DimStyleAction) =>
    bus.answer({ kind: 'dialog', action: 'apply', dimstyle });
  const styleNamed = (name: string) =>
    [...model.tables.dimStyles.values()].find((s) => s.name === name);
  return { model, bus, request, act, styleNamed };
}

/** The dialog's DIMVARs for `vars` with fields set, as the UI sends them. */
function edited(vars: DimStyleRecord['vars'], fields: [string, string | number | boolean][]) {
  let v = dialogVars(vars);
  for (const [key, value] of fields) v = setField(v, key, value);
  return v;
}

describe('DIMSTYLE (M4-03)', () => {
  it('opens the manager on the current style, sub-styles listed under their parent', async () => {
    const s = setup();
    await s.bus.submit('D');
    expect(s.bus.prompt).toMatchObject({ kind: 'dialog', message: 'Dimension Style Manager' });
    const r = s.request();
    expect(r.styles.map((x) => [x.name, x.used, x.parent, x.use])).toEqual([
      ['ISO-25', true, undefined, undefined],
      ['ISO-25$2', false, 'ISO-25', 'angular'],
      ['Spare', false, undefined, undefined],
      ['Standard', false, undefined, undefined],
    ]);
    expect(r).toMatchObject({ current: 'Standard', selected: 'Standard', overrides: {} });
    expect(r.note).toBeUndefined();
    expect(r.lists.textStyles).toEqual([{ value: TEXT_STANDARD, label: 'Standard' }]);
    expect(r.lists.linetypes.map((o) => o.label)).toEqual(['ByBlock', 'CENTER', 'Continuous']);
    expect(r.lists.linetypes[0]!.value).toBe('');
    expect(r.lists.arrowheads[0]).toEqual({ value: '', label: 'Closed filled' });
    expect(r.lists.arrowheads.map((o) => o.value)).toContain('_DOT');
  });

  it('counts a style used through its child styles, and DST and DIMSTY open it too', async () => {
    const s = setup();
    const { model } = s;
    const b = model.handles;
    expect(b).toBeDefined();
    await s.bus.submit('DST');
    expect(s.request().styles.find((x) => x.name === 'ISO-25')!.used).toBe(true);
    await s.bus.answer({ kind: 'dialog', action: 'ok' });
    expect(s.bus.command).toBeUndefined();
    await s.bus.submit('DIMSTY');
    expect(s.request().type).toBe('dimstyle');
  });

  it('Set Current makes the style current and copies its DIMVARs into the header', async () => {
    const s = setup();
    await s.bus.submit('DIMSTYLE');
    await s.act({ op: 'current', name: 'iso-25' });
    expect(s.model.header.get('$DIMSTYLE')).toBe('ISO-25');
    expect(s.model.header.get('$DIMTXT')).toBe(2.5);
    expect(s.model.header.get('$DIMASZ')).toBe(2.5);
    expect(s.model.header.get('$DIMTOL')).toBe(false);
    // Variables the header does not hold are not added.
    expect(s.model.header.has('$DIMSCALE')).toBe(false);
    expect(s.request()).toMatchObject({ current: 'ISO-25', selected: 'ISO-25', overrides: {} });
    // A child style or a name the drawing lacks is not made current.
    await s.act({ op: 'current', name: 'ISO-25$2' });
    await s.act({ op: 'current', name: 'Nope' });
    expect(s.model.header.get('$DIMSTYLE')).toBe('ISO-25');
  });

  it('New adds a style started from another, with the arrowheads it chose added to the drawing', async () => {
    const s = setup();
    await s.bus.submit('DIMSTYLE');
    const vars = edited(STANDARD_VARS, [
      ['DIMTXT', 0.25],
      ['DIMBLK1', '_DOT'],
      ['DIMLDRBLK', '_DOT'],
      ['DIMLTYPE', CENTER],
      ['DIMTOL.method', 'deviation'],
      ['DIMDSEP', ','],
    ]);
    await s.act({ op: 'new', name: ' Mechanical ', from: 'Standard', vars });
    const made = s.styleNamed('Mechanical')!;
    expect(made).toBeDefined();
    const dot = [...s.model.blocks.values()].find((b) => b.name === '_DOT')!;
    expect(dot).toBeDefined();
    expect(made.vars).toMatchObject({
      DIMTXT: 0.25,
      DIMASZ: 0.18,
      DIMBLK: dot.handle,
      DIMLDRBLK: dot.handle,
      DIMLTYPE: CENTER,
      DIMTOL: true,
      DIMSAH: false,
      DIMDSEP: ',',
      DIMTXSTY: TEXT_STANDARD,
    });
    // Only what the dialog changed is written: the rest stays as the style stated it.
    expect(made.vars.DIMSCALE).toBe(1);
    expect(made.vars.DIMCEN).toBeUndefined();
    expect(Number(made.handle)).toBeGreaterThan(0);
    expect(s.request().selected).toBe('Mechanical');
    expect(s.styleNamed('Standard')!.vars).toEqual(STANDARD_VARS);
  });

  it('refuses a new style named as another, an invalid name or an unknown start style', async () => {
    const s = setup();
    await s.bus.submit('DIMSTYLE');
    const before = s.model.tables.dimStyles.size;
    const vars = dialogVars(STANDARD_VARS);
    await s.act({ op: 'new', name: 'standard', from: 'Standard', vars });
    expect(s.request().note).toBe('A dimension style with this name already exists.');
    await s.act({ op: 'new', name: 'A<B', from: 'Standard', vars });
    expect(s.request().note).toBe('Invalid dimension style name.');
    await s.act({ op: 'new', name: 'Child$0', from: 'Standard', vars });
    expect(s.request().note).toBe('Invalid dimension style name.');
    await s.act({ op: 'new', name: '', from: 'Standard', vars });
    await s.act({ op: 'new', name: 'Good', from: 'Missing', vars });
    expect(s.request().note).toBeUndefined();
    // DIMVARs the dialog cannot give.
    await s.act({ op: 'new', name: 'Good', from: 'Standard', vars: { ...vars, DIMNOPE: 1 } });
    await s.act({ op: 'new', name: 'Good', from: 'Standard', vars: { ...vars, DIMTXT: 'big' } });
    await s.act({ op: 'new', name: 'Good', from: 'Standard', vars: { ...vars, DIMTXSTY: 'FF' } });
    await s.act({ op: 'new', name: 'Good', from: 'Standard', vars: { ...vars, DIMTXSTY: '' } });
    await s.act({ op: 'new', name: 'Good', from: 'Standard', vars: { ...vars, DIMLTYPE: 'FF' } });
    await s.act({ op: 'new', name: 'Good', from: 'Standard', vars: { ...vars, DIMBLK: 'FF' } });
    await s.act({ op: 'new', name: 'Good', from: 'Standard', vars: { ...vars, DIMBLK: 3 } });
    await s.act({ op: 'new', name: 'Good', from: 'Standard', vars: { ...vars, DIMDSEP: '..' } });
    await s.act({ op: 'new', name: 'Good', from: 'Standard', vars: { ...vars, DIMPOST: 2 } });
    await s.act({ op: 'new', name: 'Good', from: 'Standard', vars: { ...vars, DIMTOL: 'x' } });
    await s.act({ op: 'new', name: 'Good', from: 'Standard', vars: { ...vars, DIMASZ: NaN } });
    await s.act({ op: 'new', name: 'Good', from: 'Standard', vars: null as never });
    expect(s.model.tables.dimStyles.size).toBe(before);
    expect(s.bus.undo.state.undoable).toBe(0);
  });

  it('Modify changes the style, keeping its switches booleans; the current one moves the header', async () => {
    const s = setup([['$DIMASZ', 0.25]]);
    await s.bus.submit('DIMSTYLE');
    expect(s.request().overrides).toEqual({ DIMASZ: 0.25 });
    const vars = edited(STANDARD_VARS, [
      ['DIMTXT', 0.2],
      ['DIMASZ', 0.3],
      ['DIMTOL.method', 'symmetrical'],
      ['DIMTP', '0.01'],
    ]);
    await s.act({ op: 'modify', name: 'Standard', vars });
    const st = s.styleNamed('Standard')!;
    expect(st.vars).toMatchObject({ DIMTXT: 0.2, DIMASZ: 0.3, DIMTOL: true, DIMTP: 0.01 });
    expect(s.model.header.get('$DIMTXT')).toBe(0.2);
    expect(s.model.header.get('$DIMTOL')).toBe(true);
    // The header's override stays an override.
    expect(s.model.header.get('$DIMASZ')).toBe(0.25);
    expect(s.request().overrides).toEqual({ DIMASZ: 0.25 });
    // Modify of a style that is not current leaves the header alone; nothing changed, no edit.
    await s.act({ op: 'modify', name: 'Spare', vars: edited(STANDARD_VARS, [['DIMTXT', 1]]) });
    expect(s.styleNamed('Spare')!.vars.DIMTXT).toBe(1);
    expect(s.model.header.get('$DIMTXT')).toBe(0.2);
    const version = s.model.version;
    await s.act({ op: 'modify', name: 'Spare', vars: dialogVars(s.styleNamed('Spare')!.vars) });
    await s.act({ op: 'modify', name: 'Gone', vars });
    expect(s.model.version).toBe(version);
  });

  it('Modify to the default arrowhead and linetype drops their references', async () => {
    const s = setup([], [style('2B', 'Arrows', { ...STANDARD_VARS, DIMLTYPE: CENTER })]);
    await s.bus.submit('DIMSTYLE');
    await s.act({
      op: 'modify',
      name: 'Arrows',
      vars: edited(s.styleNamed('Arrows')!.vars, [['DIMLTYPE', '']]),
    });
    expect('DIMLTYPE' in s.styleNamed('Arrows')!.vars).toBe(false);
    // A reference the dialog sends as '' is the default too.
    await s.act({
      op: 'modify',
      name: 'Arrows',
      vars: { ...dialogVars(s.styleNamed('Arrows')!.vars), DIMLTEX1: '' },
    });
    expect('DIMLTEX1' in s.styleNamed('Arrows')!.vars).toBe(false);
  });

  it('drops the true colour of a colour Modify changes, and New keeps the others', async () => {
    const red = { kind: 'rgb', r: 250, g: 10, b: 10 } as const;
    const s = setup(
      [],
      [
        style(
          '2B',
          'Coloured',
          { ...STANDARD_VARS, DIMCLRD: 1, DIMCLRE: 1 },
          { trueColors: { DIMCLRD: red, DIMCLRE: red } },
        ),
      ],
    );
    await s.bus.submit('DIMSTYLE');
    const base = s.styleNamed('Coloured')!.vars;
    await s.act({ op: 'new', name: 'Copy', from: 'Coloured', vars: dialogVars(base) });
    expect(s.styleNamed('Copy')!.trueColors).toEqual({ DIMCLRD: red, DIMCLRE: red });
    await s.act({
      op: 'new',
      name: 'Copy2',
      from: 'Coloured',
      vars: edited(base, [['DIMCLRD', '3']]),
    });
    expect(s.styleNamed('Copy2')!.trueColors).toEqual({ DIMCLRE: red });
    await s.act({
      op: 'modify',
      name: 'Coloured',
      vars: edited(base, [
        ['DIMCLRD', '3'],
        ['DIMCLRE', '4'],
      ]),
    });
    expect(s.styleNamed('Coloured')!.trueColors).toBeUndefined();
    expect(s.styleNamed('Coloured')!.vars).toMatchObject({ DIMCLRD: 3, DIMCLRE: 4 });
  });

  it('Override sets the header’s DIMVARs that differ; Save to current style writes them', async () => {
    const s = setup();
    await s.bus.submit('DIMSTYLE');
    await s.act({
      op: 'override',
      vars: edited(STANDARD_VARS, [
        ['DIMTXT', 0.3],
        ['DIMDSEP', ','],
        ['DIMLTYPE', CENTER],
        ['DIMSCALE', 2],
      ]),
    });
    expect(s.model.header.get('$DIMTXT')).toBe(0.3);
    expect(s.model.header.get('$DIMDSEP')).toBe(44);
    expect(s.model.header.get('$DIMLTYPE')).toBe('CENTER');
    // An override the header lacked is added.
    expect(s.model.header.get('$DIMSCALE')).toBe(2);
    expect(s.request().overrides).toEqual({
      DIMTXT: 0.3,
      DIMDSEP: ',',
      DIMLTYPE: CENTER,
      DIMSCALE: 2,
    });
    // The style itself is unchanged.
    expect(s.styleNamed('Standard')!.vars).toEqual(STANDARD_VARS);
    // Override again with only DIMTXT: the others go back to the style's.
    await s.act({ op: 'override', vars: edited(STANDARD_VARS, [['DIMTXT', 0.4]]) });
    expect(s.request().overrides).toEqual({ DIMTXT: 0.4 });
    expect(s.model.header.get('$DIMSCALE')).toBe(1);
    expect(s.model.header.get('$DIMLTYPE')).toBe('ByBlock');
    await s.act({ op: 'save-overrides' });
    expect(s.styleNamed('Standard')!.vars).toMatchObject({ DIMTXT: 0.4, DIMSCALE: 1 });
    expect(s.request().overrides).toEqual({});
    // Nothing to save.
    const version = s.model.version;
    await s.act({ op: 'save-overrides' });
    expect(s.model.version).toBe(version);
  });

  it('Save to current style keeps a switch a boolean and the separator a character', async () => {
    const s = setup([
      ['$DIMTOL', true],
      ['$DIMDSEP', 44],
    ]);
    await s.bus.submit('DIMSTYLE');
    expect(s.request().overrides).toEqual({ DIMTOL: 1, DIMDSEP: ',' });
    await s.act({ op: 'save-overrides' });
    expect(s.styleNamed('Standard')!.vars).toMatchObject({ DIMTOL: true, DIMDSEP: ',' });
  });

  it('Set Current on the current style with overrides clears them', async () => {
    const s = setup([['$DIMTXT', 0.5]]);
    await s.bus.submit('DIMSTYLE');
    await s.act({ op: 'current', name: 'Standard' });
    expect(s.model.header.get('$DIMTXT')).toBe(0.18);
    expect(s.request().overrides).toEqual({});
  });

  it('Rename renames the style and its children; the current one renames DIMSTYLE', async () => {
    const s = setup();
    await s.bus.submit('DIMSTYLE');
    await s.act({ op: 'rename', name: 'ISO-25', to: 'ISO' });
    expect(s.model.tables.dimStyles.get(ISO)!.name).toBe('ISO');
    expect(s.model.tables.dimStyles.get(ISO_CHILD)!.name).toBe('ISO$2');
    expect(s.request().selected).toBe('ISO');
    await s.act({ op: 'current', name: 'ISO' });
    await s.act({ op: 'rename', name: 'ISO', to: 'ISO-25' });
    expect(s.model.header.get('$DIMSTYLE')).toBe('ISO-25');
    await s.act({ op: 'rename', name: 'Standard', to: 'Std' });
    expect(s.request().note).toBe('Standard cannot be renamed.');
    await s.act({ op: 'rename', name: 'Spare', to: 'iso-25' });
    expect(s.request().note).toBe('A dimension style with this name already exists.');
    await s.act({ op: 'rename', name: 'Spare', to: 'a|b' });
    expect(s.request().note).toBe('Invalid dimension style name.');
    const version = s.model.version;
    await s.act({ op: 'rename', name: 'Spare', to: 'Spare' });
    await s.act({ op: 'rename', name: 'ISO-25$2', to: 'X' });
    await s.act({ op: 'rename', name: 'Gone', to: 'X' });
    expect(s.request().note).toBeUndefined();
    expect(s.model.version).toBe(version);
    // A case change is a rename of its own name.
    await s.act({ op: 'rename', name: 'Spare', to: 'SPARE' });
    expect(s.styleNamed('SPARE')).toBeDefined();
  });

  it('Delete removes an unused style with its children, never Standard, the current or a used one', async () => {
    const s = setup([], [style('2B', 'Spare$0', STANDARD_VARS)]);
    await s.bus.submit('DIMSTYLE');
    await s.act({ op: 'delete', name: 'ISO-25' });
    expect(s.request().note).toBe('Style in use, can’t be deleted.');
    await s.act({ op: 'delete', name: 'Standard' });
    expect(s.request().note).toBe('Standard cannot be deleted.');
    await s.act({ op: 'current', name: 'Spare' });
    await s.act({ op: 'delete', name: 'Spare' });
    expect(s.request().note).toBe('The current style cannot be deleted.');
    await s.act({ op: 'current', name: 'Standard' });
    await s.act({ op: 'delete', name: 'Spare' });
    expect(s.styleNamed('Spare')).toBeUndefined();
    expect(s.styleNamed('Spare$0')).toBeUndefined();
    expect(s.request()).toMatchObject({ selected: 'Standard' });
    expect(s.request().note).toBeUndefined();
    await s.act({ op: 'delete', name: 'Gone' });
    expect(s.styleNamed('ISO-25$2')).toBeDefined();
    // A sub-style goes alone (part 2), the list back on its parent.
    await s.act({ op: 'delete', name: 'ISO-25$2' });
    expect(s.styleNamed('ISO-25$2')).toBeUndefined();
    expect(s.styleNamed('ISO-25')).toBeDefined();
    expect(s.request().selected).toBe('ISO-25');
  });

  it('is one undo step for everything it did, and Close (or Esc) ends it', async () => {
    const s = setup();
    await s.bus.submit('DIMSTYLE');
    await s.act({ op: 'new', name: 'A', from: 'Standard', vars: dialogVars(STANDARD_VARS) });
    await s.act({ op: 'current', name: 'A' });
    await s.act({ op: 'delete', name: 'Spare' });
    await s.bus.answer({ kind: 'dialog', action: 'ok' });
    expect(s.bus.command).toBeUndefined();
    expect(s.bus.undo.state.undoable).toBe(1);
    await s.bus.submit('U');
    expect(s.styleNamed('A')).toBeUndefined();
    expect(s.styleNamed('Spare')).toBeDefined();
    expect(s.model.header.get('$DIMSTYLE')).toBe('Standard');
    await s.bus.submit('DIMSTYLE');
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
    // An apply without an action closes it too.
    await s.bus.submit('DIMSTYLE');
    await s.bus.answer({ kind: 'dialog', action: 'apply' });
    expect(s.bus.command).toBeUndefined();
  });

  it('works in a drawing whose current style the header does not name', async () => {
    const s = setup([['$DIMSTYLE', 'Missing']]);
    await s.bus.submit('DIMSTYLE');
    expect(s.request()).toMatchObject({ current: 'Standard', overrides: {} });
    await s.act({ op: 'override', vars: edited(STANDARD_VARS, [['DIMTXT', 1]]) });
    expect(s.model.header.get('$DIMTXT')).toBe(1);
  });

  it('opens on an empty list in a drawing without dimension styles', async () => {
    const base = sampleInit();
    const model = DocumentModel.create(base);
    const bus = new PromptBus({ model, registry: builtinCommands() });
    await bus.submit('DIMSTYLE');
    const r = (bus.prompt as { dialog: DimStyleRequest }).dialog;
    expect(r).toMatchObject({ styles: [], current: '', selected: '' });
    await bus.answer({ kind: 'dialog', action: 'apply', dimstyle: { op: 'override', vars: {} } });
    await bus.answer({ kind: 'dialog', action: 'apply', dimstyle: { op: 'save-overrides' } });
    expect(model.version).toBe(0);
  });
});

const JAG_APP = '35';
const TALN_APP = '36';
const ANNO_APP = '37';
const jagged = (factor: number) => ({
  appId: JAG_APP,
  values: [
    { code: 1070, value: 388 },
    { code: 1040, value: factor },
  ],
});

describe('DIMSTYLE part 2 (M4-03): xdata settings and sub-styles', () => {
  const apps = [
    record(JAG_APP, 'ACAD_DSTYLE_DIMJAG'),
    record(TALN_APP, 'ACAD_DSTYLE_DIMTALN'),
    record(ANNO_APP, 'AcadAnnotative'),
  ];
  const settings = style('2C', 'Settings', STANDARD_VARS, {
    xdata: [
      { appId: ANNO_APP, values: [{ code: 1000, value: 'AnnotativeData' }] },
      jagged(2),
      {
        appId: TALN_APP,
        values: [
          { code: 1070, value: 392 },
          { code: 1070, value: 1 },
        ],
      },
    ],
  });

  it('shows the settings a style keeps in ACAD_DSTYLE xdata as its DIMVARs', async () => {
    const s = setup([], [settings], apps);
    await s.bus.submit('DIMSTYLE');
    const row = s.request().styles.find((x) => x.name === 'Settings')!;
    expect(row.vars).toMatchObject({ DIMJAG: 2, DIMTALN: 1 });
    expect(row.vars.DIMBREAK).toBeUndefined();
    // The dialog shows AutoCAD's defaults for the ones a style does not state.
    expect(dialogVars(STANDARD_VARS)).toMatchObject({
      DIMBREAK: 0.125,
      DIMJAG: 1.5,
      DIMTALN: 0,
      DIMMZF: 100,
      DIMMZS: '',
    });
  });

  it('Modify writes them into the record’s xdata, registering the applications it lacks', async () => {
    const s = setup([], [settings], apps);
    await s.bus.submit('DIMSTYLE');
    const vars = edited(s.request().styles.find((x) => x.name === 'Settings')!.vars, [
      ['DIMJAG', 3],
      ['DIMBREAK', 0.25],
      ['DIMZIN.leading', true],
      ['DIMMZS', 'cm'],
    ]);
    await s.act({ op: 'modify', name: 'Settings', vars });
    const st = s.styleNamed('Settings')!;
    // Only DIMVARs in `vars`; the settings in the xdata, the other applications kept in place.
    expect(
      Object.keys(st.vars).filter((n) => /^DIM(BREAK|JAG|MZF|MZS|ALTMZF|ALTMZS|TALN)$/.test(n)),
    ).toEqual([]);
    expect(st.vars.DIMZIN).toBe(4);
    const appNamed = (name: string) =>
      [...s.model.tables.appIds.values()].find((a) => a.name === name)!.handle;
    expect(st.xdata).toEqual([
      { appId: ANNO_APP, values: [{ code: 1000, value: 'AnnotativeData' }] },
      jagged(3),
      {
        appId: TALN_APP,
        values: [
          { code: 1070, value: 392 },
          { code: 1070, value: 1 },
        ],
      },
      {
        appId: appNamed('ACAD_DSTYLE_DIMBREAK'),
        values: [
          { code: 1070, value: 391 },
          { code: 1040, value: 0.25 },
        ],
      },
      {
        appId: appNamed('ACAD_DSTYLE_DIMMZS'),
        values: [
          { code: 1070, value: 394 },
          { code: 1000, value: 'cm' },
        ],
      },
    ]);
    // Values the dialog cannot give are refused.
    const version = s.model.version;
    for (const bad of [
      { DIMJAG: 0 },
      { DIMTALN: 2 },
      { DIMBREAK: -1 },
      { DIMMZS: 5 },
      { DIMMZF: 'x' },
    ]) {
      await s.act({ op: 'modify', name: 'Settings', vars: { ...vars, ...bad } });
    }
    expect(s.model.version).toBe(version);
  });

  it('New copies the Start With style’s settings but not its annotative xdata; Override leaves them', async () => {
    const s = setup([['$DIMSTYLE', 'Settings']], [settings], apps);
    await s.bus.submit('DIMSTYLE');
    const from = s.request().styles.find((x) => x.name === 'Settings')!.vars;
    await s.act({ op: 'new', name: 'Copy', from: 'Settings', vars: dialogVars(from) });
    expect(s.styleNamed('Copy')!.xdata).toEqual([
      jagged(2),
      {
        appId: TALN_APP,
        values: [
          { code: 1070, value: 392 },
          { code: 1070, value: 1 },
        ],
      },
    ]);
    const version = s.model.version;
    await s.act({ op: 'override', vars: edited(from, [['DIMJAG', 5]]) });
    expect(s.model.version).toBe(version);
    expect(s.styleNamed('Settings')!.xdata).toEqual(settings.xdata);
  });

  it('New with Use for makes the Start With style’s sub-style, or edits the one there is', async () => {
    const s = setup();
    await s.bus.submit('DIMSTYLE');
    const iso = s.styleNamed('ISO-25')!;
    const vars = edited(iso.vars, [['DIMTXT', 3.5]]);
    await s.act({ op: 'new', name: 'ignored', from: 'ISO-25', vars, use: 'linear' });
    const child = s.styleNamed('ISO-25$0')!;
    expect(child.vars).toMatchObject({ DIMTXT: 3.5, DIMASZ: 2.5 });
    expect(s.styleNamed('ignored')).toBeUndefined();
    expect(s.request().selected).toBe('ISO-25$0');
    expect(s.request().styles.map((x) => x.name)).toEqual([
      'ISO-25',
      'ISO-25$0',
      'ISO-25$2',
      'Spare',
      'Standard',
    ]);
    // Again: the existing sub-style is modified, not doubled.
    await s.act({
      op: 'new',
      name: '',
      from: 'ISO-25',
      vars: edited(iso.vars, [['DIMTXT', 5]]),
      use: 'linear',
    });
    expect(s.styleNamed('ISO-25$0')!.handle).toBe(child.handle);
    expect(s.styleNamed('ISO-25$0')!.vars.DIMTXT).toBe(5);
    // A sub-style of a sub-style, or an unknown use, is refused; All dimensions is a plain New.
    const size = s.model.tables.dimStyles.size;
    await s.act({ op: 'new', name: '', from: 'ISO-25$2', vars, use: 'radius' });
    await s.act({ op: 'new', name: '', from: 'ISO-25', vars, use: 'bogus' as never });
    expect(s.model.tables.dimStyles.size).toBe(size);
    await s.act({ op: 'new', name: 'Plain', from: 'ISO-25', vars, use: 'all' });
    expect(s.styleNamed('Plain')).toBeDefined();
  });
});

describe('-DIMSTYLE (M4-03 part 2)', () => {
  /** What the command printed since `from`. */
  const printed = (s: ReturnType<typeof setup>, from: number) => s.bus.history.slice(from);
  const dimId = (s: ReturnType<typeof setup>) => s.model.entityByHandle(DIM)!.id;

  it('asks for an option, Restore by default, and Restore makes a style current', async () => {
    const s = setup([['$DIMASZ', 0.25]]);
    await s.bus.submit('-DIMSTYLE');
    expect(s.bus.history).toContain('Current dimension style: Standard');
    expect(s.bus.prompt).toMatchObject({
      kind: 'keyword',
      message: 'Enter a dimension style option',
      options: ['Save', 'Restore', 'STatus', 'Variables', 'Apply', '?'],
      default: { kind: 'keyword', keyword: 'Restore' },
    });
    await s.bus.submit('');
    expect(s.bus.prompt).toMatchObject({ kind: 'string', defaultLabel: 'select dimension' });
    await s.bus.submit('nope');
    expect(s.bus.history.at(-1)).toBe('Dimension style nope not found.');
    await s.bus.submit('iso-25');
    expect(s.bus.command).toBeUndefined();
    expect(s.model.header.get('$DIMSTYLE')).toBe('ISO-25');
    // Its DIMVARs replace the header's, overrides and all.
    expect(s.model.header.get('$DIMASZ')).toBe(2.5);
  });

  it('Restore by selecting a dimension, and ~name lists the differences', async () => {
    const s = setup();
    await s.bus.submit('-DIMSTYLE');
    await s.bus.submit('R');
    await s.bus.submit('');
    expect(s.bus.prompt).toMatchObject({ kind: 'selection', message: 'Select dimension' });
    await s.bus.answer({ kind: 'selection', ids: [dimId(s)] });
    expect(s.model.header.get('$DIMSTYLE')).toBe('ISO-25');

    await s.bus.submit('-DIMSTYLE');
    await s.bus.submit('R');
    const from = s.bus.history.length;
    await s.bus.submit('~Standard');
    const out = printed(s, from);
    expect(out).toContain('Differences between Standard and current settings:');
    expect(out.some((l) => /^DIMASZ\s+0\.1800\s+2\.5000$/.test(l))).toBe(true);
    expect(out.some((l) => l.startsWith('DIMSCALE'))).toBe(false);
    // Nothing was made current.
    expect(s.model.header.get('$DIMSTYLE')).toBe('ISO-25');
  });

  it('STatus lists the current settings with their descriptions; Variables a style’s', async () => {
    const s = setup([['$DIMASZ', 0.25]]);
    await s.bus.submit('-DIMSTYLE');
    let from = s.bus.history.length;
    await s.bus.submit('ST');
    let out = printed(s, from);
    expect(out.find((l) => l.startsWith('DIMASZ'))).toMatch(/^DIMASZ\s+0\.2500\s+Arrow size$/);
    expect(out.find((l) => l.startsWith('DIMTOL '))).toMatch(/Off\s+Tolerance dimensioning$/);
    expect(out.find((l) => l.startsWith('DIMTXSTY'))).toMatch(/Standard\s+Text style$/);
    expect(out.find((l) => l.startsWith('DIMBLK '))).toMatch(/ClosedFilled/);
    expect(out.find((l) => l.startsWith('DIMLTYPE'))).toMatch(/BYBLOCK/);
    expect(out.find((l) => l.startsWith('DIMJAG'))).toMatch(/1\.5000\s+Linear jog height factor$/);
    expect(out.find((l) => l.startsWith('DIMDSEP'))).toMatch(/^DIMDSEP\s+\.\s+Decimal separator$/);
    expect(s.bus.command).toBeUndefined();

    await s.bus.submit('-DIMSTYLE');
    await s.bus.submit('V');
    from = s.bus.history.length;
    await s.bus.submit('ISO-25');
    out = printed(s, from);
    expect(out.find((l) => l.startsWith('DIMASZ'))).toMatch(/^DIMASZ\s+2\.5000/);
    // By a dimension: its style with its own overrides.
    await s.bus.submit('-DIMSTYLE');
    await s.bus.submit('V');
    await s.bus.submit('');
    from = s.bus.history.length;
    await s.bus.answer({ kind: 'selection', ids: [dimId(s)] });
    out = printed(s, from);
    expect(out.find((l) => l.startsWith('DIMTXT'))).toMatch(/^DIMTXT\s+2\.5000/);
    expect(s.model.header.get('$DIMSTYLE')).toBe('Standard');
  });

  it('Save makes a new style of the current settings and makes it current', async () => {
    const s = setup([['$DIMASZ', 0.25]]);
    await s.bus.submit('-DIMSTYLE');
    await s.bus.submit('S');
    expect(s.bus.prompt).toMatchObject({ message: 'Enter name for new dimension style' });
    await s.bus.submit('a|b');
    expect(s.bus.history.at(-1)).toBe('Invalid dimension style name.');
    await s.bus.submit('Saved');
    expect(s.bus.command).toBeUndefined();
    const saved = s.styleNamed('Saved')!;
    expect(saved.vars).toMatchObject({ DIMASZ: 0.25, DIMTXT: 0.18, DIMTOL: false });
    expect(s.model.header.get('$DIMSTYLE')).toBe('Saved');
    expect(s.model.header.get('$DIMASZ')).toBe(0.25);
    expect(s.bus.undo.state.undoable).toBe(1);
  });

  it('Save onto an existing name redefines it once the drafter says Yes', async () => {
    const s = setup([['$DIMASZ', 0.5]]);
    await s.bus.submit('-DIMSTYLE');
    await s.bus.submit('S');
    await s.bus.submit('spare');
    expect(s.bus.prompt).toMatchObject({
      kind: 'keyword',
      message: 'That name is already in use, redefine it?',
      default: { kind: 'keyword', keyword: 'No' },
    });
    await s.bus.submit('');
    expect(s.styleNamed('Spare')!.vars.DIMASZ).toBe(0.18);
    await s.bus.submit('-DIMSTYLE');
    await s.bus.submit('S');
    await s.bus.submit('Spare');
    await s.bus.submit('Y');
    expect(s.styleNamed('Spare')!.vars.DIMASZ).toBe(0.5);
    expect(s.model.header.get('$DIMSTYLE')).toBe('Spare');
    // A sub-style's name is not a style to save to.
    await s.bus.submit('-DIMSTYLE');
    await s.bus.submit('S');
    await s.bus.submit('ISO-25$2');
    expect(s.bus.history.at(-1)).toBe('Invalid dimension style name.');
  });

  it('Apply gives the selected dimensions the current style and settings', async () => {
    const s = setup([['$DIMASZ', 0.3]]);
    await s.bus.submit('-DIMSTYLE');
    await s.bus.submit('A');
    expect(s.bus.prompt).toMatchObject({ kind: 'selection', message: 'Select objects' });
    await s.bus.answer({ kind: 'selection', ids: [dimId(s)] });
    const e = s.model.entityByHandle(DIM)!;
    expect((e.geom as DimensionGeometry).style).toBe(STANDARD);
    // The header's override filed as its DSTYLE override (41 DIMASZ).
    expect(e.xdata).toEqual([
      {
        appId: '12',
        values: [
          { code: 1000, value: 'DSTYLE' },
          { code: 1002, value: '{' },
          { code: 1070, value: 41 },
          { code: 1040, value: 0.3 },
          { code: 1002, value: '}' },
        ],
      },
    ]);
  });

  it('says what it cannot do, and lists ? wherever a name is asked', async () => {
    const s = setup();
    const run = async (...inputs: string[]) => {
      await s.bus.submit('-DIMSTYLE');
      for (const i of inputs) await s.bus.submit(i);
    };
    await run('R', 'ISO-25$2');
    expect(s.bus.history.at(-1)).toBe('Invalid dimension style name.');
    await run('V', '~Spare');
    expect(s.bus.history.at(-1)).toBe('No differences.');
    await run('?', 'Q*');
    expect(s.bus.history.at(-1)).toBe('No matching dimension styles found.');
    await run('S', '?', '');
    expect(s.bus.history).toContain('  ISO-25$2');
    expect(s.bus.prompt).toMatchObject({ message: 'Enter name for new dimension style' });
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    await run('R', '?', '');
    expect(s.bus.prompt).toMatchObject({ message: 'Enter a dimension style name' });
    await s.bus.cancel();
    // Nothing selected: not a dimension, and the command ends.
    await run('R', '');
    await s.bus.answer({ kind: 'selection', ids: [] });
    expect(s.bus.history.at(-1)).toBe('That object is not a dimension.');
    expect(s.bus.command).toBeUndefined();
    await run('A');
    await s.bus.answer({ kind: 'selection', ids: [] });
    expect(s.bus.command).toBeUndefined();
    expect(s.bus.undo.state.undoable).toBe(0);

    const none = new PromptBus({
      model: DocumentModel.create(sampleInit()),
      registry: builtinCommands(),
    });
    await none.submit('-DIMSTYLE');
    expect(none.history.at(-1)).toBe('The drawing has no dimension style.');
    expect(none.command).toBeUndefined();
  });

  it('? lists the styles matching a pattern', async () => {
    const s = setup();
    await s.bus.submit('-DIMSTYLE');
    await s.bus.submit('?');
    expect(s.bus.prompt).toMatchObject({ message: 'Enter dimension style(s) to list' });
    const from = s.bus.history.length;
    await s.bus.submit('S*');
    expect(printed(s, from).slice(1)).toEqual(['Named dimension styles:', '  Spare', '  Standard']);
  });
});
