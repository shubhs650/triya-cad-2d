// M5-07 part 5: the Layer Properties Manager's filter tree, read from the drawing as opened plus
// the changes applied since; the layers each node lists (All, All Used Layers, a filter, Invert
// filter); new filters' names; and the Layer Filter Properties dialog's definition grid, written
// to and read from a filter expression. M5-07 part 6: the filter menu's items, which are greyed
// on which node, and the engine edit each sends.
import type {
  BlockTableRecord,
  ChangeSet,
  DocumentInit,
  LayerFilter,
  LayerRecord,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_DEFINITION,
  definitionExpression,
  FILTER_MENU,
  definitionRows,
  drawingLayerFilters,
  drawingXrefs,
  filterCountLine,
  filterNodeName,
  filterMenuEdit,
  filterMenuEnabled,
  layerFilterSource,
  layerFilterTree,
  listedLayers,
  nextFilterName,
} from '../src/layer-filters';

const layer = (handle: string, name: string, extra: Partial<LayerRecord> = {}): LayerRecord => ({
  handle,
  name,
  color: { kind: 'aci', index: 7 },
  linetype: '14',
  lineweight: 'Default',
  transparency: { alpha: 255 },
  plot: true,
  on: true,
  frozen: false,
  locked: false,
  ...extra,
});

const filter = (handle: string, name: string, more: Partial<LayerFilter> = {}): LayerFilter => ({
  handle,
  owner: '60',
  type: 'LAYER_FILTER',
  name,
  filterType: 'property',
  expression: 'NAME=="*"',
  layers: [],
  ...more,
});

const ZERO = layer('10', '0');
const WALLS = layer('11', 'A-Walls', { color: { kind: 'aci', index: 1 } });
const DOORS = layer('12', 'A-Doors', { on: false });
const NOTES = layer('13', 'Notes', { color: { kind: 'aci', index: 1 } });

const init: DocumentInit = {
  meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
  handSeed: '100',
  tables: {
    layers: [ZERO, WALLS, DOORS, NOTES],
    linetypes: [{ handle: '14', name: 'Continuous', description: '', elements: [] } as never],
  },
  objects: [
    filter('61', 'Arch', { expression: 'NAME=="A-*"' }),
    filter('62', 'Red', { expression: 'COLOR=="1"', parent: '61' }),
    filter('63', 'Mine', { filterType: 'group', expression: '', layers: ['13', '10'] }),
  ],
};

describe('drawingLayerFilters', () => {
  it('lists the filters as the engine has them now', () => {
    expect(drawingLayerFilters(init, []).map((f) => f.name)).toEqual(['Arch', 'Mine', 'Red']);
    const changes: ChangeSet[] = [
      { objects: { added: [filter('64', 'Doors', { expression: 'NAME=="*Doors"' })] } },
      {
        objects: {
          updated: [{ before: filter('61', 'Arch'), after: filter('61', 'Architecture') }],
        },
      },
      { objects: { removed: [filter('63', 'Mine')] } },
    ];
    expect(drawingLayerFilters(init, changes).map((f) => f.name)).toEqual([
      'Architecture',
      'Doors',
      'Red',
    ]);
  });
});

describe('layerFilterTree', () => {
  it('nests each filter under its parent, by name', () => {
    const tree = layerFilterTree(drawingLayerFilters(init, []));
    expect(tree.map((n) => [n.filter.name, n.children.map((c) => c.filter.name)])).toEqual([
      ['Arch', ['Red']],
      ['Mine', []],
    ]);
  });

  it('puts a filter whose parent is gone at the top', () => {
    const orphan = [filter('70', 'Lost', { parent: '99' })];
    expect(layerFilterTree(orphan).map((n) => n.filter.name)).toEqual(['Lost']);
  });
});

