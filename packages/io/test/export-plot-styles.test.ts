// TriyaToAcad for an entity's plot style name and material (M1-75 part 21): the Properties
// palette's Plot style and Material rows, and COPY, which gives new entities its source's. In a
// named-plot-style drawing ($PSTYLEMODE 0) an entity names its plot style by a hard pointer to an
// ACDBPLACEHOLDER in the ACAD_PLOTSTYLENAME dictionary (DXF 390; a DWG states the pointer after
// the plot style flags 11), and from R2007 a material by a pointer to a MATERIAL (DXF 347). Drawings
// are authored in memory with acad-ts and saved once, so "the file" is real bytes. acad-ts writes
// a MATERIAL to DXF only from the group codes it read, so the authored DXF loses its materials:
// materials are saved here from the DWG, and to DXF by the corpus-wide edit in
// packages/testkit/src/export/export-plot-styles.corpus.test.ts.
import {
  ACadVersion,
  AcdbPlaceHolder,
  AttributeEntity,
  BlockRecord,
  CadDictionary,
  CadDictionaryWithDefault,
  CadDocument,
  Circle,
  EntityPlotStyleType,
  Insert,
  Line,
  Material,
  Seqend,
  XYZ,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type EntityGeometry,
  type EntityInit,
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

/**
 * A drawing of `version` with the plot style names Normal (the dictionary default) and Red pen,
 * the material Steel, and in model space: a LINE, a CIRCLE plotted with Red pen and made of
 * Steel, and an INSERT of TAG with one ATTRIB. `mode` is $PSTYLEMODE (0 named, 1 colour-dependent).
 */
function drawing(version = ACadVersion.AC1032, mode = 0, format: CadFormat = 'dxf'): Uint8Array {
  const doc = new CadDocument(version);
  // The named-object dictionaries and their defaults (the Global, ByLayer and ByBlock materials).
  doc.updateCollections(true, true);
  doc.header!.plotStyleMode = mode;
  const normal = new AcdbPlaceHolder('Normal');
  const red = new AcdbPlaceHolder('Red pen');
  const names = new CadDictionaryWithDefault(CadDictionary.acadPlotStyleName);
  doc.rootDictionary!.add(names);
  names.add(normal);
  names.add(red);
  names.defaultEntry = normal;
  const steel = new Material('Steel');
  doc.materials!.add(steel);
  const line = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
  const circle = new Circle(new XYZ(5, 5, 0), 2);
  const tag = new BlockRecord('TAG');
  doc.blockRecords!.add(tag);
  const insert = new Insert(tag);
  insert.insertPoint = new XYZ(20, 0, 0);
  for (const e of [line, circle, insert]) doc.entities!.add(e);
  if (mode === 0) {
    circle.plotStyleType = EntityPlotStyleType.ByObjectId;
    circle.plotStyleName = red.handle;
  }
  if (version >= ACadVersion.AC1021) circle.material = steel;
  insert.attributes.length = 0;
  const a = new AttributeEntity();
  a.tag = 'NO';
  a.value = 'A-1';
  a.insertPoint = new XYZ(21, 1, 0);
  a.height = 1;
  a.layer = insert.layer;
  a.owner = insert;
  a.handle = doc.header!.handleSeed++;
  insert.attributes.push(a);
  insert.attributes.seqend = new Seqend(insert);
  insert.attributes.seqend.handle = doc.header!.handleSeed++;
  return writeCadDocument(doc, { format });
}

const FILE = drawing();
const DWG_FILE = drawing(ACadVersion.AC1032, 0, 'dwg');
interface Save {
  readonly format: CadFormat;
  readonly binary?: boolean;
  /** The file the save starts from, in the same format. */
  readonly file: Uint8Array;
}
const FORMATS: Save[] = [
  { format: 'dxf', file: FILE },
  { format: 'dxf', binary: true, file: FILE },
  { format: 'dwg', file: DWG_FILE },
];
const DWG = FORMATS[2]!;

const open = (bytes = FILE): DocumentModel =>
  DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const reopened = (bytes: Uint8Array): Map<string, EntityInit> =>
  new Map(documentInit(readCadDocument(bytes)).entities?.map((e) => [e.handle, e]));

const save = (model: DocumentModel, { file, ...options }: Save): Uint8Array =>
  exportDocument(readCadDocument(file), model, options);

const label = ({ format, binary }: Save): string => `${format}${binary ? ' binary' : ''}`;

const find = (model: DocumentModel, type: string): Entity =>
  [...model.entities()].find((e) => e.type === type)!;

/** The handle of the ACAD_PLOTSTYLENAME entry or MATERIAL called `name`. */
function named(bytes: Uint8Array, name: string): string {
  const doc = readCadDocument(bytes);
  const names = doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadPlotStyleName)!;
  const o = names.getEntry(name) ?? doc.materials?.tryGet(name);
  return o!.handle.toString(16).toUpperCase();
}

type InsertGeometry = Extract<EntityGeometry, { kind: 'INSERT' }>;

