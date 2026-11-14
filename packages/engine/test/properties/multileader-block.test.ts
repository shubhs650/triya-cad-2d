// M2-35 part 15: a block multileader's Block rows in the Properties palette (AutoCAD's help does
// not list them; they follow ActiveX AcadMLeader's ContentBlockName and BlockScale and the
// context data's block colour and rotation, labelled as MLEADERSTYLE's Block options are): Source
// block, Block color, Block scale and Block rotation. Each edit flags its DXF 90 bit (the ODA
// specification's BLOCK_CONTENT_ID 19, _COLOR 20, _SCALE 21, _ROTATION 22, as ezdxf names them)
// and keeps the side of the block that faces the landing where it was.
//
// M2-66: MULTILEADER's own flags for block content and an overall scale are those bits too.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  MLEADER_OVERRIDES,
  PromptBus,
  builtinCommands,
  multiLeaderParts,
  newMultiLeader,
  propertySheet,
  settingsOf,
  standardMLeaderStyle,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type MLeaderStyleRecord,
  type MultiLeaderGeometry,
  type PropertyRow,
  type PropertySheet,
} from '../../src/index';
import { blockRecord, circleGeom, entityInit, sampleInit } from '../model/fixtures';

const STANDARD_TEXT = '30';
const STANDARD = '35';
const TAG = '37';
const ATTDEF = '38';
const PLAIN = '3F';
const BIG = '40';

const style: MLeaderStyleRecord = {
  handle: STANDARD,
  ...standardMLeaderStyle(true, STANDARD_TEXT),
  contentType: 1,
  block: TAG,
};

const attdef = (tag: string, prompt: string, value: string, flags = 0) => ({
  kind: 'ATTDEF' as const,
  tag,
  prompt,
  value,
  flags,
  style: STANDARD_TEXT,
  position: { x: 0, y: 0 },
  height: 0.5,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
});

/**
 * A TAG multileader from (0, 0) to a landing at (10, 10) running right to (19, 10): the circle
 * of radius 1 about the block's base point sits with its left edge on the landing's end.
 */
function blockLeader(over: Partial<MultiLeaderGeometry> = {}): MultiLeaderGeometry {
  const g = newMultiLeader({
    style,
    settings: settingsOf(style),
    vertices: [{ x: 0, y: 0 }],
    landing: { connection: { x: 10, y: 10 }, direction: { x: 1, y: 0 }, end: { x: 19, y: 10 } },
    scale: 1,
    block: {
      block: TAG,
      position: { x: 20, y: 10 },
      attributes: [{ definition: ATTDEF, index: 0, width: 1, value: 'A7' }],
    },
  });
  return { ...g, ...over };
}

function textLeader(): MultiLeaderGeometry {
  const { block: _b, ...g } = blockLeader();
  return {
    ...g,
    contentType: 2,
    text: {
      content: 'VALVE',
      style: STANDARD_TEXT,
      position: { x: 20, y: 12 },
      rotation: 0,
      height: 4,
      width: 0,
      boundaryHeight: 0,
      lineSpacing: 1,
      lineSpacingStyle: 1,
      attachment: 1,
      flow: 1,
      color: { kind: 'byBlock' },
    } as NonNullable<MultiLeaderGeometry['text']>,
  };
}

function setup(entities: NonNullable<DocumentInit['entities']>, styles = [style]) {
  const base = sampleInit();
  const model = DocumentModel.create({
    ...base,
    tables: {
      ...base.tables,
      blockRecords: [
        ...(base.tables?.blockRecords ?? []),
        blockRecord(TAG, 'TAG'),
        blockRecord(PLAIN, 'PLAIN'),
        blockRecord(BIG, '*U5'),
      ],
      textStyles: [
        {
          handle: STANDARD_TEXT,
          name: 'Standard',
          font: 'txt',
          height: 0,
          widthFactor: 1,
          obliqueAngle: 0,
          lastHeight: 2.5,
          generation: 0,
          trueTypeFlags: 0,
        },
      ],
      mleaderStyles: styles,
    },
    blocks: [
      ...(base.blocks ?? []),
      { handle: TAG, name: 'TAG', basePoint: { x: 0, y: 0 } },
      { handle: PLAIN, name: 'PLAIN', basePoint: { x: 1, y: 1 } },
      { handle: BIG, name: '*U5', basePoint: { x: 0, y: 0 } },
    ],
    entities: [
      entityInit('39', circleGeom(0, 0, 1), { owner: TAG }),
      entityInit(ATTDEF, attdef('NO', 'Tag number', '1'), { owner: TAG }),
      // A constant attribute is the block's own; the multileader states no value for it.
      entityInit('3B', attdef('KIND', 'Kind', 'K', 2), { owner: TAG }),
      entityInit('3C', attdef('NAME', '', 'N'), { owner: TAG }),
      // Radius 2 about the base point (1, 1): extents −2…2 from it.
      entityInit('3D', circleGeom(1, 1, 2), { owner: PLAIN }),
      entityInit('41', circleGeom(0, 0, 5), { owner: BIG }),
      ...entities,
    ],
  });
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: () => Promise.resolve({ ok: true }) },
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const byHandle = (h: string): Entity => model.entityByHandle(h)!;
  const ids = (...hs: string[]) => hs.map((h) => byHandle(h).id);
  const leader = (h: string) => byHandle(h).geom as MultiLeaderGeometry;
  const set = async (key: string, value: string) => {
    await bus.setProperty({ key, value }, 'MULTILEADER');
  };
  return { model, bus, log, ids, leader, set };
}

