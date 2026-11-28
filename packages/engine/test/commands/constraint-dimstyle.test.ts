// M9-03 part 15 (DEC-088): an annotational dimensional constraint's dimension style and the
// DIMVAR rows it is drawn with, in the Properties palette. AutoCAD 2024 Help, "About Applying
// Dimensional Constraints": annotational constraints "display using the current dimension
// style" and are changed in the Properties palette, as dimensions are. A constraint made or
// turned annotational takes the current style and the header's overrides of it; the palette's
// Dim style, Arrow size, Ext line ext, Ext line offset, Text height, Text offset and Dim scale
// overall set its style and its own DIMVARs. The solver is a stand-in.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  constraintDimvars,
  constraintDisplays,
  isDimensionalConstraint,
  propertySheet,
  type ConstraintSolver,
  type DimensionalConstraintObject,
  type HeaderValue,
  type ViewReply,
} from '../../src/index';
import { entityInit, lineGeom, sampleInit } from '../model/fixtures';
import { NO_PARAMETERS } from './solver-stub';

const STANDARD = '27';
const ISO = '28';

const D1: DimensionalConstraintObject = {
  handle: 'D1',
  type: 'TRIYA_DIMCONSTRAINT',
  owner: 'C',
  dimension: 'aligned',
  refs: [{ entity: '30' }],
  parameter: 'd1',
  expression: '10',
  location: { x: 5, y: 2 },
  form: 'dynamic',
};
/** Annotational in Standard, its text 0.25 high. */
const D2: DimensionalConstraintObject = {
  ...D1,
  handle: 'D2',
  parameter: 'd2',
  form: 'annotational',
  style: STANDARD,
  dimvars: { DIMTXT: 0.25 },
};
/** Annotational, saved before DEC-088: no style of its own. */
const D3: DimensionalConstraintObject = {
  ...D1,
  handle: 'D3',
  parameter: 'd3',
  form: 'annotational',
};

/**
 * Line 30; styles Standard (AutoCAD's imperial values, only DIMASZ stated) and ISO-25 (current,
 * DIMTXT 2.5, DIMASZ 2.5, DIMEXO 0.625, DIMEXE 1.25, DIMGAP 0.625), the header setting DIMTXT
 * 3.5 over it.
 */
function setup(vars?: Map<string, number>) {
  const init = sampleInit();
  const header = new Map<string, HeaderValue>([
    ...init.header!,
    ['$DIMSTYLE', 'ISO-25'],
    ['$DIMTXT', 3.5],
    ['$DIMASZ', 2.5],
    ['$DIMEXO', 0.625],
    ['$DIMEXE', 1.25],
    ['$DIMGAP', 0.625],
    ['$DIMSCALE', 1],
  ]);
  const model = DocumentModel.create({
    ...init,
    header,
    meta: { ...init.meta, rootDictionary: 'C' },
    tables: {
      ...init.tables,
      dimStyles: [
        { handle: STANDARD, name: 'Standard', vars: { DIMASZ: 0.18 } },
        {
          handle: ISO,
          name: 'ISO-25',
          vars: { DIMTXT: 2.5, DIMASZ: 2.5, DIMEXO: 0.625, DIMEXE: 1.25, DIMGAP: 0.625 },
        },
      ],
    },
    entities: [
      entityInit('30', lineGeom(0, 0, 10, 0)),
      entityInit('32', { kind: 'CIRCLE', center: { x: 20, y: 0 }, radius: 2 }),
    ],
    objects: [...(init.objects ?? []), D1, D2, D3],
  });
  const under = new Map<string, string>([
    ['5,2', 'D1'],
    ['1,1', 'D2'],
    ['2,2', 'D3'],
  ]);
  const service = {
    ...NO_PARAMETERS,
    measure: (dims, spec) => ({
      ok: true,
      dimension: spec.dimension,
      value: 2,
      parameter: `rad${dims.length + 1}`,
    }),
    addDimension: (_c, dims, spec) => ({
      ok: true,
      dimension: spec.dimension,
      parameter: `rad${dims.length + 1}`,
      expression: '2',
      value: 2,
      updated: [],
      dofs: 0,
      expressions: [],
    }),
  } as Partial<ConstraintSolver> as ConstraintSolver;
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r): Promise<ViewReply> => {
        if (r.op === 'sysvar' && vars) {
          if (r.value !== undefined) vars.set(r.name, r.value as number);
          return Promise.resolve({ ok: true, value: vars.get(r.name) ?? 0 });
        }
        const key = 'point' in r ? `${r.point.x},${r.point.y}` : '';
        if (r.op === 'constraintAt') {
          const c = under.get(key);
          return Promise.resolve({ ok: true, ...(c && { constraint: c }) });
        }
        if (r.op === 'pick') {
          const circle = model.entityByHandle('32')!;
          return Promise.resolve({ ok: true, ids: key === '22,0' ? [circle.id] : [] });
        }
        return Promise.resolve({ ok: true });
      },
    },
    constraints: () => Promise.resolve(service),
  });
  const dim = (h: string) =>
    [...model.objects.values()].filter(isDimensionalConstraint).find((d) => d.handle === h)!;
  const sheet = (handles: string[]) => propertySheet(model, [], undefined, 0, undefined, handles);
  return { model, bus, dim, sheet };
}

