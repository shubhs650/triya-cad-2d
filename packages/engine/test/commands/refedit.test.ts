// M5-02 part 3: in-place reference editing on the PromptBus, as AutoCAD 2024's (AutoCAD Help,
// "REFEDIT (Command)", "-REFEDIT", "Reference Edit Dialog Box", "REFSET (Command)", "REFCLOSE
// (Command)", "REFEDITNAME (System Variable)"):
//   - REFEDIT: "Select reference:", then the Reference Edit dialog (the reference picked and the
//     ones nested in it under the pick; all nested objects or "Select nested objects:"; attribute
//     definitions shown or not; objects not in the working set locked or not); the working set is
//     edited in place, where the references put it, and objects drawn meanwhile join it;
//   - REFSET Add/Remove moves objects between the working set and the drawing;
//   - REFCLOSE Save carries the working set back into the block (every reference follows), what
//     was not edited exactly as it was; Discard takes every change back.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type DialogRequest,
  type EntityGeometry,
  type InsertGeometry,
  type NestedPick,
  type RefEditSettings,
  type Vec2,
  type ViewHost,
} from '../../src/index';
import { blockRecord, entityInit, layer, lineGeom, sampleInit } from '../model/fixtures';
import { host } from './edit-harness';

const L0 = '10';
const WALLS = '11';
const LOCKED = '12';
const DOOR = '18';
const KNOB = '19';
const DOOR_REF = '2A';
const PLAIN_REF = '2B';
const TALL_REF = '2D';
const MODEL = '1F';

const insert = (
  block: string,
  at: Vec2,
  o: { scale?: Vec2; rotation?: number } = {},
): EntityGeometry =>
  ({
    kind: 'INSERT',
    block,
    position: at,
    scale: { x: o.scale?.x ?? 1, y: o.scale?.y ?? 1, z: 1 },
    rotation: o.rotation ?? 0,
    attributes: [],
  }) as unknown as EntityGeometry;

/** Picks on the references, by name: what the canvas's `pick` and `nested` answer there. */
const PICKS = {
  /** DOOR's line 34, through the reference turned and scaled (2A). */
  line: { at: { x: 99, y: 101 }, path: [DOOR_REF, '34'] },
  /** DOOR's circle 35. */
  circle: { at: { x: 98, y: 102 }, path: [DOOR_REF, '35'] },
  /** KNOB's line 39, inserted in DOOR (36). */
  knob: { at: { x: 101, y: 100.1 }, path: [DOOR_REF, '36', '39'] },
  /** The reference scaled 1 by 2 (2D). */
  tall: { at: { x: 300, y: 1 }, path: [TALL_REF, '34'] },
} as const satisfies Record<string, { at: Vec2; path: readonly string[] }>;
type PickName = keyof typeof PICKS;

/**
 * Layers 0, WALLS and LOCKED (locked). Block DOOR (base 0,0) holds line 34 (0,0)-(1,0) and circle
 * 35 at (1,0) r 0.5 on 0, a reference to KNOB (36), an attribute definition (37) and line 38 on
 * LOCKED; KNOB holds line 39 (0,0)-(0.1,0). DOOR is referenced at (100,100) scaled 2 and turned
 * 90° (2A), at 0,0 plainly (2B) and scaled 1 by 2 (2D); model space has line 30 on WALLS too.
 */
