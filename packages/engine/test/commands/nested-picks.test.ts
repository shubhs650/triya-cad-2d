// M5-06 part 5: the layer tools' picks of objects nested in blocks and xrefs (AutoCAD Help,
// "LAYOFF (Command)" and "LAYFRZ (Command)": Settings > Block selection, "Enter Block Selection
// nesting level [Block/Entity/None] <Block>"). The canvas says what a pick hit inside the
// reference it took (`nested`); this canvas answers from a table of picks.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type EntityGeometry,
  type NestedPick,
  type Vec2,
  type ViewHost,
} from '../../src/index';
import { blockRecord, entityInit, layer, lineGeom, sampleInit } from '../model/fixtures';
import { host } from './edit-harness';

const L0 = '10';
const WALLS = '11';
const DOORS = '12';
const HARDWARE = '13';
const NOTES = '15';
const FURN = '16';
const SITE_WALLS = '17';
const DOOR = '18';
const KNOB = '19';
const SITE = '1A';
const DOOR_REF = '2A';
const SITE_REF = '2C';
const NAMES: Record<string, string> = {
  [L0]: '0',
  [WALLS]: 'WALLS',
  [DOORS]: 'DOORS',
  [HARDWARE]: 'HARDWARE',
  [NOTES]: 'NOTES',
  [FURN]: 'FURN',
};

