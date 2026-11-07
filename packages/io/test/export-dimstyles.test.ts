// TriyaToAcad for DIMSTYLE records (M1-75 part 9). The drawing is authored in memory with acad-ts
// and saved once, so "the file" is real bytes; the corpus-wide edits are in
// packages/testkit/src/export/export.corpus.test.ts.
import {
  ACadVersion,
  BlockRecord,
  CadDocument,
  Layer,
  LineType,
  LineTypeSegment,
  TextStyle,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type DimStyleRecord,
  type DimVarValue,
  type LinetypeRecord,
  type ObjectCommon,
  type TextStyleRecord,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  triyaToAcad,
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';

/**
 * Dimension styles Standard and ARCH; text style DIMTEXT (romans.shx), linetype DASHED, the
 * arrowhead blocks _ArchTick and _Dot and layer NOTES.
 */
function drawing(version = ACadVersion.AC1032, format: CadFormat = 'dxf'): Uint8Array {
  const doc = new CadDocument(version);
  const text = new TextStyle('DIMTEXT');
  text.filename = 'romans.shx';
  doc.textStyles!.add(text);
  const dashed = new LineType('DASHED');
  for (const length of [0.5, -0.25]) {
    const s = new LineTypeSegment();
    s.length = length;
    dashed.addSegment(s);
  }
  doc.lineTypes!.add(dashed);
  doc.blockRecords!.add(new BlockRecord('_ArchTick'));
  doc.blockRecords!.add(new BlockRecord('_Dot'));
  doc.layers!.add(new Layer('NOTES'));
  const arch = doc.dimensionStyles!.tryGetValue('Standard')!.clone() as never as {
    name: string;
  };
  arch.name = 'ARCH';
  doc.dimensionStyles!.add(arch as never);
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const named = <T extends { name: string }>(records: Iterable<T>, name: string): T =>
  [...records].find((r) => r.name.toUpperCase() === name.toUpperCase())!;
const dimStyleNamed = (model: DocumentModel, name: string): DimStyleRecord =>
  named(model.tables.dimStyles.values(), name);
const blockNamed = (model: DocumentModel, name: string) =>
  named(model.tables.blockRecords.values(), name);

/** Saves `model` over a fresh read of `bytes` and maps the result back. */
function saved(bytes: Uint8Array, model: DocumentModel, format: CadFormat) {
  return documentInit(readCadDocument(exportDocument(readCadDocument(bytes), model, { format })));
}

/** A record as it maps back, without the reader's link. */
function comparable<T extends ObjectCommon>(r: T | undefined) {
  if (!r) return r;
  const { raw: _raw, ...rest } = r;
  return rest;
}

/** A new record from an existing one, without its handle and links. */
function like<T extends ObjectCommon>(r: T): Omit<T, 'handle' | 'raw'> {
  const { handle: _h, raw: _raw, ...rest } = r;
  return rest;
}

/** Equal up to float noise (DXF writes the jog angle in degrees). */
function near(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
    return Object.is(a, b);
  const ka = Object.keys(a);
  return (
    ka.length === Object.keys(b).length &&
    ka.every((k) => near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

/** A value other than AutoCAD's default for every DIMVAR a R2010+ DIMSTYLE stores by value. */
const EDITED: Readonly<Record<string, DimVarValue>> = {
  DIMPOST: 'L=<> mm',
  DIMAPOST: '[] in',
  DIMSCALE: 2,
  DIMASZ: 0.3,
  DIMEXO: 0.1,
  DIMDLI: 0.5,
  DIMEXE: 0.2,
  DIMRND: 0.05,
  DIMDLE: 0.12,
  DIMTP: 0.01,
  DIMTM: 0.02,
  DIMFXL: 3,
  DIMJOGANG: Math.PI / 3,
  DIMTFILL: 2,
  DIMTFILLCLR: 5,
  DIMTOL: true,
  DIMLIM: true,
  DIMTIH: true,
  DIMTOH: true,
  DIMSE1: true,
  DIMSE2: true,
  DIMTAD: 2,
  DIMZIN: 12,
  DIMAZIN: 3,
  DIMARCSYM: 2,
  DIMTXT: 0.35,
  DIMCEN: -0.2,
  DIMTSZ: 0.1,
  DIMALTF: 2.54,
  DIMLFAC: 10,
  DIMTVP: 0.4,
  DIMTFAC: 0.7,
  DIMGAP: 0.09,
  DIMALTRND: 0.5,
  DIMALT: true,
  DIMALTD: 4,
  DIMTOFL: true,
  DIMSAH: false,
  DIMTIX: true,
  DIMSOXD: true,
  DIMCLRD: 1,
  DIMCLRE: 2,
  DIMCLRT: 3,
  DIMADEC: 2,
  DIMDEC: 4,
  DIMTDEC: 3,
  DIMALTU: 4,
  DIMALTTD: 1,
  DIMAUNIT: 1,
  DIMFRAC: 1,
  DIMLUNIT: 4,
  DIMDSEP: ',',
  DIMTMOVE: 2,
  DIMJUST: 3,
  DIMSD1: true,
  DIMSD2: true,
  DIMTOLJ: 2,
  DIMTZIN: 4,
  DIMALTZ: 3,
  DIMALTTZ: 4,
  DIMUPT: true,
  DIMFXLON: true,
  DIMLWD: 35,
  DIMLWE: 50,
};

const formats: readonly CadFormat[] = ['dxf', 'dwg'];

describe('dimension styles', () => {
  it.each(formats)('writes every DIMVAR of an edited and a new style (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const model = open(bytes);
    const standard = dimStyleNamed(model, 'Standard');
    const arch = dimStyleNamed(model, 'ARCH');
    const dimText = named(model.tables.textStyles.values(), 'DIMTEXT');
    const dashed = named(model.tables.linetypes.values(), 'DASHED');
    let style: TextStyleRecord | undefined;
    let linetype: LinetypeRecord | undefined;
    let added: DimStyleRecord | undefined;
    edit(model, (b) => {
      // The new style names a text style and a linetype the same save adds.
      style = b.addTableRecord('textStyles', { ...like(dimText), name: 'DIMTEXT2' });
      linetype = b.addTableRecord('linetypes', { ...like(dashed), name: 'DASHED2' });
      const refs = {
        DIMTXSTY: style.handle,
        DIMBLK: blockNamed(model, '_ArchTick').handle,
        DIMBLK1: blockNamed(model, '_ArchTick').handle,
        DIMBLK2: blockNamed(model, '_Dot').handle,
        DIMLDRBLK: blockNamed(model, '_Dot').handle,
        DIMLTYPE: linetype.handle,
        DIMLTEX1: dashed.handle,
        DIMLTEX2: linetype.handle,
      };
      // DXF saves the text direction and DWG DIMATFIT wrongly (M1-92); the other side has them.
      const gaps = format === 'dxf' ? { DIMATFIT: 1 } : { DIMTXTDIRECTION: 1 };
      b.updateTableRecord('dimStyles', standard.handle, {
        vars: { ...standard.vars, ...EDITED, ...refs, ...gaps },
      });
      b.updateTableRecord('dimStyles', arch.handle, {
        name: 'ARCHITECTURAL',
        vars: { ...arch.vars, DIMSCALE: 48, DIMTXSTY: dimText.handle, DIMLTYPE: dashed.handle },
      });
      added = b.addTableRecord('dimStyles', {
        ...like(standard),
        name: 'METRIC',
        vars: { ...standard.vars, ...EDITED, ...refs, ...gaps, DIMLUNIT: 2, DIMDEC: 1 },
      });
    });

    const back = new Map(saved(bytes, model, format).tables?.dimStyles?.map((s) => [s.handle, s]));
    for (const h of [standard.handle, arch.handle, added!.handle]) {
      const want = comparable(model.tables.dimStyles.get(h));
      expect(near(comparable(back.get(h)), want), `${h} ${JSON.stringify(back.get(h))}`).toBe(true);
    }
  });

  it('removes a dimension linetype and arrowhead (ByBlock, the default arrowhead)', () => {
    const bytes = drawing();
    let model = open(bytes);
    const standard = dimStyleNamed(model, 'Standard');
    const vars = {
      ...standard.vars,
      DIMBLK: blockNamed(model, '_Dot').handle,
      DIMLTYPE: named(model.tables.linetypes.values(), 'DASHED').handle,
    };
    edit(model, (b) => b.updateTableRecord('dimStyles', standard.handle, { vars }));
    const bytes2 = exportDocument(readCadDocument(bytes), model, { format: 'dxf' });

    model = open(bytes2);
    const { DIMBLK: _blk, DIMLTYPE: _lt, ...rest } = dimStyleNamed(model, 'Standard').vars;
    edit(model, (b) => b.updateTableRecord('dimStyles', standard.handle, { vars: rest }));
    const back = saved(bytes2, model, 'dxf').tables?.dimStyles?.find((s) => s.name === 'Standard');
    expect(back?.vars.DIMBLK).toBeUndefined();
    expect(back?.vars.DIMLTYPE).toBeUndefined();
    expect(back?.vars.DIMTXSTY).toBe(rest.DIMTXSTY);
  });

  it('writes a true DIMVAR colour to an R2004+ DWG and refuses it elsewhere', () => {
    const color = { kind: 'rgb', r: 200, g: 100, b: 50 } as const;
    // AutoCAD's ACI for it (aciOfTrueColor), which DXF and the DIMSTYLE's ACI groups state.
    const change = (m: DocumentModel, aci: number) => {
      const s = dimStyleNamed(m, 'Standard');
      return { vars: { ...s.vars, DIMCLRT: aci }, trueColors: { DIMCLRT: color } };
    };
    const bytes = drawing(ACadVersion.AC1018, 'dwg');
    const model = open(bytes);
    const aci = 32;
    edit(model, (b) =>
      b.updateTableRecord('dimStyles', dimStyleNamed(model, 'Standard').handle, change(model, aci)),
    );
    const back = saved(bytes, model, 'dwg').tables?.dimStyles?.find((s) => s.name === 'Standard');
    expect(back?.trueColors).toEqual({ DIMCLRT: color });
    expect(back?.vars.DIMCLRT).toBe(aci);

    // An ACI of its own goes with dropping the true colour, which would otherwise win.
    const bytes2 = exportDocument(readCadDocument(bytes), model, { format: 'dwg' });
    const aciOnly = open(bytes2);
    const s = dimStyleNamed(aciOnly, 'Standard');
    edit(aciOnly, (b) =>
      b.updateTableRecord('dimStyles', s.handle, { vars: { ...s.vars, DIMCLRT: 1 } }),
    );
    expect(() => triyaToAcad(readCadDocument(bytes2), aciOnly, 'dwg')).toThrow(
      /DIMCLRT: its colour number is not the one AutoCAD gives/,
    );
    edit(aciOnly, (b) => b.updateTableRecord('dimStyles', s.handle, { trueColors: undefined }));
    const aciBack = saved(bytes2, aciOnly, 'dwg').tables?.dimStyles?.find(
      (d) => d.name === 'Standard',
    );
    expect(aciBack?.trueColors).toBeUndefined();
    expect(aciBack?.vars.DIMCLRT).toBe(1);

    const wrongAci = open(bytes);
    edit(wrongAci, (b) =>
      b.updateTableRecord(
        'dimStyles',
        dimStyleNamed(wrongAci, 'Standard').handle,
        change(wrongAci, 7),
      ),
    );
    expect(() => triyaToAcad(readCadDocument(bytes), wrongAci, 'dwg')).toThrow(
      /DIMCLRT: its colour number is not the one AutoCAD gives/,
    );

    for (const [version, format] of [
      [ACadVersion.AC1032, 'dxf'],
      [ACadVersion.AC1015, 'dwg'],
    ] as const) {
      const other = drawing(version, format);
      const m = open(other);
      edit(m, (b) =>
        b.updateTableRecord('dimStyles', dimStyleNamed(m, 'Standard').handle, change(m, aci)),
      );
      expect(() => triyaToAcad(readCadDocument(other), m, format)).toThrow(
        /only an R2004\+ DWG stores a DIMSTYLE true colour/,
      );
    }
  });

  it('writes $DIMSTYLE and a dimension naming a style the same save adds', () => {
    const bytes = drawing();
    const model = open(bytes);
    let added: DimStyleRecord | undefined;
    edit(model, (b) => {
      added = b.addTableRecord('dimStyles', {
        ...like(dimStyleNamed(model, 'Standard')),
        name: 'NEW',
      });
      b.setHeader('$DIMSTYLE', 'NEW');
    });
    const back = saved(bytes, model, 'dxf');
    expect(new Map(back.header).get('$DIMSTYLE')).toBe('NEW');
    expect(back.tables?.dimStyles?.find((s) => s.handle === added!.handle)?.name).toBe('NEW');
  });

  it('writes an R12 style’s DIMVARs and arrow blocks', () => {
    const bytes = drawing(ACadVersion.AC1009);
    const model = open(bytes);
    const standard = dimStyleNamed(model, 'Standard');
    const vars = {
      ...standard.vars,
      DIMSCALE: 4,
      DIMTXT: 0.25,
      DIMTIX: true,
      DIMCLRD: 1,
      DIMSAH: true,
      DIMBLK1: blockNamed(model, '_ArchTick').handle,
      DIMBLK2: blockNamed(model, '_Dot').handle,
    };
    edit(model, (b) => b.updateTableRecord('dimStyles', standard.handle, { vars }));
    const back = saved(bytes, model, 'dxf').tables?.dimStyles?.find((s) => s.name === 'Standard');
    expect(near(back?.vars, vars)).toBe(true);
  });

  it('refuses what it cannot write and leaves the original as it was', () => {
    type Case = [string, (m: DocumentModel) => Record<string, DimVarValue | undefined>, RegExp];
    const vars =
      (change: Record<string, DimVarValue | undefined>) =>
      (m: DocumentModel): Record<string, DimVarValue | undefined> => ({
        ...dimStyleNamed(m, 'ARCH').vars,
        ...change,
      });
    const cases: [ACadVersion, CadFormat, Case][] = [
      [ACadVersion.AC1032, 'dxf', ['DIMTXT 0', vars({ DIMTXT: 0 }), /DIMTXT: .*greater than zero/]],
      [ACadVersion.AC1032, 'dxf', ['DIMASZ < 0', vars({ DIMASZ: -1 }), /DIMASZ: /]],
      [ACadVersion.AC1032, 'dxf', ['DIMJOGANG 2°', vars({ DIMJOGANG: 0.035 }), /DIMJOGANG: /]],
      [ACadVersion.AC1032, 'dxf', ['DIMDEC 2.5', vars({ DIMDEC: 2.5 }), /not a whole number/]],
      [ACadVersion.AC1032, 'dxf', ['DIMSE1 1', vars({ DIMSE1: 1 }), /DIMSE1: 1 is not a boolean/]],
      [ACadVersion.AC1032, 'dxf', ['DIMDSEP', vars({ DIMDSEP: ',,' }), /one character/]],
      [ACadVersion.AC1032, 'dxf', ['DIMCLRD', vars({ DIMCLRD: 300 }), /not a colour number/]],
      [ACadVersion.AC1032, 'dxf', ['DIMFOO', vars({ DIMFOO: 1 }), /DIMFOO is not a DIMSTYLE/]],
      [
        ACadVersion.AC1032,
        'dxf',
        ['no DIMTXT', vars({ DIMTXT: undefined }), /DIMTXT: it has no value/],
      ],
      [
        ACadVersion.AC1032,
        'dxf',
        ['no DIMTXSTY', vars({ DIMTXSTY: undefined }), /needs a text style/],
      ],
      [
        ACadVersion.AC1032,
        'dxf',
        ['DIMBLK', vars({ DIMBLK: 'FFF' }), /DIMBLK: FFF does not exist/],
      ],
      [
        ACadVersion.AC1032,
        'dxf',
        [
          'DIMBLK a layer',
          (m) => vars({ DIMBLK: named(m.tables.layers.values(), 'NOTES').handle })(m),
          /does not exist/,
        ],
      ],
      // Not in that version's DIMSTYLE record.
      [
        ACadVersion.AC1018,
        'dwg',
        ['DIMJOGANG', vars({ DIMJOGANG: 1 }), /DIMJOGANG: a DIMSTYLE before R2007/],
      ],
      [
        ACadVersion.AC1018,
        'dxf',
        ['DIMTXTDIRECTION', vars({ DIMTXTDIRECTION: 1 }), /before R2010/],
      ],
      [
        ACadVersion.AC1014,
        'dwg',
        ['DIMLWD', vars({ DIMLWD: 35 }), /DIMLWD: a DIMSTYLE before R2000/],
      ],
      [
        ACadVersion.AC1009,
        'dxf',
        ['DIMTDEC', vars({ DIMTDEC: 3 }), /DIMTDEC: a DIMSTYLE before R13/],
      ],
      [ACadVersion.AC1032, 'dwg', ['DIMFIT', vars({ DIMFIT: 2 }), /DIMFIT: obsolete since R2000/]],
      [
        ACadVersion.AC1032,
        'dxf',
        ['DIMUNIT', vars({ DIMUNIT: 4 }), /DIMUNIT: obsolete since R2000/],
      ],
      // What acad-ts loses (M1-92).
      [
        ACadVersion.AC1032,
        'dxf',
        ['DIMARCSYM 1', vars({ DIMARCSYM: 1 }), /DIMARCSYM: acad-ts does not save it to DXF/],
      ],
      [
        ACadVersion.AC1032,
        'dxf',
        ['DIMTXTDIRECTION', vars({ DIMTXTDIRECTION: 1 }), /DIMTXTDIRECTION: acad-ts/],
      ],
      [
        ACadVersion.AC1032,
        'dxf',
        ['DIMTFILLCLR', vars({ DIMTFILLCLR: 5 }), /DIMTFILLCLR: acad-ts/],
      ],
      [
        ACadVersion.AC1032,
        'dwg',
        ['DIMATFIT', vars({ DIMATFIT: 1 }), /DIMATFIT: acad-ts does not save it to DWG/],
      ],
      [ACadVersion.AC1014, 'dxf', ['DIMUNIT', vars({ DIMUNIT: 4 }), /DIMUNIT: acad-ts/]],
    ];
    for (const [version, format, [what, change, message]] of cases) {
      const bytes = drawing(version, format);
      const model = open(bytes);
      edit(model, (b) =>
        b.updateTableRecord('dimStyles', dimStyleNamed(model, 'ARCH').handle, {
          vars: change(model) as Record<string, DimVarValue>,
        }),
      );
      const doc = readCadDocument(bytes);
      const before = documentInit(doc);
      expect(() => triyaToAcad(doc, model, format), what).toThrow(message);
      expect(documentInit(doc), what).toEqual(before);
    }

    const records: [string, (b: ChangeSetBuilder, m: DocumentModel) => void, RegExp][] = [
      [
        'remove',
        (b, m) => b.removeTableRecord('dimStyles', dimStyleNamed(m, 'ARCH').handle),
        /removing a dimension style/,
      ],
      [
        'rename Standard',
        (b, m) =>
          b.updateTableRecord('dimStyles', dimStyleNamed(m, 'Standard').handle, { name: 'MAIN' }),
        /Standard cannot be renamed/,
      ],
      [
        'duplicate',
        (b, m) =>
          b.updateTableRecord('dimStyles', dimStyleNamed(m, 'ARCH').handle, { name: 'standard' }),
        /another dimension style is named standard/,
      ],
      [
        'xref',
        (b, m) => b.updateTableRecord('dimStyles', dimStyleNamed(m, 'ARCH').handle, { flags: 16 }),
        /xref-dependent/,
      ],
      [
        'xdata',
        (b, m) => b.updateTableRecord('dimStyles', dimStyleNamed(m, 'ARCH').handle, { xdata: [] }),
        /xdata changes/,
      ],
    ];
    for (const [what, f, message] of records) {
      const bytes = drawing();
      const model = open(bytes);
      edit(model, (b) => f(b, model));
      expect(() => triyaToAcad(readCadDocument(bytes), model, 'dxf'), what).toThrow(message);
      expect(() => triyaToAcad(readCadDocument(bytes), model, 'dxf')).toThrow(
        UnsupportedChangeError,
      );
    }
  });
});
