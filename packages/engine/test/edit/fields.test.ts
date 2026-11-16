// M4-10 part 1: field evaluation. A text's fields (DrawingField, as the FIELD objects in its
// ACAD_FIELD dictionary hold them) evaluate to the date, the file name, the layout's name and
// plot scale, the drawing's dates and variables, and an object's properties, formatted by the
// field's format string as AutoCAD writes them.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  evaluateFields,
  fieldCodeText,
  fieldText,
  formatFieldDate,
  formatFieldNumber,
  julianDate,
  type DrawingField,
  type FieldContext,
  type HeaderValue,
} from '../../src/index';
import {
  LAYER_WALLS,
  MODEL_SPACE,
  PAPER_SPACE,
  circleGeom,
  entityInit,
  sampleInit,
} from '../model/fixtures';

const NOW = new Date(2026, 10, 16, 17, 5, 9); // Monday 16 November 2026, 5:05:09 PM

const child = (code: string, value?: string, objects: string[] = []): DrawingField => ({
  evaluator: code.startsWith('\\AcObjProp') ? 'AcObjProp' : 'AcVar',
  code,
  children: [],
  objects,
  ...(value === undefined ? {} : { value }),
});

const root = (code: string, ...children: DrawingField[]): DrawingField => ({
  evaluator: '_text',
  code,
  children,
  objects: [],
});

function model(header: [string, HeaderValue][] = []) {
  const base = sampleInit();
  return DocumentModel.create({
    ...base,
    header: new Map<string, HeaderValue>([...base.header!, ...header]),
    layouts: [
      { handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE },
      {
        handle: '1E',
        name: 'Sheet A1',
        tabOrder: 1,
        blockRecord: PAPER_SPACE,
        plot: {
          paperSize: 'ISO_A1_(841.00_x_594.00_MM)',
          paperWidth: 841,
          paperHeight: 594,
          margins: { left: 0, bottom: 0, right: 0, top: 0 },
          paperUnits: 'millimeters',
          rotation: 0,
          origin: { x: 0, y: 0 },
          scale: { numerator: 1, denominator: 50 },
          plotType: 5,
          flags: 0,
          pageSetupName: 'A1 Plotter',
        },
      },
    ],
    entities: [
      ...base.entities!,
      entityInit('60', circleGeom(0, 0, 10), { layer: LAYER_WALLS }),
      entityInit('61', {
        kind: 'LWPOLYLINE',
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 2000, y: 0, bulge: 0 },
          { x: 2000, y: 1500, bulge: 0 },
          { x: 0, y: 1500, bulge: 0 },
        ],
        closed: true,
      }),
    ],
  });
}

const context = (over: Partial<FieldContext> = {}): FieldContext => ({
  model: model(),
  now: NOW,
  fileName: 'Plan.dxf',
  folder: '',
  space: MODEL_SPACE,
  ...over,
});

/** The value one field evaluates to in `ctx`. */
function value(code: string, ctx: FieldContext = context(), objects: string[] = []): string {
  const r = evaluateFields(root('%<\\_FldIdx 0>%', child(code, 'cached', objects)), ctx);
  return r.text;
}

describe('formatFieldDate', () => {
  it.each([
    ['M/d/yyyy', '11/16/2026'],
    ['dd/MM/yyyy', '16/11/2026'],
    ['dd.MM.yy', '16.11.26'],
    ['MMMM d, yyyy', 'November 16, 2026'],
    ['dddd, MMMM dd, yyyy', 'Monday, November 16, 2026'],
    ['ddd, MMM d, yyyy', 'Mon, Nov 16, 2026'],
    ['dd.MM.yyyy - HH:mm', '16.11.2026 - 17:05'],
    ['h:mm:ss tt', '5:05:09 PM'],
    ['hh:mm tt', '05:05 PM'],
    ["'Plotted' yyyy", 'Plotted 2026'],
    ['%x', '11/16/2026'],
    ['%X', '5:05:09 PM'],
    ['%c', '11/16/2026 5:05:09 PM'],
    ['%#x', 'Monday, November 16, 2026'],
    ['%#c', 'Monday, November 16, 2026 5:05:09 PM'],
    ['%tc1MMMM d, yyyy', 'NOVEMBER 16, 2026'],
    ['', '11/16/2026'],
  ])('%s gives %s', (picture, shown) => {
    expect(formatFieldDate(NOW, picture)).toBe(shown);
  });

  it('writes midnight and noon as 12 on the 12-hour clock', () => {
    expect(formatFieldDate(new Date(2026, 0, 2, 0, 7), 'h:mm tt')).toBe('12:07 AM');
    expect(formatFieldDate(new Date(2026, 0, 2, 12, 7), 'h:mm tt')).toBe('12:07 PM');
  });
});

