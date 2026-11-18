// M5-07 part 4: layer filters (the Layer Properties Manager's filter tree), as the engine keeps
// and evaluates them. A property filter lists the layers its expression matches; a group filter
// the layers put in it; a nested filter only layers its parent lists; Invert filter the others.
// New, Rename, edits and Delete are one LAYER undo step each; a deleted layer leaves its groups.
import { describe, expect, it } from 'vitest';
import {
  EngineSession,
  filteredLayers,
  layerFilterDictionary,
  layerFilterMatches,
  layerFilterNamed,
  layerFilters,
  parseLayerFilterExpression,
  type DocumentInit,
  type LayerFilter,
  type LayerRecord,
} from '../../src/index';
import { LAYER_0, LAYER_WALLS, layer, linetype, sampleInit } from '../model/fixtures';

const LAYER_DOORS = '12';
const LAYER_A_WIN = '13';
const DASHED = '16';
const FILTERS = '50';

function filtersInit(withDictionary = true): DocumentInit {
  const init = sampleInit();
  return {
    ...init,
    meta: { ...init.meta, ...(withDictionary ? { layerFilterDictionary: FILTERS } : {}) },
    tables: {
      ...init.tables,
      layers: [
        ...init.tables!.layers!,
        { ...layer(LAYER_DOORS, 'Doors'), color: { kind: 'aci', index: 1 }, linetype: DASHED },
        {
          ...layer(LAYER_A_WIN, 'A-WIN'),
          on: false,
          locked: true,
          lineweight: 25,
          transparency: { alpha: 127 },
          description: 'Windows',
        },
      ],
      linetypes: [...init.tables!.linetypes!, linetype(DASHED, 'DASHED')],
    },
    passthrough: [...(init.passthrough ?? []), ...(withDictionary ? [FILTERS] : [])],
  };
}

const filterOf = (s: EngineSession, name: string): LayerFilter => layerFilterNamed(s.model, name)!;
const names = (layers: readonly LayerRecord[]) => layers.map((l) => l.name);
const ok = (r: { ok: boolean; message?: string }) => expect(r).toMatchObject({ ok: true });

describe('layer filter expressions (M5-07 part 4)', () => {
  const s = new EngineSession(filtersInit());
  const tables = s.model;
  const doors = s.model.tables.layers.get(LAYER_DOORS)!;
  const win = s.model.tables.layers.get(LAYER_A_WIN)!;
  const matches = (expr: string, l: LayerRecord) => {
    const e = parseLayerFilterExpression(expr);
    if (typeof e === 'string') throw new Error(e);
    return layerFilterMatches(tables, e, l);
  };

  it('reads AutoCAD’s forms: quoted or bare values, AND before OR, brackets, NOT, any case', () => {
    expect(matches('NAME=="D*"', doors)).toBe(true);
    expect(matches('( NAME== "#*" ) and ( COLOR== "1" )', doors)).toBe(false);
    expect(matches('NAME==D* AND COLOR==1', doors)).toBe(true);
    expect(matches('NAME=="X*" OR NAME=="A-*" AND LOCKED=="True"', win)).toBe(true);
    expect(matches('(NAME=="X*" OR NAME=="A-*") AND LOCKED=="False"', win)).toBe(false);
    expect(matches('NOT NAME=="A*"', doors)).toBe(true);
    expect(matches('name!="d*"', doors)).toBe(false);
  });

  it('compares each layer property the Layer Filter Properties grid has', () => {
    expect(matches('ON=="False"', win)).toBe(true);
    expect(matches('OFF=="True"', win)).toBe(true);
    expect(matches('FROZEN=="False" AND PLOTTABLE=="True"', win)).toBe(true);
    expect(matches('COLOR=="red"', doors)).toBe(true);
    expect(matches('COLOR=="7"', win)).toBe(true);
    expect(matches('LINETYPE=="dash*"', doors)).toBe(true);
    expect(matches('LINEWEIGHT=="0.25"', win)).toBe(true);
    expect(matches('LINEWEIGHT=="Default"', doors)).toBe(true);
    expect(matches('TRANSPARENCY=="50"', win)).toBe(true);
    expect(matches('DESCRIPTION=="Win*"', win)).toBe(true);
    expect(matches('PLOTSTYLENAME=="Color_1"', doors)).toBe(true);
    expect(matches('NEWVPFROZEN=="False"', doors)).toBe(true);
  });

  it('refuses what is not an expression, and matches nothing on a property it does not know', () => {
    expect(parseLayerFilterExpression('NAME==')).toBe('Invalid filter expression.');
    expect(parseLayerFilterExpression('NAME=="A" AND')).toBe('Invalid filter expression.');
    expect(parseLayerFilterExpression('(NAME=="A"')).toBe('Invalid filter expression.');
    expect(parseLayerFilterExpression('')).toBe('Invalid filter expression.');
    expect(matches('VPCOLOR=="1"', doors)).toBe(false);
    expect(matches('VPCOLOR!="1"', doors)).toBe(false);
  });
});