function setup() {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    tables: {
      ...init.tables,
      layers: [layer(L0, '0'), layer(WALLS, 'WALLS'), { ...layer(LOCKED, 'LOCKED'), locked: true }],
      blockRecords: [
        ...init.tables!.blockRecords!,
        blockRecord(DOOR, 'DOOR'),
        blockRecord(KNOB, 'KNOB'),
      ],
    },
    blocks: [
      ...init.blocks!,
      { handle: DOOR, name: 'DOOR', basePoint: { x: 0, y: 0 } },
      { handle: KNOB, name: 'KNOB', basePoint: { x: 0, y: 0 } },
    ],
    entities: [
      entityInit('30', lineGeom(0, 50, 10, 50), { layer: WALLS }),
      entityInit('34', lineGeom(0, 0, 1, 0), { owner: DOOR, layer: L0 }),
      entityInit(
        '35',
        { kind: 'CIRCLE', center: { x: 1, y: 0 }, radius: 0.5 },
        { owner: DOOR, layer: L0 },
      ),
      entityInit('36', insert(KNOB, { x: 0, y: 0 }), { owner: DOOR, layer: L0 }),
      entityInit(
        '37',
        {
          kind: 'ATTDEF',
          tag: 'NO',
          prompt: 'Number',
          value: '1',
          flags: 0,
          position: { x: 0, y: -1 },
          height: 0.25,
          rotation: 0,
          style: '16',
        } as unknown as EntityGeometry,
        { owner: DOOR, layer: L0 },
      ),
      entityInit('38', lineGeom(0, 0, 0, 1), { owner: DOOR, layer: LOCKED }),
      entityInit('39', lineGeom(0, 0, 0.1, 0), { owner: KNOB, layer: L0 }),
      entityInit(
        '3B',
        {
          kind: 'CIRCLE',
          center: { x: 0, y: 0 },
          radius: 0.05,
          normal: { x: 1, y: 0, z: 0 },
        } as unknown as EntityGeometry,
        { owner: KNOB, layer: L0 },
      ),
      entityInit(
        DOOR_REF,
        insert(DOOR, { x: 100, y: 100 }, { scale: { x: 2, y: 2 }, rotation: Math.PI / 2 }),
        { layer: WALLS },
      ),
      entityInit(PLAIN_REF, insert(DOOR, { x: 0, y: 0 }), { layer: WALLS }),
      entityInit(TALL_REF, insert(DOOR, { x: 300, y: 0 }, { scale: { x: 1, y: 2 } }), {
        layer: WALLS,
      }),
    ],
  });
  const base = host(() => model);
  const id = (h: string) => model.ids.idOf(h)!;
  const handle = (i: number) => model.ids.handleOf(i)!;
  const named = (p: Vec2) =>
    Object.values(PICKS).find((k) => k.at.x === p.x && k.at.y === p.y) as
      { at: Vec2; path: readonly string[] } | undefined;
  const view: ViewHost = {
    request: (r) => {
      if (r.op === 'pick') {
        const k = named(r.point);
        if (k) return Promise.resolve({ ok: true, ids: [id(k.path[0]!)] });
      }
      if (r.op === 'nested') {
        const k = named(r.point);
        if (!k) return Promise.resolve({ ok: true });
        const nested: NestedPick = { path: k.path.map(id) };
        return Promise.resolve({ ok: true, nested });
      }
      return base.request(r);
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  const log: string[] = [];
  const events: Extract<BusEvent, { type: 'refEdit' }>[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
    if (e.type === 'refEdit') events.push(e);
  });
  const pick = (name: PickName) => bus.pick(PICKS[name].at);
  const contents = (block: string) => model.blockEntities(block).map(handle);
  const geom = (h: string) => model.entity(id(h))!.geom;
  const owner = (h: string) => model.entity(id(h))!.owner;
  const dialog = () => (bus.prompt as { dialog?: DialogRequest } | undefined)?.dialog;
  const name = async () => {
    await bus.script(['SETVAR', 'REFEDITNAME']);
    return log.at(-1)!;
  };
  /** REFEDIT on `at` with the dialog's OK on the reference `chosen`, with `settings`. */
  const refedit = async (at: PickName, chosen = 0, settings: Partial<RefEditSettings> = {}) => {
    await bus.submit('REFEDIT');
    await pick(at);
    const d = dialog() as Extract<DialogRequest, { type: 'refedit' }>;
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      refedit: { chosen, settings: { ...d.settings, ...settings } },
    });
  };
  return { model, bus, log, events, id, contents, geom, owner, dialog, name, pick, refedit };
}

const near = (p: Vec2, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
};
const lineOf = (g: EntityGeometry) => g as Extract<EntityGeometry, { kind: 'LINE' }>;