describe('an annotational constraint’s DIMVARs (M9-03 part 15)', () => {
  it('are its style’s, its own over them; with no style of its own, the header’s', () => {
    const s = setup();
    expect(constraintDimvars(s.model, D2)).toEqual({
      DIMASZ: 0.18,
      // AutoCAD's imperial values where Standard states none.
      DIMEXE: 0.18,
      DIMEXO: 0.0625,
      DIMGAP: 0.09,
      DIMSCALE: 1,
      DIMTXT: 0.25,
    });
    expect(constraintDimvars(s.model, D3)).toEqual({
      DIMASZ: 2.5,
      DIMEXE: 1.25,
      DIMEXO: 0.625,
      DIMGAP: 0.625,
      DIMSCALE: 1,
      DIMTXT: 3.5,
    });
    // A purged style: the header's, as before DEC-088.
    expect(constraintDimvars(s.model, { ...D2, style: 'FF' }).DIMTXT).toBe(0.25);
    expect(constraintDimvars(s.model, { ...D2, style: 'FF' }).DIMASZ).toBe(2.5);
  });

  it('size what the renderer draws: annotational ones carry them, dynamic ones none', () => {
    const s = setup();
    const shown = constraintDisplays(s.model, 2);
    expect(shown.find((d) => d.handle === 'D1')!.dimvars).toBeUndefined();
    expect(shown.find((d) => d.handle === 'D2')!.dimvars).toMatchObject({ DIMTXT: 0.25 });
    expect(shown.find((d) => d.handle === 'D3')!.dimvars).toMatchObject({ DIMTXT: 3.5 });
  });
});

describe('the Properties palette’s dimension rows of an annotational constraint', () => {
  it('lists Dim style, then Lines & Arrows, Text and Fit rows as a dimension’s', () => {
    const s = setup();
    const sheet = s.sheet(['D2']);
    expect(sheet.sections.map((x) => x.title)).toEqual([
      'Constraint',
      'Misc',
      'Lines & Arrows',
      'Text',
      'Fit',
    ]);
    const rows = sheet.sections.slice(1).flatMap((x) => x.rows);
    expect(rows.map((r) => [r.key, r.label, r.value])).toEqual([
      ['constraint-dimStyle', 'Dim style', STANDARD],
      ['dimvar:DIMASZ', 'Arrow size', 0.18],
      ['dimvar:DIMEXE', 'Ext line ext', 0.18],
      ['dimvar:DIMEXO', 'Ext line offset', 0.0625],
      ['dimvar:DIMTXT', 'Text height', 0.25],
      ['dimvar:DIMGAP', 'Text offset', 0.09],
      ['dimvar:DIMSCALE', 'Dim scale overall', 1],
    ]);
    expect(rows[0]!.options!.map((o) => o.label)).toEqual(['ISO-25', 'Standard']);
  });

  it('shows the current style for one saved without; several share or vary', () => {
    const s = setup();
    const one = s.sheet(['D3']).sections.find((x) => x.title === 'Misc')!.rows[0]!;
    expect(one.value).toBe(ISO);
    const both = s.sheet(['D2', 'D3']).sections.flatMap((x) => x.rows);
    expect(both.find((r) => r.key === 'constraint-dimStyle')!.varies).toBe(true);
    expect(both.find((r) => r.key === 'dimvar:DIMSCALE')!.value).toBe(1);
    expect(both.find((r) => r.key === 'dimvar:DIMTXT')!.varies).toBe(true);
  });

  it('has none for a dynamic constraint, or a selection holding one', () => {
    const s = setup();
    expect(s.sheet(['D1']).sections.map((x) => x.title)).toEqual(['Constraint']);
    expect(s.sheet(['D1', 'D2']).sections.map((x) => x.title)).toEqual(['Constraint']);
  });
});

