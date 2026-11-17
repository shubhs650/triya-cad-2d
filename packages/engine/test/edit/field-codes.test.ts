// M4-10 part 2: fields typed into text. The Field dialog's choices make a field code
// (`fieldCode`); a text holding codes is kept as the codes' FIELD tree with their values shown
// (`fieldOfText`, `textWithFields`), opens in the editor as its codes again
// (`editableFieldText`), and the dialog's Preview evaluates a code against what it is given
// of the drawing (`previewField`), as the drawing would.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  editableFieldCode,
  editableFieldText,
  fieldCode,
  fieldOfText,
  fieldValues,
  objectFieldProperties,
  previewField,
  textWithFields,
  type DrawingField,
  type FieldContext,
  type FieldSnapshot,
} from '../../src/index';
import { LAYER_WALLS, MODEL_SPACE, circleGeom, entityInit, sampleInit } from '../model/fixtures';

const NOW = new Date(2026, 10, 16, 17, 5, 9);

function model() {
  const base = sampleInit();
  return DocumentModel.create({
    ...base,
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
    entities: [...base.entities!, entityInit('60', circleGeom(0, 0, 10), { layer: LAYER_WALLS })],
  });
}

const ctx = (m = model()): FieldContext => ({
  model: m,
  now: NOW,
  fileName: 'Plan.dxf',
  folder: '',
  space: MODEL_SPACE,
});

describe('fieldCode', () => {
  it('writes date fields with their picture', () => {
    expect(fieldCode({ name: 'Date', date: 'dd/MM/yyyy' })).toBe('\\AcVar Date \\f "dd/MM/yyyy"');
    expect(fieldCode({ name: 'SaveDate' })).toBe('\\AcVar SaveDate \\f "M/d/yyyy"');
  });

  it('writes Filename with its parts, extension and case', () => {
    expect(fieldCode({ name: 'Filename' })).toBe('\\AcVar Filename \\f "%fn6"');
    expect(fieldCode({ name: 'Filename', parts: 'name', extension: false })).toBe(
      '\\AcVar Filename \\f "%fn2"',
    );
    expect(fieldCode({ name: 'Filename', parts: 'path' })).toBe('\\AcVar Filename \\f "%fn1"');
    expect(fieldCode({ name: 'Filename', parts: 'full', textCase: 1 })).toBe(
      '\\AcVar Filename \\f "%tc1%fn7"',
    );
  });

  it('writes the plot fields', () => {
    expect(fieldCode({ name: 'PageSetupName' })).toBe('\\AcVar PageSetupName');
    expect(fieldCode({ name: 'PageSetupName', textCase: 2 })).toBe(
      '\\AcVar PageSetupName \\f "%tc2"',
    );
    expect(fieldCode({ name: 'PlotScale' })).toBe('\\AcVar PlotScale');
    expect(fieldCode({ name: 'PlotScale', scaleFormat: 1, precision: 0 })).toBe(
      '\\AcVar PlotScale \\f "%lu2%pr0"',
    );
  });

  it('writes a system variable, CTAB in lower case as AutoCAD writes it', () => {
    expect(fieldCode({ name: 'SystemVariable' })).toBeUndefined();
    expect(fieldCode({ name: 'SystemVariable', variable: 'CTAB', textCase: 1 })).toBe(
      '\\AcVar ctab \\f "%tc1"',
    );
    expect(fieldCode({ name: 'SystemVariable', variable: 'LTSCALE', precision: 2 })).toBe(
      '\\AcVar LTSCALE \\f "%pr2"',
    );
  });

  it("writes an object's property by its handle, once both are chosen", () => {
    expect(fieldCode({ name: 'Object' })).toBeUndefined();
    expect(fieldCode({ name: 'Object', object: '60' })).toBeUndefined();
    expect(
      fieldCode({ name: 'Object', object: '60', property: 'Area', units: 2, precision: 2 }),
    ).toBe('\\AcObjProp Object(%<\\_ObjId 60>%).Area \\f "%lu2%pr2"');
    expect(fieldCode({ name: 'Object', object: '60', property: 'Layer', textCase: 1 })).toBe(
      '\\AcObjProp Object(%<\\_ObjId 60>%).Layer \\f "%tc1"',
    );
  });

  it('escapes a quote in a picture', () => {
    expect(fieldCode({ name: 'Date', date: "'on' d" })).toBe('\\AcVar Date \\f "\'on\' d"');
    expect(fieldCode({ name: 'Date', date: 'a"b' })).toBe('\\AcVar Date \\f "a\\"b"');
  });
});