describe('REFEDIT', () => {
  it('opens Reference Edit on the reference picked; OK carries its block out where it draws it', async () => {
    const t = setup();
    await t.bus.submit('REFEDIT');
    expect(t.bus.promptText).toBe('Select reference:');
    await t.pick('line');
    const d = t.dialog() as Extract<DialogRequest, { type: 'refedit' }>;
    expect(d).toEqual({
      type: 'refedit',
      references: [{ name: 'DOOR', block: DOOR }],
      chosen: 0,
      settings: { prompt: false, unique: true, attributes: false, lock: true },
    });
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      refedit: { chosen: 0, settings: d.settings },
    });
    expect(t.bus.promptText).toBe('Command:');
    // Everything but the attribute definition, the locked layer's line too, keeping handles.
    expect(t.contents(DOOR)).toEqual(['37']);
    expect(t.contents(MODEL)).toEqual([
      '30',
      DOOR_REF,
      PLAIN_REF,
      TALL_REF,
      '34',
      '35',
      '36',
      '38',
    ]);
    // Turned 90° and scaled 2 about (100,100).
    near(lineOf(t.geom('34')).start, 100, 100);
    near(lineOf(t.geom('34')).end, 100, 102);
    expect(t.log).toContain(
      'Use REFCLOSE or the Edit Reference bar to end reference editing session.',
    );
    expect(t.log).toContain('4 objects in the working set.');
    expect(await t.name()).toMatch(/REFEDITNAME = "DOOR"/);
    expect(t.events.at(-1)).toMatchObject({
      type: 'refEdit',
      name: 'DOOR',
      working: ['34', '35', '36', '38'].map(t.id),
    });
  });

  it('tells the canvas how the other references draw the block while it is edited (part 5)', async () => {
    const t = setup();
    const was = new Map(t.contents(DOOR).map((h) => [h, t.model.entity(t.id(h))]));
    await t.refedit('line');
    // The first event of the edit: the block as it was, for every reference but the one edited.
    const first = t.events.at(-1)!;
    expect(first.held).toEqual({
      block: DOOR,
      path: [t.id(DOOR_REF)],
      order: ['34', '35', '36', '37', '38'].map(t.id),
      entities: ['34', '35', '36', '38'].map((h) => was.get(h)),
    });
    // Later ones carry only the working set: a line drawn joins it.
    await t.bus.script(['LINE', '0,0', '0,1', '']);
    const drawn = t.events.at(-1)!;
    expect(drawn.held).toBeUndefined();
    expect(drawn.working).toHaveLength(5);
    // U back past REFEDIT ends it; REDO resumes it, the block as it was sent again.
    await t.bus.submit('U');
    await t.bus.submit('U');
    expect(t.events.at(-1)).toEqual({ type: 'refEdit', working: [] });
    await t.bus.submit('REDO');
    expect(t.events.at(-1)!.held?.order).toEqual(first.held!.order);
    // Nested: the path runs from the reference picked to the one edited.
    await t.bus.script(['REFCLOSE', 'D']);
    await t.bus.submit('REFEDIT');
    await t.pick('knob');
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      refedit: {
        chosen: 1,
        settings: (t.dialog() as Extract<DialogRequest, { type: 'refedit' }>).settings,
      },
    });
    expect(t.events.at(-1)!.held).toMatchObject({
      block: KNOB,
      path: [DOOR_REF, '36'].map(t.id),
      order: ['39', '3B'].map(t.id),
    });
  });

  it('Save carries the working set back: edits reach every reference, the rest exactly as it was', async () => {
    const t = setup();
    const before = t.model.entity(t.id('34'));
    await t.refedit('line');
    await t.bus.script(['ERASE']);
    await t.bus.pick({ x: 100, y: 103 });
    await t.bus.script(['']);
    await t.bus.script(['LINE', '100,100', '98,100', '']);
    const drawn = t.contents(MODEL).at(-1)!;
    expect(t.events.at(-1)!.working).toContain(t.id(drawn));
    await t.bus.script(['REFCLOSE']);
    expect(t.bus.promptText).toBe('Enter option [Save/Discard reference changes] <Save>:');
    await t.bus.script(['']);
    expect(t.log.at(-1)).toBe('Block "DOOR" redefined: reference edits saved.');
    expect(t.contents(MODEL)).toEqual(['30', DOOR_REF, PLAIN_REF, TALL_REF]);
    expect(t.contents(DOOR)).toEqual(['37', '34', '36', '38', drawn]);
    // Untouched: exactly the object it was, but for its place in the block.
    expect(t.model.entity(t.id('34'))).toEqual(before);
    // The new line in the block's own coordinates: (0,0)-(0,1).
    near(lineOf(t.geom(drawn)).start, 0, 0);
    near(lineOf(t.geom(drawn)).end, 0, 1);
    expect(await t.name()).toMatch(/REFEDITNAME = ""/);
    expect(t.events.at(-1)).toEqual({ type: 'refEdit', working: [] });
  });

  it('Discard takes every change back; U brings the edit back', async () => {
    const t = setup();
    const was = t.contents(DOOR).map((h) => t.model.entity(t.id(h)));
    await t.refedit('line');
    await t.bus.script(['ERASE']);
    await t.bus.pick({ x: 100, y: 103 });
    await t.bus.script(['', 'LINE', '0,0', '5,5', '', 'REFCLOSE', 'D']);
    expect(t.log.at(-1)).toBe('Reference edits discarded.');
    expect(t.contents(DOOR).map((h) => t.model.entity(t.id(h)))).toEqual(was);
    expect(t.contents(MODEL)).toEqual(['30', DOOR_REF, PLAIN_REF, TALL_REF]);
    await t.bus.submit('U');
    expect(await t.name()).toMatch(/REFEDITNAME = "DOOR"/);
    expect(t.owner('34')).toBe(MODEL);
  });

  it('U back past REFEDIT ends the edit, REDO resumes it; U after Save resumes it', async () => {
    const t = setup();
    await t.refedit('line');
    await t.bus.submit('U');
    expect(await t.name()).toMatch(/REFEDITNAME = ""/);
    expect(t.owner('34')).toBe(DOOR);
    await t.bus.submit('REDO');
    expect(await t.name()).toMatch(/REFEDITNAME = "DOOR"/);
    expect(t.owner('34')).toBe(MODEL);
    await t.bus.script(['REFCLOSE', 'S']);
    expect(t.owner('34')).toBe(DOOR);
    await t.bus.submit('U');
    expect(await t.name()).toMatch(/REFEDITNAME = "DOOR"/);
    expect(t.owner('34')).toBe(MODEL);
    // Saved again from there.
    await t.bus.script(['REFCLOSE', '']);
    expect(t.owner('34')).toBe(DOOR);
    expect(t.contents(MODEL)).toEqual(['30', DOOR_REF, PLAIN_REF, TALL_REF]);
  });

  it('locks objects not in the working set; REFSET moves objects in and out of it', async () => {
    const t = setup();
    await t.refedit('line');
    await t.bus.script(['ERASE', '5,50', '']);
    expect(t.log).toContain('1 was not in the working set.');
    expect(t.model.entity(t.id('30'))).toBeDefined();
    await t.bus.script(['REFSET']);
    expect(t.bus.promptText).toBe('Enter an option [Add/Remove] <Add>:');
    await t.bus.script(['', '5,50', '']);
    expect(t.log.at(-1)).toBe('1 Added to working set');
    // The reference being edited cannot go into its own block.
    await t.bus.script(['REFSET', 'A']);
    await t.pick('circle');
    await t.bus.script(['']);
    expect(t.log).toContain('1 holds a reference to "DOOR".');
    await t.bus.script(['REFSET', 'R', '100,101', '']);
    expect(t.log.at(-1)).toBe('1 Removed from working set');
    await t.bus.script(['REFCLOSE', 'S']);
    // Line 30 went into the block, by the inverse placement; line 34 stayed in the drawing.
    expect(t.owner('30')).toBe(DOOR);
    near(lineOf(t.geom('30')).start, -25, 50);
    expect(t.owner('34')).toBe(MODEL);
  });

  it('with Lock objects not in working set off, the drawing stays editable', async () => {
    const t = setup();
    await t.refedit('line', 0, { lock: false });
    await t.bus.script(['ERASE', '5,50', '']);
    expect(t.model.blockEntities(MODEL).map((i) => t.model.ids.handleOf(i))).not.toContain('30');
  });

  it('edits a reference nested under the pick, placed by both references', async () => {
    const t = setup();
    await t.bus.submit('REFEDIT');
    await t.pick('knob');
    const d = t.dialog() as Extract<DialogRequest, { type: 'refedit' }>;
    expect(d.references.map((r) => r.name)).toEqual(['DOOR', 'KNOB']);
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      refedit: { chosen: 1, settings: d.settings },
    });
    // A circle out of the XY plane cannot be turned: it stays in the block.
    expect(t.contents(KNOB)).toEqual(['3B']);
    expect(t.log).toContain('1 could not be edited in place and stayed in the block.');
    near(lineOf(t.geom('39')).end, 100, 100.2);
    expect(await t.name()).toMatch(/REFEDITNAME = "KNOB"/);
  });

  it('Prompt to select nested objects takes only the objects picked', async () => {
    const t = setup();
    await t.bus.submit('REFEDIT');
    await t.pick('line');
    const d = t.dialog() as Extract<DialogRequest, { type: 'refedit' }>;
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      refedit: { chosen: 0, settings: { ...d.settings, prompt: true } },
    });
    expect(t.bus.promptText).toBe('Select nested objects:');
    await t.pick('circle');
    await t.bus.script(['']);
    expect(t.contents(MODEL).slice(4)).toEqual(['35']);
    // The dialog keeps its settings for the next time.
    await t.bus.script(['REFCLOSE', 'D', 'REFEDIT']);
    await t.pick('line');
    expect((t.dialog() as Extract<DialogRequest, { type: 'refedit' }>).settings.prompt).toBe(true);
  });

  it('Display attribute definitions for editing takes them into the working set', async () => {
    const t = setup();
    await t.refedit('line', 0, { attributes: true });
    expect(t.contents(DOOR)).toEqual([]);
    expect(t.owner('37')).toBe(MODEL);
  });

  it('refuses what it cannot edit in place, and while another edit or the Block Editor is open', async () => {
    const t = setup();
    // The reference scaled 1 by 2 turned over (its extrusion direction down): not in plan.
    const b = new ChangeSetBuilder(t.model);
    const tall = t.model.entity(t.id(TALL_REF))!;
    b.updateEntity(tall.id, { geom: { ...tall.geom, normal: { x: 0, y: 0, z: -1 } } as never });
    t.model.apply(b.build());
    await t.bus.submit('REFEDIT');
    await t.pick('tall');
    const d = t.dialog() as Extract<DialogRequest, { type: 'refedit' }>;
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      refedit: { chosen: 0, settings: d.settings },
    });
    expect((t.dialog() as Extract<DialogRequest, { type: 'refedit' }>).note).toBe(
      '** The block reference is not in plan **',
    );
    await t.bus.cancel();
    await t.bus.script(['REFEDIT', '5,50']);
    expect(t.log.at(-1)).toBe('Selected object is not a reference.');
    await t.bus.cancel();
    await t.bus.script(['REFSET']);
    expect(t.log.at(-1)).toBe('** REFSET is only allowed while a reference is edited in place **');
    await t.bus.script(['REFCLOSE']);
    expect(t.log.at(-1)).toBe(
      '** REFCLOSE is only allowed while a reference is edited in place **',
    );
    await t.refedit('line');
    await t.bus.script(['REFEDIT']);
    expect(t.log.at(-1)).toBe('** REFEDIT is not allowed while a reference is edited in place **');
    await t.bus.script(['BEDIT']);
    expect(t.log.at(-1)).toBe('** BEDIT is not allowed while a reference is edited in place **');
    await t.bus.script(['REFCLOSE', 'D', '-BEDIT', 'KNOB', 'REFEDIT']);
    expect(t.log.at(-1)).toBe('** REFEDIT is not allowed in the Block Editor **');
  });

  it('Save refuses a working set holding a reference to the block itself', async () => {
    const t = setup();
    await t.refedit('line');
    await t.bus.script(['-INSERT', 'DOOR', '200,200', '1', '', '0', '', 'REFCLOSE', 'S']);
    expect(t.log.at(-1)).toBe(
      '** The working set holds a reference to "DOOR", which cannot reference itself **',
    );
    expect(await t.name()).toMatch(/REFEDITNAME = "DOOR"/);
  });
});