const rows = (sheet: PropertySheet): PropertyRow[] => sheet.sections.flatMap((s) => s.rows);
const rowOf = (sheet: PropertySheet, label: string): PropertyRow | undefined =>
  rows(sheet).find((x) => x.label === label);
const bit = (g: MultiLeaderGeometry, n: number): boolean => (g.overrideFlags & (1 << n)) !== 0;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pt = (p: { x: number; y: number }) => [r6(p.x), r6(p.y)];

describe('MULTILEADER override bits (M2-66)', () => {
  it('uses the ODA specification’s bits for block content and the overall scale', () => {
    expect(MLEADER_OVERRIDES).toMatchObject({
      contentType: 1 << 10,
      blockContent: 1 << 19,
      blockColor: 1 << 20,
      blockScale: 1 << 21,
      blockRotation: 1 << 22,
      scale: 1 << 24,
    });
  });

  it('flags a block multileader at another scale with bits 10, 19 and 24, not 17 or 22', () => {
    const { block: _b, ...rest } = style;
    const text: MLeaderStyleRecord = { ...rest, contentType: 2 };
    const g = newMultiLeader({
      style: text,
      settings: { ...settingsOf(text), contentType: 1 },
      vertices: [{ x: 0, y: 0 }],
      landing: { connection: { x: 10, y: 10 }, direction: { x: 1, y: 0 }, end: { x: 19, y: 10 } },
      scale: 2,
      block: { block: TAG, position: { x: 20, y: 10 }, attributes: [] },
    });
    expect(g.overrideFlags).toBe((1 << 10) | (1 << 19) | (1 << 24));
  });
});

