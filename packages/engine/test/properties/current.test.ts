// M2-35: with nothing selected the Properties palette shows and sets the drawing's current
// settings (AutoCAD 2024 Help, "Properties Palette": "When no objects are selected, only the
// general properties of the current layer … are displayed"; CECOLOR, CLAYER, CELTYPE,
// CELTSCALE, CELWEIGHT, CETRANSPARENCY), and the objects commands draw take them.
import { describe, expect, it } from 'vitest';
import {
  CETRANSPARENCY,
  DocumentModel,
  PromptBus,
  builtinCommands,
  currentProps,
  propertySheet,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type HeaderValue,
  type PropertySheet,
  type TextStyleRecord,
} from '../../src/index';
import { LAYER_0, LAYER_WALLS, layer, linetype, sampleInit } from '../model/fixtures';

const FROZEN = '12';
const DASHED = '15';
const BYLAYER_LTYPE = '16';

function init(header: [string, HeaderValue][] = []): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    header: new Map([...(base.header ?? []), ...header]),
    tables: {
      ...base.tables,
      layers: [...(base.tables?.layers ?? []), { ...layer(FROZEN, 'HIDDEN'), frozen: true }],
      linetypes: [
        ...(base.tables?.linetypes ?? []),
        linetype(DASHED, 'DASHED'),
        linetype(BYLAYER_LTYPE, 'ByLayer'),
      ],
    },
  };
}

function setup(i: DocumentInit = init()) {
  const model = DocumentModel.create(i);
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  return { model, bus, log, added };
}

const values = (sheet: PropertySheet) =>
  Object.fromEntries(sheet.sections.flatMap((s) => s.rows.map((r) => [r.label, r.value])));

describe('the Properties sheet with nothing selected', () => {
  it('shows General with the drawing’s current settings', () => {
    const { model } = setup();
    const sheet = propertySheet(model, []);
    expect(sheet).toMatchObject({ count: 0, types: [], current: true });
    expect(sheet.sections.map((s) => s.title)).toEqual(['General']);
    expect(values(sheet)).toEqual({
      Color: 'ByLayer',
      Layer: LAYER_WALLS,
      Linetype: 'ByLayer',
      'Linetype scale': 1,
      Lineweight: 'ByLayer',
      Transparency: 'ByLayer',
    });
    const layerRow = sheet.sections[0]!.rows.find((r) => r.key === 'layer')!;
    expect(layerRow.options?.map((o) => o.label)).toEqual(['0', 'HIDDEN', 'WALLS']);
  });

  it('reads CECOLOR, CELTYPE, CELTSCALE, CELWEIGHT and CETRANSPARENCY as DXF states them', () => {
    const { model } = setup(
      init([
        ['$CECOLOR', 1],
        ['$CELTYPE', 'dashed'],
        ['$CELTSCALE', 2],
        ['$CELWEIGHT', 25],
        [CETRANSPARENCY, '40'],
      ]),
    );
    expect(values(propertySheet(model, []))).toMatchObject({
      Color: 'aci:1',
      Linetype: DASHED,
      'Linetype scale': 2,
      Lineweight: '25',
      Transparency: 40,
    });
    const byBlock = setup(
      init([
        ['$CECOLOR', 0],
        ['$CELTYPE', 'BYBLOCK'],
        ['$CELWEIGHT', -2],
        [CETRANSPARENCY, 'ByBlock'],
      ]),
    ).model;
    expect(currentProps(byBlock)).toMatchObject({
      color: { kind: 'byBlock' },
      linetype: 'ByBlock',
      lineweight: 'ByBlock',
      transparency: 'ByBlock',
    });
    // Values no drawing should hold fall back to ByLayer, as AUDIT sets them.
    const damaged = setup(
      init([
        ['$CECOLOR', 300],
        ['$CELTYPE', 'NOPE'],
        ['$CELTSCALE', 0],
        ['$CELWEIGHT', -7],
        [CETRANSPARENCY, 'opaque'],
      ]),
    ).model;
    expect(currentProps(damaged)).toEqual({
      layer: LAYER_WALLS,
      color: { kind: 'byLayer' },
      linetype: 'ByLayer',
      ltScale: 1,
      lineweight: 'ByLayer',
      transparency: 'ByLayer',
    });
    expect(currentProps(setup(init([['$CELWEIGHT', -3]])).model).lineweight).toBe('Default');
  });
});

