// M2-35 part 5: a dimension's other Properties rows (AutoCAD 2024's Lines & Arrows, Text, Fit,
// Primary Units, Alternate Units and Tolerances groups), each written as `DSTYLE` overrides in
// the dimension's ACAD xdata. A row may set several DIMVARs at once, as AutoCAD's do.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DIMVAR_ROWS,
  DocumentModel,
  PromptBus,
  builtinCommands,
  dimVars,
  propertySheet,
  type DimStyleRecord,
  type DimensionGeometry,
  type DimensionMeasure,
  type DocumentInit,
  type PropertyRow,
  type TextStyleRecord,
} from '../../src/index';
import { blockRecord, entityInit, linetype, record, sampleInit } from '../model/fixtures';

const DIM = '30';
const STANDARD = '27';
const ACAD = '12';
const DOT = '40';
const TICK = '41';
const OTHER_BLOCK = '42';
const BYBLOCK = '15';
const BYLAYER = '16';
const DASHED = '17';
const ROMANS = '18';
const STANDARD_TEXT = '19';

const textStyle = (handle: string, name: string): TextStyleRecord => ({
  handle,
  name,
  font: 'txt',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 0.2,
  generation: 0,
  trueTypeFlags: 0,
});

const dimension: DimensionGeometry = {
  kind: 'DIMENSION',
  dimType: 'linear',
  style: STANDARD,
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
} as DimensionGeometry;

function init(
  vars: DimStyleRecord['vars'] = {},
  dims: readonly DimensionGeometry[] = [dimension],
): DocumentInit {
  const base = sampleInit();
  const blocks: [string, string][] = [
    [DOT, '_DOT'],
    [TICK, '_ArchTick'],
    [OTHER_BLOCK, 'DOOR'],
  ];
  return {
    ...base,
    tables: {
      ...base.tables,
      appIds: [record(ACAD, 'ACAD')],
      linetypes: [
        ...(base.tables?.linetypes ?? []),
        linetype(BYBLOCK, 'ByBlock'),
        linetype(BYLAYER, 'ByLayer'),
        linetype(DASHED, 'DASHED'),
      ],
      textStyles: [textStyle(ROMANS, 'romans'), textStyle(STANDARD_TEXT, 'Standard')],
      dimStyles: [{ handle: STANDARD, name: 'Standard', vars: { DIMTXT: 0.18, ...vars } }],
      blockRecords: [
        ...(base.tables?.blockRecords ?? []),
        ...blocks.map(([h, n]) => blockRecord(h, n)),
      ],
    },
    blocks: [
      ...(base.blocks ?? []),
      ...blocks.map(([handle, name]) => ({ handle, name, basePoint: { x: 0, y: 0 } })),
    ],
    entities: dims.map((g, n) => entityInit(String(Number(DIM) + 20 * n), g)),
  };
}