describe('fieldOfText', () => {
  it('is undefined for text without fields', () => {
    expect(fieldOfText('Plain text')).toBeUndefined();
    expect(fieldOfText('50%< unclosed')).toBeUndefined();
  });

  it('makes the root _text field and a child per code', () => {
    const f = fieldOfText('{\\C1;Date:} %<\\AcVar Date \\f "yyyy">%\\PFile %<\\AcVar Filename>%')!;
    expect(f).toEqual({
      evaluator: '_text',
      code: '{\\C1;Date:} %<\\_FldIdx 0>%\\PFile %<\\_FldIdx 1>%',
      children: [
        // A Date field is evaluated on demand only (DXF 91 = 32), as AutoCAD makes it (part 3).
        {
          evaluator: 'AcVar',
          code: '\\AcVar Date \\f "yyyy"',
          children: [],
          objects: [],
          options: 32,
        },
        { evaluator: 'AcVar', code: '\\AcVar Filename', children: [], objects: [] },
      ],
      objects: [],
    });
  });

  it('makes an object id an object index, and nested fields children', () => {
    const f = fieldOfText(
      'A=%<\\AcObjProp Object(%<\\_ObjId 2a>%).Area>% %<\\AcExpr (%<\\AcVar LTSCALE>%*2)>%',
    )!;
    expect(f.children[0]).toEqual({
      evaluator: 'AcObjProp',
      code: '\\AcObjProp Object(%<\\_ObjIdx 0>%).Area',
      children: [],
      objects: ['2A'],
    });
    expect(f.children[1]).toEqual({
      evaluator: 'AcExpr',
      code: '\\AcExpr (%<\\_FldIdx 0>%*2)',
      children: [{ evaluator: 'AcVar', code: '\\AcVar LTSCALE', children: [], objects: [] }],
      objects: [],
    });
  });

  it('reads back as typed', () => {
    const typed = 'A=%<\\AcObjProp Object(%<\\_ObjId 2A>%).Area>% %<\\AcExpr (%<\\AcVar X>%)>%';
    const f = fieldOfText(typed)!;
    expect(editableFieldText(f)).toBe(typed);
    expect(editableFieldCode(f.children[0]!)).toBe('\\AcObjProp Object(%<\\_ObjId 2A>%).Area');
  });
});