describe('REFEDIT edges', () => {
  it('Esc or Cancel at any step starts nothing', async () => {
    const t = setup();
    await t.bus.submit('REFEDIT');
    await t.bus.cancel();
    await t.bus.submit('REFEDIT');
    await t.pick('line');
    await t.bus.cancel();
    await t.bus.submit('-REFEDIT');
    await t.pick('knob');
    await t.bus.cancel();
    await t.bus.submit('-REFEDIT');
    await t.pick('line');
    await t.bus.cancel();
    expect(await t.name()).toMatch(/REFEDITNAME = ""/);
    expect(t.contents(DOOR)).toHaveLength(5);
  });

  it('Enter at "Select reference" ends it; a reference taken without a pick is edited alone', async () => {
    const t = setup();
    await t.bus.script(['REFEDIT', '']);
    expect(t.bus.promptText).toBe('Command:');
    await t.bus.submit('REFEDIT');
    await t.bus.answer({ kind: 'selection', ids: [t.id(DOOR_REF)] });
    const d = t.dialog() as Extract<DialogRequest, { type: 'refedit' }>;
    expect(d.references.map((r) => r.name)).toEqual(['DOOR']);
  });

  it('nested picks that miss the block take nothing: an empty working set', async () => {
    const t = setup();
    await t.refedit('line', 0, { prompt: true });
    // A pick on the drawing's own line, then one through another reference path.
    await t.bus.pick({ x: 5, y: 50 });
    await t.pick('tall');
    await t.bus.submit('');
    expect(t.log).toContain('0 objects in the working set.');
    expect(t.contents(DOOR)).toHaveLength(5);
    // Objects drawn join it; Discard with nothing carried out takes them back.
    await t.bus.script(['LINE', '0,0', '1,1', '', 'REFCLOSE', 'D']);
    expect(t.contents(MODEL)).toEqual(['30', DOOR_REF, PLAIN_REF, TALL_REF]);
  });

  it('an object of the drawing brought back by U does not join the working set', async () => {
    const t = setup();
    await t.refedit('line', 0, { lock: false });
    await t.bus.script(['ERASE', '5,50', '', 'U', 'LINE', '0,0', '1,1', '', 'U', 'REDO']);
    expect(t.events.at(-1)!.working).not.toContain(t.id('30'));
    await t.bus.script(['REFCLOSE', 'S']);
    expect(t.owner('30')).toBe(MODEL);
    expect(t.contents(DOOR)).toHaveLength(6);
  });

  it('REFSET and REFCLOSE end quietly on Esc', async () => {
    const t = setup();
    await t.refedit('line');
    await t.bus.submit('REFSET');
    await t.bus.cancel();
    await t.bus.script(['REFSET', 'R']);
    await t.bus.cancel();
    await t.bus.submit('REFCLOSE');
    await t.bus.cancel();
    expect(await t.name()).toMatch(/REFEDITNAME = "DOOR"/);
  });
});

