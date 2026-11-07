// TriyaToAcad for MLINESTYLE objects (M1-75 part 31). The drawing is authored in memory with
// acad-ts and saved once, so "the file" is real bytes; the corpus-wide edits are in
// packages/testkit/src/export/export.corpus.test.ts.
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  Color as AcadColor,
  LineType,
  MLine,
  MLineSegment,
  MLineStyle,
  MLineStyleElement,
  MLineVertex,
  XYZ,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type MLineStyleRecord,
  type ObjectCommon,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { same } from '../src/export/entities';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  triyaToAcad,
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';

const DEG = Math.PI / 180;

/**
 * MLINE styles Standard (the document's own), WALL (an MLINE draws with it), SPARE and `more`,
 * each with two ByLayer elements at ±0.5; the linetype DASHED; $CMLSTYLE = `current`.
 */
function drawing(
  version = ACadVersion.AC1032,
  format: CadFormat = 'dxf',
  current = 'Standard',
  more: readonly string[] = [],
): Uint8Array {
  const doc = new CadDocument(version);
  doc.updateCollections(true, true);
  const dashed = new LineType('DASHED');
  doc.lineTypes!.add(dashed);
  const styles = new Map<string, MLineStyle>();
  for (const name of ['WALL', 'SPARE', ...more]) {
    const s = new MLineStyle(name);
    doc.mLineStyles!.add(s);
    for (const offset of [0.5, -0.5]) {
      const e = new MLineStyleElement();
      e.offset = offset;
      s.addElement(e);
    }
    styles.set(name, s);
  }
  doc.header!.currentMLineStyleName = current;
  const mline = new MLine();
  doc.entities!.add(mline);
  mline.style = styles.get('WALL')!;
  for (const x of [0, 10]) {
    const v = new MLineVertex();
    v.position = new XYZ(x, 0, 0);
    v.direction = new XYZ(1, 0, 0);
    v.miter = new XYZ(0, 1, 0);
    v.segments = [0.5, -0.5].map((p) => {
      const s = new MLineSegment();
      s.parameters = [p, 0];
      return s;
    });
    mline.vertices.push(v);
  }
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const style = (model: DocumentModel, name: string): MLineStyleRecord =>
  [...model.tables.mlineStyles.values()].find((s) => s.name.toUpperCase() === name.toUpperCase())!;

const linetype = (model: DocumentModel, name: string): string =>
  [...model.tables.linetypes.values()].find((l) => l.name.toUpperCase() === name.toUpperCase())!
    .handle;

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

function refusal(f: () => unknown): string[] {
  try {
    f();
  } catch (e) {
    if (e instanceof UnsupportedChangeError) return [...e.problems];
    throw e;
  }
  return [];
}

const element = (offset: number, extra: Partial<MLineStyleRecord['elements'][number]> = {}) => ({
  offset,
  color: { kind: 'byLayer' as const },
  ...extra,
});

/** `elements` with ByLayer where they name no linetype, as a file states it (DXF 6 BYLAYER). */
function byLayer(m: DocumentModel, change: Partial<MLineStyleRecord>): Partial<MLineStyleRecord> {
  if (!change.elements) return change;
  const h = linetype(m, 'ByLayer');
  return { ...change, elements: change.elements.map((e) => ({ linetype: h, ...e })) };
}

/** Every field the mapping carries, set to a value the drawing does not have. */
const FIELD_EDITS: Record<string, (m: DocumentModel) => Partial<MLineStyleRecord>> = {
  description: () => ({ description: 'Cavity wall' }),
  styleFlags: () => ({ styleFlags: 1 | 2 | 16 | 64 | 256 | 1024 }),
  'styleFlags inner arcs': () => ({ styleFlags: 32 | 512 }),
  fillColor: () => ({ fillColor: { kind: 'aci', index: 8 } }),
  'fillColor ByBlock': () => ({ fillColor: { kind: 'byBlock' } }),
  'fillColor rgb': () => ({ fillColor: { kind: 'rgb', r: 10, g: 20, b: 30 } }),
  startAngle: () => ({ startAngle: 45 * DEG }),
  endAngle: () => ({ endAngle: 150 * DEG }),
  'one element': () => ({ elements: [element(0)] }),
  'four elements': () => ({
    elements: [element(1.5), element(0.5), element(-0.5), element(-1.5)],
  }),
  'element offset': () => ({ elements: [element(0.75), element(-0.25)] }),
  'element color': () => ({
    elements: [element(0.5, { color: { kind: 'aci', index: 1 } }), element(-0.5)],
  }),
  'element color rgb': () => ({
    elements: [element(0.5, { color: { kind: 'rgb', r: 200, g: 100, b: 0 } }), element(-0.5)],
  }),
  'element linetype': (m) => ({
    elements: [element(0.5, { linetype: linetype(m, 'DASHED') }), element(-0.5)],
  }),
  'element linetype ByBlock': (m) => ({
    elements: [element(0.5, { linetype: linetype(m, 'ByBlock') }), element(-0.5)],
  }),
};

const SAVES: readonly [ACadVersion, CadFormat][] = [
  [ACadVersion.AC1015, 'dxf'],
  [ACadVersion.AC1015, 'dwg'],
  [ACadVersion.AC1018, 'dwg'],
  [ACadVersion.AC1021, 'dxf'],
  [ACadVersion.AC1024, 'dwg'],
  [ACadVersion.AC1027, 'dwg'],
  [ACadVersion.AC1032, 'dxf'],
  [ACadVersion.AC1032, 'dwg'],
];

/** What the save cannot keep: a true colour where only a colour number is stored, an indexed linetype. */
const refused = (version: ACadVersion, format: CadFormat, field: string): boolean =>
  (/rgb/.test(field) && (format === 'dxf' || version < ACadVersion.AC1018)) ||
  (field === 'element linetype' && format === 'dwg' && version < ACadVersion.AC1032);

const formats: readonly CadFormat[] = ['dxf', 'dwg'];

describe('MLINESTYLE objects (M1-75 part 31)', () => {
  it.each(formats)('writes edited and new styles (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const model = open(bytes);
    const spare = style(model, 'SPARE');
    let added = '';
    let center = '';
    edit(model, (b) => {
      // The linetype the new style names is one the same save adds.
      const {
        handle: _h,
        raw: _raw,
        ...dashed
      } = model.tables.linetypes.get(linetype(model, 'DASHED'))!;
      center = b.addTableRecord('linetypes', { ...dashed, name: 'CENTER' }).handle;
      b.updateTableRecord(
        'mlineStyles',
        spare.handle,
        byLayer(model, {
          description: 'Spare, edited',
          styleFlags: 1 | 2,
          fillColor: { kind: 'aci', index: 9 },
          startAngle: 60 * DEG,
          endAngle: 120 * DEG,
          elements: [element(1, { color: { kind: 'aci', index: 2 } }), element(0), element(-1)],
        }),
      );
      added = b.addTableRecord('mlineStyles', {
        name: 'Cavity Wall',
        description: 'Two leaves and a centre line',
        styleFlags: 16 | 256,
        fillColor: { kind: 'byLayer' },
        startAngle: 90 * DEG,
        endAngle: 90 * DEG,
        elements: [
          element(0.15, { color: { kind: 'aci', index: 1 }, linetype: linetype(model, 'ByLayer') }),
          element(0, { linetype: center }),
          element(-0.15, { color: { kind: 'byBlock' }, linetype: linetype(model, 'ByBlock') }),
        ],
      }).handle;
      b.setHeader('$CMLSTYLE', 'Cavity Wall');
    });

    const back = saved(bytes, model, format);
    const get = (h: string) => back.tables!.mlineStyles!.find((s) => s.handle === h);
    expect(comparable(get(spare.handle))).toEqual(
      comparable(model.tables.mlineStyles.get(spare.handle)),
    );
    expect(comparable(get(added))).toEqual(comparable(model.tables.mlineStyles.get(added)));
    expect(get(added)?.elements[1]?.linetype).toBe(center);
    expect(new Map(back.header).get('$CMLSTYLE')).toBe('Cavity Wall');
  });

  it('keeps everything else as it was', () => {
    const bytes = drawing();
    const model = open(bytes);
    const spare = style(model, 'SPARE');
    edit(model, (b) => b.updateTableRecord('mlineStyles', spare.handle, { startAngle: 45 * DEG }));
    const was = documentInit(readCadDocument(bytes));
    const now = documentInit(
      readCadDocument(exportDocument(readCadDocument(bytes), model, { format: 'dxf' })),
    );
    const others = (i: typeof was) =>
      i.tables!.mlineStyles!.filter((s) => s.handle !== spare.handle);
    expect(others(now)).toEqual(others(was));
    expect(now.tables!.linetypes).toEqual(was.tables!.linetypes);
    expect(now.entities).toEqual(was.entities);
  });

  it.each(SAVES)(
    'writes every field %s %s, or refuses what the save cannot keep',
    (version, format) => {
      const bytes = drawing(version, format);
      const problems: string[] = [];
      for (const [field, patch] of Object.entries(FIELD_EDITS)) {
        const model = open(bytes);
        const s = style(model, 'SPARE');
        edit(model, (b) =>
          b.updateTableRecord('mlineStyles', s.handle, byLayer(model, patch(model))),
        );
        if (refused(version, format, field)) {
          const out = refusal(() => triyaToAcad(readCadDocument(bytes), model, format));
          if (out.length === 0) problems.push(`${field} is not refused`);
          continue;
        }
        const back = saved(bytes, model, format).tables?.mlineStyles?.find(
          (x) => x.handle === s.handle,
        );
        if (!same(comparable(back), comparable(model.tables.mlineStyles.get(s.handle))))
          problems.push(`${field} is not kept: ${JSON.stringify(comparable(back))}`);
      }
      expect(problems).toEqual([]);
    },
  );

  const entries = (doc: ReturnType<typeof readCadDocument>) => {
    const dict = doc.rootDictionary!.get(CadDictionary.acadMLineStyle) as CadDictionary;
    return { names: dict.entryNames.map((n) => n.toUpperCase()), handles: dict.entryHandles };
  };

  it.each(SAVES)(
    'renames a style in its dictionary entry, and $CMLSTYLE with it (%s %s)',
    (version, format) => {
      const bytes = drawing(version, format, 'WALL');
      const model = open(bytes);
      const wall = style(model, 'WALL');
      let added = '';
      edit(model, (b) => {
        // A style in use may be renamed and described, and a new style may take the name it
        // gives up.
        b.updateTableRecord('mlineStyles', wall.handle, { name: 'Block wall', description: 'x' });
        const { handle: _h, raw: _raw, ...rest } = wall;
        added = b.addTableRecord('mlineStyles', { ...rest, name: 'WALL' }).handle;
        b.setHeader('$CMLSTYLE', 'Block wall');
      });
      const original = entries(readCadDocument(bytes));
      const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, { format }));
      const after = entries(reopened);
      // The entry stays where it was, under its handle; the new one goes at the end.
      expect(after.names).toEqual([
        ...original.names.map((n) => (n === 'WALL' ? 'BLOCK WALL' : n)),
        'WALL',
      ]);
      expect(after.handles.slice(0, original.handles.length)).toEqual(original.handles);
      const back = documentInit(reopened);
      const get = (h: string) => back.tables!.mlineStyles!.find((s) => s.handle === h);
      expect(get(wall.handle)?.name.toUpperCase()).toBe('BLOCK WALL');
      expect(get(wall.handle)?.description).toBe('x');
      expect(get(added)?.name.toUpperCase()).toBe('WALL');
      expect(String(new Map(back.header).get('$CMLSTYLE')).toUpperCase()).toBe('BLOCK WALL');
      // The MLINE still draws with the renamed style.
      const mline = back.entities!.find((e) => e.geom.kind === 'MLINE')!;
      expect(mline.geom.kind === 'MLINE' && mline.geom.style).toBe(wall.handle);
    },
  );

  it.each(formats)('lets two styles trade names (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const model = open(bytes);
    const [wall, spare] = [style(model, 'WALL'), style(model, 'SPARE')];
    edit(model, (b) => {
      b.updateTableRecord('mlineStyles', wall.handle, { name: 'SPARE' });
      b.updateTableRecord('mlineStyles', spare.handle, { name: 'WALL' });
    });
    const back = documentInit(
      readCadDocument(exportDocument(readCadDocument(bytes), model, { format })),
    ).tables!.mlineStyles!;
    expect(back.find((s) => s.handle === wall.handle)?.name.toUpperCase()).toBe('SPARE');
    expect(back.find((s) => s.handle === spare.handle)?.name.toUpperCase()).toBe('WALL');
  });

  it('refuses what it cannot write and leaves the original as it was', () => {
    const update =
      (name: string, change: Partial<MLineStyleRecord>) =>
      (b: ChangeSetBuilder, m: DocumentModel) =>
        b.updateTableRecord('mlineStyles', style(m, name).handle, change);
    const add = (change: Partial<MLineStyleRecord>) => (b: ChangeSetBuilder, m: DocumentModel) => {
      const { handle: _h, raw: _raw, ...rest } = style(m, 'SPARE');
      b.addTableRecord('mlineStyles', { ...rest, name: 'NEW', ...change });
    };
    const sixteen = Array.from({ length: 16 }, (_, i) => element(8 - i));
    const cases: [(b: ChangeSetBuilder, m: DocumentModel) => void, RegExp][] = [
      [update('Standard', { name: 'Default' }), /Standard cannot be renamed/],
      [
        update('Standard', { startAngle: 45 * DEG }),
        /startAngle: AutoCAD does not let Standard's elements and properties change/,
      ],
      [
        update('WALL', {
          elements: [element(1), element(-1)],
          fillColor: { kind: 'aci', index: 1 },
        }),
        /fillColor, elements: MLINE [0-9A-F]+ uses it, and AutoCAD does not let a style in use change/,
      ],
      [update('SPARE', { name: 'wall' }), /another MLINE style is named wall/],
      [update('SPARE', { name: 'A<B' }), /is not a valid MLINE style name/],
      [add({ name: 'spare' }), /another MLINE style is named spare/],
      [update('SPARE', { flags: 16 }), /has no record flags/],
      [update('SPARE', { styleFlags: 4 }), /styleFlags: 4 has bits other than/],
      [update('SPARE', { styleFlags: 1.5 }), /styleFlags: 1.5/],
      [
        update('SPARE', { startAngle: 5 * DEG }),
        /startAngle: [0-9.]+ is not an angle from 10° to 170°/,
      ],
      [update('SPARE', { endAngle: 175 * DEG }), /endAngle: [0-9.]+ is not an angle/],
      [update('SPARE', { endAngle: Number.NaN }), /endAngle: null is not an angle/],
      [update('SPARE', { elements: [] }), /elements: 0, where a style has 1 to 16/],
      [update('SPARE', { elements: [...sixteen, element(-9)] }), /elements: 17/],
      [
        update('SPARE', { elements: [element(-1), element(1)] }),
        /element 2 offset: 1 is above the offset before it/,
      ],
      [update('SPARE', { elements: [element(Number.NaN)] }), /element 1 offset: null/],
      [
        update('SPARE', { elements: [element(0, { linetype: 'FFFF' })] }),
        /element 1 linetype: FFFF does not exist/,
      ],
      [
        update('SPARE', {
          fillColor: { kind: 'rgb', r: 1, g: 2, b: 3, bookName: 'RAL' },
        }),
        /fillColor: colour-book colours/,
      ],
      [
        update('SPARE', { elements: [element(0, { color: { kind: 'rgb', r: 1, g: 2, b: 3 } })] }),
        /element 1 color: a DXF MLINESTYLE stores colour numbers only/,
      ],
      [update('SPARE', { xdata: [{ appId: '12', values: [] }] } as never), /xdata changes/],
      [(b) => b.setHeader('$CMLSTYLE', 'NOPE'), /\$CMLSTYLE: no record named "NOPE"/],
    ];
    const bytes = drawing(ACadVersion.AC1032, 'dxf', 'SPARE');
    for (const [change, message] of cases) {
      const model = open(bytes);
      edit(model, (b) => change(b, model));
      const original = readCadDocument(bytes);
      const before = documentInit(original);
      const problems = refusal(() => triyaToAcad(original, model, 'dxf'));
      expect(problems.join('\n'), String(message)).toMatch(message);
      expect(documentInit(original)).toEqual(before);
    }
    // $CMLSTYLE left naming the renamed style.
    const model = open(bytes);
    edit(model, (b) =>
      b.updateTableRecord('mlineStyles', style(model, 'SPARE').handle, { name: 'OTHER' }),
    );
    expect(refusal(() => triyaToAcad(readCadDocument(bytes), model, 'dxf'))).toEqual([
      'header variable $CMLSTYLE: it names SPARE, which the save renames OTHER',
    ]);
    // Sixteen elements save.
    const many = open(bytes);
    edit(many, (b) =>
      b.updateTableRecord('mlineStyles', style(many, 'WALL').handle, { description: 'used' }),
    );
    edit(many, (b) => add({ elements: sixteen })(b, many));
    expect(refusal(() => triyaToAcad(readCadDocument(bytes), many, 'dxf'))).toEqual([]);
  });

  it('refuses an element linetype a DWG before R2018 would index, and a new style in R12', () => {
    const r2013 = drawing(ACadVersion.AC1027, 'dwg');
    const model = open(r2013);
    edit(model, (b) =>
      b.updateTableRecord('mlineStyles', style(model, 'SPARE').handle, {
        elements: [element(0, { linetype: linetype(model, 'DASHED') })],
      }),
    );
    expect(refusal(() => triyaToAcad(readCadDocument(r2013), model, 'dwg')).join()).toMatch(
      /element 1 linetype: a DWG MLINESTYLE before R2018 names it by an index/,
    );

    const r12 = writeCadDocument(new CadDocument(ACadVersion.AC1009), { format: 'dxf' });
    const m12 = open(r12);
    edit(m12, (b) =>
      b.addTableRecord('mlineStyles', {
        name: 'NEW',
        description: '',
        styleFlags: 0,
        fillColor: { kind: 'byLayer' },
        startAngle: 90 * DEG,
        endAngle: 90 * DEG,
        elements: [element(0)],
      }),
    );
    expect(refusal(() => triyaToAcad(readCadDocument(r12), m12, 'dxf')).join()).toMatch(
      /AC1009 has no MLINE styles \(R13 introduced them\)/,
    );
  });

  it('adds the ACAD_MLINESTYLE dictionary to a drawing that has none', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    doc.header!.currentMLineStyleName = '';
    doc.rootDictionary!.remove(CadDictionary.acadMLineStyle);
    const bytes = writeCadDocument(doc, { format: 'dxf' });
    const model = open(bytes);
    expect(model.tables.mlineStyles.size).toBe(0);
    let h = '';
    edit(model, (b) => {
      h = b.addTableRecord('mlineStyles', {
        name: 'Standard',
        description: '',
        styleFlags: 0,
        fillColor: { kind: 'byLayer' },
        startAngle: 90 * DEG,
        endAngle: 90 * DEG,
        elements: [element(0.5), element(-0.5)].map((e) => ({
          ...e,
          linetype: linetype(model, 'ByLayer'),
        })),
      }).handle;
    });
    const back = saved(bytes, model, 'dxf');
    expect(comparable(back.tables!.mlineStyles!.find((s) => s.handle === h))).toEqual(
      comparable(model.tables.mlineStyles.get(h)),
    );
  });

  it('keeps a true colour read from a DWG MLINESTYLE', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    doc.updateCollections(true, true);
    const s = new MLineStyle('TINTED');
    doc.mLineStyles!.add(s);
    s.fillColor = new AcadColor(12, 34, 56);
    const e = new MLineStyleElement();
    e.color = new AcadColor(200, 0, 0);
    s.addElement(e);
    const back = open(writeCadDocument(doc, { format: 'dwg' }));
    expect(style(back, 'TINTED').fillColor).toEqual({ kind: 'rgb', r: 12, g: 34, b: 56 });
    expect(style(back, 'TINTED').elements[0]?.color).toEqual({ kind: 'rgb', r: 200, g: 0, b: 0 });
  });
});
