// M2-35 part 2: the Properties palette's type rows that were shown only: a TEXT's and an MTEXT's
// Style and Justify (choices, as AutoCAD 2024's palette lists them), a block reference's Scale
// X/Y/Z (its attributes follow, as AutoCAD's do), and a polyline's Global width.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  propertySheet,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type EntityGeometry,
  type PropertyRow,
  type PropertySheet,
  type TextOutline,
  type ViewRequest,
} from '../../src/index';
import { LAYER_0, blockRecord, entityInit, sampleInit } from '../model/fixtures';

type Text = Extract<EntityGeometry, { kind: 'TEXT' }>;
type MText = Extract<EntityGeometry, { kind: 'MTEXT' }>;
type Insert = Extract<EntityGeometry, { kind: 'INSERT' }>;
type Polyline = Extract<EntityGeometry, { kind: 'LWPOLYLINE' }>;

const textGeom = (over: Partial<Text> = {}): Text => ({
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

const mtextGeom = (over: Partial<MText> = {}): MText =>
  ({
    kind: 'MTEXT',
    contents: 'GENERAL NOTES',
    style: '30',
    position: { x: 2, y: 8 },
    height: 2.5,
    width: 40,
    rotation: 0,
    attachment: 1,
    lineSpacing: 1,
    ...over,
  }) as MText;

const style = (handle: string, name: string, height = 0) =>
  ({ handle, name, height, widthFactor: 1, obliqueAngle: 0, font: 'txt' }) as never;

function init(extra: DocumentInit['entities'] = []): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    tables: {
      ...base.tables,
      textStyles: [style('30', 'Standard'), style('31', 'Notes'), style('32', 'Title', 5)],
      blockRecords: [...(base.tables?.blockRecords ?? []), blockRecord('52', 'BOLT')],
    },
    blocks: [...(base.blocks ?? []), { handle: '52', name: 'BOLT', basePoint: { x: 0, y: 0 } }],
    entities: [...(base.entities ?? []), ...extra],
  };
}

/** `outline` answers the canvas's `textOutlines` (null: no font draws the text). */
function setup(i: DocumentInit, outline: TextOutline | null = null) {
  const model = DocumentModel.create(i);
  const requests: ViewRequest[] = [];
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r) => {
        requests.push(r);
        if (r.op === 'textOutlines') {
          return Promise.resolve({ ok: true, outlines: r.texts.map(() => outline) });
        }
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
  throw new Error(`no row ${label}`);
};