describe('triyaToAcad plot style names and materials', () => {
  it('reads the authored drawing as expected', () => {
    for (const { file } of FORMATS) {
      const model = open(file);
      const circle = find(model, 'CIRCLE');
      expect(circle.plotStyle).toBe(named(file, 'Red pen'));
      expect(find(model, 'LINE').plotStyle).toBeUndefined();
      expect(find(model, 'LINE').material).toBeUndefined();
    }
    expect(find(open(DWG_FILE), 'CIRCLE').material).toBe(named(DWG_FILE, 'Steel'));
  });

  it('writes a plot style name onto an entity, changes one and takes one off', () => {
    for (const options of FORMATS) {
      const { file } = options;
      const model = open(file);
      const line = find(model, 'LINE');
      const circle = find(model, 'CIRCLE');
      const insert = find(model, 'INSERT');
      edit(model, (b) => {
        b.updateEntity(line.id, { plotStyle: named(file, 'Normal') });
        b.updateEntity(insert.id, { plotStyle: named(file, 'Red pen') });
        b.updateEntity(circle.id, { plotStyle: undefined });
      });
      const back = reopened(save(model, options));

      const what = label(options);
      expect(back.get(line.handle)?.plotStyle, what).toBe(named(file, 'Normal'));
      expect(back.get(insert.handle)?.plotStyle, what).toBe(named(file, 'Red pen'));
      expect(back.get(circle.handle)?.plotStyle, what).toBeUndefined();
    }
  });

  it("writes an ATTRIB's plot style name and material", () => {
    for (const options of FORMATS) {
      const { file } = options;
      const model = open(file);
      const insert = find(model, 'INSERT');
      const g = insert.geom as InsertGeometry;
      const material = options === DWG ? named(file, 'Steel') : undefined;
      const attributes = g.attributes.map((a) => ({
        ...a,
        plotStyle: named(file, 'Red pen'),
        ...(material ? { material } : {}),
      }));
      edit(model, (b) => b.updateEntity(insert.id, { geom: { ...g, attributes } }));
      const back = reopened(save(model, options)).get(insert.handle)!.geom as InsertGeometry;

      expect(
        back.attributes.map((a) => [a.plotStyle, a.material]),
        label(options),
      ).toEqual([[named(file, 'Red pen'), material]]);
    }
  });

  it('writes materials: one of its own, ByBlock, and none (ByLayer)', () => {
    const model = open(DWG_FILE);
    const line = find(model, 'LINE');
    const circle = find(model, 'CIRCLE');
    const insert = find(model, 'INSERT');
    edit(model, (b) => {
      b.updateEntity(line.id, { material: named(DWG_FILE, 'Steel') });
      b.updateEntity(insert.id, { material: named(DWG_FILE, 'ByBlock') });
      b.updateEntity(circle.id, { material: undefined });
    });
    const back = reopened(save(model, DWG));

    expect(back.get(line.handle)?.material).toBe(named(DWG_FILE, 'Steel'));
    expect(back.get(insert.handle)?.material).toBe(named(DWG_FILE, 'ByBlock'));
    expect(back.get(circle.handle)?.material).toBeUndefined();
  });

  it('gives a copy its source’s plot style name and material', () => {
    for (const options of FORMATS) {
      const { file } = options;
      const model = open(file);
      const circle = find(model, 'CIRCLE');
      const { id: _id, handle: _handle, ...source } = circle;
      let handle = '';
      edit(model, (b) => {
        handle = b.addEntity(source).handle;
      });
      const back = reopened(save(model, options)).get(handle);

      expect([back?.plotStyle, back?.material], label(options)).toEqual([
        named(file, 'Red pen'),
        circle.material,
      ]);
    }
  });

  it('refuses what the drawing cannot hold', () => {
    const refusal = (file: Uint8Array, change: Partial<Entity>): string[] => {
      const model = open(file);
      const line = find(model, 'LINE');
      edit(model, (b) => b.updateEntity(line.id, change));
      try {
        save(model, { format: 'dwg', file });
      } catch (e) {
        if (e instanceof UnsupportedChangeError) return [...e.problems];
        throw e;
      }
      return [];
    };
    const colour = drawing(ACadVersion.AC1032, 1, 'dwg');
    expect(refusal(colour, { plotStyle: named(colour, 'Normal') })).toEqual([
      expect.stringMatching(/plot style name in a colour-dependent drawing \(\$PSTYLEMODE 1\)/),
    ]);
    const layer0 = [...open(DWG_FILE).tables.layers.values()][0]!.handle;
    expect(refusal(DWG_FILE, { plotStyle: layer0 })).toEqual([
      expect.stringMatching(new RegExp(`plot style ${layer0} is not in ACAD_PLOTSTYLENAME`)),
    ]);
    const r14 = drawing(ACadVersion.AC1014, 0, 'dwg');
    expect(refusal(r14, { plotStyle: named(r14, 'Normal') })).toEqual([
      expect.stringMatching(/AC1014 has no plot style names \(R2000 added them\)/),
    ]);
    // acad-ts gives every drawing the default materials, which an R2004 file has no place for.
    const r2004 = drawing(ACadVersion.AC1018, 0, 'dwg');
    expect(refusal(r2004, { material: named(r2004, 'Global') })).toEqual([
      expect.stringMatching(/AC1018 has no materials \(R2007 added them\)/),
    ]);
  });
});
