// TriyaToAcad for materials renamed and plot style names added (M1-75 part 33).
//
// A material is renamed as RENAME (Materials) and the Materials Browser's Rename do: the
// MATERIAL's name (DXF 1) and its ACAD_MATERIAL entry change, its handle and definition stay, and
// everything using it follows by handle. A plot style name joins a named-plot-style drawing
// ($PSTYLEMODE 0) as AutoCAD adds one when a layer or object is given a style of the attached
// plot style table: an ACDBPLACEHOLDER in ACAD_PLOTSTYLENAME. Drawings are authored in memory with
// acad-ts and saved once, so "the file" is real bytes. acad-ts writes a MATERIAL to DXF only from
// the group codes it read, so materials are saved here from the DWG, and to DXF by the corpus-wide
// edit in packages/testkit/src/export/export-materials-plot-styles.corpus.test.ts.
import {
  ACadVersion,
  AcdbPlaceHolder,
  CadDictionary,
  CadDictionaryWithDefault,
  CadDocument,
  Circle,
  EntityPlotStyleType,
  Line,
  Material,
  XYZ,
} from '@node-projects/acad-ts';
import { ChangeSetBuilder, DocumentModel, type Entity, type TableName } from '@triya/engine';
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
 * the materials Steel and Brass, and in model space a LINE and a CIRCLE plotted with Red pen and
 * made of Steel (from R2007). `mode` is $PSTYLEMODE (0 named, 1 colour-dependent).
 */
function drawing(version = ACadVersion.AC1032, mode = 0, format: CadFormat = 'dwg'): Uint8Array {
  const doc = new CadDocument(version);
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
  doc.materials!.add(new Material('Brass'));
  const line = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
  const circle = new Circle(new XYZ(5, 5, 0), 2);
  for (const e of [line, circle]) doc.entities!.add(e);
  if (mode === 0) {
    circle.plotStyleType = EntityPlotStyleType.ByObjectId;
    circle.plotStyleName = red.handle;
  }
  if (version >= ACadVersion.AC1021) circle.material = steel;
  return writeCadDocument(doc, { format });
}

const DWG_FILE = drawing();
const DXF_FILE = drawing(ACadVersion.AC1032, 0, 'dxf');
interface Save {
  readonly format: CadFormat;
  readonly binary?: boolean;
  /** The file the save starts from, in the same format. */
  readonly file: Uint8Array;
}
const FORMATS: Save[] = [
  { format: 'dxf', file: DXF_FILE },
  { format: 'dxf', binary: true, file: DXF_FILE },
  { format: 'dwg', file: DWG_FILE },
];
const DWG = FORMATS[2]!;

const open = (bytes: Uint8Array): DocumentModel =>
  DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const save = (model: DocumentModel, { file, ...options }: Save): Uint8Array =>
  exportDocument(readCadDocument(file), model, options);

const label = ({ format, binary }: Save): string => `${format}${binary ? ' binary' : ''}`;

const find = (model: DocumentModel, type: string): Entity =>
  [...model.entities()].find((e) => e.type === type)!;

/** The handle of the record of `table` called `name` in `model`. */
const named = (model: DocumentModel, table: TableName, name: string): string =>
  [...model.tables[table].values()].find((r) => r.name === name)!.handle;

/** Why a save of `file` with the edit `f` is refused. */
function refused(
  f: (b: ChangeSetBuilder, model: DocumentModel) => void,
  file = DWG_FILE,
  format: CadFormat = 'dwg',
): string[] {
  const model = open(file);
  edit(model, (b) => f(b, model));
  try {
    exportDocument(readCadDocument(file), model, { format });
  } catch (e) {
    if (e instanceof UnsupportedChangeError) return [...e.problems];
    throw e;
  }
  return [];
}

