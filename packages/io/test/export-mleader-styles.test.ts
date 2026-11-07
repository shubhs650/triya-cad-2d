// TriyaToAcad for MLEADERSTYLE objects (M1-75 part 11). The drawing is authored in memory with
// acad-ts and saved once, so "the file" is real bytes; the corpus-wide edits are in
// packages/testkit/src/export/export.corpus.test.ts.
import {
  ACadVersion,
  BlockRecord,
  CadDictionary,
  CadDocument,
  DictionaryVariable,
  MultiLeaderStyle,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type MLeaderStyleRecord,
  type ObjectCommon,
  type TextStyleRecord,
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

/**
 * Multileader styles Standard, CALLOUT and `more`, the block TAG, and CMLEADERSTYLE = `current`.
 */
function drawing(
  version = ACadVersion.AC1032,
  format: CadFormat = 'dxf',
  current = MultiLeaderStyle.defaultName,
  more: readonly string[] = [],
): Uint8Array {
  const doc = new CadDocument(version);
  doc.blockRecords!.add(new BlockRecord('TAG'));
  const dict = doc.rootDictionary!.get(CadDictionary.acadMLeaderStyle) as CadDictionary;
  for (const name of [MultiLeaderStyle.defaultName, 'CALLOUT', ...more]) {
    const s = new MultiLeaderStyle(name);
    dict.add(s);
    s.textStyle = doc.textStyles!.get('Standard')!;
    s.leaderLineType = doc.lineTypes!.get('ByBlock')!;
  }
  const vars = doc.rootDictionary!.get(CadDictionary.variableDictionary) as CadDictionary;
  const variable = new DictionaryVariable();
  variable.name = 'CMLEADERSTYLE';
  variable.value = current;
  vars.add(variable);
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const style = (model: DocumentModel, name: string): MLeaderStyleRecord =>
  [...model.tables.mleaderStyles.values()].find((s) => s.name === name)!;

const block = (model: DocumentModel, name: string): string =>
  [...model.tables.blockRecords.values()].find((s) => s.name === name)!.handle;

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

/** Every field the mapping carries, set to a value the drawing does not have. */
const FIELD_EDITS: Record<string, (m: DocumentModel) => Partial<MLeaderStyleRecord>> = {
  description: () => ({ description: 'Balloon callouts' }),
  contentType: () => ({ contentType: 1 }),
  mleaderDrawOrder: () => ({ mleaderDrawOrder: 1 }),
  leaderDrawOrder: () => ({ leaderDrawOrder: 1 }),
  maxLeaderPoints: () => ({ maxLeaderPoints: 5 }),
  firstSegmentAngle: () => ({ firstSegmentAngle: Math.PI / 4 }),
  secondSegmentAngle: () => ({ secondSegmentAngle: Math.PI / 2 }),
  pathType: () => ({ pathType: 2 }),
  lineColor: () => ({ lineColor: { kind: 'aci', index: 1 } }),
  'lineColor rgb': () => ({ lineColor: { kind: 'rgb', r: 10, g: 20, b: 30 } }),
  linetype: (m) => ({
    linetype: [...m.tables.linetypes.values()].find((l) => l.name === 'Continuous')!.handle,
  }),
  lineweight: () => ({ lineweight: 35 }),
  'lineweight ByLayer': () => ({ lineweight: 'ByLayer' }),
  landing: () => ({ landing: false }),
  landingGap: () => ({ landingGap: 0.5 }),
  dogleg: () => ({ dogleg: false }),
  doglegLength: () => ({ doglegLength: 2 }),
  arrowhead: (m) => ({ arrowhead: block(m, 'TAG') }),
  arrowheadSize: () => ({ arrowheadSize: 0.25 }),
  defaultText: () => ({ defaultText: 'NOTE' }),
  textLeftAttachment: () => ({ textLeftAttachment: 3 }),
  textRightAttachment: () => ({ textRightAttachment: 6 }),
  textTopAttachment: () => ({ textTopAttachment: 9 }),
  textBottomAttachment: () => ({ textBottomAttachment: 10 }),
  textAttachmentDirection: () => ({ textAttachmentDirection: 1 }),
  textAngleType: () => ({ textAngleType: 2 }),
  textAlignment: () => ({ textAlignment: 1 }),
  textColor: () => ({ textColor: { kind: 'aci', index: 5 } }),
  textHeight: () => ({ textHeight: 2.5 }),
  textFrame: () => ({ textFrame: true }),
  textAlignAlwaysLeft: () => ({ textAlignAlwaysLeft: true }),
  alignSpace: () => ({ alignSpace: 4 }),
  block: (m) => ({ block: block(m, 'TAG'), contentType: 1 }),
  blockColor: () => ({ blockColor: { kind: 'aci', index: 3 } }),
  blockScale: () => ({ blockScale: { x: 2, y: 3, z: 1 } }),
  blockScaleOn: () => ({ blockScaleOn: true }),
  blockRotation: () => ({ blockRotation: 0.5 }),
  blockRotationOn: () => ({ blockRotationOn: true }),
  blockConnection: () => ({ blockConnection: 1 }),
  scale: () => ({ scale: 0 }),
  overwriteProperties: () => ({ overwriteProperties: true }),
  annotative: () => ({ annotative: true }),
  breakGap: () => ({ breakGap: 0.25 }),
};

const SAVES: readonly [ACadVersion, CadFormat][] = [
  [ACadVersion.AC1015, 'dxf'],
  [ACadVersion.AC1018, 'dwg'],
  [ACadVersion.AC1021, 'dxf'],
  [ACadVersion.AC1021, 'dwg'],
  [ACadVersion.AC1024, 'dxf'],
  [ACadVersion.AC1024, 'dwg'],
  [ACadVersion.AC1032, 'dxf'],
  [ACadVersion.AC1032, 'dwg'],
];

/** A DWG MLEADERSTYLE stores the text attachment direction and vertical attachments from R2010. */
const refused = (version: ACadVersion, format: CadFormat, field: string): boolean =>
  format === 'dwg' &&
  version < ACadVersion.AC1024 &&
  ['textAttachmentDirection', 'textTopAttachment', 'textBottomAttachment'].includes(field);

const formats: readonly CadFormat[] = ['dxf', 'dwg'];

describe('MLEADERSTYLE objects', () => {
  it.each(formats)('writes edited and new styles (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const model = open(bytes);
    const callout = style(model, 'CALLOUT');
    let added = '';
    let bold = '';
    edit(model, (b) => {
      // The text style the new multileader style names is one the same save adds.
      const standard = [...model.tables.textStyles.values()].find((s) => s.name === 'Standard')!;
      const { handle: _h, raw: _raw, ...text } = standard;
      bold = b.addTableRecord('textStyles', {
        ...(text as Omit<TextStyleRecord, 'handle'>),
        name: 'NOTES',
        font: 'romans.shx',
        height: 0,
        widthFactor: 0.8,
      }).handle;
      b.updateTableRecord('mleaderStyles', callout.handle, {
        description: 'Balloon callouts',
        contentType: 1,
        block: block(model, 'TAG'),
        blockScale: { x: 2, y: 2, z: 2 },
        landing: false,
        textHeight: 3.5,
      });
      const { handle: _h2, raw: _raw2, ...rest } = callout;
      added = b.addTableRecord('mleaderStyles', {
        ...rest,
        name: 'Detail Notes',
        textStyle: bold,
        textHeight: 2.5,
        lineColor: { kind: 'aci', index: 1 },
        lineweight: 25,
        arrowheadSize: 3,
        doglegLength: 6,
        landingGap: 1,
        arrowhead: block(model, 'TAG'),
      }).handle;
      b.setHeader('CMLEADERSTYLE', 'Detail Notes');
    });

    const back = saved(bytes, model, format);
    const get = (h: string) => back.tables!.mleaderStyles!.find((s) => s.handle === h);
    expect(comparable(get(callout.handle))).toEqual(
      comparable(model.tables.mleaderStyles.get(callout.handle)),
    );
    expect(comparable(get(added))).toEqual(comparable(model.tables.mleaderStyles.get(added)));
    expect(get(added)?.textStyle).toBe(bold);
    expect(new Map(back.header).get('CMLEADERSTYLE')).toBe('Detail Notes');
  });

  it('keeps everything else as it was', () => {
    const bytes = drawing();
    const model = open(bytes);
    const callout = style(model, 'CALLOUT');
    edit(model, (b) => b.updateTableRecord('mleaderStyles', callout.handle, { textHeight: 5 }));
    const original = readCadDocument(bytes);
    const reopened = readCadDocument(
      exportDocument(readCadDocument(bytes), model, { format: 'dxf' }),
    );
    const was = documentInit(original);
    const now = documentInit(reopened);
    const others = (i: typeof was) =>
      i.tables!.mleaderStyles!.filter((s) => s.handle !== callout.handle);
    expect(others(now)).toEqual(others(was));
    expect(now.tables!.textStyles).toEqual(was.tables!.textStyles);
  });

  it.each(SAVES)(
    'writes every field %s %s, or refuses what the save cannot keep',
    (version, format) => {
      const bytes = drawing(version, format);
      const problems: string[] = [];
      for (const [field, patch] of Object.entries(FIELD_EDITS)) {
        const model = open(bytes);
        const s = style(model, 'CALLOUT');
        edit(model, (b) => b.updateTableRecord('mleaderStyles', s.handle, patch(model)));
        if (refused(version, format, field)) {
          const out = refusal(() => triyaToAcad(readCadDocument(bytes), model, format));
          if (out.length === 0) problems.push(`${field} is not refused`);
          continue;
        }
        const back = saved(bytes, model, format).tables?.mleaderStyles?.find(
          (x) => x.handle === s.handle,
        );
        if (!same(comparable(back), comparable(model.tables.mleaderStyles.get(s.handle))))
          problems.push(`${field} is not kept: ${JSON.stringify(comparable(back))}`);
      }
      expect(problems).toEqual([]);
    },
  );

  const mleaderEntries = (doc: ReturnType<typeof readCadDocument>) => {
    const dict = doc.rootDictionary!.get(CadDictionary.acadMLeaderStyle) as CadDictionary;
    return { names: dict.entryNames, handles: dict.entryHandles };
  };

  it.each(SAVES)(
    'renames a style in its dictionary entry, and CMLEADERSTYLE with it (%s %s, M1-95)',
    (version, format) => {
      const bytes = drawing(version, format, 'CALLOUT');
      const model = open(bytes);
      const callout = style(model, 'CALLOUT');
      // A new style may take the name the rename gives up (from R2007; the copy states the
      // R2010 attachment fields, which a DWG keeps from R2010).
      const adds = version >= (format === 'dwg' ? ACadVersion.AC1024 : ACadVersion.AC1021);
      let added = '';
      edit(model, (b) => {
        b.updateTableRecord('mleaderStyles', callout.handle, { name: 'Balloon', textHeight: 4 });
        if (adds) {
          const { handle: _h, raw: _raw, ...rest } = callout;
          added = b.addTableRecord('mleaderStyles', { ...rest, name: 'CALLOUT' }).handle;
        }
        b.setHeader('CMLEADERSTYLE', 'Balloon');
      });

      const original = mleaderEntries(readCadDocument(bytes));
      const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, { format }));
      const after = mleaderEntries(reopened);
      // The entry stays where it was, under its handle; a new one goes at the end.
      expect(after.names).toEqual([
        ...original.names.map((n) => (n === 'CALLOUT' ? 'Balloon' : n)),
        ...(adds ? ['CALLOUT'] : []),
      ]);
      expect(after.handles.slice(0, original.handles.length)).toEqual(original.handles);
      const back = documentInit(reopened);
      const get = (h: string) => back.tables!.mleaderStyles!.find((s) => s.handle === h);
      expect(comparable(get(callout.handle))).toEqual(
        comparable(model.tables.mleaderStyles.get(callout.handle)),
      );
      if (adds) expect(get(added)?.name).toBe('CALLOUT');
      expect(new Map(back.header).get('CMLEADERSTYLE')).toBe('Balloon');
    },
  );

  it.each(formats)('lets two styles trade names (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format, 'Standard', ['NOTE']);
    const model = open(bytes);
    const [callout, note] = [style(model, 'CALLOUT'), style(model, 'NOTE')];
    edit(model, (b) => {
      b.updateTableRecord('mleaderStyles', callout.handle, { name: 'NOTE' });
      b.updateTableRecord('mleaderStyles', note.handle, { name: 'CALLOUT' });
    });
    const original = mleaderEntries(readCadDocument(bytes));
    const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, { format }));
    expect(mleaderEntries(reopened)).toEqual({
      names: original.names.map((n) => ({ CALLOUT: 'NOTE', NOTE: 'CALLOUT' })[n] ?? n),
      handles: original.handles,
    });
    const back = documentInit(reopened).tables!.mleaderStyles!;
    expect(back.find((s) => s.handle === callout.handle)?.name).toBe('NOTE');
    expect(back.find((s) => s.handle === note.handle)?.name).toBe('CALLOUT');
  });

  it('refuses a rename that leaves CMLEADERSTYLE naming the old name', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dxf', 'callout');
    const model = open(bytes);
    edit(model, (b) =>
      b.updateTableRecord('mleaderStyles', style(model, 'CALLOUT').handle, { name: 'BALLOON' }),
    );
    expect(refusal(() => triyaToAcad(readCadDocument(bytes), model, 'dxf'))).toEqual([
      'header variable CMLEADERSTYLE: it names callout, which the save renames BALLOON',
    ]);
    // A case-only rename keeps the name CMLEADERSTYLE finds.
    const again = open(bytes);
    edit(again, (b) =>
      b.updateTableRecord('mleaderStyles', style(again, 'CALLOUT').handle, { name: 'Callout' }),
    );
    expect(refusal(() => triyaToAcad(readCadDocument(bytes), again, 'dxf'))).toEqual([]);
  });

  it('refuses what it cannot write and leaves the original as it was', () => {
    const update =
      (name: string, change: Partial<MLeaderStyleRecord>) =>
      (b: ChangeSetBuilder, m: DocumentModel) =>
        b.updateTableRecord('mleaderStyles', style(m, name).handle, change);
    const add =
      (change: Partial<MLeaderStyleRecord>) => (b: ChangeSetBuilder, m: DocumentModel) => {
        const { handle: _h, raw: _raw, ...rest } = style(m, 'CALLOUT');
        b.addTableRecord('mleaderStyles', { ...rest, name: 'NEW', ...change });
      };
    const cases: [(b: ChangeSetBuilder, m: DocumentModel) => void, RegExp][] = [
      [
        (b, m) => b.removeTableRecord('mleaderStyles', style(m, 'Standard').handle),
        /Standard cannot be purged/,
      ],
      [update('CALLOUT', { name: 'standard' }), /another multileader style is named standard/],
      [update('CALLOUT', { name: 'A<B' }), /is not a valid multileader style name/],
      [
        (b, m) => {
          b.updateTableRecord('mleaderStyles', style(m, 'CALLOUT').handle, { name: 'BALLOON' });
          b.setHeader('CMLEADERSTYLE', 'CALLOUT');
        },
        /CMLEADERSTYLE: no multileader style named "CALLOUT"/,
      ],
      [update('Standard', { name: 'Default' }), /Standard cannot be renamed/],
      [add({ name: 'callout' }), /another multileader style is named callout/],
      [add({ name: 'A<B' }), /is not a valid multileader style name/],
      [update('CALLOUT', { flags: 16 }), /has no flags/],
      [update('CALLOUT', { contentType: 4 }), /contentType: 4 is not a whole number from 0 to 3/],
      [update('CALLOUT', { maxLeaderPoints: 1 }), /maxLeaderPoints/],
      [update('CALLOUT', { pathType: 1.5 }), /pathType/],
      [update('CALLOUT', { textHeight: 0 }), /textHeight: 0 is not more than 0/],
      [update('CALLOUT', { arrowheadSize: -1 }), /arrowheadSize: -1 is negative/],
      [update('CALLOUT', { landingGap: Number.NaN }), /landingGap: null is not a number/],
      [update('CALLOUT', { blockScale: { x: 0, y: 1, z: 1 } }), /blockScale/],
      [update('CALLOUT', { lineweight: 7 as never }), /not a lineweight|is not/],
      [update('CALLOUT', { lineweight: 300 }), /lineweight: 300 is not a lineweight/],
      [
        update('CALLOUT', { textColor: { kind: 'rgb', r: 1, g: 2, b: 3, bookName: 'RAL' } }),
        /textColor: colour-book colours/,
      ],
      [
        update('CALLOUT', { textStyle: undefined } as never),
        /textStyle: a multileader style needs one/,
      ],
      [update('CALLOUT', { linetype: 'FFFF' }), /linetype: FFFF does not exist/],
      [update('CALLOUT', { block: 'FFFF' }), /block: FFFF does not exist/],
      [update('CALLOUT', { xdata: [{ appId: '12', values: [] }] } as never), /xdata changes/],
      [(b) => b.setHeader('CMLEADERSTYLE', 'NOPE'), /CMLEADERSTYLE: no multileader style named/],
    ];
    const bytes = drawing();
    for (const [change, message] of cases) {
      const model = open(bytes);
      edit(model, (b) => change(b, model));
      const original = readCadDocument(bytes);
      const before = documentInit(original);
      const problems = refusal(() => triyaToAcad(original, model, 'dxf'));
      expect(problems.join('\n'), String(message)).toMatch(message);
      expect(documentInit(original)).toEqual(before);
    }
  });

  it('refuses a new style before R2007, which has none, and the R2010 fields in an R2007 DWG', () => {
    const r2004 = drawing(ACadVersion.AC1018, 'dwg');
    const model = open(r2004);
    edit(model, (b) => {
      const { handle: _h, raw: _raw, ...rest } = style(model, 'CALLOUT');
      b.addTableRecord('mleaderStyles', { ...rest, name: 'NEW' });
    });
    expect(refusal(() => triyaToAcad(readCadDocument(r2004), model, 'dwg')).join()).toMatch(
      /AC1018 has no multileader styles \(R2007 introduced them\)/,
    );

    const r2007 = drawing(ACadVersion.AC1021, 'dwg');
    const m2 = open(r2007);
    edit(m2, (b) =>
      b.updateTableRecord('mleaderStyles', style(m2, 'CALLOUT').handle, {
        textAttachmentDirection: 1,
      }),
    );
    expect(refusal(() => triyaToAcad(readCadDocument(r2007), m2, 'dwg')).join()).toMatch(
      /textAttachmentDirection: a DWG MLEADERSTYLE before R2010 does not store it/,
    );
    // The same edit saves to DXF, which acad-ts writes and reads back whatever the version.
    const dxf = drawing(ACadVersion.AC1021);
    const m3 = open(dxf);
    edit(m3, (b) =>
      b.updateTableRecord('mleaderStyles', style(m3, 'CALLOUT').handle, {
        textAttachmentDirection: 1,
      }),
    );
    expect(refusal(() => triyaToAcad(readCadDocument(dxf), m3, 'dxf'))).toEqual([]);
  });

  it('adds the ACAD_MLEADERSTYLE dictionary to a drawing that has none', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    doc.rootDictionary!.remove(CadDictionary.acadMLeaderStyle);
    const bytes = writeCadDocument(doc, { format: 'dxf' });
    const model = open(bytes);
    expect(model.tables.mleaderStyles.size).toBe(0);
    const text = [...model.tables.textStyles.values()].find((s) => s.name === 'Standard')!;
    const linetype = [...model.tables.linetypes.values()].find((s) => s.name === 'ByBlock')!;
    let h = '';
    edit(model, (b) => {
      h = b.addTableRecord('mleaderStyles', {
        name: 'Standard',
        description: '',
        contentType: 2,
        mleaderDrawOrder: 0,
        leaderDrawOrder: 0,
        maxLeaderPoints: 2,
        firstSegmentAngle: 0,
        secondSegmentAngle: 0,
        pathType: 1,
        lineColor: { kind: 'byBlock' },
        linetype: linetype.handle,
        lineweight: 'ByBlock',
        landing: true,
        landingGap: 0.09,
        dogleg: true,
        doglegLength: 0.36,
        arrowheadSize: 0.18,
        defaultText: '',
        textStyle: text.handle,
        textLeftAttachment: 1,
        textRightAttachment: 1,
        textTopAttachment: 9,
        textBottomAttachment: 9,
        textAttachmentDirection: 0,
        textAngleType: 1,
        textAlignment: 0,
        textColor: { kind: 'byBlock' },
        textHeight: 0.18,
        textFrame: false,
        textAlignAlwaysLeft: false,
        alignSpace: 4,
        blockColor: { kind: 'byBlock' },
        blockScale: { x: 1, y: 1, z: 1 },
        blockScaleOn: true,
        blockRotation: 0,
        blockRotationOn: true,
        blockConnection: 0,
        scale: 1,
        overwriteProperties: false,
        annotative: false,
        breakGap: 0.125,
      }).handle;
    });
    const back = saved(bytes, model, 'dxf');
    expect(comparable(back.tables!.mleaderStyles!.find((s) => s.handle === h))).toEqual(
      comparable(model.tables.mleaderStyles.get(h)),
    );
  });
});