describe('a block multileader’s Block rows (M2-35 part 15)', () => {
  it('shows Block after Leaders for multileaders that all hold a block', () => {
    const s = setup([
      entityInit(
        '60',
        blockLeader({ scale: 2, block: { ...blockLeader().block!, scale: { x: 3, y: 3, z: 3 } } }),
      ),
      entityInit('61', textLeader()),
      entityInit('62', blockLeader()),
    ]);
    const one = propertySheet(s.model, s.ids('60'));
    expect(one.sections.map((x) => x.title)).toEqual(['General', 'Leaders', 'Block']);
    const block = one.sections.find((x) => x.title === 'Block')!;
    expect(block.rows.map((r) => r.label)).toEqual([
      'Source block',
      'Block color',
      'Block scale',
      'Block rotation',
    ]);
    // Named blocks only: not anonymous, not a layout's.
    expect(rowOf(one, 'Source block')).toMatchObject({
      kind: 'choice',
      value: TAG,
      options: [
        { value: PLAIN, label: 'PLAIN' },
        { value: TAG, label: 'TAG' },
      ],
    });
    expect(rowOf(one, 'Block color')).toMatchObject({
      kind: 'choice',
      value: 'ByBlock',
      colorDialog: 'true',
    });
    // The block's own scale: what it draws at over the overall scale.
    expect(rowOf(one, 'Block scale')).toMatchObject({ kind: 'number', value: 1.5 });
    expect(rowOf(one, 'Block rotation')).toMatchObject({ kind: 'angle', value: 0 });
    // Text content, or text and block content together: no Block rows.
    expect(propertySheet(s.model, s.ids('61')).sections.map((x) => x.title)).toEqual([
      'General',
      'Leaders',
      'Text',
    ]);
    expect(propertySheet(s.model, s.ids('60', '61')).sections.map((x) => x.title)).toEqual([
      'General',
      'Leaders',
    ]);
    const both = propertySheet(s.model, s.ids('60', '62'));
    expect(rowOf(both, 'Block scale')?.varies).toBe(true);
    expect(rowOf(both, 'Source block')?.value).toBe(TAG);
  });

  it('sets another source block, its attributes at their defaults, the facing side kept', async () => {
    const s = setup([entityInit('60', blockLeader())]);
    await s.bus.selectAll();
    await s.set('sourceBlock', PLAIN);
    let g = s.leader('60');
    expect(g.block!.block).toBe(PLAIN);
    expect(bit(g, 19)).toBe(true);
    expect(bit(g, 17)).toBe(false);
    // PLAIN asks for nothing.
    expect(g.block!.attributes).toBeUndefined();
    // Its left edge (2 left of its base point) stays at x = 19, its middle on the landing.
    expect(pt(g.block!.position)).toEqual([21, 10]);
    const insert = multiLeaderParts(g, s.model).at(-1)!;
    expect(insert.geom).toMatchObject({ kind: 'INSERT', block: PLAIN });
    await s.set('sourceBlock', TAG);
    g = s.leader('60');
    expect(pt(g.block!.position)).toEqual([20, 10]);
    // TAG's attributes as MLEADER asks for them: the definitions' values; not the constant one.
    expect(g.block!.attributes).toEqual([
      { definition: ATTDEF, index: 0, width: 1, value: '1' },
      { definition: '3C', index: 1, width: 1, value: 'N' },
    ]);
    await s.bus.submit('U');
    expect(s.leader('60').block!.block).toBe(PLAIN);
    const before = s.leader('60');
    for (const value of [BIG, 'FFFF', '']) {
      await s.set('sourceBlock', value);
      expect(s.log.at(-1), value).toBe('Invalid input.');
    }
    expect(s.leader('60')).toEqual(before);
  });

  it('sets the block colour', async () => {
    const s = setup([entityInit('60', blockLeader())]);
    await s.bus.selectAll();
    await s.set('blockColor', 'aci:1');
    expect(s.leader('60').block!.color).toEqual({ kind: 'aci', index: 1 });
    expect(bit(s.leader('60'), 20)).toBe(true);
    await s.set('blockColor', 'rgb:10,20,30');
    expect(s.leader('60').block!.color).toEqual({ kind: 'rgb', r: 10, g: 20, b: 30 });
    await s.set('blockColor', 'teal');
    expect(s.log.at(-1)).toBe('Invalid input.');
  });

  it('scales the block about the side facing the landing, times the overall scale', async () => {
    const s = setup([
      entityInit('60', blockLeader()),
      entityInit(
        '61',
        blockLeader({ scale: 2, block: { ...blockLeader().block!, scale: { x: 2, y: 2, z: 2 } } }),
      ),
    ]);
    await s.bus.selectAll();
    await s.set('blockScale', '1.5');
    const g = s.leader('60');
    expect(g.block!.scale).toEqual({ x: 1.5, y: 1.5, z: 1.5 });
    expect(bit(g, 21)).toBe(true);
    // The circle is 1.5 wide on each side now; its left edge stays at x = 19.
    expect(pt(g.block!.position)).toEqual([20.5, 10]);
    expect(s.leader('61').block!.scale).toEqual({ x: 3, y: 3, z: 3 });
    expect(pt(s.leader('61').block!.position)).toEqual([21, 10]);
    for (const value of ['0', '-1', 'x']) {
      await s.set('blockScale', value);
      expect(s.log.at(-1), value).toBe('Invalid input.');
    }
  });

  it('keeps a landing on the left at the block’s right edge, and the base point where it connects', async () => {
    const left = blockLeader({
      branches: blockLeader().branches.map((b) => ({ ...b, direction: { x: -1, y: 0 } })),
      block: { ...blockLeader().block!, position: { x: 0, y: 10 } },
    });
    const based: MLeaderStyleRecord = { ...style, handle: '42', blockConnection: 1 };
    const s = setup(
      [entityInit('60', left), entityInit('61', { ...blockLeader(), style: '42' })],
      [style, based],
    );
    await s.bus.selectAll();
    await s.set('blockScale', '2');
    // Right edge stays at x = 1.
    expect(pt(s.leader('60').block!.position)).toEqual([-1, 10]);
    // By its base point: the insertion point stays.
    expect(pt(s.leader('61').block!.position)).toEqual([20, 10]);
  });

  it('turns the block, its facing side kept', async () => {
    const s = setup([
      entityInit(
        '60',
        blockLeader({
          block: { ...blockLeader().block!, block: PLAIN, position: { x: 21, y: 10 } },
        }),
      ),
    ]);
    await s.bus.selectAll();
    await s.set('blockRotation', '90');
    const g = s.leader('60');
    expect(g.block!.rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(bit(g, 22)).toBe(true);
    // A circle about its base point keeps its box.
    expect(pt(g.block!.position)).toEqual([21, 10]);
    await s.set('blockRotation', 'x');
    expect(s.log.at(-1)).toBe('Invalid input.');
  });

  it('refuses an annotative multileader’s block, which each scale keeps', async () => {
    const s = setup([entityInit('60', blockLeader({ annotative: true }))]);
    await s.bus.selectAll();
    for (const [key, value] of [
      ['sourceBlock', PLAIN],
      ['blockColor', 'aci:1'],
      ['blockScale', '2'],
      ['blockRotation', '30'],
    ] as const) {
      await s.set(key, value);
      expect(s.log.at(-1), key).toMatch(/1 object was not changed: annotative/);
    }
    expect(s.leader('60')).toEqual(blockLeader({ annotative: true }));
  });

  it('leaves a text multileader alone', async () => {
    const s = setup([entityInit('61', textLeader())]);
    await s.bus.selectAll();
    await s.set('blockScale', '2');
    expect(s.leader('61')).toEqual(textLeader());
  });
});