describe('formatFieldNumber', () => {
  const units = { lunits: 2, luprec: 4, aunits: 0, auprec: 0, unitmode: 0 };
  it.each([
    ['', 1234.5, '1234.5000'],
    ['%lu2%pr2', 1234.5, '1234.50'],
    ['%lu2%pr0', 1234.5, '1235'],
    ['%lu2%pr3%zs8', 2.5, '2.5'],
    ['%lu2%pr3%zs4', 0.5, '.500'],
    ['%lu2%pr2%th44', 1234567.891, '1,234,567.89'],
    ['%lu2%pr2%ds44', 2.5, '2,50'],
    ['%lu2%pr2%ps[Ø,mm]', 20, 'Ø20.00mm'],
    ['%lu2%pr2%ct8[0.001]', 2500, '2.50'],
    ['%lu4%pr4', 17.5, `1'-5 1/2"`],
    ['%lu1%pr2', 1234.5, '1.23E+03'],
    ['%.3f', 2.5, '2.500'],
    ['%lu2%ct4%qf1%PR0 sq.ft.', 12.4, '12 sq.ft.'],
  ])('%s formats %d as %s', (format, n, shown) => {
    expect(formatFieldNumber(n, format, units)).toBe(shown);
  });

  it('writes a scale or a variable without a precision as it is', () => {
    expect(formatFieldNumber(50, '1:%lu2%ct1%qf2816', units, 'plain')).toBe('1:50');
    expect(formatFieldNumber(0.25, '', units, 'plain')).toBe('0.25');
    expect(formatFieldNumber(0.25, '%pr3', units, 'plain')).toBe('0.250');
    expect(formatFieldNumber(255, '%X', units, 'plain')).toBe('FF');
    expect(formatFieldNumber(255, '%x', units, 'plain')).toBe('ff');
  });

  it('takes the drawing units when the format names none', () => {
    const feet = { lunits: 4, luprec: 3, aunits: 0, auprec: 0, unitmode: 0 };
    expect(formatFieldNumber(30.25, '', feet)).toBe(`2'-6 1/4"`);
  });

  it('writes an angle in the angular units the format names', () => {
    expect(formatFieldNumber(Math.PI / 4, '%au0%pr1', units, 'angle')).toBe('45.0');
    expect(formatFieldNumber(Math.PI / 2, '%au3%pr2', units, 'angle')).toBe('1.57r');
  });
});

describe('fieldCodeText and fieldText', () => {
  const f = root(
    'Plotted on %<\\_FldIdx 0>% from %<\\_FldIdx 1>%',
    child('\\AcVar PlotDate \\f "M/d/yyyy"', '1/2/2025'),
    child('\\AcVar Filename \\f "%fn2"'),
  );

  it('shows the codes in place, as the Field dialog lists them', () => {
    expect(fieldCodeText(f)).toBe(
      'Plotted on %<\\AcVar PlotDate \\f "M/d/yyyy">% from %<\\AcVar Filename \\f "%fn2">%',
    );
  });

  it('shows each value in place, an unevaluated field as ----', () => {
    expect(fieldText(f)).toBe('Plotted on 1/2/2025 from ----');
  });
});

