// M4-03: the New, Modify and Override Dimension Style dialog's fields (AutoCAD 2024 Help, "New,
// Modify, and Override Dimension Style Dialog Boxes"): every DIMVAR a DIMSTYLE record holds is
// shown and set by some field of the seven tabs (DIMTVP and DIMTSZ aside, which AutoCAD's
// dialog does not have either), each field gives back what it shows, and the fields that set
// several DIMVARs set them as AutoCAD's do.
import { describe, expect, it } from 'vitest';
import {
  DIMSTYLE_DEFAULTS,
  DIMSTYLE_DIALOG_KEEPS,
  DIMSTYLE_FIELDS,
  DIMSTYLE_TABS,
  DIMVAR_BY_CODE,
  dialogVars,
  fieldOptions,
  setField,
  type DimStyleLists,
  type DimStyleVars,
} from '../../src/index';

const LISTS: DimStyleLists = {
  textStyles: [{ value: '11', label: 'Standard' }],
  linetypes: [
    { value: '', label: 'ByBlock' },
    { value: '15', label: 'ByLayer' },
    { value: '16', label: 'CENTER' },
  ],
  arrowheads: [
    { value: '', label: 'Closed filled' },
    { value: '_DOT', label: 'Dot' },
    { value: '40', label: 'Architectural tick' },
  ],
};

/** ISO-25 as acadiso.dwt has it, in the types a DIMSTYLE record holds. */
const ISO: DimStyleVars = dialogVars({
  DIMASZ: 2.5,
  DIMCEN: 2.5,
  DIMDLI: 3.75,
  DIMEXE: 1.25,
  DIMEXO: 0.625,
  DIMGAP: 0.625,
  DIMTXT: 2.5,
  DIMTAD: 1,
  DIMTIH: false,
  DIMTOH: false,
  DIMTOLJ: 0,
  DIMDEC: 2,
  DIMDSEP: ',',
  DIMZIN: 8,
  DIMALTF: 0.0393700787,
  DIMATFIT: 3,
  DIMTOL: false,
  DIMLIM: false,
  DIMALT: false,
  DIMSAH: false,
});

const field = (key: string) => {
  const f = DIMSTYLE_FIELDS.find((x) => x.key === key);
  if (!f) throw new Error(`no field ${key}`);
  return f;
};