/** The ACAD_PLOTSTYLENAME dictionary's entries as `name → handle`, and its default's name. */
function plotStyleDictionary(bytes: Uint8Array): {
  entries: string[];
  default: string | undefined;
} {
  const doc = readCadDocument(bytes);
  const dict = doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadPlotStyleName)!;
  const handles = [...dict].map((o) => o.handle.toString(16).toUpperCase());
  return {
    entries: dict.entryNames.map((n, i) => `${n} ${handles[i]}`),
    default:
      dict instanceof CadDictionaryWithDefault
        ? dict.defaultEntry?.handle.toString(16).toUpperCase()
        : undefined,
  };
}

describe('triyaToAcad plot style names added (M1-75 part 33)', () => {
  it('adds a plot style name that a layer and an entity use in the same save', () => {
    for (const options of FORMATS) {
      const model = open(options.file);
      const normal = named(model, 'plotStyles', 'Normal');
      const line = find(model, 'LINE');
      const layer0 = named(model, 'layers', '0');
      let blue = '';
      edit(model, (b) => {
        blue = b.addTableRecord('plotStyles', { name: 'Blue pen' }).handle;
        b.updateEntity(line.id, { plotStyle: blue });
        b.updateTableRecord('layers', layer0, { plotStyle: blue });
      });
      const bytes = save(model, options);
      const what = label(options);

      const dict = plotStyleDictionary(bytes);
      expect(dict.entries, what).toEqual([
        `Normal ${normal}`,
        `Red pen ${named(model, 'plotStyles', 'Red pen')}`,
        `Blue pen ${blue}`,
      ]);
      expect(dict.default, what).toBe(normal);
      const back = open(bytes);
      expect(back.tables.plotStyles.get(blue)?.name, what).toBe('Blue pen');
      expect(find(back, 'LINE').plotStyle, what).toBe(blue);
      expect(back.tables.layers.get(layer0)?.plotStyle, what).toBe(blue);
    }
  });

  it('adds two plot style names, and purges one in the same save', () => {
    const model = open(DWG_FILE);
    const red = named(model, 'plotStyles', 'Red pen');
    const circle = find(model, 'CIRCLE');
    let blue = '';
    let green = '';
    edit(model, (b) => {
      b.updateEntity(circle.id, { plotStyle: undefined });
      b.removeTableRecord('plotStyles', red);
      blue = b.addTableRecord('plotStyles', { name: 'Blue pen' }).handle;
      green = b.addTableRecord('plotStyles', { name: 'Green pen' }).handle;
    });
    const back = open(save(model, DWG));
    expect([...back.tables.plotStyles.values()].map((s) => [s.name, s.handle])).toEqual([
      ['Normal', named(model, 'plotStyles', 'Normal')],
      ['Blue pen', blue],
      ['Green pen', green],
    ]);
  });

  it('refuses what AutoCAD does not do to plot style names', () => {
    const addBlue = (b: ChangeSetBuilder): void => {
      b.addTableRecord('plotStyles', { name: 'Blue pen' });
    };
    expect(refused(addBlue, drawing(ACadVersion.AC1032, 1))).toEqual([
      expect.stringMatching(
        /^plot style Blue pen \([0-9A-F]+\): .*colour-dependent drawing \(\$PSTYLEMODE 1\)/,
      ),
    ]);
    expect(refused(addBlue, drawing(ACadVersion.AC1014, 0))).toEqual([
      expect.stringMatching(/^plot style Blue pen \([0-9A-F]+\): AC1014 has no plot style names/),
    ]);
    expect(
      refused((b, m) =>
        b.updateTableRecord('plotStyles', named(m, 'plotStyles', 'Red pen'), {
          name: 'Pen 1',
        }),
      ),
    ).toEqual([
      expect.stringMatching(
        /^plot style Pen 1 \([0-9A-F]+\): renaming a plot style name: .*plot style table/,
      ),
    ]);
    expect(
      refused((b, m) =>
        b.updateTableRecord('plotStyles', named(m, 'plotStyles', 'Normal'), { name: 'Plain' }),
      ),
    ).toEqual([expect.stringMatching(/^plot style Plain \([0-9A-F]+\): Normal cannot be renamed/)]);
    expect(
      refused((b) => {
        b.addTableRecord('plotStyles', { name: 'red PEN' });
      }),
    ).toEqual([
      expect.stringMatching(/^plot style red PEN \([0-9A-F]+\): another plot style is named/),
    ]);
    expect(
      refused((b, m) => {
        b.updateEntity(find(m, 'CIRCLE').id, { plotStyle: undefined });
        b.removeTableRecord('plotStyles', named(m, 'plotStyles', 'Red pen'));
        b.addTableRecord('plotStyles', { name: 'RED PEN' });
      }),
    ).toEqual([
      expect.stringMatching(/^plot style RED PEN \([0-9A-F]+\): .* purged by the same save/),
    ]);
    expect(
      refused((b) => {
        b.addTableRecord('plotStyles', { name: 'Bad|name' });
      }),
    ).toEqual([expect.stringMatching(/"Bad\|name" is not a valid plot style name/)]);
  });
});

