// M4-21: a feature control frame's Properties rows. AutoCAD 2024 shows a TOLERANCE's Dim style,
// Dim line color, Text color, Text height and Text style (ActiveX AcadTolerance's StyleName,
// DimensionLineColor, TextColor, TextHeight and TextStyle) and edits the four DIMVARs as
// `DSTYLE` overrides in the frame's ACAD xdata, as a dimension's rows do (M2-35 part 5). Its
// Direction (DirectionVector, DXF 11) turns the frame about its insertion point, and Position
// moves it.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  annotationParts,
  builtinCommands,
  dimVars,
  propertySheet,
  type DimStyleRecord,
  type DocumentInit,
  type EntityGeometry,
  type PropertyRow,
  type TextStyleRecord,
  type ToleranceGeometry,
} from '../../src/index';
import { entityInit, record, sampleInit } from '../model/fixtures';

const FRAME = '30';
const OTHER_FRAME = '31';
const LINE = '32';
const STANDARD = '27';
const ISO = '28';
const LEADERS = '29';
const ACAD = '12';
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

const frame: ToleranceGeometry = {
  kind: 'TOLERANCE',
  style: STANDARD,
  position: { x: 10, y: 20 },
  rotation: 0,
  text: '{\\Fgdt;j}%%v{\\Fgdt;n}0.1%%vA',
};

