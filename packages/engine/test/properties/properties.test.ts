// M2-21: the Properties palette's sheet (AutoCAD 2024 Help, "Properties Palette": General, then
// each type's sections; *VARIES* where the selected objects differ; the type list narrows it)
// and its edits on the PromptBus, each one undo step that U takes back.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  EngineSession,
  PromptBus,
  builtinCommands,
  polylineArea,
  polylineLength,
  propertySheet,
  type BusEvent,
  type CommandOutput,
  type DocumentInit,
  type Entity,
  type EntityGeometry,
  type PropertyRow,
  type PropertySheet,
  type ViewRequest,
} from '../../src/index';
import {
  LAYER_0,
  LAYER_WALLS,
  blockRecord,
  entityInit,
  layer,
  lineGeom,
  sampleInit,
} from '../model/fixtures';

const textGeom = (
  over: Partial<Extract<EntityGeometry, { kind: 'TEXT' }>> = {},
): EntityGeometry => ({
  kind: 'TEXT',
  value: 'NOTE',
  style: '30',
  position: { x: 1, y: 1 },
  height: 2.5,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
  ...over,
});

/** The sample drawing's three model-space objects, with a text and a dynamic block's states. */
function init(extra: DocumentInit['entities'] = []): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    tables: {
      ...base.tables,
      layers: [...(base.tables?.layers ?? []), { ...layer('12', 'LOCKED'), locked: true }],
      textStyles: [
        {
          handle: '30',
          name: 'Standard',
          height: 0,
          widthFactor: 1,
          oblique: 0,
          font: 'txt',
        } as never,
      ],
      blockRecords: [
        ...(base.tables?.blockRecords ?? []),
        blockRecord('50', 'DOOR'),
        blockRecord('51', '*U4'),
        blockRecord('52', 'BOLT'),
      ],
    },
    blocks: [
      ...(base.blocks ?? []),
      { handle: '50', name: 'DOOR', basePoint: { x: 0, y: 0 }, dynamic: { name: 'DOOR' } },
      { handle: '51', name: '*U4', basePoint: { x: 0, y: 0 }, dynamicOf: '50' },
      { handle: '52', name: 'BOLT', basePoint: { x: 0, y: 0 } },
    ],
    entities: [...(base.entities ?? []), ...extra],
  };
}

const insertGeom = (block: string, x = 0, y = 0, attributes: unknown[] = []): EntityGeometry =>
  ({
    kind: 'INSERT',
    block,
    position: { x, y },
    scale: { x: 1, y: 1, z: 1 },
    rotation: 0,
    attributes,
  }) as EntityGeometry;