describe('listedLayers', () => {
  const source = layerFilterSource(init, []);
  const names = (s: ReadonlySet<string> | undefined) =>
    s === undefined
      ? 'every layer'
      : [ZERO, WALLS, DOORS, NOTES].filter((l) => s.has(l.handle)).map((l) => l.name);

  it('lists every layer under All, none inverted', () => {
    expect(names(listedLayers(source, 'all', { invert: false }))).toBe('every layer');
    expect(names(listedLayers(source, 'all', { invert: true }))).toEqual([]);
  });

  it('lists the layers in use under All Used Layers', () => {
    const used = new Set(['10', '12']);
    expect(names(listedLayers(source, 'used', { invert: false, used }))).toEqual(['0', 'A-Doors']);
    expect(names(listedLayers(source, 'used', { invert: true, used }))).toEqual([
      'A-Walls',
      'Notes',
    ]);
    // Until the engine has said which are in use, none is listed.
    expect(names(listedLayers(source, 'used', { invert: false }))).toEqual([]);
  });

  it('lists a property filter’s matches, a nested one within its parent’s', () => {
    expect(names(listedLayers(source, '61', { invert: false }))).toEqual(['A-Walls', 'A-Doors']);
    expect(names(listedLayers(source, '62', { invert: false }))).toEqual(['A-Walls']);
    expect(names(listedLayers(source, '62', { invert: true }))).toEqual(['0', 'A-Doors', 'Notes']);
  });

  it('lists a group filter’s own layers', () => {
    expect(names(listedLayers(source, '63', { invert: false }))).toEqual(['0', 'Notes']);
  });

  it('lists every layer for a filter no longer in the drawing', () => {
    expect(names(listedLayers(source, '99', { invert: false }))).toBe('every layer');
  });
});

describe('nextFilterName', () => {
  it('numbers new filters as AutoCAD does, past the names taken', () => {
    const filters = drawingLayerFilters(init, []);
    expect(nextFilterName(filters, 'property')).toBe('Properties Filter1');
    const taken = [...filters, filter('70', 'properties filter1'), filter('71', 'Group Filter1')];
    expect(nextFilterName(taken, 'property')).toBe('Properties Filter2');
    expect(nextFilterName(taken, 'group')).toBe('Group Filter2');
  });
});

describe('filterCountLine', () => {
  it('says how many layers the node shows of the drawing’s', () => {
    expect(filterCountLine('All', 4, 4)).toBe('All: 4 layers displayed of 4 total layers');
    expect(filterCountLine('Mine', 1, 4)).toBe('Mine: 1 layer displayed of 4 total layers');
  });
});

describe('the Layer Filter Properties definition', () => {
  it('writes each row as AND, the rows as OR, skipping empty cells and rows', () => {
    expect(
      definitionExpression([
        { name: 'A-*', on: 'On', color: '1' },
        {},
        { frozen: 'Frozen', locked: 'Unlocked', plot: 'No plot', status: 'In use' },
        { lineweight: '0.25', transparency: '50', linetype: 'DASHED', description: 'x*' },
        { plotStyle: 'Color_1', newVpFrozen: 'Thawed', on: 'Off' },
      ]),
    ).toBe(
      'NAME=="A-*" AND ON=="True" AND COLOR=="1" OR ' +
        'USED=="True" AND FROZEN=="True" AND LOCKED=="False" AND PLOTTABLE=="False" OR ' +
        'LINETYPE=="DASHED" AND LINEWEIGHT=="0.25" AND TRANSPARENCY=="50" AND DESCRIPTION=="x*" OR ' +
        'ON=="False" AND PLOTSTYLENAME=="Color_1" AND NEWVPFROZEN=="False"',
    );
  });

  it('lists every layer for an empty grid', () => {
    expect(definitionExpression([{}, { name: '  ' }])).toBe(EMPTY_DEFINITION);
  });

  it('refuses a value with a double quote', () => {
    expect(definitionExpression([{ name: 'a"b' }])).toBe(
      'A filter value cannot hold a double quote (").',
    );
  });

  it('reads an expression back into rows', () => {
    const rows = [
      { name: 'A-*', on: 'On', color: '1' },
      { frozen: 'Frozen', status: 'Not in use' },
    ];
    const text = definitionExpression(rows);
    expect(typeof text).toBe('string');
    expect(definitionRows(text as string)).toEqual(rows);
    // AutoCAD's own form: bracketed terms, spaces, keywords in any case.
    expect(definitionRows('( NAME== "#*" ) and ( COLOR== "3" ) or (ON=="False")')).toEqual([
      { name: '#*', color: '3' },
      { on: 'Off' },
    ]);
    expect(definitionRows(EMPTY_DEFINITION)).toEqual([]);
  });

  it('reads no rows from what the grid cannot show', () => {
    expect(definitionRows('NAME!="A*"')).toBeUndefined();
    expect(definitionRows('NOT NAME=="A*"')).toBeUndefined();
    expect(definitionRows('NAME=="A*" AND NAME=="*B"')).toBeUndefined();
    expect(definitionRows('(NAME=="A*" OR COLOR=="1") AND ON=="True"')).toBeUndefined();
    expect(definitionRows('FOO=="1"')).toBeUndefined();
    expect(definitionRows('ON=="maybe"')).toBeUndefined();
    expect(definitionRows('NAME==')).toBeUndefined();
  });
});