describe('evaluateFields', () => {
  it('evaluates Date by its format, to now', () => {
    expect(value('\\AcVar Date \\f "dd/MM/yyyy"')).toBe('16/11/2026');
    expect(value('\\AcVar Date')).toBe('11/16/2026');
  });

  it('gives the file name by %fn: 1 the folder, 2 the name, 4 the extension', () => {
    const ctx = context({ fileName: 'Plan.dxf', folder: 'C:\\Jobs\\' });
    expect(value('\\AcVar Filename \\f "%fn2"', ctx)).toBe('Plan');
    expect(value('\\AcVar Filename \\f "%fn6"', ctx)).toBe('Plan.dxf');
    expect(value('\\AcVar Filename \\f "%fn1"', ctx)).toBe('C:\\Jobs\\');
    expect(value('\\AcVar Filename \\f "%fn7"', ctx)).toBe('C:\\Jobs\\Plan.dxf');
    expect(value('\\AcVar Filename', ctx)).toBe('C:\\Jobs\\Plan.dxf');
    expect(value('\\AcVar Filename \\f "%tc1%fn2"', ctx)).toBe('PLAN');
  });

  it('gives the layout name (CTAB) of the space the text is in', () => {
    expect(value('\\AcVar ctab', context({ space: PAPER_SPACE }))).toBe('Sheet A1');
    expect(value('\\AcVar ctab \\f "%tc1"', context({ space: PAPER_SPACE }))).toBe('SHEET A1');
    expect(value('\\AcVar CTAB', context())).toBe('Model');
  });

  it("gives the layout's plot scale and page setup name", () => {
    const ctx = context({ space: PAPER_SPACE });
    expect(value('\\AcVar PlotScale', ctx)).toBe('1:50');
    expect(value('\\AcVar PlotScale \\f "1:%lu2%ct1%qf2816"', ctx)).toBe('1:50');
    expect(value('\\AcVar PageSetupName', ctx)).toBe('A1 Plotter');
    expect(value('\\AcVar PlotScale', context())).toBe('cached');
  });

  it('keeps the plot date as last evaluated unless plotting', () => {
    expect(value('\\AcVar PlotDate \\f "M/d/yyyy"')).toBe('cached');
    const plotted = context({ plotDate: new Date(2026, 11, 24, 9, 30) });
    expect(value('\\AcVar PlotDate \\f "dd.MM.yyyy HH:mm"', plotted)).toBe('24.12.2026 09:30');
  });

  it("gives the drawing's created and saved dates", () => {
    const created = new Date(2025, 2, 3, 8, 0, 0);
    const saved = new Date(2026, 5, 7, 14, 30, 0);
    const ctx = context({
      model: model([
        ['$TDCREATE', julianDate(created)],
        ['$TDUPDATE', julianDate(saved)],
      ]),
    });
    expect(value('\\AcVar CreateDate \\f "M/d/yyyy h:mm tt"', ctx)).toBe('3/3/2025 8:00 AM');
    expect(value('\\AcVar SaveDate \\f "yyyy-MM-dd"', ctx)).toBe('2026-06-07');
  });

  it('gives a system variable from the header, a number by its format', () => {
    const ctx = context({ model: model([['$DIMSCALE', 50]]) });
    expect(value('\\AcVar Dimscale \\f "%lu2%pr1"', ctx)).toBe('50.0');
    expect(value('\\AcVar clayer', ctx)).toBe('WALLS');
    expect(value('\\AcVar Login', ctx)).toBe('cached');
  });

  it("gives an object's properties", () => {
    const ctx = context();
    const area = (format: string) =>
      value(`\\AcObjProp Object(%<\\_ObjIdx 0>%).Area \\f "${format}"`, ctx, ['61']);
    expect(area('%lu2%pr2%ct8[1E-06]')).toBe('3.00');
    expect(area('%lu2%pr0')).toBe('3000000');
    const circle = (prop: string, format = '%lu2%pr3') =>
      value(`\\AcObjProp.16.2 Object(%<\\_ObjIdx 0>%).${prop} \\f "${format}"`, ctx, ['60']);
    expect(circle('Radius')).toBe('10.000');
    expect(circle('Diameter')).toBe('20.000');
    expect(circle('Circumference')).toBe('62.832');
    expect(circle('Area', '%lu2%pr1')).toBe('314.2');
    expect(circle('Layer', '%tc1')).toBe('WALLS');
    expect(value('\\AcObjProp Object(%<\\_ObjIdx 0>%).Length', ctx, ['61'])).toBe('7000.0000');
  });

  it('shows #### for an object that is gone, keeps a property it does not measure', () => {
    const ctx = context();
    expect(value('\\AcObjProp Object(%<\\_ObjIdx 0>%).Area', ctx, ['99'])).toBe('####');
    expect(value('\\AcObjProp Object(%<\\_ObjIdx 0>%).Radius', ctx, ['61'])).toBe('cached');
  });

  it('keeps the value of a field it cannot evaluate', () => {
    expect(value('\\AcExpr (1+2)')).toBe('cached');
    expect(value('\\AcSm SheetSet.Name')).toBe('cached');
  });

  it('rebuilds the text around the fields and counts them', () => {
    const f = root(
      '{\\C1;Date:} %<\\_FldIdx 0>%\\P%<\\_FldIdx 1>% / %<\\_FldIdx 2>%',
      child('\\AcVar Date \\f "M/d/yyyy"', '1/1/2020'),
      child('\\AcVar Filename \\f "%fn6"', 'Old.dxf'),
      child('\\AcExpr (1+2)', '3'),
    );
    const r = evaluateFields(f, context());
    expect(r.text).toBe('{\\C1;Date:} 11/16/2026\\PPlan.dxf / 3');
    expect(r.found).toBe(3);
    expect(r.evaluated).toBe(2);
    expect(r.field.children.map((c) => c.value)).toEqual(['11/16/2026', 'Plan.dxf', '3']);
    expect(r.field.children[0]!.time).toBe(NOW.getTime());
    // The root keeps no value when the file gave it none, and the input is not changed.
    expect(r.field.value).toBeUndefined();
    expect(f.children[0]!.value).toBe('1/1/2020');
  });

  it("updates the root's value when it holds one", () => {
    const f = {
      ...root('Saved %<\\_FldIdx 0>%', child('\\AcVar Date \\f "yyyy"', '2020')),
      value: 'Saved 2020',
    };
    expect(evaluateFields(f, context()).field.value).toBe('Saved 2026');
  });
});