describe('Dimension style dialog fields (M4-03)', () => {
  it('has the seven tabs, each with fields, and unique keys', () => {
    expect(DIMSTYLE_TABS.map((t) => t.label)).toEqual([
      'Lines',
      'Symbols and Arrows',
      'Text',
      'Fit',
      'Primary Units',
      'Alternate Units',
      'Tolerances',
    ]);
    for (const t of DIMSTYLE_TABS)
      expect(
        DIMSTYLE_FIELDS.some((f) => f.tab === t.id),
        t.id,
      ).toBe(true);
    const keys = DIMSTYLE_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('shows and sets every DIMSTYLE variable but those AutoCAD keeps out of its dialog', () => {
    const shown = new Set(DIMSTYLE_FIELDS.flatMap((f) => f.vars));
    const missing = Object.values(DIMVAR_BY_CODE).filter(
      (n) => !shown.has(n) && !DIMSTYLE_DIALOG_KEEPS.includes(n),
    );
    expect(missing).toEqual([]);
    expect(DIMSTYLE_DIALOG_KEEPS.filter((n) => shown.has(n))).toEqual([]);
  });

  it('gives back the value it shows, on AutoCAD Standard and on ISO-25', () => {
    for (const vars of [dialogVars({}), ISO]) {
      for (const f of DIMSTYLE_FIELDS) {
        const patch = f.set(f.get(vars), vars);
        expect(patch, f.key).toBeDefined();
        const after = setField(vars, f.key, f.get(vars));
        for (const name of f.vars) {
          expect(Number(after[name] ?? 0), `${f.key} ${name}`).toBe(Number(vars[name] ?? 0));
        }
      }
    }
  });

  it('refuses values a field cannot take, leaving the style as it was', () => {
    const v = dialogVars({});
    for (const [key, value] of [
      ['DIMTXT', 0],
      ['DIMASZ', -1],
      ['DIMASZ', 'abc'],
      ['DIMJOGANG', 4],
      ['DIMJOGANG', 91],
      ['DIMTAD', '7'],
      ['DIMSD1', 'yes'],
      ['DIMCLRD', 300],
      ['DIMTFILL', 'red'],
      ['DIMDSEP', ';'],
      ['DIMCEN.type', 'circle'],
      ['DIMCEN.size', 0],
      ['DIMTIH.alignment', 'vertical'],
      ['DIMATFIT', '5'],
      ['DIMSCALE.type', 'annotative'],
      ['DIMDEC', 9],
      ['DIMAUNIT', 6],
      ['DIMPOST.prefix', 3],
      ['DIMZIN.feet', 1],
      ['DIMAZIN.leading', 'on'],
      ['DIMAPOST.placement', 'above'],
      ['DIMTOL.method', 'plusminus'],
      ['DIMTP', 'x'],
      ['DIMLFAC', 0],
      ['DIMLFAC.layout', 1],
      ['DIMGAP.frame', 'yes'],
      ['DIMGAP', -1],
      ['DIMLTYPE', 5],
      ['DIMBLK1', 5],
      ['no such field', 1],
    ] as const) {
      expect(setField(v, key, value), key).toBe(v);
    }
  });

  it('First sets both arrowheads; a Second unlike it sets DIMSAH with each end its own', () => {
    let v = dialogVars({});
    v = setField(v, 'DIMBLK1', '40');
    expect(v).toMatchObject({ DIMBLK: '40', DIMSAH: 0 });
    expect(field('DIMBLK2').get(v)).toBe('40');
    v = setField(v, 'DIMBLK2', '_DOT');
    expect(v).toMatchObject({ DIMBLK1: '40', DIMBLK2: '_DOT', DIMSAH: 1 });
    expect([field('DIMBLK1').get(v), field('DIMBLK2').get(v)]).toEqual(['40', '_DOT']);
    // A Second brought back to the First's is one arrowhead again.
    v = setField(v, 'DIMBLK2', '40');
    expect(v).toMatchObject({ DIMBLK: '40', DIMSAH: 0 });
    // Closed filled is no block at all.
    v = setField(v, 'DIMBLK1', '');
    expect(v.DIMBLK).toBeUndefined();
    expect(fieldOptions(field('DIMBLK1'), LISTS, v)).toEqual(LISTS.arrowheads);
    expect(fieldOptions(field('DIMLDRBLK'), LISTS, v)).toEqual(LISTS.arrowheads);
  });

  it('sets the linetypes and text style by handle, ByBlock as none', () => {
    let v = setField(dialogVars({}), 'DIMLTYPE', '16');
    expect(v.DIMLTYPE).toBe('16');
    expect(fieldOptions(field('DIMLTEX1'), LISTS, v)).toEqual(LISTS.linetypes);
    v = setField(v, 'DIMLTYPE', '');
    expect('DIMLTYPE' in v).toBe(false);
    expect(field('DIMLTYPE').get(v)).toBe('');
    expect(setField(v, 'DIMTXSTY', '11').DIMTXSTY).toBe('11');
    expect(fieldOptions(field('DIMTXSTY'), LISTS, v)).toEqual(LISTS.textStyles);
  });

  it('lists colours with the style’s own ACI, and Fill color as None, Background or a colour', () => {
    const v = dialogVars({ DIMCLRD: 30 });
    expect(fieldOptions(field('DIMCLRD'), LISTS, v).map((o) => o.label)).toEqual([
      'ByBlock',
      'ByLayer',
      'Red',
      'Yellow',
      'Green',
      'Cyan',
      'Blue',
      'Magenta',
      'White',
      'Color 30',
    ]);
    expect(setField(v, 'DIMCLRE', '1').DIMCLRE).toBe(1);
    expect(setField(v, 'DIMTFILL', 'background')).toMatchObject({ DIMTFILL: 1 });
    const filled = setField(v, 'DIMTFILL', '5');
    expect(filled).toMatchObject({ DIMTFILL: 2, DIMTFILLCLR: 5 });
    expect(field('DIMTFILL').get(filled)).toBe('5');
    expect(
      fieldOptions(field('DIMTFILL'), LISTS, filled)
        .slice(0, 2)
        .map((o) => o.label),
    ).toEqual(['None', 'Background']);
    expect(setField(filled, 'DIMTFILL', 'none')).toMatchObject({ DIMTFILL: 0 });
    expect(fieldOptions(field('DIMLWD'), LISTS, v)[0]).toEqual({ value: '-2', label: 'ByBlock' });
  });

  it('keeps a center mark’s size across None, Mark and Line', () => {
    let v = dialogVars({ DIMCEN: 0.09 });
    expect(field('DIMCEN.type').get(v)).toBe('mark');
    v = setField(v, 'DIMCEN.type', 'line');
    expect(v.DIMCEN).toBe(-0.09);
    v = setField(v, 'DIMCEN.size', 0.2);
    expect(v.DIMCEN).toBe(-0.2);
    expect(field('DIMCEN.size').get(v)).toBe(0.2);
    v = setField(v, 'DIMCEN.type', 'none');
    expect(v.DIMCEN).toBe(0);
    expect(field('DIMCEN.size').enabled!(v)).toBe(false);
    // Back from None: half the arrow size, as AutoCAD's default mark is.
    expect(setField(v, 'DIMCEN.type', 'mark').DIMCEN).toBe(0.09);
    expect(setField(dialogVars({ DIMCEN: 0, DIMASZ: 0 }), 'DIMCEN.type', 'mark').DIMCEN).toBe(0.09);
    expect(setField(v, 'DIMCEN.size', 0.3).DIMCEN).toBe(0.3);
  });

  it('shows the jog angle in degrees and keeps it in radians', () => {
    const v = setField(dialogVars({}), 'DIMJOGANG', '30');
    expect(v.DIMJOGANG).toBeCloseTo(Math.PI / 6, 12);
    expect(field('DIMJOGANG').get(v)).toBe(30);
    expect(setField(v, 'DIMARCSYM', '2').DIMARCSYM).toBe(2);
  });

  it('sets text alignment, the frame and the offset with DIMTIH, DIMTOH and DIMGAP’s sign', () => {
    let v = dialogVars({});
    expect(field('DIMTIH.alignment').get(v)).toBe('horizontal');
    v = setField(v, 'DIMTIH.alignment', 'iso');
    expect(v).toMatchObject({ DIMTIH: 0, DIMTOH: 1 });
    v = setField(v, 'DIMTIH.alignment', 'aligned');
    expect(v).toMatchObject({ DIMTIH: 0, DIMTOH: 0 });
    expect(field('DIMTIH.alignment').get(v)).toBe('aligned');
    expect(setField(v, 'DIMTIH.alignment', 'horizontal')).toMatchObject({ DIMTIH: 1, DIMTOH: 1 });
    v = setField(v, 'DIMGAP.frame', true);
    expect(v.DIMGAP).toBe(-0.09);
    v = setField(v, 'DIMGAP', 0.05);
    expect(v.DIMGAP).toBe(-0.05);
    expect(field('DIMGAP').get(v)).toBe(0.05);
    expect(setField(v, 'DIMGAP.frame', false).DIMGAP).toBe(0.05);
    expect(setField(dialogVars({}), 'DIMGAP', 0.2).DIMGAP).toBe(0.2);
    expect(field('DIMTFAC').enabled!(v)).toBe(false);
    expect(field('DIMTFAC').enabled!(setField(v, 'DIMLUNIT', '4'))).toBe(true);
  });

  it('sets Fit options, text placement and the scale as AutoCAD’s Fit tab does', () => {
    let v = setField(dialogVars({}), 'DIMATFIT', 'tix');
    expect(v).toMatchObject({ DIMTIX: 1, DIMATFIT: 3 });
    expect(field('DIMATFIT').get(v)).toBe('tix');
    v = setField(v, 'DIMATFIT', '1');
    expect(v).toMatchObject({ DIMTIX: 0, DIMATFIT: 1 });
    expect(setField(v, 'DIMTMOVE', '2').DIMTMOVE).toBe(2);
    v = setField(v, 'DIMSCALE.type', 'layout');
    expect(v.DIMSCALE).toBe(0);
    expect(field('DIMSCALE').enabled!(v)).toBe(false);
    v = setField(v, 'DIMSCALE.type', 'overall');
    expect(v.DIMSCALE).toBe(1);
    expect(setField(v, 'DIMSCALE', '48').DIMSCALE).toBe(48);
    expect(setField(dialogVars({ DIMSCALE: 20 }), 'DIMSCALE.type', 'overall').DIMSCALE).toBe(20);
    expect(setField(v, 'DIMUPT', true).DIMUPT).toBe(1);
  });

  it('splits DIMPOST and DIMAPOST into prefix and suffix, keeping Below primary value', () => {
    let v = setField(dialogVars({}), 'DIMPOST.suffix', ' mm');
    expect(v.DIMPOST).toBe(' mm');
    v = setField(v, 'DIMPOST.prefix', '~');
    expect(v.DIMPOST).toBe('~<> mm');
    expect([field('DIMPOST.prefix').get(v), field('DIMPOST.suffix').get(v)]).toEqual(['~', ' mm']);
    expect(setField(v, 'DIMPOST.prefix', '').DIMPOST).toBe(' mm');
    v = setField(dialogVars({ DIMALT: 1 }), 'DIMAPOST.placement', 'below');
    expect(v.DIMAPOST).toBe('\\X');
    v = setField(v, 'DIMAPOST.suffix', ' in');
    v = setField(v, 'DIMAPOST.prefix', '[');
    expect(v.DIMAPOST).toBe('\\X[[] in');
    expect(field('DIMAPOST.placement').get(v)).toBe('below');
    expect(field('DIMAPOST.suffix').get(v)).toBe(' in');
    expect(setField(v, 'DIMAPOST.placement', 'after').DIMAPOST).toBe('[[] in');
    expect(field('DIMAPOST.prefix').enabled!(dialogVars({}))).toBe(false);
  });

  it('sets zero suppression bits, feet and inches by DIMZIN’s low values', () => {
    let v = dialogVars({ DIMZIN: 0, DIMLUNIT: 4 });
    expect([field('DIMZIN.feet').get(v), field('DIMZIN.inches').get(v)]).toEqual([true, true]);
    v = setField(v, 'DIMZIN.feet', false);
    expect(v.DIMZIN).toBe(2);
    v = setField(v, 'DIMZIN.inches', false);
    expect(v.DIMZIN).toBe(1);
    v = setField(v, 'DIMZIN.feet', true);
    expect(v.DIMZIN).toBe(3);
    v = setField(v, 'DIMZIN.leading', true);
    v = setField(v, 'DIMZIN.trailing', true);
    expect(v.DIMZIN).toBe(15);
    expect(setField(v, 'DIMZIN.trailing', false).DIMZIN).toBe(7);
    expect(field('DIMZIN.feet').enabled!(v)).toBe(true);
    expect(field('DIMZIN.feet').enabled!(dialogVars({}))).toBe(false);
    v = setField(v, 'DIMAZIN.trailing', true);
    expect(v.DIMAZIN).toBe(2);
    expect(setField(v, 'DIMAZIN.trailing', false).DIMAZIN).toBe(0);
  });

  it('lists precisions as the unit format shows them, and Surveyor’s units when a style has them', () => {
    const labels = (key: string, v: DimStyleVars) =>
      fieldOptions(field(key), LISTS, v).map((o) => o.label);
    expect(labels('DIMDEC', dialogVars({}))[4]).toBe('0.0000');
    expect(labels('DIMDEC', dialogVars({ DIMLUNIT: 1 }))[2]).toBe('0.00E+01');
    expect(labels('DIMDEC', dialogVars({ DIMLUNIT: 4 }))[3]).toBe('0 1/8');
    expect(labels('DIMALTD', dialogVars({ DIMALTU: 7 }))[1]).toBe('0 1/2');
    expect(labels('DIMAUNIT', dialogVars({}))).not.toContain("Surveyor's units");
    expect(labels('DIMAUNIT', dialogVars({ DIMAUNIT: 4 }))).toContain("Surveyor's units");
    expect(setField(dialogVars({}), 'DIMAUNIT', '1').DIMAUNIT).toBe(1);
    expect(setField(dialogVars({}), 'DIMDSEP', ',').DIMDSEP).toBe(',');
    expect(field('DIMDSEP').get(dialogVars({ DIMDSEP: 44 }))).toBe(',');
    expect(field('DIMDSEP').get(dialogVars({ DIMDSEP: '' }))).toBe('.');
  });

  it('sets the measurement scale’s size and its layout-only sign', () => {
    let v = setField(dialogVars({}), 'DIMLFAC', '2');
    v = setField(v, 'DIMLFAC.layout', true);
    expect(v.DIMLFAC).toBe(-2);
    expect(field('DIMLFAC').get(v)).toBe(2);
    expect(setField(v, 'DIMLFAC', '3').DIMLFAC).toBe(-3);
    expect(setField(v, 'DIMLFAC.layout', false).DIMLFAC).toBe(2);
  });

  it('sets the tolerance method with DIMTOL, DIMLIM, DIMTM and DIMGAP’s sign', () => {
    let v = setField(dialogVars({ DIMTP: 0.1, DIMTM: 0.05 }), 'DIMTOL.method', 'symmetrical');
    expect(v).toMatchObject({ DIMTOL: 1, DIMLIM: 0, DIMTM: 0.1 });
    expect(field('DIMTM').enabled!(v)).toBe(false);
    v = setField(v, 'DIMTP', '0.2');
    expect(v).toMatchObject({ DIMTP: 0.2, DIMTM: 0.2 });
    v = setField(v, 'DIMTOL.method', 'deviation');
    v = setField(v, 'DIMTM', '0.05');
    expect(field('DIMTOL.method').get(v)).toBe('deviation');
    expect(setField(v, 'DIMTP', '0.3')).toMatchObject({ DIMTP: 0.3, DIMTM: 0.05 });
    v = setField(v, 'DIMTOL.method', 'limits');
    expect(v).toMatchObject({ DIMTOL: 0, DIMLIM: 1 });
    expect(field('DIMTOL.method').get(v)).toBe('limits');
    v = setField(v, 'DIMTOL.method', 'basic');
    expect(v).toMatchObject({ DIMTOL: 0, DIMLIM: 0, DIMGAP: -0.09 });
    expect(field('DIMTOL.method').get(v)).toBe('basic');
    expect(field('DIMTDEC').enabled!(v)).toBe(false);
    v = setField(v, 'DIMTOL.method', 'none');
    expect(v).toMatchObject({ DIMTOL: 0, DIMLIM: 0, DIMGAP: 0.09 });
    expect(field('DIMALTTD').enabled!(v)).toBe(false);
    expect(field('DIMALTTD').enabled!(dialogVars({ DIMALT: 1, DIMTOL: 1, DIMTP: 1 }))).toBe(true);
    expect(fieldOptions(field('DIMTDEC'), LISTS, dialogVars({ DIMLUNIT: 5 }))[1]!.label).toBe(
      '0 1/2',
    );
    expect(fieldOptions(field('DIMALTTD'), LISTS, dialogVars({}))[2]!.label).toBe('0.00');
  });

  it('fills AutoCAD’s defaults for what a style does not state', () => {
    expect(dialogVars({ DIMTXT: 2.5 })).toMatchObject({ DIMTXT: 2.5, DIMDLI: 0.38, DIMASZ: 0.18 });
    expect(DIMSTYLE_DEFAULTS.DIMJOGANG).toBeCloseTo(Math.PI / 4, 12);
  });
});