function setup(i: DocumentInit = init()) {
  const model = DocumentModel.create(i);
  const registry = builtinCommands();
  const requests: ViewRequest[] = [];
  const bus = new PromptBus({
    model,
    registry,
    view: {
      request: (r) => {
        requests.push(r);
        return Promise.resolve({ ok: true });
      },
    },
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const byHandle = (h: string): Entity => model.entityByHandle(h)!;
  const ids = (...hs: string[]) => hs.map((h) => byHandle(h).id);
  return { model, bus, log, byHandle, ids, requests };
}

const rowOf = (sheet: PropertySheet, label: string): PropertyRow => {
  for (const s of sheet.sections) {
    const r = s.rows.find((x) => x.label === label);
    if (r) return r;
  }
  throw new Error(`no row ${label} in ${sheet.sections.map((s) => s.title).join(', ')}`);
};
const titles = (sheet: PropertySheet) => sheet.sections.map((s) => s.title);

describe('the Properties sheet', () => {
  it('shows a line: General, then Geometry with its measured values', () => {
    const s = setup();
    const sheet = propertySheet(s.model, s.ids('20'));
    expect(sheet.count).toBe(1);
    expect(sheet.types).toEqual([{ type: 'LINE', label: 'Line', count: 1 }]);
    expect(titles(sheet)).toEqual(['General', 'Geometry']);
    expect(rowOf(sheet, 'Color')).toMatchObject({ value: 'ByLayer', kind: 'choice' });
    expect(rowOf(sheet, 'Layer')).toMatchObject({ value: LAYER_0 });
    expect(rowOf(sheet, 'Layer').options?.map((o) => o.label)).toEqual(['0', 'LOCKED', 'WALLS']);
    expect(rowOf(sheet, 'Linetype').options?.map((o) => o.label)).toEqual([
      'ByLayer',
      'ByBlock',
      'Continuous',
    ]);
    expect(rowOf(sheet, 'Lineweight')).toMatchObject({ value: 'ByLayer' });
    expect(rowOf(sheet, 'Transparency')).toMatchObject({ value: 'ByLayer' });
    expect(rowOf(sheet, 'Linetype scale')).toMatchObject({ value: 1 });
    expect(rowOf(sheet, 'End X')).toMatchObject({ value: 10, kind: 'distance' });
    expect(rowOf(sheet, 'Length')).toMatchObject({ value: 10, readOnly: true });
    expect(rowOf(sheet, 'Angle')).toMatchObject({ value: 0, kind: 'angle', readOnly: true });
    expect(sheet.units).toEqual({ lunits: 2, luprec: 4, aunits: 0, auprec: 0 });
  });

  it('shows General only for mixed types, with *VARIES* where they differ', () => {
    const s = setup();
    const sheet = propertySheet(s.model, s.ids('20', '21', '23'));
    expect(sheet.count).toBe(3);
    expect(sheet.types).toEqual([
      { type: 'LINE', label: 'Line', count: 2 },
      { type: 'CIRCLE', label: 'Circle', count: 1 },
    ]);
    expect(titles(sheet)).toEqual(['General']);
    // The circle is on WALLS, the lines on 0.
    expect(rowOf(sheet, 'Layer')).toMatchObject({ varies: true });
    expect(rowOf(sheet, 'Layer').value).toBeUndefined();
    expect(rowOf(sheet, 'Color')).toMatchObject({ value: 'ByLayer' });
  });

  it('narrows to one type: its sections, and *VARIES* among its objects', () => {
    const s = setup();
    const sheet = propertySheet(s.model, s.ids('20', '21', '23'), 'LINE');
    expect(sheet.filter).toBe('LINE');
    expect(sheet.count).toBe(3);
    expect(titles(sheet)).toEqual(['General', 'Geometry']);
    expect(rowOf(sheet, 'Layer')).toMatchObject({ value: LAYER_0 });
    expect(rowOf(sheet, 'Start X')).toMatchObject({ value: 0 });
    expect(rowOf(sheet, 'End X')).toMatchObject({ varies: true });
    // A type not selected shows all.
    expect(propertySheet(s.model, s.ids('20'), 'CIRCLE').filter).toBeUndefined();
  });

  it('shows a circle with radius, diameter, circumference and area', () => {
    const s = setup();
    const sheet = propertySheet(s.model, s.ids('21'));
    expect(rowOf(sheet, 'Center X').value).toBe(5);
    expect(rowOf(sheet, 'Radius').value).toBe(2);
    expect(rowOf(sheet, 'Diameter').value).toBe(4);
    expect(rowOf(sheet, 'Circumference').value).toBeCloseTo(4 * Math.PI, 12);
    expect(rowOf(sheet, 'Area').value).toBeCloseTo(4 * Math.PI, 12);
  });

  it('shows an arc with its ends, angles, length and area', () => {
    const arc: EntityGeometry = {
      kind: 'ARC',
      center: { x: 0, y: 0 },
      radius: 2,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    const s = setup(init([entityInit('60', arc)]));
    const sheet = propertySheet(s.model, s.ids('60'));
    expect(rowOf(sheet, 'Start X').value).toBe(2);
    expect(rowOf(sheet, 'End Y').value).toBeCloseTo(2, 12);
    expect(rowOf(sheet, 'Total angle').value).toBeCloseTo(Math.PI / 2, 12);
    expect(rowOf(sheet, 'Arc length').value).toBeCloseTo(Math.PI, 12);
    expect(rowOf(sheet, 'Area').value).toBeCloseTo(Math.PI - 2, 12);
  });

  it('shows a text and names its style and justification', () => {
    const s = setup(
      init([entityInit('61', textGeom({ halign: 1, valign: 2, alignmentPoint: { x: 4, y: 5 } }))]),
    );
    const sheet = propertySheet(s.model, s.ids('61'));
    expect(titles(sheet)).toEqual(['General', 'Text', 'Geometry', 'Misc']);
    expect(rowOf(sheet, 'Contents').value).toBe('NOTE');
    // M2-35 part 2: Style is a choice by handle, labelled with the style's name.
    const style = rowOf(sheet, 'Style');
    expect(style.options?.find((o) => o.value === style.value)?.label).toBe('Standard');
    expect(rowOf(sheet, 'Justify').value).toBe('Middle center');
    // A justified text is placed by its alignment point.
    expect(rowOf(sheet, 'Position X').value).toBe(4);
    expect(rowOf(sheet, 'Upside down').value).toBe('no');
  });

  it('names a dynamic block reference by its dynamic block and shows the FR-B3 badge', () => {
    const s = setup(init([entityInit('62', insertGeom('51')), entityInit('63', insertGeom('52'))]));
    const dyn = propertySheet(s.model, s.ids('62'));
    expect(dyn.dynamic).toBe('DOOR');
    expect(rowOf(dyn, 'Name').value).toBe('DOOR');
    expect(propertySheet(s.model, s.ids('63')).dynamic).toBeUndefined();
    expect(rowOf(propertySheet(s.model, s.ids('63')), 'Name').value).toBe('BOLT');
    // A static and a dynamic reference together: no badge.
    expect(propertySheet(s.model, s.ids('62', '63')).dynamic).toBeUndefined();
  });

  it('lists one reference’s attributes by tag', () => {
    const attribute = {
      ...(textGeom({ value: 'A-101' }) as object),
      tag: 'SHEET',
      flags: 0,
      handle: '64',
      layer: LAYER_0,
      color: { kind: 'byLayer' },
      linetype: 'ByLayer',
      lineweight: 'ByLayer',
      transparency: 'ByLayer',
      ltScale: 1,
      visible: true,
    };
    delete (attribute as { kind?: string }).kind;
    const s = setup(init([entityInit('65', insertGeom('52', 0, 0, [attribute]))]));
    const sheet = propertySheet(s.model, s.ids('65'));
    expect(titles(sheet)).toContain('Attributes');
    expect(rowOf(sheet, 'SHEET')).toMatchObject({ key: 'attribute:64', value: 'A-101' });
  });

  it('shows the current settings for no selection, and nothing for objects gone', () => {
    const s = setup();
    expect(propertySheet(s.model, [])).toMatchObject({ count: 0, types: [], current: true });
    const gone = s.ids('20');
    const b = new ChangeSetBuilder(s.model);
    b.removeEntity(gone[0]!);
    s.model.apply(b.build());
    expect(propertySheet(s.model, gone)).toMatchObject({ count: 0, types: [], sections: [] });
  });
});

describe('polyline measures', () => {
  const square = (closed: boolean, bulge = 0) => ({
    kind: 'LWPOLYLINE' as const,
    closed,
    vertices: [
      { x: 0, y: 0, bulge: 0 },
      { x: 2, y: 0, bulge },
      { x: 2, y: 2, bulge: 0 },
      { x: 0, y: 2, bulge: 0 },
    ],
  });
  it('measures straight segments and closes an open one for its area', () => {
    expect(polylineLength(square(true))).toBe(8);
    expect(polylineLength(square(false))).toBe(6);
    expect(polylineArea(square(false))).toBe(4);
  });
  it('adds a half circle bulging out and takes one bulging in', () => {
    // Bulge 1 is a half circle; counter-clockwise from (2,0) to (2,2) on a counter-clockwise
    // square, it bulges out.
    expect(polylineArea(square(true, 1))).toBeCloseTo(4 + Math.PI / 2, 12);
    expect(polylineArea(square(true, -1))).toBeCloseTo(4 - Math.PI / 2, 12);
    expect(polylineLength(square(true, 1))).toBeCloseTo(6 + Math.PI, 12);
  });
});

describe('Properties edits', () => {
  it('sets a colour on every selected object as one undo step', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'color', value: 'aci:1' });
    for (const h of ['20', '21', '23']) {
      expect(s.byHandle(h).color).toEqual({ kind: 'aci', index: 1 });
    }
    expect(s.bus.undo.state.undoable).toBe(1);
    // The objects stay selected, and the command line echoes nothing.
    expect(s.bus.selection).toHaveLength(3);
    expect(s.log).toEqual([]);
    await s.bus.submit('U');
    for (const h of ['20', '21', '23']) expect(s.byHandle(h).color).toEqual({ kind: 'byLayer' });
  });

  it('applies to the type the palette shows only', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'layer', value: LAYER_WALLS }, 'LINE');
    expect(s.byHandle('20').layer).toBe(LAYER_WALLS);
    expect(s.byHandle('23').layer).toBe(LAYER_WALLS);
    expect(s.byHandle('21').layer).toBe(LAYER_WALLS);
    await s.bus.setProperty({ key: 'ltScale', value: '2*1.5' }, 'CIRCLE');
    expect(s.byHandle('21').ltScale).toBe(3);
    expect(s.byHandle('20').ltScale).toBe(1);
  });

  it('sets linetype, lineweight and transparency, refusing values they cannot take', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'linetype', value: '14' });
    await s.bus.setProperty({ key: 'lineweight', value: '35' });
    await s.bus.setProperty({ key: 'transparency', value: '40' });
    const line = s.byHandle('20');
    expect(line.linetype).toBe('14');
    expect(line.lineweight).toBe(35);
    expect(line.transparency).toEqual({ alpha: 153 });
    expect(rowOf(propertySheet(s.model, [line.id]), 'Transparency').value).toBe(40);
    await s.bus.setProperty({ key: 'transparency', value: '95' });
    await s.bus.setProperty({ key: 'lineweight', value: '36' });
    await s.bus.setProperty({ key: 'ltScale', value: '-1' });
    await s.bus.setProperty({ key: 'layer', value: 'FF' });
    expect(s.log.filter((l) => l === 'Invalid input.')).toHaveLength(4);
    expect(s.byHandle('20')).toMatchObject({ lineweight: 35, ltScale: 1, layer: LAYER_0 });
    expect(s.bus.undo.state.undoable).toBe(3);
  });

  it('edits a line’s ends and a circle’s size four ways', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'endX', value: '12.5' }, 'LINE');
    expect((s.byHandle('20').geom as { end: { x: number } }).end.x).toBe(12.5);
    expect((s.byHandle('23').geom as { end: { x: number } }).end.x).toBe(12.5);
    const radius = () => (s.byHandle('21').geom as { radius: number }).radius;
    await s.bus.setProperty({ key: 'diameter', value: 6 }, 'CIRCLE');
    expect(radius()).toBe(3);
    await s.bus.setProperty({ key: 'circumference', value: String(10 * Math.PI) }, 'CIRCLE');
    expect(radius()).toBeCloseTo(5, 12);
    await s.bus.setProperty({ key: 'area', value: Math.PI * 16 }, 'CIRCLE');
    expect(radius()).toBeCloseTo(4, 12);
    await s.bus.setProperty({ key: 'radius', value: 0 }, 'CIRCLE');
    expect(radius()).toBeCloseTo(4, 12);
    expect(s.log.at(-1)).toBe('Invalid input.');
  });

  it('moves a circle by its centre and an arc keeps its angles in 0–2π', async () => {
    const arc: EntityGeometry = {
      kind: 'ARC',
      center: { x: 0, y: 0 },
      radius: 2,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    const s = setup(init([entityInit('60', arc)]));
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'centerY', value: 7 }, 'CIRCLE');
    expect((s.byHandle('21').geom as { center: unknown }).center).toEqual({ x: 5, y: 7 });
    await s.bus.setProperty({ key: 'endAngle', value: '-90' }, 'ARC');
    expect((s.byHandle('60').geom as { endAngle: number }).endAngle).toBeCloseTo(
      (3 * Math.PI) / 2,
      12,
    );
  });

  it('turns a justified text about its alignment point and sets its text values', async () => {
    const s = setup(
      init([
        entityInit(
          '61',
          textGeom({ halign: 2, position: { x: 0, y: 4 }, alignmentPoint: { x: 4, y: 4 } }),
        ),
      ]),
    );
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'rotation', value: '90' }, 'TEXT');
    const g = () => s.byHandle('61').geom as Extract<EntityGeometry, { kind: 'TEXT' }>;
    expect(g().rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(g().alignmentPoint).toEqual({ x: 4, y: 4 });
    expect(g().position.x).toBeCloseTo(4, 12);
    expect(g().position.y).toBeCloseTo(0, 12);
    await s.bus.setProperty({ key: 'contents', value: 'REVISED' }, 'TEXT');
    await s.bus.setProperty({ key: 'height', value: '3.5' }, 'TEXT');
    await s.bus.setProperty({ key: 'widthFactor', value: '0.8' }, 'TEXT');
    await s.bus.setProperty({ key: 'oblique', value: '15' }, 'TEXT');
    await s.bus.setProperty({ key: 'backward', value: 'yes' }, 'TEXT');
    await s.bus.setProperty({ key: 'positionX', value: '10' }, 'TEXT');
    expect(g()).toMatchObject({ value: 'REVISED', height: 3.5, widthFactor: 0.8, backward: true });
    expect(g().oblique).toBeCloseTo(Math.PI / 12, 12);
    expect(g().alignmentPoint).toEqual({ x: 10, y: 4 });
    await s.bus.setProperty({ key: 'oblique', value: '86' }, 'TEXT');
    expect(g().oblique).toBeCloseTo(Math.PI / 12, 12);
  });

  it('moves and turns a reference with its attributes, and edits an attribute value', async () => {
    const attribute = {
      ...(textGeom({ value: 'A-101', position: { x: 1, y: 0 } }) as object),
      tag: 'SHEET',
      flags: 0,
      handle: '64',
      layer: LAYER_0,
      color: { kind: 'byLayer' },
      linetype: 'ByLayer',
      lineweight: 'ByLayer',
      transparency: 'ByLayer',
      ltScale: 1,
      visible: true,
    };
    delete (attribute as { kind?: string }).kind;
    const s = setup(init([entityInit('65', insertGeom('52', 0, 0, [attribute]))]));
    await s.bus.selectAll();
    const g = () => s.byHandle('65').geom as Extract<EntityGeometry, { kind: 'INSERT' }>;
    await s.bus.setProperty({ key: 'positionX', value: 3 }, 'INSERT');
    expect(g().position).toEqual({ x: 3, y: 0 });
    expect(g().attributes[0]!.position).toEqual({ x: 4, y: 0 });
    await s.bus.setProperty({ key: 'rotation', value: '90' }, 'INSERT');
    expect(g().rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(g().attributes[0]!.position.x).toBeCloseTo(3, 12);
    expect(g().attributes[0]!.position.y).toBeCloseTo(1, 12);
    await s.bus.setProperty({ key: 'attribute:64', value: 'A-102' }, 'INSERT');
    expect(g().attributes[0]!.value).toBe('A-102');
    expect(s.bus.undo.state.undoable).toBe(3);
    await s.bus.submit('U');
    expect(g().attributes[0]!.value).toBe('A-101');
  });

  it('closes a polyline and sets its elevation', async () => {
    const pl: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 1, y: 0, bulge: 0 },
        { x: 1, y: 1, bulge: 0 },
      ],
    };
    const s = setup(init([entityInit('66', pl)]));
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'closed', value: 'yes' }, 'LWPOLYLINE');
    await s.bus.setProperty({ key: 'elevation', value: '2' }, 'LWPOLYLINE');
    expect(s.byHandle('66').geom).toMatchObject({ closed: true, elevation: 2 });
    await s.bus.setProperty({ key: 'elevation', value: '0' }, 'LWPOLYLINE');
    expect('elevation' in s.byHandle('66').geom).toBe(false);
  });

  it('leaves objects on locked layers alone and says so', async () => {
    const s = setup(init([entityInit('67', lineGeom(0, 0, 1, 1), { layer: '12' })]));
    // ALL skips locked layers; the palette may show a locked object picked before it locked.
    await s.bus.selectAll();
    s.model.apply({
      tables: {
        layers: {
          updated: [
            {
              before: s.model.tables.layers.get(LAYER_WALLS)!,
              after: { ...s.model.tables.layers.get(LAYER_WALLS)!, locked: true },
            },
          ],
        },
      },
    });
    await s.bus.setProperty({ key: 'color', value: 'aci:3' });
    expect(s.byHandle('21').color).toEqual({ kind: 'byLayer' });
    expect(s.byHandle('20').color).toEqual({ kind: 'aci', index: 3 });
    expect(s.log.at(-1)).toBe('1 object was not changed: on a locked layer.');
  });

  it('cancels a running command first', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.submit('ZOOM');
    expect(s.bus.command).toBe('ZOOM');
    await s.bus.setProperty({ key: 'color', value: 'aci:2' });
    expect(s.bus.command).toBeUndefined();
    expect(s.byHandle('20').color).toEqual({ kind: 'aci', index: 2 });
  });
});