describe('-REFEDIT', () => {
  it('Esc at the selection method or the attribute question starts nothing', async () => {
    const t = setup();
    await t.bus.submit('-REFEDIT');
    await t.pick('line');
    expect(t.bus.promptText).toBe('Enter object selection method [All/Nested] <All>:');
    await t.bus.script(['']);
    await t.bus.cancel();
    expect(await t.name()).toMatch(/REFEDITNAME = ""/);
  });

  it('asks the nesting level, the selection method and the attribute definitions', async () => {
    const t = setup();
    await t.bus.submit('-REFEDIT');
    await t.pick('knob');
    expect(t.log.at(-1)).toBe('Nesting level: DOOR');
    expect(t.bus.promptText).toBe('Select nesting level [Ok/Next] <Next>:');
    await t.bus.submit('');
    expect(t.log.at(-1)).toBe('Nesting level: KNOB');
    await t.bus.submit('');
    expect(t.log.at(-1)).toBe('Nesting level: DOOR');
    await t.bus.submit('O');
    expect(t.bus.promptText).toBe('Enter object selection method [All/Nested] <All>:');
    await t.bus.submit('N');
    await t.pick('circle');
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Display attribute definitions [Yes/No] <No>:');
    await t.bus.submit('');
    expect(t.contents(MODEL).slice(4)).toEqual(['35']);
  });
});