describe('triyaToAcad materials renamed (M1-75 part 33)', () => {
  it('renames a material where it stands, and what uses it follows', () => {
    const model = open(DWG_FILE);
    const steel = named(model, 'materials', 'Steel');
    const layer0 = named(model, 'layers', '0');
    edit(model, (b) => {
      b.updateTableRecord('materials', steel, { name: 'Stainless steel' });
      b.updateTableRecord('layers', layer0, { material: steel });
    });
    const bytes = save(model, DWG);

    const doc = readCadDocument(bytes);
    const dict = doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadMaterial)!;
    const byName = new Map(dict.entryNames.map((n, i) => [n, [...dict][i]!]));
    const renamed = byName.get('Stainless steel') as Material;
    expect(renamed.handle.toString(16).toUpperCase()).toBe(steel);
    expect(renamed.name).toBe('Stainless steel');
    expect(byName.has('Steel')).toBe(false);
    // The dictionary keeps its order: the entry stays where it was.
    expect(dict.entryNames).toEqual(
      readCadDocument(DWG_FILE)
        .rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadMaterial)!
        .entryNames.map((n) => (n === 'Steel' ? 'Stainless steel' : n)),
    );
    const back = open(bytes);
    expect(back.tables.materials.get(steel)?.name).toBe('Stainless steel');
    expect(find(back, 'CIRCLE').material).toBe(steel);
    expect(back.tables.layers.get(layer0)?.material).toBe(steel);
  });

  it('lets two materials swap names', () => {
    const model = open(DWG_FILE);
    const steel = named(model, 'materials', 'Steel');
    const brass = named(model, 'materials', 'Brass');
    edit(model, (b) => {
      b.updateTableRecord('materials', steel, { name: 'Brass' });
      b.updateTableRecord('materials', brass, { name: 'Steel' });
    });
    const back = open(save(model, DWG));
    expect([
      back.tables.materials.get(steel)?.name,
      back.tables.materials.get(brass)?.name,
    ]).toEqual(['Brass', 'Steel']);
  });

  it('refuses what AutoCAD does not do to materials', () => {
    for (const fixed of ['Global', 'ByLayer', 'ByBlock']) {
      expect(
        refused((b, m) =>
          b.updateTableRecord('materials', named(m, 'materials', fixed), { name: 'Mine' }),
        ),
        fixed,
      ).toEqual([
        expect.stringMatching(
          new RegExp(`^material Mine \\([0-9A-F]+\\): ${fixed} cannot be renamed`),
        ),
      ]);
    }
    expect(
      refused((b, m) =>
        b.updateTableRecord('materials', named(m, 'materials', 'Steel'), { name: 'BRASS' }),
      ),
    ).toEqual([
      expect.stringMatching(/^material BRASS \([0-9A-F]+\): another material is named BRASS/),
    ]);
    expect(
      refused((b) => {
        b.addTableRecord('materials', { name: 'Copper' });
      }),
    ).toEqual([
      expect.stringMatching(/^material Copper \([0-9A-F]+\): a new material: .*definition/),
    ]);
  });
});