const attribute = (over: Partial<Text> = {}) => {
  const { kind: _kind, ...fields } = textGeom({ value: 'M12', position: { x: 1, y: 0 }, ...over });
  return {
    ...fields,
    tag: 'SIZE',
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
};

const insertGeom = (attributes: unknown[] = [], over: Partial<Insert> = {}): EntityGeometry =>
  ({
    kind: 'INSERT',
    block: '52',
    position: { x: 10, y: 10 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: 0,
    attributes,
    ...over,
  }) as EntityGeometry;

describe('the type rows the palette edits (M2-35 part 2)', () => {
  it('offers a text’s style and justification as choices', () => {
    const s = setup(
      init([entityInit('61', textGeom()), entityInit('62', mtextGeom({ attachment: 5 }))]),
    );
    const text = propertySheet(s.model, s.ids('61'));
    const styleRow = rowOf(text, 'Style');
    expect(styleRow).toMatchObject({ kind: 'choice', value: '30' });
    expect(styleRow.readOnly).toBeUndefined();
    expect(styleRow.options).toEqual([
      { value: '30', label: 'Standard' },
      { value: '31', label: 'Notes' },
      { value: '32', label: 'Title' },
    ]);
    const justify = rowOf(text, 'Justify');
    expect(justify).toMatchObject({ kind: 'choice', value: 'Left' });
    expect(justify.readOnly).toBeUndefined();
    expect(justify.options?.map((o) => o.label)).toEqual([
      'Left',
      'Center',
      'Right',
      'Aligned',
      'Middle',
      'Fit',
      'Top left',
      'Top center',
      'Top right',
      'Middle left',
      'Middle center',
      'Middle right',
      'Bottom left',
      'Bottom center',
      'Bottom right',
    ]);
    const mtext = propertySheet(s.model, s.ids('62'));
    expect(rowOf(mtext, 'Style')).toMatchObject({ kind: 'choice', value: '30' });
    const mjustify = rowOf(mtext, 'Justify');
    expect(mjustify).toMatchObject({ kind: 'choice', value: 'Middle center' });
    expect(mjustify.options).toHaveLength(9);
  });

  it('sets a text’s style, taking a fixed-height style’s height', async () => {
    const s = setup(init([entityInit('61', textGeom()), entityInit('62', mtextGeom())]));
    const g = (h: string) => s.byHandle(h).geom as Text | MText;
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'style', value: '31' }, 'TEXT');
    expect(g('61')).toMatchObject({ style: '31', height: 2.5 });
    await s.bus.setProperty({ key: 'style', value: '32' }, 'TEXT');
    expect(g('61')).toMatchObject({ style: '32', height: 5 });
    await s.bus.setProperty({ key: 'style', value: '32' }, 'MTEXT');
    expect(g('62')).toMatchObject({ style: '32', height: 5 });
    await s.bus.setProperty({ key: 'style', value: '99' }, 'TEXT');
    expect(s.log.at(-1)).toBe('Invalid input.');
    expect(g('61').style).toBe('32');
    expect(s.bus.undo.state.undoable).toBe(3);
  });

  it('justifies a text about its insertion point, measured on the canvas', async () => {
    const s = setup(init([entityInit('61', textGeom())]), {
      corners: [],
      width: 8,
      below: 0.5,
    });
    const g = () => s.byHandle('61').geom as Text;
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'justify', value: 'Middle center' }, 'TEXT');
    expect(s.requests.filter((r) => r.op === 'textOutlines')).toHaveLength(1);
    expect(g()).toMatchObject({ halign: 1, valign: 2, alignmentPoint: { x: 1, y: 1 } });
    // DXF 10, which AutoCAD derives, is the baseline start the renderer draws from.
    expect(g().position.x).toBeCloseTo(-3, 12);
    expect(g().position.y).toBeCloseTo(-0.25, 12);
    expect(rowOf(propertySheet(s.model, s.ids('61')), 'Justify').value).toBe('Middle center');
    await s.bus.setProperty({ key: 'justify', value: 'Left' }, 'TEXT');
    expect(g()).toMatchObject({ halign: 0, valign: 0, position: { x: 1, y: 1 } });
    await s.bus.setProperty({ key: 'justify', value: 'Upwards' }, 'TEXT');
    expect(s.log.at(-1)).toBe('Invalid input.');
  });

  it('says a text no font measures cannot be fitted, and justifies it otherwise', async () => {
    const s = setup(init([entityInit('61', textGeom())]), null);
    const g = () => s.byHandle('61').geom as Text;
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'justify', value: 'Fit' }, 'TEXT');
    expect(g().halign).toBe(0);
    expect(s.log.at(-1)).toBe('1 object was not changed: its text cannot be measured.');
    await s.bus.setProperty({ key: 'justify', value: 'Top right' }, 'TEXT');
    expect(g()).toMatchObject({ halign: 2, valign: 3, alignmentPoint: { x: 1, y: 1 } });
  });

  it('justifies an MTEXT about its insertion point', async () => {
    const s = setup(init([entityInit('62', mtextGeom())]));
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'justify', value: 'Bottom right' }, 'MTEXT');
    expect(s.byHandle('62').geom).toMatchObject({ attachment: 9, position: { x: 2, y: 8 } });
    expect(s.requests.filter((r) => r.op === 'textOutlines')).toHaveLength(0);
  });

  it('scales a reference by X, Y and Z, its attributes following', async () => {
    const s = setup(init([entityInit('65', insertGeom([attribute()]))]));
    const g = () => s.byHandle('65').geom as Insert;
    const sheet = propertySheet(s.model, s.ids('65'));
    for (const label of ['Scale X', 'Scale Y', 'Scale Z']) {
      expect(rowOf(sheet, label).readOnly).toBeUndefined();
    }
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'scaleX', value: '2' }, 'INSERT');
    expect(g().scale).toEqual({ x: 2, y: 1, z: 1 });
    // The attribute 1 unit along the block's X axis is now 2 along it, its text twice as wide.
    expect(g().attributes[0]).toMatchObject({ position: { x: 12, y: 10 }, height: 2.5 });
    expect(g().attributes[0]!.widthFactor).toBeCloseTo(2, 12);
    await s.bus.setProperty({ key: 'scaleY', value: '3' }, 'INSERT');
    expect(g().scale).toEqual({ x: 2, y: 3, z: 1 });
    expect(g().attributes[0]!.height).toBeCloseTo(7.5, 12);
    expect(g().attributes[0]!.widthFactor).toBeCloseTo(2 / 3, 12);
    await s.bus.setProperty({ key: 'scaleZ', value: '4' }, 'INSERT');
    expect(g().scale).toEqual({ x: 2, y: 3, z: 4 });
    await s.bus.setProperty({ key: 'scaleX', value: '0' }, 'INSERT');
    expect(s.log.at(-1)).toBe('Invalid input.');
    expect(s.bus.undo.state.undoable).toBe(3);
    await s.bus.submit('U');
    await s.bus.submit('U');
    await s.bus.submit('U');
    expect(g().scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(g().attributes[0]).toMatchObject({ position: { x: 11, y: 10 }, height: 2.5 });
  });

  it('scales a turned reference along its own axes', async () => {
    const turned = attribute({ position: { x: 10, y: 11 }, rotation: Math.PI / 2 });
    const s = setup(
      init([entityInit('65', insertGeom([turned], { rotation: Math.PI / 2 }))]),
    );
    const g = () => s.byHandle('65').geom as Insert;
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'scaleX', value: '2' }, 'INSERT');
    const a = g().attributes[0]!;
    expect(a.position.x).toBeCloseTo(10, 12);
    expect(a.position.y).toBeCloseTo(12, 12);
    expect(a.rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(a.height).toBeCloseTo(2.5, 12);
    expect(a.widthFactor).toBeCloseTo(2, 12);
  });

  it('mirrors a reference given a negative scale, its attributes kept readable', async () => {
    const s = setup(init([entityInit('65', insertGeom([attribute()]))]));
    const g = () => s.byHandle('65').geom as Insert;
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'scaleX', value: '-1' }, 'INSERT');
    expect(g().scale).toEqual({ x: -1, y: 1, z: 1 });
    const a = g().attributes[0]!;
    // MIRRTEXT 0: the attribute lands in its mirror image's place and still reads left to right.
    expect(a.backward).toBe(false);
    expect(a.upsideDown).toBe(false);
    expect(Math.cos(a.rotation)).toBeCloseTo(1, 12);
    expect(a.height).toBeCloseTo(2.5, 12);
    expect(a.widthFactor).toBeCloseTo(1, 12);
    expect(a.halign).toBe(2);
    expect(a.alignmentPoint?.x).toBeCloseTo(9, 12);
    expect(a.alignmentPoint?.y).toBeCloseTo(10, 12);
  });

  it('sets a polyline’s global width', async () => {
    const pl: Polyline = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0, startWidth: 0.5, endWidth: 1 },
        { x: 1, y: 0, bulge: 0 },
        { x: 1, y: 1, bulge: 0 },
      ],
    } as Polyline;
    const s = setup(
      init([
        entityInit('66', pl),
        entityInit('67', { ...pl, vertices: pl.vertices.map(({ x, y }) => ({ x, y, bulge: 0 })) }),
      ]),
    );
    const width = () => rowOf(propertySheet(s.model, s.ids('66', '67')), 'Global width');
    expect(width()).toMatchObject({ kind: 'distance' });
    expect(width().varies).toBe(true);
    // One polyline whose segments differ shows *VARIES* too.
    expect(rowOf(propertySheet(s.model, s.ids('66')), 'Global width').varies).toBe(true);
    expect(rowOf(propertySheet(s.model, s.ids('67')), 'Global width').value).toBe(0);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'globalWidth', value: '0.25' }, 'LWPOLYLINE');
    for (const h of ['66', '67']) {
      const g = s.byHandle(h).geom as Polyline;
      expect(g.constantWidth).toBe(0.25);
      expect(g.vertices.every((v) => v.startWidth === undefined && v.endWidth === undefined)).toBe(
        true,
      );
    }
    expect(width().value).toBe(0.25);
    await s.bus.setProperty({ key: 'globalWidth', value: '-1' }, 'LWPOLYLINE');
    expect(s.log.at(-1)).toBe('Invalid input.');
  });
});