function setup(
  styles: readonly DimStyleRecord[] = [
    { handle: STANDARD, name: 'Standard', vars: { DIMTXT: 0.18 } },
  ],
  frames: readonly ToleranceGeometry[] = [frame],
  more: readonly [string, EntityGeometry][] = [],
) {
  const base = sampleInit();
  const init: DocumentInit = {
    ...base,
    tables: {
      ...base.tables,
      appIds: [record(ACAD, 'ACAD')],
      textStyles: [textStyle(ROMANS, 'romans'), textStyle(STANDARD_TEXT, 'Standard')],
      dimStyles: [...styles],
    },
    entities: [
      ...frames.map((g, n) => entityInit(n === 0 ? FRAME : OTHER_FRAME, g)),
      ...more.map(([h, g]) => entityInit(h, g)),
    ],
  };
  const model = DocumentModel.create(init);
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const log: string[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  const entity = () => model.entityByHandle(FRAME)!;
  const geom = () => entity().geom as ToleranceGeometry;
  const handles = [FRAME, ...(frames.length > 1 ? [OTHER_FRAME] : []), ...more.map(([h]) => h)];
  const ids = () => handles.map((h) => model.entityByHandle(h)!.id);
  const set = async (key: string, value: string) => {
    await bus.selectAll();
    await bus.setProperty({ key, value });
  };
  const sheet = (filter?: 'TOLERANCE') => propertySheet(model, ids(), filter);
  const rowOf = (label: string): PropertyRow => {
    for (const s of sheet().sections) {
      const r = s.rows.find((x) => x.label === label);
      if (r) return r;
    }
    throw new Error(`no row ${label}`);
  };
  /** The frame's DSTYLE overrides, as (code, value) pairs. */
  const overrides = (): [number, unknown][] => {
    const v = entity().xdata?.[0]?.values ?? [];
    const out: [number, unknown][] = [];
    for (let i = 2; i + 1 < v.length - 1; i += 2) out.push([v[i]!.value as number, v[i + 1]!]);
    return out;
  };
  const vars = () => dimVars(geom().style, entity().xdata, model);
  return { model, bus, log, entity, geom, set, sheet, rowOf, overrides, vars };
}

/** Every compartment's text 1 unit wide per character, so the parts need no font. */
const measure = (t: { contents: string }) => t.contents.length;

describe('a feature control frame’s Properties rows (M4-21)', () => {
  it('shows AutoCAD 2024’s groups and rows, in its order', () => {
    const s = setup();
    const sections = s.sheet().sections.map((x) => [x.title, x.rows.map((r) => r.label)]);
    expect(sections.slice(1)).toEqual([
      ['Misc', ['Dim style']],
      ['Lines & Arrows', ['Dim line color']],
      ['Text', ['Text color', 'Text height', 'Text style']],
      ['Geometry', ['Position X', 'Position Y', 'Direction']],
    ]);
  });

  it('shows what the frame is drawn with: its style’s values, AutoCAD’s defaults, overrides', () => {
    const s = setup();
    expect(s.rowOf('Dim style')).toMatchObject({
      kind: 'choice',
      value: STANDARD,
      options: [{ value: STANDARD, label: 'Standard' }],
    });
    expect(s.rowOf('Dim line color')).toMatchObject({ value: 'ByBlock', colorDialog: 'index' });
    expect(s.rowOf('Text color')).toMatchObject({ value: 'ByBlock', colorDialog: 'index' });
    expect(s.rowOf('Text height')).toMatchObject({ kind: 'distance', value: 0.18 });
    expect(s.rowOf('Text style')).toMatchObject({ kind: 'choice', value: STANDARD_TEXT });
    expect(s.rowOf('Text style').options?.map((o) => o.label)).toEqual(['romans', 'Standard']);
    expect(s.rowOf('Position X')).toMatchObject({ kind: 'distance', value: 10 });
    expect(s.rowOf('Position Y')).toMatchObject({ kind: 'distance', value: 20 });
    expect(s.rowOf('Direction')).toMatchObject({ kind: 'angle', value: 0 });
  });

  it('reads its style’s Leaders and Tolerances sub-style, which it is drawn with', () => {
    const s = setup([
      { handle: STANDARD, name: 'Standard', vars: { DIMTXT: 0.18 } },
      { handle: LEADERS, name: 'Standard$7', vars: { DIMTXT: 0.25, DIMCLRD: 3 } },
    ]);
    expect(s.rowOf('Text height').value).toBe(0.25);
    expect(s.rowOf('Dim line color').value).toBe('aci:3');
    // The sub-style is not a style to choose.
    expect(s.rowOf('Dim style').value).toBe(STANDARD);
  });

  it('writes each row as DSTYLE overrides, which the frame draws with', async () => {
    const s = setup();
    await s.set('dimvar:DIMCLRD', 'aci:1');
    await s.set('dimvar:DIMCLRT', 'aci:5');
    await s.set('dimvar:DIMTXT', '0.5');
    await s.set('dimvar:DIMTXSTY', ROMANS);
    expect(s.log).toEqual([]);
    expect(s.overrides()).toEqual([
      [176, { code: 1070, value: 1 }],
      [178, { code: 1070, value: 5 }],
      [140, { code: 1040, value: 0.5 }],
      [340, { code: 1005, value: ROMANS }],
    ]);
    expect(s.vars()).toMatchObject({ DIMCLRD: 1, DIMCLRT: 5, DIMTXT: 0.5, DIMTXSTY: ROMANS });
    expect(s.rowOf('Dim line color').value).toBe('aci:1');
    expect(s.rowOf('Text color').value).toBe('aci:5');
    expect(s.rowOf('Text height').value).toBe(0.5);
    expect(s.rowOf('Text style').value).toBe(ROMANS);

    const parts = annotationParts(s.geom(), s.model, s.entity().xdata, measure)!;
    const frames = parts.filter((p) => p.geom.kind === 'LWPOLYLINE');
    const texts = parts.filter((p) => p.geom.kind === 'MTEXT');
    expect(frames.length).toBe(3);
    for (const p of frames) expect(p.color).toEqual({ kind: 'aci', index: 1 });
    for (const p of texts) {
      expect(p.color).toEqual({ kind: 'aci', index: 5 });
      expect(p.geom).toMatchObject({ height: 0.5, style: ROMANS });
    }
  });

  it('drops an override set back to the style’s value', async () => {
    const s = setup();
    await s.set('dimvar:DIMTXT', '0.5');
    expect(s.overrides()).toEqual([[140, { code: 1040, value: 0.5 }]]);
    await s.set('dimvar:DIMTXT', '0.18');
    expect(s.overrides()).toEqual([]);
  });

  it('refuses a value a row cannot take, changing nothing', async () => {
    const s = setup();
    await s.set('dimvar:DIMTXT', '0');
    await s.set('dimvar:DIMTXT', '-1');
    await s.set('dimvar:DIMTXSTY', 'no such style');
    await s.set('dimvar:DIMCLRD', 'rgb:1,2,3');
    // A dimension's row a frame does not have.
    await s.set('dimvar:DIMASZ', '1');
    await s.set('dimStyle', 'no such style');
    await s.set('textOverride', 'x');
    expect(s.log).toEqual(Array(7).fill('Invalid input.'));
    expect(s.entity().xdata).toBeUndefined();
    expect(s.geom()).toEqual(frame);
  });

  it('chooses another dimension style', async () => {
    const s = setup([
      { handle: STANDARD, name: 'Standard', vars: { DIMTXT: 0.18 } },
      { handle: ISO, name: 'ISO-25', vars: { DIMTXT: 2.5 } },
    ]);
    expect(s.rowOf('Dim style').options?.map((o) => o.label)).toEqual(['ISO-25', 'Standard']);
    await s.set('dimStyle', ISO);
    expect(s.geom().style).toBe(ISO);
    expect(s.rowOf('Text height').value).toBe(2.5);
  });

  it('turns the frame about its insertion point and moves it', async () => {
    const s = setup();
    await s.set('rotation', '90');
    expect(s.geom().rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(s.geom().position).toEqual({ x: 10, y: 20 });
    expect(s.rowOf('Direction').value).toBeCloseTo(Math.PI / 2, 12);
    await s.set('positionX', '15');
    await s.set('positionY', '-5');
    expect(s.geom().position.x).toBeCloseTo(15, 12);
    expect(s.geom().position.y).toBeCloseTo(-5, 12);
    expect(s.geom().text).toBe(frame.text);
    await s.set('rotation', 'x');
    expect(s.log).toEqual(['Invalid input.']);
  });

  it('shows a row two frames share, and edits both', async () => {
    const s = setup(undefined, [frame, { ...frame, position: { x: 0, y: 0 }, rotation: 1 }]);
    expect(s.rowOf('Text height').value).toBe(0.18);
    expect(s.rowOf('Direction')).toMatchObject({ varies: true });
    await s.set('dimvar:DIMTXT', '0.3');
    for (const h of [FRAME, OTHER_FRAME]) {
      const e = s.model.entityByHandle(h)!;
      expect(dimVars(STANDARD, e.xdata, s.model).DIMTXT).toBe(0.3);
    }
  });

  it('is one undo step per edit', async () => {
    const s = setup();
    await s.set('dimvar:DIMTXT', '0.5');
    expect(s.bus.undo.state.undoable).toBe(1);
    await s.bus.submit('U');
    expect(s.entity().xdata).toBeUndefined();
  });

  it('shows only the general rows with other objects, until the frames are picked', async () => {
    const s = setup(
      undefined,
      [frame],
      [[LINE, { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }]],
    );
    expect(s.sheet().sections.map((x) => x.title)).toEqual(['General']);
    expect(s.sheet('TOLERANCE').sections.map((x) => x.title)).toContain('Text');
  });

  it('refuses the rows without an ACAD application to write overrides under', async () => {
    // A drawing always has ACAD (readers add it); a model built without one refuses the edit.
    const bare = (() => {
      const base = sampleInit();
      const model = DocumentModel.create({
        ...base,
        tables: {
          ...base.tables,
          appIds: [],
          dimStyles: [{ handle: STANDARD, name: 'Standard', vars: {} }],
        },
        entities: [entityInit(FRAME, frame)],
      });
      return { model, bus: new PromptBus({ model, registry: builtinCommands() }) };
    })();
    const log: string[] = [];
    bare.bus.on((e) => {
      if (e.type === 'log') log.push(e.line);
    });
    await bare.bus.selectAll();
    await bare.bus.setProperty({ key: 'dimvar:DIMTXT', value: '1' });
    expect(log).toEqual(['Invalid input.']);
  });
});
