// M5-19: an xref load evaluates the xref's layers for new ones (AutoCAD 2024 Help, "LAYEREVAL",
// "About Reconciling New Layers"): with LAYEREVAL 1 or 2, a layer the xref brings in that the
// layer list did not have when it was last evaluated is unreconciled until the drafter
// reconciles it.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  withoutXrefContent,
  xrefLoadChange,
  type DocumentInit,
  type HeaderValue,
  type LayerRecord,
} from '../../src/index';
import { blockRecord, entityInit, layer, lineGeom, linetype, sampleInit } from './fixtures';

const XREF = '30';

/** The sample drawing with an attached xref CHILD (child.dxf), LAYEREVAL `evaluate`. */
function hostInit(evaluate?: string, extraLayers: LayerRecord[] = []): DocumentInit {
  const s = sampleInit();
  return {
    ...s,
    header: new Map<string, HeaderValue>([
      ...(s.header ?? []),
      ...(evaluate === undefined ? [] : ([['LAYEREVAL', evaluate]] as const)),
    ]),
    tables: {
      ...s.tables,
      layers: [...(s.tables?.layers ?? []), ...extraLayers],
      blockRecords: [
        ...(s.tables?.blockRecords ?? []),
        { ...blockRecord(XREF, 'CHILD'), flags: 4 },
      ],
    },
    blocks: [
      ...(s.blocks ?? []),
      { handle: XREF, name: 'CHILD', basePoint: { x: 0, y: 0 }, xrefPath: 'child.dxf' },
    ],
  };
}

/** The xref's file: layers 0, WALLS and ROOF (and `more`), a line on each. */
function childInit(more: string[] = []): DocumentInit {
  const names = ['0', 'WALLS', 'ROOF', ...more];
  const handles = names.map((_, i) => (0x10 + i).toString(16).toUpperCase());
  return {
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '60',
    tables: {
      layers: names.map((n, i) => layer(handles[i]!, n)),
      linetypes: [linetype('1C', 'Continuous')],
      blockRecords: [blockRecord('1F', '*Model_Space')],
    },
    blocks: [{ handle: '1F', name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
    entities: handles.map((h, i) =>
      entityInit((0x40 + i).toString(16).toUpperCase(), lineGeom(0, i, 10, i), {
        layer: h,
        owner: '1F',
      }),
    ),
  };
}

/** The drawing's unreconciled layers, by name. */
const unreconciled = (model: DocumentModel) =>
  [...model.tables.layers.values()]
    .filter((l) => l.unreconciled)
    .map((l) => l.name)
    .sort();

const loadedLayers = (model: DocumentModel) =>
  [...model.tables.layers.values()].filter((l) => l.name.startsWith('CHILD|')).map((l) => l.name);

describe('xrefLoadChange: unreconciled new layers (M5-19)', () => {
  it('flags nothing while LAYEREVAL is 0 or absent, even for XATTACH', () => {
    for (const evaluate of [undefined, '0']) {
      const model = DocumentModel.create(hostInit(evaluate));
      model.apply(xrefLoadChange(model, XREF, childInit(), { attach: true }));
      expect(loadedLayers(model)).toEqual(['CHILD|WALLS', 'CHILD|ROOF']);
      expect(unreconciled(model)).toEqual([]);
    }
  });

  it("XATTACH's load flags every layer the xref brings in (LAYEREVAL 1 and 2)", () => {
    for (const evaluate of ['1', '2']) {
      const model = DocumentModel.create(hostInit(evaluate));
      model.apply(xrefLoadChange(model, XREF, childInit(), { attach: true }));
      // Layer 0 is the host's own.
      expect(unreconciled(model)).toEqual(['CHILD|ROOF', 'CHILD|WALLS']);
    }
  });

  it('takes the layers of a drawing opened with no record of them as the baseline', () => {
    const model = DocumentModel.create(hostInit('1'));
    model.apply(xrefLoadChange(model, XREF, childInit()));
    expect(loadedLayers(model)).toHaveLength(2);
    expect(unreconciled(model)).toEqual([]);
  });

  it("flags the layers new to the drawing's own records of the xref's layers (VISRETAIN)", () => {
    const kept = { ...layer('50', 'CHILD|WALLS'), flags: 48 };
    const model = DocumentModel.create(hostInit('1', [kept]));
    model.apply(xrefLoadChange(model, XREF, childInit()));
    expect(model.tables.layers.get('50')?.unreconciled).toBeUndefined();
    expect(unreconciled(model)).toEqual(['CHILD|ROOF']);
  });
});

describe('xref reload: the layers new since the last load (M5-19)', () => {
  function session(evaluate = '1') {
    const s = new EngineSession(hostInit(evaluate));
    const load = (more: string[] = []) => {
      const r = s.edit({ kind: 'xref-load', block: XREF, drawing: childInit(more) });
      expect(r.ok).toBe(true);
    };
    const reload = (more: string[] = []) => {
      expect(s.edit({ kind: 'xref-unload', block: XREF, reload: true }).ok).toBe(true);
      load(more);
    };
    return { s, model: s.model, load, reload };
  }

  it('flags a layer the xref gained since it was last loaded, until it is reconciled', () => {
    const t = session();
    t.load();
    expect(unreconciled(t.model)).toEqual([]);
    t.reload(['GLASS']);
    expect(unreconciled(t.model)).toEqual(['CHILD|GLASS']);
    // Still new at the next reload, as nobody reconciled it.
    t.reload(['GLASS']);
    expect(unreconciled(t.model)).toEqual(['CHILD|GLASS']);
    const glass = [...t.model.tables.layers.values()].find((l) => l.name === 'CHILD|GLASS')!;
    expect(t.s.edit({ kind: 'layer', layer: glass.handle, reconcile: true }).ok).toBe(true);
    expect(unreconciled(t.model)).toEqual([]);
    t.reload(['GLASS', 'SITE']);
    expect(unreconciled(t.model)).toEqual(['CHILD|SITE']);
  });

  it('keeps the layers the reload is waiting with out of the save', () => {
    const t = session();
    t.load();
    expect(t.s.edit({ kind: 'xref-unload', block: XREF, reload: true }).ok).toBe(true);
    expect(t.model.blocks.get(XREF)?.xrefLayers).toEqual({
      'CHILD|WALLS': false,
      'CHILD|ROOF': false,
    });
    expect(withoutXrefContent(t.model).blocks.get(XREF)?.xrefLayers).toBeUndefined();
    t.load();
    expect(t.model.blocks.get(XREF)?.xrefLayers).toBeUndefined();
  });

  it('flags nothing at a reload while LAYEREVAL is 0', () => {
    const t = session('0');
    t.load();
    t.reload(['GLASS']);
    expect(unreconciled(t.model)).toEqual([]);
  });
});