describe('editing an annotational constraint’s dimension rows', () => {
  it('Text height and the other rows set its own DIMVARs, each one undo step', async () => {
    const s = setup();
    await s.bus.pick({ x: 1, y: 1 });
    await s.bus.setProperty({ key: 'dimvar:DIMTXT', value: '0.5' });
    await s.bus.setProperty({ key: 'dimvar:DIMASZ', value: 0.3 });
    await s.bus.setProperty({ key: 'dimvar:DIMSCALE', value: '2' });
    expect(s.dim('D2').dimvars).toEqual({ DIMTXT: 0.5, DIMASZ: 0.3, DIMSCALE: 2 });
    expect(constraintDimvars(s.model, s.dim('D2'))).toMatchObject({ DIMTXT: 0.5, DIMSCALE: 2 });
    await s.bus.script(['U']);
    expect(s.dim('D2').dimvars).toEqual({ DIMTXT: 0.5, DIMASZ: 0.3 });
    // A value the dimension's row refuses changes nothing: text height is positive.
    await s.bus.setProperty({ key: 'dimvar:DIMTXT', value: '0' });
    await s.bus.setProperty({ key: 'dimvar:DIMTXT', value: 'tall' });
    expect(s.dim('D2').dimvars?.DIMTXT).toBe(0.5);
    // A DIMVAR a constraint is not drawn with is not one of its rows.
    await s.bus.setProperty({ key: 'dimvar:DIMTAD', value: '1' });
    expect(s.dim('D2').dimvars).toEqual({ DIMTXT: 0.5, DIMASZ: 0.3 });
  });

  it('Text offset keeps DIMGAP’s sign as a dimension’s does', async () => {
    const s = setup();
    await s.bus.pick({ x: 2, y: 2 });
    await s.bus.setProperty({ key: 'dimvar:DIMGAP', value: '1' });
    expect(s.dim('D3').dimvars).toEqual({ DIMGAP: 1 });
  });

  it('Dim style sets its style, keeping its own DIMVARs; a style the drawing lacks is refused', async () => {
    const s = setup();
    await s.bus.pick({ x: 1, y: 1 });
    await s.bus.setProperty({ key: 'constraint-dimStyle', value: ISO });
    expect(s.dim('D2')).toMatchObject({ style: ISO, dimvars: { DIMTXT: 0.25 } });
    expect(constraintDimvars(s.model, s.dim('D2'))).toMatchObject({ DIMASZ: 2.5, DIMTXT: 0.25 });
    await s.bus.setProperty({ key: 'constraint-dimStyle', value: 'FF' });
    expect(s.dim('D2').style).toBe(ISO);
    await s.bus.script(['U']);
    expect(s.dim('D2').style).toBe(STANDARD);
  });

  it('a dynamic constraint made annotational takes the current style and the header’s overrides', async () => {
    const s = setup();
    await s.bus.pick({ x: 5, y: 2 });
    await s.bus.setProperty({ key: 'dimvar:DIMTXT', value: '9' });
    expect(s.dim('D1').dimvars).toBeUndefined();
    await s.bus.setProperty({ key: 'constraint-form', value: 'annotational' });
    expect(s.dim('D1')).toMatchObject({
      form: 'annotational',
      style: ISO,
      dimvars: { DIMTXT: 3.5 },
    });
    // Back to dynamic and annotational again, it keeps the style it had.
    await s.bus.setProperty({ key: 'constraint-dimStyle', value: STANDARD });
    await s.bus.setProperty({ key: 'constraint-form', value: 'dynamic' });
    await s.bus.setProperty({ key: 'constraint-form', value: 'annotational' });
    expect(s.dim('D1').style).toBe(STANDARD);
  });

  it('COPY gives a copy its style and DIMVARs', async () => {
    const s = setup();
    await s.bus.script(['COPY']);
    await s.bus.answer({ kind: 'selection', ids: [s.model.entityByHandle('30')!.id] });
    await s.bus.script(['0,0', '0,20', '']);
    const copies = [...s.model.objects.values()]
      .filter(isDimensionalConstraint)
      .filter((d) => !['D1', 'D2', 'D3'].includes(d.handle));
    expect(copies.map((d) => [d.form, d.style, d.dimvars])).toEqual([
      ['dynamic', undefined, undefined],
      ['annotational', STANDARD, { DIMTXT: 0.25 }],
      ['annotational', undefined, undefined],
    ]);
  });

  it('DCRADIUS with Form Annotational gives the new constraint the current style', async () => {
    const vars = new Map([['CCONSTRAINTFORM', 1]]);
    const s = setup(vars);
    await s.bus.script(['DCRADIUS']);
    await s.bus.pick({ x: 22, y: 0 });
    await s.bus.pick({ x: 25, y: 3 });
    await s.bus.script(['']);
    const made = [...s.model.objects.values()]
      .filter(isDimensionalConstraint)
      .find((d) => d.dimension === 'radial')!;
    expect(made).toMatchObject({ form: 'annotational', style: ISO, dimvars: { DIMTXT: 3.5 } });
    vars.set('CCONSTRAINTFORM', 0);
    await s.bus.script(['DCRADIUS']);
    await s.bus.pick({ x: 22, y: 0 });
    await s.bus.pick({ x: 25, y: -3 });
    await s.bus.script(['']);
    const dynamic = [...s.model.objects.values()]
      .filter(isDimensionalConstraint)
      .filter((d) => d.dimension === 'radial')[1]!;
    expect(dynamic.form).toBe('dynamic');
    expect(dynamic.style).toBeUndefined();
  });
});