// M5-02 part 8: a reference scaled differently in X and Y (TALL_REF, DOOR at 300,0 scaled 1 by 2)
// is edited in place as any other. Its objects are carried out by the scale as objects of their
// own kind, as EXPLODE carries them (lines, a reference whose axes stay square, text whose
// frame stays square); a circle or an arc, which the scale draws as an ellipse, is edited as an
// ellipse standing in for it and comes back a circle or an arc under its own handle while it
// stays one. Objects drawn meanwhile go back by the inverse scale; one the inverse cannot carry
// as an object of its kind stays in the drawing.
describe('REFEDIT of a reference scaled differently in X and Y (part 8)', () => {
  type Ellipse = Extract<EntityGeometry, { kind: 'ELLIPSE' }>;
  const tallEdit = async () => {
    const t = setup();
    const was = new Map(t.contents(DOOR).map((h) => [h, t.model.entity(t.id(h))!]));
    await t.refedit('tall');
    const standIn = t.contents(MODEL).find((h) => t.geom(h).kind === 'ELLIPSE')!;
    return { ...t, was, standIn };
  };
  const radii = (e: Ellipse) => {
    const major = Math.hypot(e.majorAxis.x, e.majorAxis.y);
    return { major, minor: major * e.ratio };
  };

  it('carries the block out by the scale, a circle as an ellipse standing in for it', async () => {
    const t = await tallEdit();
    expect(t.contents(DOOR)).toEqual(['37']);
    expect(t.contents(MODEL).filter((h) => h !== t.standIn)).toEqual([
      '30',
      DOOR_REF,
      PLAIN_REF,
      TALL_REF,
      '34',
      '36',
      '38',
    ]);
    near(lineOf(t.geom('34')).start, 300, 0);
    near(lineOf(t.geom('34')).end, 301, 0);
    near(lineOf(t.geom('38')).end, 300, 2);
    // KNOB's reference keeps its axes square under the scale: it stays a reference, scaled.
    expect(t.geom('36')).toMatchObject({ kind: 'INSERT', position: { x: 300, y: 0 } });
    expect((t.geom('36') as InsertGeometry).scale).toMatchObject({ x: 1, y: 2 });
    // The circle at (1,0) r 0.5 drawn as the reference draws it.
    const e = t.geom(t.standIn) as Ellipse;
    near(e.center, 301, 0);
    expect(radii(e).major).toBeCloseTo(1, 12);
    expect(radii(e).minor).toBeCloseTo(0.5, 12);
    expect(t.model.entity(t.id('35'))).toBeUndefined();
    expect(t.model.entity(t.id(t.standIn))!.layer).toBe(L0);
    expect(t.log).toContain('4 objects in the working set.');
    expect(t.log).toContain(
      '1 circle or arc is edited as an ellipse while the block is scaled differently in X and Y.',
    );
    // The canvas draws the other references with the block as it was, the circle included.
    expect(t.events.at(-1)!.working).toEqual(['34', t.standIn, '36', '38'].map(t.id));
    expect(t.events.at(-1)!.held!.entities).toEqual(
      ['34', '35', '36', '38'].map((h) => t.was.get(h)),
    );
  });

  it('Save with nothing edited puts the block back exactly as it was', async () => {
    const t = await tallEdit();
    await t.bus.script(['REFCLOSE', 'S']);
    expect(t.log.at(-1)).toBe('Block "DOOR" redefined: reference edits saved.');
    expect(t.contents(MODEL)).toEqual(['30', DOOR_REF, PLAIN_REF, TALL_REF]);
    expect(t.contents(DOOR)).toEqual(['37', '34', '35', '36', '38']);
    for (const [h, e] of t.was) expect(t.model.entity(t.id(h))).toEqual(e);
    expect(t.model.entity(t.id(t.standIn))).toBeUndefined();
  });

  it('Save carries edits back by the inverse scale: the circle stays a circle under its handle', async () => {
    const t = await tallEdit();
    // The ellipse moved up 2: the circle moves up 1 in the block.
    await t.bus.script(['MOVE']);
    await t.bus.pick({ x: 301.5, y: 0 });
    await t.bus.script(['', '0,0', '0,2']);
    await t.bus.script(['LINE', '310,0', '310,4', '']);
    const line = t.contents(MODEL).at(-1)!;
    await t.bus.script(['CIRCLE', '320,0', '1']);
    const circle = t.contents(MODEL).at(-1)!;
    // A donut is a polyline of arcs with a width, which the inverse scale cannot carry.
    await t.bus.script(['DONUT', '0.5', '1', '330,0', '']);
    const donut = t.contents(MODEL).at(-1)!;
    await t.bus.script(['REFCLOSE', 'S']);
    expect(t.log).toContain(
      '1 object could not be carried back into a block scaled differently in X and Y and stays in the drawing.',
    );
    expect(t.log.at(-1)).toBe('Block "DOOR" redefined: reference edits saved.');
    expect(t.contents(MODEL)).toEqual(['30', DOOR_REF, PLAIN_REF, TALL_REF, donut]);
    // The circle: the same object, one up.
    const c = t.geom('35') as Extract<EntityGeometry, { kind: 'CIRCLE' }>;
    expect(c.kind).toBe('CIRCLE');
    near(c.center, 1, 1);
    expect(c.radius).toBeCloseTo(0.5, 12);
    expect(t.owner('35')).toBe(DOOR);
    expect(t.model.entity(t.id('35'))!.handle).toBe('35');
    // The line drawn (310,0)-(310,4) is (10,0)-(10,2) in the block.
    near(lineOf(t.geom(line)).start, 10, 0);
    near(lineOf(t.geom(line)).end, 10, 2);
    // The circle drawn at (320,0) r 1 is an ellipse in the block, (20,0) 1 by 0.5.
    const blockEllipses = t.contents(DOOR).filter((h) => t.geom(h).kind === 'ELLIPSE');
    expect(t.contents(DOOR)).not.toContain(circle);
    expect(blockEllipses).toHaveLength(1);
    const e = t.geom(blockEllipses[0]!) as Ellipse;
    near(e.center, 20, 0);
    expect(radii(e).major).toBeCloseTo(1, 12);
    expect(radii(e).minor).toBeCloseTo(0.5, 12);
    // Untouched objects exactly as they were.
    expect(t.model.entity(t.id('34'))).toEqual(t.was.get('34'));
    expect(t.model.entity(t.id('36'))).toEqual(t.was.get('36'));
  });

  it('a circle edited out of round comes back an ellipse, the circle erased', async () => {
    const t = await tallEdit();
    await t.bus.script(['ROTATE']);
    await t.bus.pick({ x: 301.5, y: 0 });
    await t.bus.script(['', '301,0', '90']);
    await t.bus.script(['REFCLOSE', 'S']);
    expect(t.model.entity(t.id('35'))).toBeUndefined();
    const made = t.contents(DOOR).filter((h) => !t.was.has(h));
    expect(made).toHaveLength(1);
    const e = t.geom(made[0]!) as Ellipse;
    expect(e.kind).toBe('ELLIPSE');
    near(e.center, 1, 0);
    expect(radii(e).major).toBeCloseTo(1, 12);
    expect(radii(e).minor).toBeCloseTo(0.25, 12);
    expect(t.model.entity(t.id(made[0]!))!.layer).toBe(L0);
  });

  it('an arc comes back an arc under its handle; one drawn meanwhile goes back an elliptical arc', async () => {
    const t = setup();
    const b = new ChangeSetBuilder(t.model);
    const line = t.model.entity(t.id('34'))!;
    const added = b.addEntity({
      owner: DOOR,
      layer: line.layer,
      color: line.color,
      linetype: line.linetype,
      lineweight: line.lineweight,
      transparency: line.transparency,
      ltScale: line.ltScale,
      visible: line.visible,
      geom: {
        kind: 'ARC',
        center: { x: 3, y: 0 },
        radius: 1,
        startAngle: 0,
        endAngle: Math.PI / 2,
      },
    });
    t.model.apply(b.build());
    await t.refedit('tall');
    expect(t.model.entity(added.id)).toBeUndefined();
    // The quarter arc as the reference draws it, from (304,0) to (303,2), moved up 2.
    await t.bus.script(['MOVE']);
    await t.bus.pick({ x: 304, y: 0 });
    await t.bus.script(['', '0,0', '0,2']);
    await t.bus.script(['ARC', 'C', '340,0', '341,0', '340,1']);
    const drawn = t.contents(MODEL).at(-1)!;
    expect(t.geom(drawn).kind).toBe('ARC');
    await t.bus.script(['REFCLOSE', 'S']);
    const a = t.model.entity(added.id)!;
    expect(a.handle).toBe(added.handle);
    expect(a.owner).toBe(DOOR);
    const g = a.geom as Extract<EntityGeometry, { kind: 'ARC' }>;
    expect(g.kind).toBe('ARC');
    near(g.center, 3, 1);
    expect(g.radius).toBeCloseTo(1, 12);
    expect(g.startAngle).toBeCloseTo(0, 12);
    expect(g.endAngle).toBeCloseTo(Math.PI / 2, 12);
    const made = t.contents(DOOR).filter((h) => t.geom(h).kind === 'ELLIPSE');
    expect(made).toHaveLength(1);
    const e = t.geom(made[0]!) as Ellipse;
    near(e.center, 40, 0);
    expect(e.endParam - e.startParam).toBeCloseTo(Math.PI / 2, 12);
  });

  it('Discard puts the circle back; U and REDO end and resume the edit', async () => {
    const t = await tallEdit();
    await t.bus.script(['MOVE']);
    await t.bus.pick({ x: 301.5, y: 0 });
    await t.bus.script(['', '0,0', '0,2', 'REFCLOSE', 'D']);
    expect(t.contents(MODEL)).toEqual(['30', DOOR_REF, PLAIN_REF, TALL_REF]);
    for (const [h, e] of t.was) expect(t.model.entity(t.id(h))).toEqual(e);
    await t.bus.submit('U');
    expect(await t.name()).toMatch(/REFEDITNAME = "DOOR"/);
    expect(t.model.entity(t.id('35'))).toBeUndefined();
    await t.bus.script(['REFCLOSE', 'S']);
    expect((t.geom('35') as Extract<EntityGeometry, { kind: 'CIRCLE' }>).center.y).toBeCloseTo(
      1,
      12,
    );
  });

  it('-REFEDIT edits it too', async () => {
    const t = setup();
    await t.bus.submit('-REFEDIT');
    await t.pick('tall');
    expect(t.bus.promptText).toBe('Enter object selection method [All/Nested] <All>:');
    await t.bus.script(['', '']);
    expect(await t.name()).toMatch(/REFEDITNAME = "DOOR"/);
    expect(t.owner('34')).toBe(MODEL);
  });
});
