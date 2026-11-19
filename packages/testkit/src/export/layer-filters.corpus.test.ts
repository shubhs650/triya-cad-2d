// Layer filters (M5-07 part 4, DEC-076): read from and saved to the LAYER table's
// `ACLYDICTIONARY`, nested filters in their parent's, as AutoCAD 2005+ keeps them.
// sample_AC1032_ascii.dxf holds AutoCAD's own `ACLYDICTIONARY` with no filters (only its `ACAD`
// xdata `<All`), so the sample shows a save adding filters beside what AutoCAD wrote.
//
// On every readable public corpus file: a property filter, a group filter of two layers and a
// property filter nested in it are added, the drawing saved as AC1032 DXF (DEC-047) and read back.
// The filters read back as saved, in the drawing's ACLYDICTIONARY or one the save makes. On the
// sample, the filters are then renamed, redefined, emptied of a deleted layer and deleted through
// the same round trip, and the filter menu's Convert to Group Filter (the record keeps its handle
// and key, now an AcLyLayerGroup) and Isolate Group in a layout (the viewport's 341s) (part 6).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CadDictionary } from '@node-projects/acad-ts';
import { CadObject, XRecord, type CadDocument } from '@node-projects/acad-ts';
import {
  DocumentModel,
  convertLayerFilterChange,
  deleteLayerFilterChange,
  deleteLayersChange,
  editLayerFilterChange,
  filteredLayers,
  isolateFilterChange,
  layerFilterNamed,
  layerFilters,
  newLayerChange,
  newLayerFilterChange,
  type ChangeSet,
  type LayerFilter,
} from '@triya/engine';
import { ACLYDICTIONARY, documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { eachCorpusFile } from '../corpus/each-file.ts';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);
const SAMPLE_PATH = 'third-party/acadsharp/sample_AC1032_ascii.dxf';
const SAMPLE = `${corpusDir}public/${SAMPLE_PATH}`;
/** The drawing without ACLYDICTIONARY whose save the ezdxf audit checks (audit.py). */
const NO_FILTERS = 'third-party/ezdxf/examples_dxf/colors.dxf';

const apply = (model: DocumentModel, change: ChangeSet | string): void => {
  if (typeof change === 'string') throw new Error(change);
  model.apply(change);
};

/** A filter as the Layer Properties Manager shows it: its parent by name. */
function shown(model: DocumentModel) {
  return layerFilters(model).map((f) => ({
    name: f.name,
    filterType: f.filterType,
    expression: f.expression,
    layers: f.layers,
    parent: f.parent && (model.objects.get(f.parent) as LayerFilter).name,
    lists: filteredLayers(model, f.handle).map((l) => l.handle),
  }));
}

/** The XRECORDs of `dict` (an ACLYDICTIONARY), their groups as text, pointers as handles. */
function rawFilters(dict: CadDictionary | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [i, key] of (dict?.entryNames ?? []).entries()) {
    const x = [...dict!][i];
    if (!(x instanceof XRecord)) continue;
    out.set(
      key,
      x.entries.map((e) => {
        const v = e.value instanceof CadObject ? e.value.handle.toString(16) : String(e.value);
        return `${e.code}=${v}`;
      }),
    );
  }
  return out;
}

const topDictionary = (doc: CadDocument) =>
  doc.layers?.xDictionary?.getEntry(ACLYDICTIONARY) as CadDictionary | undefined;

/** The layers frozen in viewport `handle` (DXF 341). */
function viewportFrozen(model: DocumentModel, handle: string): readonly string[] {
  const g = model.entityByHandle(handle)?.geom;
  if (g?.kind !== 'VIEWPORT') throw new Error(`${handle} is not a viewport`);
  return g.frozenLayers;
}

function reopen(bytes: Uint8Array, model: DocumentModel) {
  const saved = saveAc1032Dxf(readCadDocument(bytes), model);
  const doc = readCadDocument(saved);
  return { saved, doc, model: DocumentModel.create(documentInit(doc)) };
}

/** Adds the three filters every file gets: Walls, Pair (two layers) and Pair's Off. */
function addFilters(
  model: DocumentModel,
  layers = [...model.tables.layers.values()].slice(0, 2),
): void {
  apply(
    model,
    newLayerFilterChange(model, { name: 'Walls', expression: 'NAME=="W*" OR COLOR=="1"' }),
  );
  apply(
    model,
    newLayerFilterChange(model, {
      name: 'Pair',
      filterType: 'group',
      layers: layers.map((l) => l.handle),
    }),
  );
  apply(
    model,
    newLayerFilterChange(model, {
      name: 'Off',
      expression: 'ON=="False"',
      parent: layerFilterNamed(model, 'Pair')!.handle,
    }),
  );
}