describe('Properties edits with nothing selected', () => {
  it('set the current settings, each one undo step', async () => {
    const s = setup();
    await s.bus.setProperty({ key: 'color', value: 'aci:1' });
    await s.bus.setProperty({ key: 'layer', value: LAYER_0 });
    await s.bus.setProperty({ key: 'linetype', value: DASHED });
    await s.bus.setProperty({ key: 'ltScale', value: '0.5' });
    await s.bus.setProperty({ key: 'lineweight', value: '30' });
    await s.bus.setProperty({ key: 'transparency', value: 25 });
    const h = s.model.header;
    expect([
      h.get('$CECOLOR'),
      h.get('$CLAYER'),
      h.get('$CELTYPE'),
      h.get('$CELTSCALE'),
      h.get('$CELWEIGHT'),
      h.get(CETRANSPARENCY),
    ]).toEqual([1, '0', 'DASHED', 0.5, 30, '25']);
    expect(s.bus.undo.state.undoable).toBe(6);
    expect(s.log).toEqual([]);

    await s.bus.setProperty({ key: 'color', value: 'ByBlock' });
    await s.bus.setProperty({ key: 'linetype', value: 'ByLayer' });
    await s.bus.setProperty({ key: 'lineweight', value: 'Default' });
    await s.bus.setProperty({ key: 'transparency', value: 'ByBlock' });
    // ByLayer spelled as the drawing's own LTYPE record.
    expect([h.get('$CECOLOR'), h.get('$CELTYPE'), h.get('$CELWEIGHT')]).toEqual([0, 'ByLayer', -3]);
    expect(h.get(CETRANSPARENCY)).toBe('ByBlock');

    await s.bus.submit('U');
    expect(h.get(CETRANSPARENCY)).toBe('25');
  });

  it('refuses a frozen layer, a true colour and values the variables cannot take', async () => {
    const s = setup();
    await s.bus.setProperty({ key: 'layer', value: FROZEN });
    expect(s.log.at(-1)).toBe('Cannot set a frozen layer current.');
    await s.bus.setProperty({ key: 'color', value: 'rgb:10,20,30' });
    await s.bus.setProperty({ key: 'ltScale', value: '0' });
    await s.bus.setProperty({ key: 'transparency', value: 95 });
    await s.bus.setProperty({ key: 'startX', value: 3 });
    expect(s.log.slice(-4)).toEqual(Array(4).fill('Invalid input.'));
    expect(s.model.header.get('$CLAYER')).toBe('WALLS');
    expect(s.model.header.has('$CECOLOR')).toBe(false);
    // Setting the value already current changes nothing (still one undo step, as AutoCAD's).
    await s.bus.setProperty({ key: 'layer', value: LAYER_WALLS });
    expect(s.model.header.get('$CLAYER')).toBe('WALLS');
  });

  it('cancels a running command first', async () => {
    const s = setup();
    await s.bus.submit('ZOOM');
    expect(s.bus.command).toBe('ZOOM');
    await s.bus.setProperty({ key: 'color', value: 'aci:2' });
    expect(s.bus.command).toBeUndefined();
    expect(s.model.header.get('$CECOLOR')).toBe(2);
  });
});

const standard = {
  handle: '30',
  name: 'Standard',
  font: 'arial.ttf',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
} satisfies TextStyleRecord;

describe('new objects take the current settings', () => {
  const current: [string, HeaderValue][] = [
    ['$CECOLOR', 5],
    ['$CLAYER', '0'],
    ['$CELTYPE', 'DASHED'],
    ['$CELTSCALE', 3],
    ['$CELWEIGHT', 50],
    [CETRANSPARENCY, '50'],
  ];
  const expected = {
    color: { kind: 'aci', index: 5 },
    layer: LAYER_0,
    linetype: DASHED,
    ltScale: 3,
    lineweight: 50,
    transparency: { alpha: 128 },
  };

  it('LINE, TEXT, MTEXT, REVCLOUD and WIPEOUT', async () => {
    const i = init([...current, ['$TEXTSTYLE', 'Standard']]);
    const s = setup({ ...i, tables: { ...i.tables, textStyles: [standard] } });
    await s.bus.script(['LINE', '0,0', '10,0', '']);
    await s.bus.script(['TEXT', '0,5', '2.5', '0', 'NOTE', '']);
    await s.bus.script(['MTEXT', '0,20', '30,10', 'Notes', '']);
    await s.bus.script(['REVCLOUD', 'R', '0,30', '20,40']);
    await s.bus.script(['WIPEOUT', '40,0', '50,0', '50,10', '']);
    const made = s.added();
    expect(made.map((e) => e.type)).toEqual(['LINE', 'TEXT', 'MTEXT', 'LWPOLYLINE', 'WIPEOUT']);
    for (const e of made) expect(e, e.type).toMatchObject(expected);
  });
});