describe('PROPERTIES and PROPERTIESCLOSE', () => {
  it('ask the app to open and close the palette, keeping the selection', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.submit('CH');
    await s.bus.submit('PROPERTIESCLOSE');
    expect(s.requests).toEqual([
      { op: 'palette', palette: 'properties', open: true },
      { op: 'palette', palette: 'properties', open: false },
    ]);
    expect(s.bus.selection).toHaveLength(3);
  });
});

describe('EngineSession properties', () => {
  // The sheet follows a settled change, a microtask later.
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  function session() {
    const out: CommandOutput[] = [];
    const se = new EngineSession(init());
    se.onCommand((o) => out.push(o));
    const sheets = () =>
      out.filter(
        (o): o is Extract<CommandOutput, { type: 'properties' }> => o.type === 'properties',
      );
    return { se, out, sheets };
  }

  it('sends a sheet while the palette is open, after each selection and edit', async () => {
    const { se, sheets } = session();
    await se.command({ kind: 'select-all' });
    await flush();
    expect(sheets()).toHaveLength(0);
    await se.command({ kind: 'properties', open: true });
    expect(sheets().at(-1)!.sheet.count).toBe(3);
    await se.command({ kind: 'properties', open: true, filter: 'CIRCLE' });
    expect(sheets().at(-1)!.sheet.filter).toBe('CIRCLE');
    await se.command({ kind: 'property', edit: { key: 'radius', value: '3' } });
    await flush();
    const last = sheets().at(-1)!.sheet;
    // The edit's sheet keeps the type shown.
    expect(last.filter).toBe('CIRCLE');
    expect(rowOf(last, 'Radius').value).toBe(3);
    const line = [...se.model.entities()].find((e) => e.handle === '20')!;
    expect(line.geom).toEqual(lineGeom(0, 0, 10, 0));
    // Esc deselects: an empty sheet, and all types again next time.
    await se.command({ kind: 'cancel' });
    await flush();
    expect(sheets().at(-1)!.sheet.count).toBe(0);
    await se.command({ kind: 'select-all' });
    await flush();
    expect(sheets().at(-1)!.sheet.filter).toBeUndefined();
    const n = sheets().length;
    await se.command({ kind: 'properties', open: false });
    await se.command({ kind: 'cancel' });
    await flush();
    expect(sheets()).toHaveLength(n);
  });
});