describe('sample_AC1032_ascii.dxf', () => {
  it('reads AutoCAD’s empty ACLYDICTIONARY as where new filters go', () => {
    const model = DocumentModel.create(documentInit(readCadDocument(readFileSync(SAMPLE))));
    expect(model.meta.layerFilterDictionary).toBe('28F');
    expect(layerFilters(model)).toEqual([]);
  });

  it('saves filters as AutoCAD files them, then their edits and deletes', () => {
    const bytes = new Uint8Array(readFileSync(SAMPLE));
    const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
    // Pair holds two new layers, which Delete Layer may delete.
    apply(model, newLayerChange(model, undefined, 'Pair A'));
    apply(model, newLayerChange(model, undefined, 'Pair B'));
    const deletable = [...model.tables.layers.values()].filter((l) => l.name.startsWith('Pair'));
    addFilters(model, deletable.slice(0, 2));
    const pair = layerFilterNamed(model, 'Pair')!;
    let back = reopen(bytes, model);
    writeAuditSave(SAMPLE_PATH, 'layerfilters', () => back.saved);
    expect(shown(back.model)).toEqual(shown(model));
    const top = topDictionary(back.doc)!;
    expect(top.handle.toString(16).toUpperCase()).toBe('28F');
    const raw = rawFilters(top);
    expect([...raw.keys()]).toEqual(['*A1', '*A2']);
    expect(raw.get('*A1')).toEqual([
      '1=AcLyLayerFilter',
      '90=1',
      '300=Walls',
      '301=NAME=="W*" OR COLOR=="1"',
    ]);
    expect(raw.get('*A2')).toEqual([
      '1=AcLyLayerGroup',
      '90=1',
      '300=Pair',
      ...pair.layers.map((h) => `330=${h.toLowerCase()}`),
    ]);
    // Off is filed in the ACLYDICTIONARY of Pair's extension dictionary.
    const pairRecord = [...top][1] as XRecord;
    const nested = pairRecord.xDictionary?.getEntry(ACLYDICTIONARY) as CadDictionary;
    expect(rawFilters(nested).get('*A1')).toEqual([
      '1=AcLyLayerFilter',
      '90=1',
      '300=Off',
      '301=ON=="False"',
    ]);

    // Renamed, redefined, a layer of Pair deleted, Off deleted; Walls keeps its record.
    const m = back.model;
    const walls = layerFilterNamed(m, 'Walls')!;
    apply(m, editLayerFilterChange(m, walls.handle, { name: 'Red', expression: 'COLOR=="red"' }));
    apply(m, deleteLayerFilterChange(m, layerFilterNamed(m, 'Off')!.handle));
    const gone = pair.layers[0]!;
    apply(m, deleteLayersChange(m, [gone]));
    const again = reopen(back.saved, m);
    expect(shown(again.model)).toEqual(shown(m));
    expect(layerFilterNamed(again.model, 'Red')).toMatchObject({
      handle: walls.handle,
      expression: 'COLOR=="red"',
    });
    expect(layerFilterNamed(again.model, 'Pair')!.layers).not.toContain(gone);
    expect(layerFilterNamed(again.model, 'Off')).toBeUndefined();

    // Pair deleted: the dictionary keeps Red only.
    back = again;
    apply(
      back.model,
      deleteLayerFilterChange(back.model, layerFilterNamed(back.model, 'Pair')!.handle),
    );
    const last = reopen(back.saved, back.model);
    expect(layerFilters(last.model).map((f) => f.name)).toEqual(['Red']);
  });
});

describe('the filter menu’s edits on sample_AC1032_ascii.dxf (M5-07 part 6)', () => {
  it('saves Convert to Group Filter in the same record and Isolate Group in the viewports', () => {
    const bytes = new Uint8Array(readFileSync(SAMPLE));
    const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
    addFilters(model);
    const first = reopen(bytes, model);
    const m = first.model;
    const walls = layerFilterNamed(m, 'Walls')!;
    const listed = filteredLayers(m, walls.handle).map((l) => l.handle);
    apply(m, convertLayerFilterChange(m, walls.handle));
    // Isolate Group in Layout1 (block 58): the layers not in Pair frozen in its viewport 245.
    const pair = layerFilterNamed(m, 'Pair')!;
    apply(m, isolateFilterChange(m, pair.handle, '58'));
    const frozen = viewportFrozen(m, '245');
    expect(frozen.length).toBe(m.tables.layers.size - pair.layers.length);
    const back = reopen(first.saved, m);
    writeAuditSave(SAMPLE_PATH, 'layerfilters-menu', () => back.saved);
    expect(shown(back.model)).toEqual(shown(m));
    expect(layerFilterNamed(back.model, 'Walls')).toMatchObject({
      handle: walls.handle,
      filterType: 'group',
      expression: '',
      layers: listed,
    });
    const raw = rawFilters(topDictionary(back.doc));
    expect(raw.get('*A1')).toEqual([
      '1=AcLyLayerGroup',
      '90=1',
      '300=Walls',
      ...listed.map((h) => `330=${h.toLowerCase()}`),
    ]);
    expect(viewportFrozen(back.model, '245')).toEqual(frozen);
    expect(viewportFrozen(back.model, '240')).toEqual([]);
  });
});

describe('new layer filters save and read back on every corpus file', () => {
  let made = 0;
  let had = 0;
  eachCorpusFile(
    readable,
    (f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      withPinnedClock(() => {
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        if ([...model.tables.layers.values()].length < 2) return;
        addFilters(model);
        const back = reopen(bytes, model);
        if (f.path === `public/${NO_FILTERS}`)
          writeAuditSave(NO_FILTERS, 'layerfilters', () => back.saved);
        expect(shown(back.model), f.path).toEqual(shown(model));
        const top = layerFilterNamed(back.model, 'Walls')!.owner;
        expect(back.model.meta.layerFilterDictionary, f.path).toBe(top);
        if (model.meta.layerFilterDictionary === undefined) made++;
        else had++;
      });
    },
    () => {
      // Floors at the time of writing (M5-07 part 4): a corpus file added later only raises them.
      expect(made).toBeGreaterThanOrEqual(10);
      expect(had).toBeGreaterThanOrEqual(1);
    },
  );
});