describe('textWithFields', () => {
  it('keeps text without fields as it is', () => {
    expect(textWithFields('Plain', ctx())).toEqual({ text: 'Plain' });
  });

  it('shows each field by its value and keeps the codes', () => {
    const r = textWithFields(
      'Sheet %<\\AcVar Filename \\f "%fn2">% of %<\\AcVar Date \\f "yyyy">%',
      ctx(),
    );
    expect(r.text).toBe('Sheet Plan of 2026');
    expect(r.field!.code).toBe('Sheet %<\\_FldIdx 0>% of %<\\_FldIdx 1>%');
    expect(r.field!.value).toBe('Sheet Plan of 2026');
    expect(r.field!.children.map((c) => c.value)).toEqual(['Plan', '2026']);
    expect(r.field!.children[1]!.time).toBe(NOW.getTime());
  });

  it("evaluates an object's property", () => {
    const r = textWithFields(
      'Area %<\\AcObjProp Object(%<\\_ObjId 60>%).Area \\f "%lu2%pr1">%',
      ctx(),
    );
    expect(r.text).toBe('Area 314.2');
    expect(r.field!.children[0]!.objects).toEqual(['60']);
  });

  it('shows ---- for a new field it cannot evaluate, keeps the value of one it had', () => {
    const typed = 'Sum %<\\AcExpr (1+2)>%';
    expect(textWithFields(typed, ctx()).text).toBe('Sum ----');
    const old: DrawingField = {
      evaluator: '_text',
      code: 'x %<\\_FldIdx 0>%',
      children: [
        { evaluator: 'AcExpr', code: '\\AcExpr (1+2)', children: [], objects: [], value: '3' },
      ],
      objects: [],
    };
    expect(textWithFields(typed, ctx(), old).text).toBe('Sum 3');
  });

  it('lists the values the editor shows, by code', () => {
    const r = textWithFields('%<\\AcVar Date \\f "yyyy">% %<\\AcExpr 1>%', ctx());
    expect(fieldValues(r.field!)).toEqual({
      '\\AcVar Date \\f "yyyy"': '2026',
      '\\AcExpr 1': '----',
    });
  });
});

describe('previewField', () => {
  const m = model();
  const snapshot: FieldSnapshot = {
    now: NOW.getTime(),
    fileName: 'Plan.dxf',
    folder: '',
    units: { lunits: 2, luprec: 4, aunits: 0, auprec: 0, unitmode: 0 },
    variables: { LTSCALE: 2.5, CLAYER: 'Walls' },
    layout: {
      name: 'Sheet A1',
      plot: { scale: { numerator: 1, denominator: 50 }, pageSetupName: 'A1 PDF' },
    },
    objects: { '60': objectFieldProperties(m, '60')! },
  };

  it('previews each field the dialog makes', () => {
    const p = (spec: Parameters<typeof fieldCode>[0]) => previewField(fieldCode(spec)!, snapshot);
    expect(p({ name: 'Date', date: 'dddd, MMMM d, yyyy' })).toBe('Monday, November 16, 2026');
    expect(p({ name: 'Filename', parts: 'full', textCase: 1 })).toBe('PLAN.DXF');
    expect(p({ name: 'PlotScale' })).toBe('1:50');
    expect(p({ name: 'PlotScale', scaleFormat: 1, precision: 0 })).toBe('50');
    expect(p({ name: 'PageSetupName', textCase: 1 })).toBe('A1 PDF');
    expect(p({ name: 'SystemVariable', variable: 'CTAB' })).toBe('Sheet A1');
    expect(p({ name: 'SystemVariable', variable: 'LTSCALE', precision: 1 })).toBe('2.5');
    expect(p({ name: 'SystemVariable', variable: 'CLAYER', textCase: 2 })).toBe('walls');
    expect(p({ name: 'Object', object: '60', property: 'Diameter', precision: 0 })).toBe('20');
    expect(p({ name: 'Object', object: '60', property: 'Layer', textCase: 1 })).toBe('WALLS');
  });

  it('shows ---- for a field it cannot evaluate, #### for an object it was not given', () => {
    expect(previewField('\\AcVar PlotDate', snapshot)).toBe('----');
    expect(previewField('\\AcObjProp Object(%<\\_ObjId 99>%).Area', snapshot)).toBe('####');
  });

  it("gives DWGNAME and DWGPREFIX, the app's", () => {
    expect(previewField('\\AcVar DWGNAME', snapshot)).toBe('Plan.dxf');
    expect(previewField('\\AcVar DWGPREFIX', snapshot)).toBe('');
  });
});

describe('objectFieldProperties', () => {
  it("lists the properties a circle's field can show", () => {
    expect(Object.keys(objectFieldProperties(model(), '60')!)).toEqual([
      'Area',
      'Circumference',
      'Radius',
      'Diameter',
      'Layer',
    ]);
    expect(objectFieldProperties(model(), '99')).toBeUndefined();
  });
});
