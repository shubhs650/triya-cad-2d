// Layer filters (M5-07 part 4, DEC-076): what the reader maps from `ACLYDICTIONARY` and what the
// save refuses. The drawing is authored in memory with acad-ts; the corpus-wide round trip is
// packages/testkit/src/export/layer-filters.corpus.test.ts.
import {
  ACadVersion,
  CadDictionary,
  DxfWriter,
  Layer,
  XRecord,
  type CadDocument,
} from '@node-projects/acad-ts';
import {
  DocumentModel,
  filteredLayers,
  layerFilterNamed,
  layerFilters,
  newLayerFilterChange,
  type ChangeSet,
  type LayerFilter,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  ACLYDICTIONARY,
  documentInit,
  exportDocument,
  readCadDocument,
  UnsupportedChangeError,
} from '../src/index';
import { ascii, sampleDocument, sampleDxf } from './fixtures';

const apply = (model: DocumentModel, change: ChangeSet | string): void => {
  if (typeof change === 'string') throw new Error(change);
  model.apply(change);
};

const modelOf = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

function dxf(doc: CadDocument): Uint8Array {
  const chunks: string[] = [];
  DxfWriter.writeToStream({ write: (s: string) => void chunks.push(s) }, doc);
  return ascii(chunks.join(''));
}

function record(groups: [number, unknown][]): XRecord {
  const x = new XRecord();
  for (const [code, value] of groups) x.createEntry(code, value as never);
  return x;
}

/** A drawing with AutoCAD's filters: a property filter, a group with a nested filter, a custom. */
function filtersDocument(): CadDocument {
  const doc = sampleDocument(ACadVersion.AC1032);
  const a = new Layer('A-WALL');
  const b = new Layer('B-DOOR');
  doc.layers!.add(a);
  doc.layers!.add(b);
  const top = new CadDictionary();
  doc.layers!.createExtendedDictionary().addByKey(ACLYDICTIONARY, top);
  top.addByKey(
    '*A1',
    record([
      [1, 'AcLyLayerFilter'],
      [90, 1],
      [300, 'Walls'],
      [301, '( NAME== "A*" )'],
    ]),
  );
  const group = record([
    [1, 'AcLyLayerGroup'],
    [90, 1],
    [300, 'Doors'],
    [330, b],
    [330, a],
  ]);
  top.addByKey('*A2', group);
  top.addByKey(
    '*A3',
    record([
      [1, 'SomeAppFilter'],
      [300, 'Custom'],
    ]),
  );
  const nested = new CadDictionary();
  group.createExtendedDictionary().addByKey(ACLYDICTIONARY, nested);
  nested.addByKey(
    '*A1',
    record([
      [1, 'AcLyLayerFilter'],
      [90, 1],
      [300, 'B only'],
      [301, 'NAME=="B*"'],
    ]),
  );
  return doc;
}

describe('reading layer filters', () => {
  it('maps property and group filters, nested ones under their parent, not other classes', () => {
    const model = modelOf(dxf(filtersDocument()));
    expect(model.meta.layerFilterDictionary).toBeDefined();
    const byName = (n: string) => layerFilterNamed(model, n)!;
    expect(layerFilters(model).map((f) => f.name)).toEqual(['B only', 'Doors', 'Walls']);
    const layer = (name: string) =>
      [...model.tables.layers.values()].find((l) => l.name === name)!.handle;
    expect(byName('Walls')).toMatchObject({
      type: 'LAYER_FILTER',
      owner: model.meta.layerFilterDictionary,
      filterType: 'property',
      expression: '( NAME== "A*" )',
      layers: [],
    });
    expect(byName('Doors')).toMatchObject({
      filterType: 'group',
      expression: '',
      layers: [layer('B-DOOR'), layer('A-WALL')],
    });
    const nested = byName('B only');
    expect(nested.parent).toBe(byName('Doors').handle);
    expect(nested.owner).toBe(byName('Doors').nested);
    expect(filteredLayers(model, nested.handle).map((l) => l.name)).toEqual(['B-DOOR']);
    expect(filteredLayers(model, byName('Walls').handle).map((l) => l.name)).toEqual(['A-WALL']);
  });
});

describe('saving layer filters', () => {
  it('makes ACLYDICTIONARY and its owner for the first filter of a drawing without them', () => {
    const bytes = sampleDxf(ACadVersion.AC1032);
    const model = modelOf(bytes);
    expect(model.meta.layerFilterDictionary).toBeUndefined();
    apply(model, newLayerFilterChange(model, { name: 'Group', filterType: 'group' }));
    const g = layerFilterNamed(model, 'Group')!;
    apply(
      model,
      newLayerFilterChange(model, { name: 'Off', expression: 'ON==False', parent: g.handle }),
    );
    const back = modelOf(exportDocument(readCadDocument(bytes), model, { format: 'dxf' }));
    const got = layerFilters(back);
    expect(got.map((f) => [f.name, f.handle, f.owner, f.parent])).toEqual(
      layerFilters(model).map((f) => [f.name, f.handle, f.owner, f.parent]),
    );
    expect(back.meta.layerFilterDictionary).toBe(g.owner);
    expect(layerFilterNamed(back, 'Group')!.nested).toBe(layerFilterNamed(model, 'Group')!.nested);
  });

  it('refuses what it cannot write, before changing anything', () => {
    const bytes = sampleDxf(ACadVersion.AC1032);
    const model = modelOf(bytes);
    apply(model, newLayerFilterChange(model, { name: 'Walls', expression: 'NAME=="W*"' }));
    const f = layerFilterNamed(model, 'Walls')!;
    // Filed in a dictionary that is not ACLYDICTIONARY.
    const moved: LayerFilter = {
      ...f,
      name: 'Moved',
      handle: model.handles.allocate(),
      owner: '1',
    };
    model.apply({ objects: { added: [moved] } } as ChangeSet);
    const refusal = (): string => {
      try {
        exportDocument(readCadDocument(bytes), model, { format: 'dxf' });
      } catch (e) {
        if (e instanceof UnsupportedChangeError) return e.problems.join('\n');
        throw e;
      }
      return '';
    };
    expect(refusal()).toMatch(/is not filed in ACLYDICTIONARY/);
    // Before R2000 there are no XRECORDs to keep them in.
    const r14 = sampleDocument(ACadVersion.AC1014);
    const m14 = DocumentModel.create(documentInit(r14));
    apply(m14, newLayerFilterChange(m14, { name: 'Walls', expression: 'NAME=="W*"' }));
    expect(() =>
      exportDocument(sampleDocument(ACadVersion.AC1014), m14, { format: 'dxf' }),
    ).toThrow(/older than R2000/);
  });
});