describe('the filter menu (M5-07 part 6)', () => {
  const property = filter('70', 'Doors', { expression: 'NAME=="D*"' });
  const group = filter('71', 'G', { filterType: 'group', expression: '', layers: ['10'] });
  const nested = filter('72', 'Red', { expression: 'COLOR=="1"', parent: '70' });

  it('lists AutoCAD’s items: the submenus first, then the filters', () => {
    expect(FILTER_MENU.map((e) => e.label)).toEqual([
      'Visibility',
      'Lock',
      'Viewport',
      'Isolate Group',
      'New Properties Filter...',
      'New Group Filter',
      'Convert to Group Filter',
      'Rename',
      'Delete',
      'Properties...',
    ]);
    const sub = (label: string) =>
      FILTER_MENU.find((e) => e.label === label)!.items!.map((i) => i.label);
    expect(sub('Visibility')).toEqual(['On', 'Off', 'Thawed', 'Frozen']);
    expect(sub('Lock')).toEqual(['Lock', 'Unlock']);
    expect(sub('Viewport')).toEqual(['Freeze', 'Thaw']);
    expect(sub('Isolate Group')).toEqual(['All Viewports', 'Active Viewport Only']);
  });

  it('greys what the node or the space shown cannot take', () => {
    const on = (a: Parameters<typeof filterMenuEnabled>[0], ctx = {}) => filterMenuEnabled(a, ctx);
    for (const a of ['on', 'off', 'thawed', 'frozen', 'lock', 'unlock', 'isolateAll'] as const)
      expect(on(a), a).toBe(true);
    // No layout viewport can be made current yet (MSPACE, M6-02).
    expect(on('vpFreeze', { space: '58' })).toBe(false);
    expect(on('vpThaw')).toBe(false);
    expect(on('isolateActive')).toBe(true);
    expect(on('isolateActive', { space: '58' })).toBe(false);
    expect(on('convert')).toBe(false);
    expect(on('convert', { filter: group })).toBe(false);
    expect(on('convert', { filter: property })).toBe(true);
    // A group filter cannot be nested in a property filter.
    expect(on('convert', { filter: nested, parent: property })).toBe(false);
    expect(on('newGroup', { filter: property })).toBe(false);
    expect(on('rename')).toBe(false);
    expect(on('properties', { filter: property })).toBe(true);
  });

  it('sends the engine edit of each item that acts on the layers or converts', () => {
    expect(filterMenuEdit('frozen', 'all', {})).toEqual({
      kind: 'layer-filter-set',
      node: 'all',
      set: 'frozen',
    });
    expect(filterMenuEdit('unlock', '71', { filter: group })).toEqual({
      kind: 'layer-filter-set',
      node: '71',
      set: 'unlock',
    });
    expect(filterMenuEdit('isolateAll', 'used', {})).toEqual({
      kind: 'layer-filter-isolate',
      node: 'used',
    });
    expect(filterMenuEdit('isolateAll', '70', { filter: property, space: '58' })).toEqual({
      kind: 'layer-filter-isolate',
      node: '70',
      space: '58',
    });
    expect(filterMenuEdit('isolateActive', '70', { filter: property })).toEqual({
      kind: 'layer-filter-isolate',
      node: '70',
    });
    expect(filterMenuEdit('convert', '70', { filter: property })).toEqual({
      kind: 'layer-filter-convert',
      filter: '70',
    });
    expect(filterMenuEdit('rename', '70', { filter: property })).toBeUndefined();
    expect(filterMenuEdit('vpFreeze', '70', { filter: property, space: '58' })).toBeUndefined();
  });
});