const insert = (block: string, x: number, attributes: unknown[] = []): EntityGeometry =>
  ({
    kind: 'INSERT',
    block,
    position: { x, y: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: 0,
    attributes,
  }) as unknown as EntityGeometry;

/** Where each pick lands, by name: what the canvas's `pick` and `nested` answer there. */
const PICKS = {
  /** DOOR's line on HARDWARE. */
  hardware: { at: { x: 1, y: 1 }, path: [DOOR_REF, '34'] },
  /** DOOR's line on layer 0. */
  zero: { at: { x: 2, y: 1 }, path: [DOOR_REF, '35'] },
  /** The line on 0 of KNOB, inserted on 0 in DOOR. */
  knob: { at: { x: 3, y: 1 }, path: [DOOR_REF, '36', '39'] },
  /** DOOR_REF's attribute on FURN. */
  attribute: { at: { x: 4, y: 1 }, path: [DOOR_REF], attribute: '3D' },
  /** On DOOR_REF, but on none of its contents. */
  nothing: { at: { x: 5, y: 1 } },
  /** The xref SITE's line on Site|Walls. */
  xref: { at: { x: 201, y: 1 }, path: [SITE_REF, '3C'] },
  /** The xref's line on layer 0. */
  xrefZero: { at: { x: 202, y: 1 }, path: [SITE_REF, '3E'] },
  /** The plain line on WALLS. */
  walls: { at: { x: 5, y: 50 } },
} as const satisfies Record<string, { at: Vec2; path?: readonly string[]; attribute?: string }>;
type PickName = keyof typeof PICKS;

/**
 * Layers 0, WALLS (current, holding a plain line 30), DOORS, HARDWARE, NOTES, FURN and the xref's
 * Site|Walls. Block DOOR holds a line on HARDWARE (34), one on 0 (35) and KNOB inserted on 0 (36,
 * KNOB holding a line on 0, 39); DOOR is inserted on DOORS (2A) with an attribute on FURN (3D).
 * The xref SITE holds a line on Site|Walls (3C) and one on 0 (3E), attached on NOTES (2C).
 */
function setup() {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    header: new Map([...(init.header ?? []), ['$CLAYER', 'WALLS']]),
    tables: {
      ...init.tables,
      layers: [
        ...[L0, WALLS, DOORS, HARDWARE, NOTES, FURN].map((h) => layer(h, NAMES[h]!)),
        { ...layer(SITE_WALLS, 'Site|Walls'), flags: 16 | 32 },
      ],
      blockRecords: [
        ...init.tables!.blockRecords!,
        blockRecord(DOOR, 'DOOR'),
        blockRecord(KNOB, 'KNOB'),
        { ...blockRecord(SITE, 'Site'), flags: 4 },
      ],
    },
    blocks: [
      ...init.blocks!,
      { handle: DOOR, name: 'DOOR', basePoint: { x: 0, y: 0 } },
      { handle: KNOB, name: 'KNOB', basePoint: { x: 0, y: 0 } },
      { handle: SITE, name: 'Site', basePoint: { x: 0, y: 0 } },
    ],
    entities: [
      entityInit('30', lineGeom(0, 50, 10, 50), { layer: WALLS }),
      entityInit('34', lineGeom(0, 0, 1, 0), { owner: DOOR, layer: HARDWARE }),
      entityInit('35', lineGeom(0, 0, 0, 1), { owner: DOOR, layer: L0 }),
      entityInit('36', insert(KNOB, 0), { owner: DOOR, layer: L0 }),
      entityInit('39', lineGeom(0, 0, 0.1, 0), { owner: KNOB, layer: L0 }),
      entityInit(
        DOOR_REF,
        insert(DOOR, 0, [{ handle: '3D', layer: FURN, tag: 'A', value: '1', flags: 0 }]),
        { layer: DOORS },
      ),
      entityInit('3C', lineGeom(0, 0, 1, 0), { owner: SITE, layer: SITE_WALLS }),
      entityInit('3E', lineGeom(0, 0, 0, 1), { owner: SITE, layer: L0 }),
      entityInit(SITE_REF, insert(SITE, 200), { layer: NOTES }),
    ],
  });
  const variables = new Map<string, number>([['LAYLOCKFADECTL', 50]]);
  const base = host(() => model, variables);
  const id = (h: string) => model.ids.idOf(h)!;
  const named = (p: Vec2) =>
    Object.values(PICKS).find((k) => k.at.x === p.x && k.at.y === p.y) as
      { at: Vec2; path?: readonly string[]; attribute?: string } | undefined;
  const asked: string[] = [];
  const view: ViewHost = {
    request: (r) => {
      if (r.op === 'pick') {
        const k = named(r.point);
        if (!k) return Promise.resolve({ ok: true, ids: [] });
        const top = k.at.y === 50 ? '30' : k.at.x > 100 ? SITE_REF : DOOR_REF;
        return Promise.resolve({ ok: true, ids: [id(top)] });
      }
      if (r.op === 'nested') {
        asked.push(model.ids.handleOf(r.id)!);
        const k = named(r.point);
        if (!k?.path) return Promise.resolve({ ok: true });
        const nested: NestedPick = {
          path: k.path.map(id),
          ...(k.attribute && { attribute: k.attribute }),
        };
        return Promise.resolve({ ok: true, nested });
      }
      return base.request(r);
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const lay = (h: string) => model.tables.layers.get(h)!;
  const pick = (name: PickName) => bus.pick(PICKS[name].at);
  const current = () => model.header.get('$CLAYER');
  return { model, bus, log, lay, pick, current, asked };
}

describe('LAYOFF and LAYFRZ: Block selection', () => {
  it('Block (the default) takes the layer of the block an object is nested in', async () => {
    const t = setup();
    await t.bus.script(['LAYOFF']);
    expect(t.log).toContain('Current settings: Viewports=Vpfreeze, Block nesting level=Block');
    await t.pick('hardware');
    expect(t.log).toContain('Layer "DOORS" has been turned off.');
    expect(t.lay(HARDWARE).on).toBe(true);
  });

  it('Block takes the layer of an object nested in an xref', async () => {
    const t = setup();
    await t.bus.script(['LAYOFF']);
    await t.pick('xref');
    expect(t.log).toContain('Layer "Site|Walls" has been turned off.');
    expect(t.lay(NOTES).on).toBe(true);
  });

  it('Settings asks the setting type; Entity takes the nested object’s layer', async () => {
    const t = setup();
    await t.bus.script(['LAYOFF', 'S']);
    expect(t.bus.promptText).toBe('Enter setting type for [Viewports/Block selection]:');
    await t.bus.script(['B']);
    expect(t.bus.promptText).toBe(
      'Enter Block Selection nesting level [Block/Entity/None] <Block>:',
    );
    await t.bus.script(['E']);
    await t.pick('hardware');
    expect(t.log).toContain('Layer "HARDWARE" has been turned off.');
    expect(t.lay(DOORS).on).toBe(true);
    // The setting is kept for the next LAYOFF, and offered as the default.
    await t.bus.script(['', 'LAYOFF']);
    expect(t.log).toContain('Current settings: Viewports=Vpfreeze, Block nesting level=Entity');
    await t.bus.script(['S', 'B']);
    expect(t.bus.promptText).toBe(
      'Enter Block Selection nesting level [Block/Entity/None] <Entity>:',
    );
  });

  it('Entity: an object on layer 0 is on the layer of the reference holding it, outward', async () => {
    const t = setup();
    await t.bus.script(['LAYOFF', 'S', 'B', 'E']);
    await t.pick('zero');
    expect(t.log).toContain('Layer "DOORS" has been turned off.');
    await t.bus.script(['U']);
    // KNOB's line on 0, in KNOB inserted on 0, in DOOR inserted on DOORS.
    await t.pick('knob');
    expect(t.lay(DOORS).on).toBe(false);
    await t.pick('xrefZero');
    expect(t.log).toContain('Layer "NOTES" has been turned off.');
  });

  it('None takes the reference itself, without asking the canvas', async () => {
    const t = setup();
    await t.bus.script(['LAYFRZ', 'S', 'B', 'N']);
    await t.pick('xref');
    expect(t.log).toContain('Layer "NOTES" has been frozen.');
    expect(t.lay(SITE_WALLS).frozen).toBe(false);
    expect(t.asked).toEqual([]);
  });

  it('LAYFRZ keeps its own setting; Viewports still asks the viewport choice', async () => {
    const t = setup();
    await t.bus.script(['LAYFRZ', 'S', 'B', 'E', '']);
    await t.bus.script(['LAYOFF']);
    expect(t.log).toContain('Current settings: Viewports=Vpfreeze, Block nesting level=Block');
    await t.bus.script(['', 'LAYFRZ', 'S', 'V']);
    expect(t.bus.promptText).toBe('In paper space viewport use [Freeze/Vpfreeze] <Vpfreeze>:');
    await t.bus.script(['F']);
    expect(t.log).toContain('Current settings: Viewports=Vpfreeze, Block nesting level=Entity');
    await t.bus.script(['']);
    await t.bus.script(['LAYFRZ']);
    expect(t.log).toContain('Current settings: Viewports=Freeze, Block nesting level=Entity');
  });

  it('a pick on a reference that hits none of its contents takes the reference', async () => {
    const t = setup();
    await t.bus.script(['LAYFRZ', 'S', 'B', 'E']);
    await t.pick('nothing');
    expect(t.log).toContain('Layer "DOORS" has been frozen.');
  });

  it('Entity never freezes the current layer, nested or not', async () => {
    const t = setup();
    await t.bus.script(['LAYFRZ', 'S', 'B', 'E']);
    await t.pick('walls');
    expect(t.log).toContain('Cannot freeze layer "WALLS".  It is the CURRENT layer.');
    expect(t.asked).toEqual([]);
  });
});

describe('the other layer tools take the nested object', () => {
  it('LAYLCK locks the nested object’s layer, an attribute’s own, and LAYULK unlocks it', async () => {
    const t = setup();
    await t.bus.script(['LAYLCK']);
    await t.pick('hardware');
    expect(t.log).toContain('Layer "HARDWARE" has been locked.');
    await t.bus.script(['LAYLCK']);
    await t.pick('attribute');
    expect(t.log).toContain('Layer "FURN" has been locked.');
    await t.bus.script(['LAYULK']);
    await t.pick('xref');
    expect(t.log).toContain('Layer "Site|Walls" is not locked.');
    await t.bus.script(['LAYULK']);
    await t.pick('hardware');
    expect(t.lay(HARDWARE).locked).toBe(false);
  });

  it('LAYMCUR makes a nested layer current, and refuses an xref’s', async () => {
    const t = setup();
    await t.bus.script(['LAYMCUR']);
    await t.pick('xref');
    expect(t.log).toContain('Layer "Site|Walls" is xref-dependent and cannot be made current.');
    expect(t.current()).toBe('WALLS');
    await t.bus.script(['LAYMCUR']);
    await t.pick('hardware');
    expect(t.current()).toBe('HARDWARE');
  });

  it('LAYISO isolates the layers of the nested objects picked; an xref layer is never made current', async () => {
    const t = setup();
    await t.bus.script(['LAYISO']);
    await t.pick('xref');
    await t.bus.script(['']);
    expect(t.log).toContain('Layer "Site|Walls" has been isolated.');
    expect(t.lay(SITE_WALLS).locked).toBe(false);
    expect(t.lay(DOORS).locked).toBe(true);
    expect(t.current()).toBe('WALLS');
    await t.bus.script(['LAYUNISO', 'LAYISO']);
    await t.pick('hardware');
    await t.pick('xref');
    await t.bus.script(['']);
    expect(t.log).toContain('2 layers have been isolated.');
    expect(t.current()).toBe('HARDWARE');
  });

  it('LAYDEL refuses an xref’s layer picked; LAYMRG takes nested layers and a nested target', async () => {
    const t = setup();
    await t.bus.script(['LAYDEL']);
    await t.pick('xref');
    expect(t.log).toContain('Layer "Site|Walls" is xref-dependent and cannot be deleted.');
    await t.bus.script(['']);
    await t.bus.script(['LAYMRG']);
    await t.pick('attribute');
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe('Select object on target layer or [Name]:');
    await t.pick('hardware');
    expect(t.log).toContain('You are about to merge layer "FURN" into layer "HARDWARE".');
    await t.bus.script(['Y']);
    expect(t.model.tables.layers.has(FURN)).toBe(false);
  });
});