describe('layer filters (M5-07 part 4)', () => {
  it('New Property Filter files it in ACLYDICTIONARY and lists the layers it matches', async () => {
    const s = new EngineSession(filtersInit());
    ok(s.edit({ kind: 'layer-filter-new', name: 'Doors', expression: 'NAME=="D*"' }));
    expect(s.undoState.nextUndo).toBe('LAYER');
    const f = filterOf(s, 'doors');
    expect(f).toMatchObject({
      type: 'LAYER_FILTER',
      owner: FILTERS,
      reactors: [FILTERS],
      name: 'Doors',
      filterType: 'property',
      expression: 'NAME=="D*"',
      layers: [],
    });
    expect(f.parent).toBeUndefined();
    expect(names(filteredLayers(s.model, f.handle))).toEqual(['Doors']);
    expect(names(filteredLayers(s.model, f.handle, { invert: true }))).toEqual([
      '0',
      'WALLS',
      'A-WIN',
    ]);
    await s.command({ kind: 'submit', text: 'U' });
    expect(layerFilters(s.model)).toEqual([]);
  });

  it('New Group Filter keeps the layers put in it, by handle', () => {
    const s = new EngineSession(filtersInit());
    ok(
      s.edit({
        kind: 'layer-filter-new',
        name: 'Openings',
        filterType: 'group',
        layers: [LAYER_A_WIN, LAYER_DOORS],
      }),
    );
    const g = filterOf(s, 'Openings');
    expect(g).toMatchObject({ filterType: 'group', expression: '' });
    expect(g.layers).toEqual([LAYER_A_WIN, LAYER_DOORS]);
    expect(names(filteredLayers(s.model, g.handle))).toEqual(['Doors', 'A-WIN']);
    ok(s.edit({ kind: 'layer-filter-edit', filter: g.handle, layers: [LAYER_0] }));
    expect(names(filteredLayers(s.model, g.handle))).toEqual(['0']);
  });

  it('a nested filter lists only layers its parent lists, filed in the parent’s dictionary', () => {
    const s = new EngineSession(filtersInit());
    ok(
      s.edit({
        kind: 'layer-filter-new',
        name: 'Openings',
        filterType: 'group',
        layers: [LAYER_A_WIN, LAYER_DOORS],
      }),
    );
    const g = filterOf(s, 'Openings');
    ok(
      s.edit({
        kind: 'layer-filter-new',
        name: 'Off',
        expression: 'ON=="False"',
        parent: g.handle,
      }),
    );
    const child = filterOf(s, 'Off');
    const nested = filterOf(s, 'Openings').nested!;
    expect(nested).toBeDefined();
    expect(child).toMatchObject({ parent: g.handle, owner: nested });
    expect(names(filteredLayers(s.model, child.handle))).toEqual(['A-WIN']);
    // Off alone would list A-WIN only too; WALLS turned off is not in Openings.
    s.edit({ kind: 'layer', layer: LAYER_WALLS, on: false } as never);
    expect(names(filteredLayers(s.model, child.handle))).toEqual(['A-WIN']);
    // A second nested filter goes in the same dictionary; one step took both away.
    ok(
      s.edit({ kind: 'layer-filter-new', name: 'Red', expression: 'COLOR=="1"', parent: g.handle }),
    );
    expect(filterOf(s, 'Red').owner).toBe(nested);
    // Deleting the parent takes its nested filters with it, in one change.
    const r = s.edit({ kind: 'layer-filter-delete', filter: g.handle });
    ok(r);
    expect(layerFilters(s.model)).toEqual([]);
    expect(JSON.stringify((r as { change: unknown }).change)).toContain(child.handle);
  });

  it('refuses a group filter in a property filter, and names AutoCAD keeps or forbids', () => {
    const s = new EngineSession(filtersInit());
    ok(s.edit({ kind: 'layer-filter-new', name: 'Doors', expression: 'NAME=="D*"' }));
    const p = filterOf(s, 'Doors');
    expect(
      s.edit({ kind: 'layer-filter-new', name: 'G', filterType: 'group', parent: p.handle }),
    ).toEqual({ ok: false, message: 'A group filter cannot be nested in a property filter.' });
    expect(s.edit({ kind: 'layer-filter-new', name: 'DOORS', expression: 'COLOR=="1"' })).toEqual({
      ok: false,
      message: 'A filter named "Doors" already exists.',
    });
    for (const name of ['All', 'All Used Layers', 'Xref', 'a*b', ' '])
      expect(s.edit({ kind: 'layer-filter-new', name, expression: 'COLOR=="1"' })).toMatchObject({
        ok: false,
      });
    expect(s.edit({ kind: 'layer-filter-new', name: 'Bad', expression: 'COLOR==' })).toEqual({
      ok: false,
      message: 'Invalid filter expression.',
    });
    expect(
      s.edit({ kind: 'layer-filter-new', name: 'G', filterType: 'group', layers: ['999'] }),
    ).toEqual({ ok: false, message: 'Layer 999 is not in the drawing.' });
    expect(s.edit({ kind: 'layer-filter-edit', filter: p.handle, layers: [LAYER_0] })).toEqual({
      ok: false,
      message: 'A property filter has no layers of its own.',
    });
  });

  it('Rename and a new expression change the filter in place', () => {
    const s = new EngineSession(filtersInit());
    ok(s.edit({ kind: 'layer-filter-new', name: 'Doors', expression: 'NAME=="D*"' }));
    const h = filterOf(s, 'Doors').handle;
    ok(s.edit({ kind: 'layer-filter-edit', filter: h, name: 'Red', expression: 'COLOR=="red"' }));
    expect(filterOf(s, 'Red')).toMatchObject({ handle: h, expression: 'COLOR=="red"' });
    expect(layerFilterNamed(s.model, 'Doors')).toBeUndefined();
    expect(s.edit({ kind: 'layer-filter-edit', filter: '999' })).toMatchObject({ ok: false });
  });

  it('a drawing without ACLYDICTIONARY gets one with its first filter', () => {
    const s = new EngineSession(filtersInit(false));
    expect(layerFilterDictionary(s.model)).toBeUndefined();
    ok(s.edit({ kind: 'layer-filter-new', name: 'A', expression: 'NAME=="A*"' }));
    ok(s.edit({ kind: 'layer-filter-new', name: 'B', expression: 'NAME=="B*"' }));
    const owner = filterOf(s, 'A').owner;
    expect(filterOf(s, 'B').owner).toBe(owner);
    expect(layerFilterDictionary(s.model)).toBe(owner);
    expect(s.model.objects.has(owner)).toBe(false);
  });

  it('a deleted layer leaves the group filters that held it', () => {
    const s = new EngineSession(filtersInit());
    ok(
      s.edit({
        kind: 'layer-filter-new',
        name: 'Openings',
        filterType: 'group',
        layers: [LAYER_A_WIN, LAYER_DOORS],
      }),
    );
    ok(s.edit({ kind: 'layer-delete', layers: [LAYER_DOORS] }));
    expect(filterOf(s, 'Openings').layers).toEqual([LAYER_A_WIN]);
  });
});

describe('layers in use (All Used Layers, M5-07 part 5)', () => {
  it('names the layers objects are on, as the manager lists them', () => {
    const s = new EngineSession(filtersInit());
    const used = s.layersInUse();
    expect(used).toContain(LAYER_WALLS);
    expect(used).not.toContain(LAYER_DOORS);
    expect(used).not.toContain(LAYER_A_WIN);
  });
});
