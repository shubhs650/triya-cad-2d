// TriyaToAcad for XCLIP (SPATIAL_FILTER objects, M1-75 part 40): what XCLIP's options change. ON
// and OFF turn clipping on and off, Clipdepth sets the front and back planes, New boundary
// replaces the boundary (and the insert transform it was drawn under), a first XCLIP of a
// reference makes its filter (and the extension dictionary and ACAD_FILTER dictionary it sits
// in), Delete removes it, and ERASE takes it with its reference. The drawing is authored in
// memory with acad-ts, clipped as AutoCAD clips a reference (the filter as the SPATIAL entry of
// the ACAD_FILTER dictionary in the INSERT's extension dictionary, listing that dictionary as its
// reactor), and saved once, so "the file" is real bytes. The corpus edits are in
// packages/testkit/src/export/export-xclips.corpus.test.ts.
import {
  ACadVersion,
  BlockRecord,
  CadDictionary,
  CadDocument,
  Insert,
  Line,
  Matrix4,
  SpatialFilter as AcadSpatialFilter,
  XRecord,
  XY,
  XYZ,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type NonGraphicalObject,
  type SpatialFilter,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';

/** The 3×4 rows of a uniform scale `s` about the origin then a move by (x, y). */
// prettier-ignore
const placed = (s: number, x: number, y: number): number[] => [
  s, 0, 0, x,
  0, s, 0, y,
  0, 0, s, 0,
];
/** Inverse of `placed(s, x, y)`. */
const inverse = (s: number, x: number, y: number): number[] => placed(1 / s, 0 - x / s, 0 - y / s);
const IDENTITY = placed(1, 0, 0);
const matrix = (rows: readonly number[]) => new Matrix4([...rows, 0, 0, 0, 1]);

/**
 * Block B (a line from 0,0 to 10,10) inserted four times: C at 100,50 scaled 2 and clipped to the
 * rectangle 102,52 – 110,60 (front plane at 7; `inverted` gives it the extension dictionary
 * AutoCAD gives an inverted clip), U at 0,0 unclipped, X at 50,0 unclipped but with
 * an extension dictionary holding an XRECORD, and M a MINSERT at 0,100.
 */
function drawing(
  version = ACadVersion.AC1032,
  format: CadFormat = 'dxf',
  inverted = false,
): Uint8Array {
  const doc = new CadDocument(version);
  const block = new BlockRecord('B');
  block.entities.add(new Line(new XYZ(0, 0, 0), new XYZ(10, 10, 0)));
  doc.blockRecords!.add(block);
  const insert = (x: number, y: number, s = 1): Insert => {
    const i = new Insert(block);
    i.insertPoint = new XYZ(x, y, 0);
    i.xScale = i.yScale = i.zScale = s;
    doc.entities!.add(i);
    return i;
  };
  const clipped = insert(100, 50, 2);
  const filter = new AcadSpatialFilter();
  filter.boundaryPoints = [new XY(102, 52), new XY(110, 60)];
  filter.displayBoundary = true;
  filter.clipFrontPlane = true;
  filter.frontDistance = 7;
  filter.inverseInsertTransform = matrix(inverse(2, 100, 50));
  filter.insertTransform = matrix(IDENTITY);
  const dict = new CadDictionary('ACAD_FILTER');
  clipped.createExtendedDictionary().addByKey('ACAD_FILTER', dict);
  dict.addByKey('SPATIAL', filter);
  filter.addReactor(dict);
  // AutoCAD keeps an inverted clip's inner boundary in a record of the filter's own dictionary.
  if (inverted) {
    filter
      .createExtendedDictionary()
      .addByKey('ACAD_XREC_ROUNDTRIP', new XRecord('ACAD_XREC_ROUNDTRIP'));
  }
  insert(0, 0);
  const other = insert(50, 0);
  other.createExtendedDictionary().addByKey('NOTES', new XRecord('NOTES'));
  const array = insert(0, 100);
  array.columnCount = 2;
  array.rowCount = 2;
  array.columnSpacing = 20;
  array.rowSpacing = 20;
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const filters = (model: DocumentModel): SpatialFilter[] =>
  [...model.objects.values()].filter((o): o is SpatialFilter => o.type === 'SPATIAL_FILTER');
/** C, U, X and M as `drawing` adds them. */
function named(model: DocumentModel) {
  const [c, u, x, m] = [...model.entities()].filter((e) => e.type === 'INSERT');
  return { c: c!, u: u!, x: x!, m: m! };
}
const filterOf = (model: DocumentModel, insert: Entity): SpatialFilter | undefined =>
  filters(model).find((f) => f.insert === insert.handle);

/** An object patch with a filter's fields. */
const patch = (fields: Partial<SpatialFilter>) => fields as Partial<NonGraphicalObject>;

/** Saves `model` over a fresh read of `bytes`. */
const save = (bytes: Uint8Array, model: DocumentModel, format: CadFormat) =>
  readCadDocument(exportDocument(readCadDocument(bytes), model, { format }));
const reopen = (bytes: Uint8Array, model: DocumentModel, format: CadFormat) =>
  DocumentModel.create(documentInit(save(bytes, model, format)));

const comparable = (o: NonGraphicalObject | undefined) => {
  if (!o) return o;
  const { raw: _raw, ...rest } = o;
  return rest;
};

function refusal(f: () => unknown): string[] {
  try {
    f();
  } catch (e) {
    if (e instanceof UnsupportedChangeError) return [...e.problems];
    throw e;
  }
  return [];
}

/**
 * What XCLIP makes for a first clip of `insert`: its extension dictionary (unless it has one), an
 * ACAD_FILTER dictionary in it (unless there is one), and the filter, with the rectangle 1,1 –
 * 9,9 of the block where the reference stands.
 */
function clip(
  model: DocumentModel,
  b: ChangeSetBuilder,
  insert: Entity,
  fields: Partial<SpatialFilter> = {},
): void {
  const g = insert.geom as { position: { x: number; y: number }; scale: { x: number } };
  const s = g.scale.x;
  const { x, y } = g.position;
  const xdict = insert.extDict ?? model.handles.allocate();
  if (insert.extDict === undefined) b.updateEntity(insert.id, { extDict: xdict });
  const owner = fields.owner ?? model.handles.allocate();
  b.addObject({
    type: 'SPATIAL_FILTER',
    owner,
    reactors: [owner],
    insert: insert.handle,
    boundary: [
      { x: x + s, y: y + s },
      { x: x + 9 * s, y: y + 9 * s },
    ],
    normal: { x: 0, y: 0, z: 1 },
    origin: { x: 0, y: 0, z: 0 },
    enabled: true,
    inverseInsert: inverse(s, x, y),
    boundaryTransform: IDENTITY,
    ...fields,
  } as Omit<SpatialFilter, 'handle'>);
}

const SAVES: readonly [ACadVersion, CadFormat][] = [
  [ACadVersion.AC1015, 'dxf'],
  [ACadVersion.AC1015, 'dwg'],
  [ACadVersion.AC1018, 'dwg'],
  [ACadVersion.AC1024, 'dxf'],
  [ACadVersion.AC1032, 'dxf'],
  [ACadVersion.AC1032, 'dwg'],
];

describe('XCLIP spatial filters', () => {
  it.each(SAVES)('saves XCLIP OFF and Clipdepth (%s %s)', (v, f) => {
    const bytes = drawing(v, f);
    const model = open(bytes);
    const was = filterOf(model, named(model).c)!;
    expect(was).toMatchObject({ enabled: true, frontClip: 7 });
    edit(model, (b) =>
      b.updateObject(was.handle, patch({ enabled: false, frontClip: 3, backClip: -2 })),
    );
    const back = reopen(bytes, model, f);
    expect(comparable(filterOf(back, named(back).c))).toEqual(
      comparable(filterOf(model, named(model).c)),
    );
    expect(filterOf(back, named(back).c)).toMatchObject({
      enabled: false,
      frontClip: 3,
      backClip: -2,
    });
  });

  it.each(SAVES)('saves a new boundary and clipping planes removed (%s %s)', (v, f) => {
    // XCLIP New boundary after the reference moved: the polygon, and the insert transform it was
    // drawn under.
    const bytes = drawing(v, f);
    const model = open(bytes);
    const was = filterOf(model, named(model).c)!;
    edit(model, (b) =>
      b.updateObject(was.handle, {
        boundary: [
          { x: 104, y: 54 },
          { x: 112, y: 54 },
          { x: 104, y: 62 },
        ],
        inverseInsert: inverse(2, 101, 51),
        frontClip: undefined,
      } as Partial<NonGraphicalObject>),
    );
    const now = filterOf(model, named(model).c)!;
    const back = reopen(bytes, model, f);
    expect(comparable(filterOf(back, named(back).c))).toEqual(comparable(now));
  });

  it.each(SAVES)('saves a first XCLIP of a reference (%s %s)', (v, f) => {
    const bytes = drawing(v, f);
    const model = open(bytes);
    const { u, x } = named(model);
    edit(model, (b) => {
      clip(model, b, u);
      // X already has an extension dictionary, without an ACAD_FILTER entry.
      clip(model, b, x, { enabled: false });
    });
    const back = reopen(bytes, model, f);
    const nb = named(back);
    expect(comparable(filterOf(back, nb.u))).toEqual(comparable(filterOf(model, u)));
    expect(comparable(filterOf(back, nb.x))).toEqual(comparable(filterOf(model, x)));
    expect(nb.u.extDict).toBe(model.entityByHandle(u.handle)!.extDict);
    expect(nb.x.extDict).toBe(x.extDict);
    // The new dictionaries are AutoCAD's: ACAD_FILTER in the reference's dictionary, SPATIAL in it.
    const doc = save(bytes, model, f);
    for (const e of [nb.u, nb.x]) {
      const xdict = doc.getCadObject(Number.parseInt(e.extDict!, 16)) as CadDictionary;
      const acadFilter = xdict.getEntry<CadDictionary>('ACAD_FILTER')!;
      expect(acadFilter).toBeInstanceOf(CadDictionary);
      expect(acadFilter.getEntry('SPATIAL')).toBeInstanceOf(AcadSpatialFilter);
      expect(acadFilter.getEntry('SPATIAL')!.handle.toString(16).toUpperCase()).toBe(
        filterOf(back, e)!.handle,
      );
    }
    expect(doc.getCadObject(Number.parseInt(x.extDict!, 16))).toBeInstanceOf(CadDictionary);
    expect(
      (doc.getCadObject(Number.parseInt(x.extDict!, 16)) as CadDictionary).getEntry('NOTES'),
    ).toBeInstanceOf(XRecord);
  });

  it.each(SAVES)('saves XCLIP Delete, and a clip made again later (%s %s)', (v, f) => {
    const bytes = drawing(v, f);
    const model = open(bytes);
    const { c } = named(model);
    const was = filterOf(model, c)!;
    edit(model, (b) => b.removeObject(was.handle));
    const saved = writeCadDocument(save(bytes, model, f), { format: f });
    const doc = readCadDocument(saved);
    expect(doc.getCadObject(Number.parseInt(was.handle, 16))).toBeNull();
    // The reference keeps its dictionaries (AutoCAD does not document whether XCLIP Delete
    // removes an emptied ACAD_FILTER; keeping it is valid either way).
    const again = open(saved);
    const nc = named(again).c;
    expect(filterOf(again, nc)).toBeUndefined();
    expect(nc.extDict).toBe(c.extDict);
    expect(filters(again)).toHaveLength(0);
    // A second save clips it again into the ACAD_FILTER dictionary that stayed.
    edit(again, (b) => clip(again, b, nc, { owner: was.owner }));
    const back = reopen(saved, again, f);
    expect(comparable(filterOf(back, named(back).c))).toEqual(comparable(filterOf(again, nc)));
  });

  it.each(SAVES)('saves COPY of a clipped reference (%s %s)', (v, f) => {
    const bytes = drawing(v, f);
    const model = open(bytes);
    const { c } = named(model);
    const was = filterOf(model, c)!;
    edit(model, (b) => {
      const copy = b.addEntity({
        type: 'INSERT',
        owner: c.owner,
        layer: c.layer,
        color: c.color,
        linetype: c.linetype,
        lineweight: c.lineweight,
        transparency: c.transparency,
        ltScale: c.ltScale,
        visible: c.visible,
        geom: { ...c.geom, position: { x: 200, y: 50 } },
      } as never);
      const xdict = model.handles.allocate();
      b.updateEntity(copy.id, { extDict: xdict });
      const owner = model.handles.allocate();
      const { handle: _h, raw: _raw, ...rest } = was;
      b.addObject({
        ...rest,
        owner,
        reactors: [owner],
        insert: copy.handle,
        boundary: was.boundary.map((p) => ({ x: p.x + 100, y: p.y })),
        inverseInsert: inverse(2, 200, 50),
      } as Omit<SpatialFilter, 'handle'>);
    });
    const back = reopen(bytes, model, f);
    expect(filters(back).map(comparable)).toEqual(filters(model).map(comparable));
  });

  it.each(SAVES)('saves ERASE of a clipped reference with its filter (%s %s)', (v, f) => {
    const bytes = drawing(v, f);
    const model = open(bytes);
    const { c } = named(model);
    const was = filterOf(model, c)!;
    edit(model, (b) => {
      b.removeEntity(c.id);
      b.removeObject(was.handle);
    });
    const doc = save(bytes, model, f);
    expect(doc.getCadObject(Number.parseInt(was.handle, 16))).toBeNull();
    expect(doc.getCadObject(Number.parseInt(c.handle, 16))).toBeNull();
  });

  it('refuses a filter left behind by an erased reference', () => {
    const bytes = drawing();
    const model = open(bytes);
    const { c } = named(model);
    const was = filterOf(model, c)!;
    edit(model, (b) => b.removeEntity(c.id));
    expect(refusal(() => save(bytes, model, 'dxf'))).toEqual([
      `SPATIAL_FILTER ${was.handle}: still clips the erased INSERT ${c.handle}`,
    ]);
  });

  it('refuses what it cannot write, leaving the drawing as it was', () => {
    const bytes = drawing();
    const model = open(bytes);
    const { c, u, x, m } = named(model);
    const was = filterOf(model, c)!;
    edit(model, (b) => {
      b.updateObject(
        was.handle,
        patch({ insert: u.handle, inverseInsert: [1, 2, 3], xdata: [{ appId: '12', values: [] }] }),
      );
      clip(model, b, m);
      // Not in X's own extension dictionary.
      clip(model, b, x, { owner: was.owner, boundary: [{ x: 1, y: 1 }], reactors: [] });
    });
    const problems = refusal(() => save(bytes, model, 'dxf'));
    const added = filters(model).filter((s) => s.handle !== was.handle);
    const [onM, onX] = [
      added.find((s) => s.insert === m.handle)!,
      added.find((s) => s.insert === x.handle)!,
    ];
    expect(problems).toEqual(
      expect.arrayContaining([
        `SPATIAL_FILTER ${was.handle}: its INSERT changes`,
        `SPATIAL_FILTER ${was.handle}: xdata changes`,
        `SPATIAL_FILTER ${was.handle}: inverseInsert: not 12 finite numbers`,
        `SPATIAL_FILTER ${onM.handle}: ${m.handle} is a MINSERT (XCLIP clips single references)`,
        `SPATIAL_FILTER ${onX.handle}: it must be the SPATIAL entry of an ACAD_FILTER dictionary in INSERT ${x.handle}'s extension dictionary ${x.extDict}`,
        `SPATIAL_FILTER ${onX.handle}: its reactors can only be its dictionary`,
        `SPATIAL_FILTER ${onX.handle}: boundary: encloses nothing`,
      ]),
    );
  });

  it('refuses a new clip before R14 and a reshaped inverted clip', () => {
    // AutoCAD Release 14 introduced XCLIP; R13 and R12 files have no SPATIAL_FILTER.
    const r13 = drawing(ACadVersion.AC1012, 'dwg');
    const model = open(r13);
    const { u } = named(model);
    edit(model, (b) => clip(model, b, u));
    expect(refusal(() => save(r13, model, 'dwg'))).toContain(
      `SPATIAL_FILTER ${filterOf(model, u)!.handle}: AC1012 has no XCLIP (Release 14 added it)`,
    );
    // An inverted clip keeps its inner boundary in an ACAD_XREC_ROUNDTRIP record of the filter's
    // own extension dictionary, which a new boundary would leave stale; ON and OFF are fine.
    const bytes = drawing(ACadVersion.AC1032, 'dxf', true);
    const inverted = open(bytes);
    const was = filterOf(inverted, named(inverted).c)!;
    expect(was.extDict).toBeDefined();
    edit(inverted, (b) => b.updateObject(was.handle, patch({ enabled: false })));
    expect(filterOf(reopen(bytes, inverted, 'dxf'), named(inverted).c)?.enabled).toBe(false);
    edit(inverted, (b) =>
      b.updateObject(
        was.handle,
        patch({
          boundary: [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
          ],
        }),
      ),
    );
    expect(refusal(() => save(bytes, inverted, 'dxf'))).toEqual([
      `SPATIAL_FILTER ${was.handle}: a new boundary on a clip with an extension dictionary (an inverted clip's ACAD_XREC_ROUNDTRIP record would go stale)`,
    ]);
  });
});