// M5-07 part 8: the Xref node, under All after the filters when the drawing has xrefs, and a
// node for each xref listing the layers it brings.
describe('the Xref node (M5-07 part 8)', () => {
  const record = (handle: string, name: string, flags = 0) =>
    ({ handle, name, flags, layout: '0', units: 0 }) as unknown as BlockTableRecord;
  const PLAN = layer('20', 'Plan|Walls', { flags: 48 });
  const GRID = layer('21', 'Grid|Axes', { flags: 48 });
  const xrefInit: DocumentInit = {
    ...init,
    tables: {
      ...init.tables,
      layers: [ZERO, WALLS, PLAN, GRID],
      blockRecords: [record('30', '*Model_Space'), record('31', 'Plan', 4), record('32', 'Door')],
    },
  };
  const names = (s: ReadonlySet<string> | undefined) =>
    s === undefined
      ? 'every layer'
      : [ZERO, WALLS, PLAN, GRID].filter((l) => s.has(l.handle)).map((l) => l.name);

  it('names the drawing’s xrefs as the engine has them now', () => {
    expect(drawingXrefs(init, [])).toEqual([]);
    expect(drawingXrefs(xrefInit, [])).toEqual(['Plan']);
    const changes: ChangeSet[] = [
      { tables: { blockRecords: { added: [record('33', 'Grid', 8)] } } },
    ];
    expect(drawingXrefs(xrefInit, changes)).toEqual(['Grid', 'Plan']);
  });

  it('lists the xref-dependent layers under Xref, each xref’s under its node', () => {
    const source = layerFilterSource(xrefInit, []);
    expect(names(listedLayers(source, 'xref', { invert: false }))).toEqual([
      'Plan|Walls',
      'Grid|Axes',
    ]);
    expect(names(listedLayers(source, 'xref:Plan', { invert: false }))).toEqual(['Plan|Walls']);
    expect(names(listedLayers(source, 'xref:Plan', { invert: true }))).toEqual([
      '0',
      'A-Walls',
      'Grid|Axes',
    ]);
  });

  it('names the node in the count line, and greys the new filter items on it', () => {
    expect(filterNodeName('all', undefined)).toBe('All');
    expect(filterNodeName('used', undefined)).toBe('All Used Layers');
    expect(filterNodeName('xref', undefined)).toBe('Xref');
    expect(filterNodeName('xref:Plan', undefined)).toBe('Plan');
    expect(filterNodeName('61', filter('61', 'Arch'))).toBe('Arch');
    expect(filterMenuEnabled('newProperty', { xref: true })).toBe(false);
    expect(filterMenuEnabled('newGroup', { xref: true })).toBe(false);
    expect(filterMenuEnabled('off', { xref: true })).toBe(true);
    expect(filterMenuEnabled('isolateAll', { xref: true })).toBe(true);
    expect(filterMenuEdit('lock', 'xref:Plan', { xref: true })).toEqual({
      kind: 'layer-filter-set',
      node: 'xref:Plan',
      set: 'lock',
    });
  });
});