function setup(
  vars: DimStyleRecord['vars'] = {},
  lunits?: number,
  dims: readonly DimensionGeometry[] = [dimension],
  measure?: DimensionMeasure,
) {
  const i = init(vars, dims);
  const header = [
    ...(i.header ?? []),
    ...(lunits === undefined ? [] : [['$LUNITS', lunits] as const]),
  ];
  const model = DocumentModel.create({ ...i, header });
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const log: string[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  const entity = () => model.entityByHandle(DIM)!;
  const set = async (key: string, value: string) => {
    await bus.selectAll();
    await bus.setProperty({ key: `dimvar:${key}`, value });
  };
  const ids = () => dims.map((_, n) => model.entityByHandle(String(Number(DIM) + 20 * n))!.id);
  const sheet = () => propertySheet(model, ids(), undefined, 0, measure);
  const rowOf = (label: string): PropertyRow => {
    for (const s of sheet().sections) {
      const r = s.rows.find((x) => x.label === label);
      if (r) return r;
    }
    throw new Error(`no row ${label}`);
  };
  /** The dimension's DSTYLE overrides, as (code, value) pairs. */
  const overrides = (): [number, unknown][] => {
    const v = entity().xdata?.[0]?.values ?? [];
    const out: [number, unknown][] = [];
    for (let i = 2; i + 1 < v.length - 1; i += 2) out.push([v[i]!.value as number, v[i + 1]!]);
    return out;
  };
  const vars_ = () => dimVars(STANDARD, entity().xdata, model);
  return { model, bus, log, entity, set, sheet, rowOf, overrides, vars: vars_ };
}

describe('a dimension’s Properties groups (M2-35 part 5)', () => {
  it('shows AutoCAD 2024’s groups and rows, in its order', () => {
    const s = setup();
    const sections = s.sheet().sections.map((x) => [x.title, x.rows.map((r) => r.label)]);
    expect(sections.slice(1)).toEqual([
      ['Misc', ['Dim style']],
      [
        'Lines & Arrows',
        [
          'Arrow 1',
          'Arrow 2',
          'Arrow size',
          'Dim line lineweight',
          'Ext line lineweight',
          'Dim line 1',
          'Dim line 2',
          'Dim line color',
          'Dim line linetype',
          'Dim line ext',
          'Ext line 1 linetype',
          'Ext line 2 linetype',
          'Ext line 1',
          'Ext line 2',
          'Ext line fixed',
          'Ext line fixed length',
          'Ext line color',
          'Ext line ext',
          'Ext line offset',
        ],
      ],
      [
        'Text',
        [
          'Fill color',
          'Fraction type',
          'Text color',
          'Text height',
          'Text offset',
          'Text outside align',
          'Text pos hor',
          'Text pos vert',
          'Text style',
          'Text inside align',
          'Text rotation',
          'Text view direction',
          'Text override',
        ],
      ],
      [
        'Fit',
        [
          'Dim line forced',
          'Dim line inside',
          'Dim scale overall',
          'Fit',
          'Text inside',
          'Text movement',
        ],
      ],
      [
        'Primary Units',
        [
          'Decimal separator',
          'Dim prefix',
          'Dim suffix',
          'Dim roundoff',
          'Dim scale linear',
          'Dim units',
          'Suppress leading zeros',
          'Suppress trailing zeros',
          'Suppress zero feet',
          'Suppress zero inches',
          'Precision',
        ],
      ],
      [
        'Alternate Units',
        [
          'Alt enabled',
          'Alt format',
          'Alt precision',
          'Alt multiplier',
          'Alt prefix',
          'Alt suffix',
          'Alt round',
          'Alt suppress leading zeros',
          'Alt suppress trailing zeros',
          'Alt suppress zero feet',
          'Alt suppress zero inches',
        ],
      ],
      [
        'Tolerances',
        [
          'Tolerance display',
          'Tolerance limit lower',
          'Tolerance limit upper',
          'Tolerance pos vert',
          'Tolerance precision',
          'Tolerance suppress leading zeros',
          'Tolerance suppress trailing zeros',
          'Tolerance suppress zero feet',
          'Tolerance suppress zero inches',
          'Tolerance text height',
          'Alt tolerance precision',
          'Alt tolerance suppress leading zeros',
          'Alt tolerance suppress trailing zeros',
          'Alt tolerance suppress zero feet',
          'Alt tolerance suppress zero inches',
        ],
      ],
    ]);
  });

  it('shows AutoCAD’s defaults where the style states nothing', () => {
    const s = setup();
    expect(s.rowOf('Arrow 1')).toMatchObject({ kind: 'choice', value: '' });
    expect(s.rowOf('Dim line color')).toMatchObject({ value: 'ByBlock', colorDialog: 'index' });
    expect(s.rowOf('Dim line lineweight').value).toBe('-2');
    // Its lineweights carry their widths, for the palette to list in LWUNITS (M5-08).
    expect(s.rowOf('Ext line lineweight').options).toContainEqual({
      value: '25',
      label: '0.25 mm',
      lineweight: 25,
    });
    expect(s.rowOf('Ext line lineweight').options).toContainEqual({
      value: '-3',
      label: 'Default',
    });
    expect(s.rowOf('Dim line 1').value).toBe('on');
    expect(s.rowOf('Dim line linetype').value).toBe(BYBLOCK);
    expect(s.rowOf('Fill color').value).toBe('None');
    expect(s.rowOf('Text style').value).toBe(STANDARD_TEXT);
    expect(s.rowOf('Fit').value).toBe('3');
    expect(s.rowOf('Decimal separator').value).toBe('.');
    expect(s.rowOf('Alt multiplier').value).toBe(25.4);
    expect(s.rowOf('Tolerance display').value).toBe('none');
    expect(s.rowOf('Tolerance pos vert').value).toBe('1');
  });

  it('sets the text view direction, Left-to-Right or Right-to-Left (M2-35 part 26)', async () => {
    const s = setup();
    expect(s.rowOf('Text view direction')).toMatchObject({
      kind: 'choice',
      value: '0',
      options: [
        { value: '0', label: 'Left-to-Right' },
        { value: '1', label: 'Right-to-Left' },
      ],
    });
    await s.set('DIMTXTDIRECTION', '1');
    expect(s.vars().DIMTXTDIRECTION).toBe(1);
    expect(s.overrides()).toEqual([[294, { code: 1070, value: 1 }]]);
    expect(s.rowOf('Text view direction').value).toBe('1');
    await s.set('DIMTXTDIRECTION', '2');
    expect(s.log).toEqual(['Invalid input.']);
    // Back to the style's: the override goes.
    await s.set('DIMTXTDIRECTION', '0');
    expect(s.overrides()).toEqual([]);
  });

  it('every row has a DIMVAR default or reads a handle', () => {
    for (const r of DIMVAR_ROWS) expect(r.name).toMatch(/^DIM[A-Z0-9]+(\.\w+)?$/);
  });
});

describe('a dimension’s rows write DSTYLE overrides (M2-35 part 5)', () => {
  it('writes a colour as its ACI, ByLayer as 256, and refuses a true colour', async () => {
    const s = setup();
    await s.set('DIMCLRD', 'aci:1');
    expect(s.overrides()).toEqual([[176, { code: 1070, value: 1 }]]);
    expect(s.rowOf('Dim line color').value).toBe('aci:1');
    await s.set('DIMCLRE', 'ByLayer');
    expect(s.vars().DIMCLRE).toBe(256);
    await s.set('DIMCLRT', 'aci:142');
    expect(s.rowOf('Text color')).toMatchObject({ value: 'aci:142' });
    expect(s.rowOf('Text color').options).toContainEqual({ value: 'aci:142', label: 'Color 142' });
    await s.set('DIMCLRT', 'rgb:1,2,3');
    expect(s.log).toEqual(['Invalid input.']);
  });

  it('reads distance rows in feet and inches in an architectural drawing (M2-35 part 7)', async () => {
    const s = setup({}, 4);
    await s.set('DIMASZ', '3/16"');
    await s.set('DIMEXO', `0'-0 1/8"`);
    expect(s.vars()).toMatchObject({ DIMASZ: 0.1875, DIMEXO: 0.125 });
    await s.set('DIMSCALE', `1'`);
    expect(s.log).toEqual(['Invalid input.']);
    await s.set('DIMSCALE', '48');
    expect(s.vars().DIMSCALE).toBe(48);
  });

  it('turns parts off by their suppress variables', async () => {
    const s = setup();
    await s.set('DIMSD1', 'off');
    await s.set('DIMSE2', 'off');
    expect(s.vars()).toMatchObject({ DIMSD1: 1, DIMSE2: 1 });
    expect(s.rowOf('Dim line 1').value).toBe('off');
    await s.set('DIMSD1', 'on');
    expect(s.vars().DIMSD1).toBeUndefined();
  });

  it('sets lineweights and linetypes by handle', async () => {
    const s = setup();
    await s.set('DIMLWD', '50');
    await s.set('DIMLTEX1', DASHED);
    expect(s.overrides()).toEqual([
      [371, { code: 1070, value: 50 }],
      [346, { code: 1005, value: DASHED }],
    ]);
    expect(s.rowOf('Ext line 1 linetype').options!.map((o) => o.label)).toEqual([
      'ByLayer',
      'ByBlock',
      'Continuous',
      'DASHED',
    ]);
    await s.set('DIMLWD', '7');
    await s.set('DIMLTYPE', 'FF');
    expect(s.log).toEqual(['Invalid input.', 'Invalid input.']);
  });

  it('sets one arrowhead as AutoCAD does: DIMSAH on, the other end kept', async () => {
    const s = setup({ DIMBLK: TICK });
    expect(s.rowOf('Arrow 1').value).toBe(TICK);
    // Closed filled, then AutoCAD's arrowheads in its order: the drawing's blocks by handle,
    // the ones it lacks by their block names (authored when chosen).
    expect(s.rowOf('Arrow 1').options).toEqual([
      { value: '', label: 'Closed filled' },
      { value: '_CLOSEDBLANK', label: 'Closed blank' },
      { value: '_CLOSED', label: 'Closed' },
      { value: DOT, label: 'Dot' },
      { value: TICK, label: 'Architectural tick' },
      { value: '_OBLIQUE', label: 'Oblique' },
      { value: '_OPEN', label: 'Open' },
      { value: '_ORIGIN', label: 'Origin indicator' },
      { value: '_ORIGIN2', label: 'Origin indicator 2' },
      { value: '_OPEN90', label: 'Right angle' },
      { value: '_OPEN30', label: 'Open 30' },
      { value: '_DOTSMALL', label: 'Dot small' },
      { value: '_DOTBLANK', label: 'Dot blank' },
      { value: '_SMALL', label: 'Dot small blank' },
      { value: '_BOXBLANK', label: 'Box' },
      { value: '_BOXFILLED', label: 'Box filled' },
      { value: '_DATUMBLANK', label: 'Datum triangle' },
      { value: '_DATUMFILLED', label: 'Datum triangle filled' },
      { value: '_INTEGRAL', label: 'Integral' },
      { value: '_NONE', label: 'None' },
    ]);
    await s.set('DIMBLK1', DOT);
    expect(s.vars()).toMatchObject({ DIMSAH: 1, DIMBLK1: DOT, DIMBLK2: TICK });
    expect(s.rowOf('Arrow 1').value).toBe(DOT);
    expect(s.rowOf('Arrow 2').value).toBe(TICK);
    // Closed filled is no block: the style names none, so no override is left.
    await s.set('DIMBLK2', '');
    expect(s.vars().DIMBLK2).toBeUndefined();
    expect(s.rowOf('Arrow 2').value).toBe('');
    await s.set('DIMBLK2', 'FF');
    expect(s.log).toEqual(['Invalid input.']);
  });

  it('writes closed filled as handle 0 over a style’s DIMSAH arrowhead', async () => {
    const s = setup({ DIMSAH: true, DIMBLK1: DOT, DIMBLK2: DOT });
    await s.set('DIMBLK2', '');
    expect(s.overrides()).toEqual([[344, { code: 1005, value: '0' }]]);
    expect(s.rowOf('Arrow 2').value).toBe('');
  });

  it('authors an arrowhead the drawing lacks when it is chosen, in one undo step', async () => {
    const s = setup();
    const before = s.model.handles.handSeed;
    await s.set('DIMBLK1', '_OPEN30');
    const block = [...s.model.blocks.values()].find((b) => b.name === '_OPEN30')!;
    expect(block).toBeDefined();
    // Above every handle the drawing had: handles are never renumbered.
    expect(parseInt(block.handle, 16)).toBeGreaterThanOrEqual(parseInt(before, 16));
    expect(s.model.tables.blockRecords.get(block.handle)?.name).toBe('_OPEN30');
    const parts = s.model.blockEntities(block.handle).map((id) => s.model.entity(id)!);
    expect(parts.map((e) => e.geom.kind)).toEqual(['LWPOLYLINE', 'LINE']);
    for (const e of parts) {
      expect(s.model.tables.layers.get(e.layer)?.name).toBe('0');
      expect(e).toMatchObject({
        color: { kind: 'byBlock' },
        linetype: 'ByBlock',
        lineweight: 'ByBlock',
      });
    }
    expect(s.vars()).toMatchObject({ DIMSAH: 1, DIMBLK1: block.handle });
    expect(s.rowOf('Arrow 1')).toMatchObject({ value: block.handle });
    expect(s.rowOf('Arrow 1').options).toContainEqual({ value: block.handle, label: 'Open 30' });
    // The other end, chosen the same, takes the block the first one made.
    await s.set('DIMBLK2', '_OPEN30');
    expect(s.vars().DIMBLK2).toBe(block.handle);
    expect([...s.model.blocks.values()].filter((b) => b.name === '_OPEN30')).toHaveLength(1);
    expect(s.log).toEqual([]);
    // One U takes Arrow 2 back; the next takes Arrow 1 and the block it made away together.
    await s.bus.submit('U');
    expect(s.vars().DIMBLK2).toBeUndefined();
    expect(s.model.blocks.has(block.handle)).toBe(true);
    await s.bus.submit('U');
    expect(s.entity().xdata).toBeUndefined();
    expect(s.model.blocks.has(block.handle)).toBe(false);
  });

  it('authors no arrowhead where no dimension can take it', async () => {
    const s = setup();
    // ALL skips locked layers: the palette may show a dimension picked before its layer locked.
    await s.bus.selectAll();
    const layer = s.model.tables.layers.get(s.entity().layer)!;
    const b = new ChangeSetBuilder(s.model);
    b.updateTableRecord('layers', layer.handle, { locked: true });
    s.model.apply(b.build());
    await s.bus.setProperty({ key: 'dimvar:DIMBLK1', value: '_OPEN30' });
    expect([...s.model.blocks.values()].some((x) => x.name === '_OPEN30')).toBe(false);
    expect(s.log).toEqual(['1 object was not changed: on a locked layer.']);
    // A name that is not one of AutoCAD's arrowheads is no choice.
    const unlocked = new ChangeSetBuilder(s.model);
    unlocked.updateTableRecord('layers', layer.handle, { locked: false });
    s.model.apply(unlocked.build());
    await s.set('DIMBLK1', 'DOOR');
    expect(s.log.at(-1)).toBe('Invalid input.');
  });

  it("offers a user arrow the dimension uses after AutoCAD's arrowheads", () => {
    const s = setup({ DIMBLK: OTHER_BLOCK });
    expect(s.rowOf('Arrow 1').options!.at(-1)).toEqual({ value: OTHER_BLOCK, label: 'DOOR' });
    expect(s.rowOf('Arrow 1').options).toHaveLength(21);
  });

  it('changes nothing when an arrowhead is set to the one it has', async () => {
    const s = setup({ DIMBLK: TICK });
    await s.set('DIMBLK1', TICK);
    expect(s.entity().xdata).toBeUndefined();
  });

  it('fills the text with the background or a colour', async () => {
    const s = setup();
    await s.set('DIMTFILL', 'Background');
    expect(s.vars().DIMTFILL).toBe(1);
    await s.set('DIMTFILL', 'aci:3');
    expect(s.vars()).toMatchObject({ DIMTFILL: 2, DIMTFILLCLR: 3 });
    expect(s.rowOf('Fill color').value).toBe('aci:3');
    await s.set('DIMTFILL', 'None');
    expect(s.vars().DIMTFILL).toBeUndefined();
  });

  it('sets the text style by handle', async () => {
    const s = setup();
    await s.set('DIMTXSTY', ROMANS);
    expect(s.overrides()).toEqual([[340, { code: 1005, value: ROMANS }]]);
    expect(s.rowOf('Text style').options!.map((o) => o.label)).toEqual(['romans', 'Standard']);
  });

  it('writes the decimal separator as its character code, dropped when the style’s', async () => {
    const s = setup({ DIMDSEP: '.' });
    await s.set('DIMDSEP', ',');
    expect(s.overrides()).toEqual([[278, { code: 1070, value: 44 }]]);
    expect(s.rowOf('Decimal separator').value).toBe(',');
    await s.set('DIMDSEP', '.');
    expect(s.entity().xdata).toBeUndefined();
  });

  it('keeps the prefix and suffix the two sides of DIMPOST’s <>', async () => {
    const s = setup({ DIMPOST: 'mm' });
    expect(s.rowOf('Dim prefix').value).toBe('');
    expect(s.rowOf('Dim suffix').value).toBe('mm');
    await s.set('DIMPOST.prefix', 'R');
    expect(s.overrides()).toEqual([[3, { code: 1000, value: 'R<>mm' }]]);
    await s.set('DIMPOST.suffix', '');
    expect(s.vars().DIMPOST).toBe('R<>');
    await s.set('DIMPOST.prefix', '');
    expect(s.vars().DIMPOST).toBe('');
    // The alternate's marker is [].
    await s.set('DIMAPOST.suffix', ' in');
    expect(s.vars().DIMAPOST).toBe(' in');
    await s.set('DIMAPOST.prefix', '(');
    expect(s.vars().DIMAPOST).toBe('([] in');
  });

  it('sets DIMZIN’s bits one Suppress row at a time', async () => {
    const s = setup({ DIMZIN: 8 });
    expect(s.rowOf('Suppress trailing zeros').value).toBe('yes');
    expect(s.rowOf('Suppress zero feet').value).toBe('yes');
    await s.set('DIMZIN.leading', 'yes');
    expect(s.vars().DIMZIN).toBe(12);
    await s.set('DIMZIN.feet', 'no');
    // Zero feet kept, zero inches dropped: 2.
    expect(s.vars().DIMZIN).toBe(14);
    await s.set('DIMZIN.inches', 'no');
    expect(s.vars().DIMZIN).toBe(13);
    await s.set('DIMZIN.feet', 'yes');
    expect(s.vars().DIMZIN).toBe(15);
    expect(s.rowOf('Suppress zero inches').value).toBe('no');
  });

  it('sets the tolerance display through DIMTOL, DIMLIM and DIMGAP’s sign', async () => {
    const s = setup({ DIMGAP: 0.09, DIMTP: 0.1 });
    await s.set('DIMTOL', 'symmetrical');
    expect(s.vars()).toMatchObject({ DIMTOL: 1, DIMTM: 0.1 });
    expect(s.rowOf('Tolerance display').value).toBe('symmetrical');
    // Under Symmetrical the lower limit follows the upper.
    await s.set('DIMTP', '0.2');
    expect(s.vars()).toMatchObject({ DIMTP: 0.2, DIMTM: 0.2 });
    await s.set('DIMTOL', 'deviation');
    await s.set('DIMTM', '0.05');
    expect(s.rowOf('Tolerance display').value).toBe('deviation');
    await s.set('DIMTOL', 'limits');
    expect(s.vars()).toMatchObject({ DIMLIM: 1 });
    expect(s.vars().DIMTOL).toBeUndefined();
    await s.set('DIMTOL', 'basic');
    expect(s.vars()).toMatchObject({ DIMGAP: -0.09 });
    expect(s.vars().DIMLIM).toBeUndefined();
    expect(s.rowOf('Tolerance display').value).toBe('basic');
    // Text offset shows the gap's size and keeps the frame.
    expect(s.rowOf('Text offset').value).toBe(0.09);
    await s.set('DIMGAP', '0.2');
    expect(s.vars().DIMGAP).toBe(-0.2);
    await s.set('DIMTOL', 'none');
    expect(s.vars()).toMatchObject({ DIMGAP: 0.2 });
    expect(s.vars().DIMTOL).toBeUndefined();
  });

  it('sets the numeric and choice rows, refusing values out of range', async () => {
    const s = setup();
    await s.set('DIMDLE', '0.25');
    await s.set('DIMATFIT', '0');
    await s.set('DIMLUNIT', '4');
    await s.set('DIMALT', 'on');
    await s.set('DIMALTU', '6');
    await s.set('DIMALTF', '2');
    await s.set('DIMTFAC', '0.5');
    expect(s.vars()).toMatchObject({
      DIMDLE: 0.25,
      DIMATFIT: 0,
      DIMLUNIT: 4,
      DIMALT: 1,
      DIMALTU: 6,
      DIMALTF: 2,
      DIMTFAC: 0.5,
    });
    await s.set('DIMDLE', '-1');
    await s.set('DIMATFIT', '4');
    await s.set('DIMALTF', '0');
    await s.set('DIMTMOVE', 'x');
    expect(s.log).toEqual(Array(4).fill('Invalid input.'));
  });

  it('is one undo step per edit, even when a row sets several DIMVARs', async () => {
    const s = setup({ DIMBLK: TICK });
    await s.set('DIMBLK1', DOT);
    expect(s.bus.undo.state.undoable).toBe(1);
    await s.bus.submit('U');
    expect(s.entity().xdata).toBeUndefined();
  });
});

/** A three-point angular dimension: 90° about the origin. */
const angular: DimensionGeometry = {
  ...dimension,
  dimType: 'angular3pt',
  vertex: { x: 0, y: 0 },
  first: { x: 10, y: 0 },
  second: { x: 0, y: 10 },
  definitionPoint: { x: 6, y: 6 },
} as DimensionGeometry;

const section = (
  sheet: { sections: readonly { title: string; rows: readonly PropertyRow[] }[] },
  title: string,
) => sheet.sections.find((x) => x.title === title)?.rows.map((r) => r.label);

describe('an angular dimension’s units and the Measurement row (M2-35 part 10)', () => {
  it('shows the angle format rows for an angular dimension, and no alternate units', () => {
    const s = setup({}, undefined, [angular]);
    expect(section(s.sheet(), 'Primary Units')).toEqual([
      'Decimal separator',
      'Dim prefix',
      'Dim suffix',
      'Angle format',
      'Suppress leading zeros',
      'Suppress trailing zeros',
      'Precision',
    ]);
    expect(section(s.sheet(), 'Alternate Units')).toBeUndefined();
    expect(section(s.sheet(), 'Tolerances')).toEqual([
      'Tolerance display',
      'Tolerance limit lower',
      'Tolerance limit upper',
      'Tolerance pos vert',
      'Tolerance precision',
      'Tolerance suppress leading zeros',
      'Tolerance suppress trailing zeros',
      'Tolerance text height',
    ]);
    expect(s.rowOf('Angle format')).toMatchObject({ kind: 'choice', value: '0' });
    expect(s.rowOf('Angle format').options?.map((o) => o.label)).toEqual([
      'Decimal Degrees',
      'Degrees Minutes Seconds',
      'Gradians',
      'Radians',
    ]);
    expect(s.rowOf('Precision').value).toBe('0');
    expect(s.rowOf('Suppress leading zeros').value).toBe('no');
  });

  it('shows only the rows both kinds share for linear and angular dimensions together', () => {
    const s = setup({}, undefined, [dimension, angular]);
    expect(section(s.sheet(), 'Primary Units')).toEqual([
      'Decimal separator',
      'Dim prefix',
      'Dim suffix',
    ]);
    expect(section(s.sheet(), 'Alternate Units')).toBeUndefined();
  });

  it('writes DIMAUNIT, DIMADEC and DIMAZIN', async () => {
    const s = setup({ DIMAZIN: 2 }, undefined, [angular]);
    await s.set('DIMAUNIT', '1');
    await s.set('DIMADEC', '3');
    await s.set('DIMAZIN.leading', 'yes');
    expect(s.vars()).toMatchObject({ DIMAUNIT: 1, DIMADEC: 3, DIMAZIN: 3 });
    await s.set('DIMAZIN.trailing', 'no');
    expect(s.vars().DIMAZIN).toBe(1);
    expect(s.rowOf('Suppress trailing zeros').value).toBe('no');
    await s.set('DIMAUNIT', '4');
    // A linear dimension's units are not an angular one's.
    await s.set('DIMLUNIT', '4');
    expect(s.log).toEqual(['Invalid input.', 'Invalid input.']);
    const linear = setup();
    await linear.set('DIMAUNIT', '1');
    expect(linear.log).toEqual(['Invalid input.']);
  });

  it('reads a DIMADEC of -1 as the linear precision, DIMDEC', () => {
    const s = setup({ DIMADEC: -1, DIMDEC: 2 }, undefined, [angular]);
    expect(s.rowOf('Precision').value).toBe('2');
  });

  it('shows the measurement read only, a distance or an angle', () => {
    const measure: DimensionMeasure = (e) =>
      (e.geom as DimensionGeometry).dimType === 'angular3pt' ? Math.PI / 2 : 10;
    const linear = setup({}, undefined, [dimension], measure);
    const texts = section(linear.sheet(), 'Text');
    expect(texts?.slice(-4)).toEqual([
      'Text rotation',
      'Text view direction',
      'Measurement',
      'Text override',
    ]);
    expect(linear.rowOf('Measurement')).toMatchObject({
      key: 'measurement',
      kind: 'distance',
      value: 10,
      readOnly: true,
    });
    const angle = setup({}, undefined, [angular], measure);
    expect(angle.rowOf('Measurement')).toMatchObject({ kind: 'angle', value: Math.PI / 2 });
    const both = setup({}, undefined, [dimension, angular], measure);
    expect(both.rowOf('Measurement')).toMatchObject({ varies: true, readOnly: true });
    // Without a dimension engine to measure with there is no row.
    expect(section(setup().sheet(), 'Text')).not.toContain('Measurement');
  });
});
