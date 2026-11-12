// M2-35 part 5: a dimension's other Properties rows (AutoCAD 2024's Lines & Arrows, Text, Fit,
// Primary Units, Alternate Units and Tolerances groups), each written as `DSTYLE` overrides in
// the dimension's ACAD xdata. A row may set several DIMVARs at once, as AutoCAD's do.
import { describe, expect, it } from 'vitest';
import {
  DIMVAR_ROWS,
  DocumentModel,
  PromptBus,
  builtinCommands,
  dimVars,
  propertySheet,
  type DimStyleRecord,
  type DimensionGeometry,
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

function init(vars: DimStyleRecord['vars'] = {}): DocumentInit {
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
    entities: [entityInit(DIM, dimension)],
  };
}

function setup(vars: DimStyleRecord['vars'] = {}) {
  const model = DocumentModel.create(init(vars));
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
  const sheet = () => propertySheet(model, [entity().id]);
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
    // Closed filled, then the drawing's arrowhead blocks by AutoCAD's names.
    expect(s.rowOf('Arrow 1').options).toEqual([
      { value: '', label: 'Closed filled' },
      { value: TICK, label: 'Architectural tick' },
      { value: DOT, label: 'Dot' },
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
