// M2-03: selection on the PromptBus, AutoCAD 2024's rules ("Select objects" in SELECT (Command),
// "To Select Objects", PICKFIRST, PICKADD, PICKAUTO): picks, implied windowing (a window dragged
// left to right takes what is entirely inside, right to left whatever it crosses), Shift and
// Remove, the W, C, BOX, ALL, Last, Previous, Undo, AUto and SIngle modes, noun-verb
// pre-selection at `Command:` (Ctrl+A too), and ZOOM Object. The canvas's geometry is a test
// double here: each entity is a box, picked when the point is in it, taken by a window it lies
// inside or a crossing it overlaps (the renderer's exact rules are tested in packages/render).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type CommandDef,
  type DocumentInit,
  type PromptAnswer,
  type EntityId,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { entityInit, layer, lineGeom, sampleInit } from '../model/fixtures';

const LAYER_OFF = '12';
const LAYER_FROZEN = '13';
const LAYER_LOCKED = '15';

/**
 * Model space: 20 (0,0)-(10,0) and 23 (0,0)-(0,10) on 0, 21 a circle on WALLS, 30 on a layer
 * that is off, 31 frozen, 32 locked, all lines unless said; 24 is in paper space.
 */
function init(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    tables: {
      ...base.tables,
      layers: [
        ...(base.tables?.layers ?? []),
        { ...layer(LAYER_OFF, 'OFF'), on: false },
        { ...layer(LAYER_FROZEN, 'FROZEN'), frozen: true },
        { ...layer(LAYER_LOCKED, 'LOCKED'), locked: true },
      ],
    },
    entities: [
      ...(base.entities ?? []),
      entityInit('30', lineGeom(20, 0, 30, 0), { layer: LAYER_OFF }),
      entityInit('31', lineGeom(20, 5, 30, 5), { layer: LAYER_FROZEN }),
      entityInit('32', lineGeom(20, 10, 30, 10), { layer: LAYER_LOCKED }),
    ],
  };
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** The boxes the test canvas "draws": what a pick or window finds. */
const DRAWN: Record<string, Box> = {
  '20': { minX: 0, minY: 0, maxX: 10, maxY: 0 },
  '21': { minX: 3, minY: 3, maxX: 7, maxY: 7 },
  '23': { minX: 0, minY: 0, maxX: 0, maxY: 10 },
  '32': { minX: 20, minY: 10, maxX: 30, maxY: 10 },
};

/** A command that keeps what its "Select objects" was answered with (M2-27's selection steps). */
const answers: PromptAnswer[] = [];
const GRAB: CommandDef = {
  name: 'GRAB',
  usesSelection: 'during',
  async *run(ctx) {
    answers.push(yield ctx.prompt.selection({ message: 'Select objects' }));
  },
};

function setup(o: { pickfirst?: boolean } = {}) {
  const model = DocumentModel.create(init());
  const registry = builtinCommands();
  registry.register(GRAB);
  const asked: ViewRequest[] = [];
  const id = (h: string) => model.ids.idOf(h)!;
  const handles = (ids: readonly EntityId[]) => ids.map((i) => model.ids.handleOf(i));
  const answer = (r: ViewRequest): ViewReply => {
    asked.push(r);
    const near = (b: Box, p: { x: number; y: number }) =>
      p.x >= b.minX - 0.5 && p.x <= b.maxX + 0.5 && p.y >= b.minY - 0.5 && p.y <= b.maxY + 0.5;
    const present = Object.entries(DRAWN).filter(([h]) => model.entityByHandle(h));
    if (r.op === 'pick') {
      return { ok: true, ids: present.filter(([, b]) => near(b, r.point)).map(([h]) => id(h)) };
    }
    if (r.op === 'select') {
      const w = {
        minX: Math.min(r.a.x, r.b.x),
        minY: Math.min(r.a.y, r.b.y),
        maxX: Math.max(r.a.x, r.b.x),
        maxY: Math.max(r.a.y, r.b.y),
      };
      const inside = (b: Box) =>
        b.minX >= w.minX && b.maxX <= w.maxX && b.minY >= w.minY && b.maxY <= w.maxY;
      const overlaps = (b: Box) =>
        b.minX <= w.maxX && b.maxX >= w.minX && b.minY <= w.maxY && b.maxY >= w.minY;
      return {
        ok: true,
        ids: present.filter(([, b]) => (r.crossing ? overlaps(b) : inside(b))).map(([h]) => id(h)),
      };
    }
    return { ok: true, view: { center: { x: 0, y: 0 }, height: 10, width: 20, paper: false } };
  };
  const bus = new PromptBus({
    model,
    registry,
    view: { request: (r) => Promise.resolve(answer(r)) },
    ...(o.pickfirst === false && { pickfirst: false }),
  });
  const events: BusEvent[] = [];
  bus.on((e) => events.push(e));
  const selections = () =>
    events.flatMap((e) => (e.type === 'selection' ? [handles(e.ids)] : [])).at(-1);
  const results = () =>
    events.flatMap((e) =>
      e.type === 'log' && /found|removed|total|layer|Invalid|Expects/.test(e.line) ? [e.line] : [],
    );
  return { bus, model, asked, id, handles, selections, results, events };
}

describe('SELECT', () => {
  it('adds each picked object and reports "n found, m total", duplicates too', async () => {
    const s = setup();
    await s.bus.submit('SELECT');
    expect(s.bus.promptText).toBe('Select objects:');
    expect(s.bus.prompt?.kind).toBe('selection');
    await s.bus.pick({ x: 10, y: 0 });
    await s.bus.pick({ x: 0, y: 10 });
    await s.bus.pick({ x: 10, y: 0 });
    expect(s.results()).toEqual([
      'Select objects: 1 found',
      'Select objects: 1 found, 2 total',
      'Select objects: 1 found (1 duplicate), 2 total',
    ]);
    expect(s.selections()).toEqual(['20', '23']);
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    // SELECT leaves nothing selected: its set becomes the Previous set.
    expect(s.selections()).toEqual([]);
    await s.bus.script(['SELECT', 'P']);
    expect(s.handles(s.bus.selection)).toEqual(['20', '23']);
  });

  it('takes the nearest object a pick finds, and a typed point picks too', async () => {
    const s = setup();
    await s.bus.script(['SELECT', '5,5']);
    expect(s.handles(s.bus.selection)).toEqual(['21']);
    expect(s.asked).toEqual([{ op: 'pick', point: { x: 5, y: 5 } }]);
  });

  it('starts a window where a pick finds nothing (implied windowing): left to right is a window', async () => {
    const s = setup();
    await s.bus.submit('SELECT');
    await s.bus.pick({ x: -1, y: -1 });
    expect(s.bus.promptText).toBe('Specify opposite corner:');
    expect(s.bus.prompt).toMatchObject({
      kind: 'point',
      rubberBand: { from: { x: -1, y: -1 }, box: true, selection: 'auto' },
    });
    await s.bus.pick({ x: 8, y: 11 });
    expect(s.asked.at(-1)).toEqual({
      op: 'select',
      a: { x: -1, y: -1 },
      b: { x: 8, y: 11 },
      crossing: false,
    });
    // Only 21 and 23 lie wholly inside; 20 runs out to x = 10.
    expect(s.handles(s.bus.selection)).toEqual(['21', '23']);
    expect(s.bus.promptText).toBe('Select objects:');
  });

  it('right to left is a crossing window, which takes what it crosses', async () => {
    const s = setup();
    await s.bus.submit('SELECT');
    await s.bus.pick({ x: 8, y: 11 });
    await s.bus.pick({ x: -1, y: -1 });
    expect(s.asked.at(-1)).toMatchObject({ op: 'select', crossing: true });
    expect(s.handles(s.bus.selection)).toEqual(['20', '21', '23']);
    expect(s.results()).toEqual(['Specify opposite corner: 3 found']);
  });

  it('ends a dragged window on release; a release with no window pending does nothing', async () => {
    const s = setup();
    await s.bus.submit('SELECT');
    await s.bus.pick({ x: 10, y: 0 });
    await s.bus.pick({ x: 30, y: 30 }, { release: true });
    expect(s.handles(s.bus.selection)).toEqual(['20']);
    expect(s.bus.promptText).toBe('Select objects:');
    await s.bus.pick({ x: -1, y: -1 });
    await s.bus.pick({ x: 8, y: 11 }, { release: true });
    expect(s.handles(s.bus.selection)).toEqual(['20', '21', '23']);
  });

  it('Window and Crossing ask for both corners whatever their direction; BOX goes by direction', async () => {
    const s = setup();
    await s.bus.script(['SELECT', 'W']);
    expect(s.bus.promptText).toBe('Specify first corner:');
    await s.bus.script(['8,11', '-1,-1']);
    expect(s.asked.at(-1)).toMatchObject({ op: 'select', crossing: false });
    await s.bus.script(['C', '-1,-1', '4,1']);
    expect(s.asked.at(-1)).toMatchObject({ op: 'select', crossing: true });
    expect(s.bus.prompt).toMatchObject({ kind: 'selection' });
    await s.bus.script(['BOX', '4,1', '-1,-1']);
    expect(s.asked.at(-1)).toMatchObject({ op: 'select', crossing: true });
    expect(s.handles(s.bus.selection)).toEqual(['21', '23', '20']);
  });

  it('Shift removes what it picks or windows, and Remove/Add switch the mode', async () => {
    const s = setup();
    await s.bus.script(['SELECT', 'ALL']);
    expect(s.handles(s.bus.selection)).toEqual(['20', '21', '23', '30']);
    await s.bus.pick({ x: 10, y: 0 }, { shift: true });
    expect(s.handles(s.bus.selection)).toEqual(['21', '23', '30']);
    await s.bus.pick({ x: -1, y: -1 }, { shift: true });
    await s.bus.pick({ x: 8, y: 8 });
    expect(s.handles(s.bus.selection)).toEqual(['23', '30']);
    await s.bus.submit('R');
    expect(s.bus.promptText).toBe('Remove objects:');
    await s.bus.pick({ x: 0, y: 10 });
    expect(s.handles(s.bus.selection)).toEqual(['30']);
    await s.bus.submit('A');
    expect(s.bus.promptText).toBe('Select objects:');
    await s.bus.pick({ x: 0, y: 10 });
    expect(s.results()).toEqual([
      'Select objects: ALL 4 found',
      'Select objects: 1 removed, 3 total',
      'Specify opposite corner: 1 removed, 2 total',
      'Remove objects: 1 removed, 1 total',
      'Select objects: 1 found, 2 total',
    ]);
  });

  it('ALL takes the current space but not frozen or locked layers; objects on layers that are off are taken', async () => {
    const s = setup();
    await s.bus.script(['SELECT', 'ALL']);
    expect(s.handles(s.bus.selection)).toEqual(['20', '21', '23', '30']);
  });

  it('Last takes the newest visible object of the current space', async () => {
    const s = setup();
    await s.bus.script(['LINE', '50,50', '60,50', '', 'SELECT', 'L']);
    const newest = s.handles(s.bus.selection);
    expect(newest).toHaveLength(1);
    expect(s.model.entityByHandle(newest[0]!)?.geom).toMatchObject({ kind: 'LINE' });
    await s.bus.submit('');
    // Without the new line, the newest visible is 23: 30 to 32 sit on layers off, frozen and
    // locked (AutoCAD's Last skips frozen and off layers; locked ones are visible).
    const t = setup();
    await t.bus.script(['SELECT', 'L']);
    expect(t.handles(t.bus.selection)).toEqual(['32']);
  });

  it('Undo takes back the last selection step', async () => {
    const s = setup();
    await s.bus.submit('SELECT');
    await s.bus.pick({ x: 10, y: 0 });
    await s.bus.pick({ x: 0, y: 10 });
    await s.bus.submit('U');
    expect(s.handles(s.bus.selection)).toEqual(['20']);
    await s.bus.script(['U', 'U']);
    expect(s.handles(s.bus.selection)).toEqual([]);
  });

  it('SIngle ends at the first selection', async () => {
    const s = setup();
    await s.bus.script(['SELECT', 'SI']);
    await s.bus.pick({ x: 30, y: 30 });
    expect(s.bus.promptText).toBe('Specify opposite corner:');
    await s.bus.pick({ x: -1, y: -1 });
    expect(s.bus.command).toBeUndefined();
  });

  it('AUto picks, or starts a window where nothing is picked', async () => {
    const s = setup();
    await s.bus.script(['SELECT', 'AU', '10,0']);
    expect(s.handles(s.bus.selection)).toEqual(['20']);
  });

  it('refuses an unknown mode and lists the modes it expects', async () => {
    const s = setup();
    await s.bus.script(['SELECT', 'XYZ']);
    expect(s.results()).toEqual([
      '*Invalid selection*',
      'Expects a point or Window/Last/Crossing/BOX/ALL/Add/Remove/Previous/Undo/AUto/SIngle',
    ]);
    expect(s.bus.promptText).toBe('Select objects:');
  });

  it('Previous is the last selection set, without objects erased since', async () => {
    const s = setup();
    await s.bus.script(['SELECT', 'ALL', '']);
    await s.bus.script(['SELECT', 'P', '']);
    expect(s.results().at(-1)).toBe('Select objects: P 4 found');
    const fresh = setup();
    await fresh.bus.script(['SELECT', 'P']);
    expect(fresh.results()).toEqual(['Select objects: P 0 found']);
  });
});

describe('the steps a selection was made with (M2-27)', () => {
  const last = () => answers.at(-1) as Extract<PromptAnswer, { kind: 'selection' }>;

  it('lists each pick and window that took objects, with what it took', async () => {
    const s = setup();
    await s.bus.submit('GRAB');
    await s.bus.pick({ x: 10, y: 0 });
    await s.bus.pick({ x: 10, y: 0 });
    // A crossing window, right to left, over 21 and 23.
    await s.bus.pick({ x: 8, y: 8 });
    await s.bus.pick({ x: -1, y: 4 });
    // A pick that finds nothing and a window that takes nothing add no step.
    await s.bus.pick({ x: 50, y: 50 });
    await s.bus.pick({ x: 51, y: 51 });
    await s.bus.submit('');
    const a = last();
    expect(s.handles(a.ids)).toEqual(['20', '21', '23']);
    expect(a.takes?.map((t) => [s.handles(t.ids), t.pick, t.window, t.crossing])).toEqual([
      [['20'], { x: 10, y: 0 }, undefined, undefined],
      [['20'], { x: 10, y: 0 }, undefined, undefined],
      [['21', '23'], undefined, { a: { x: 8, y: 8 }, b: { x: -1, y: 4 } }, true],
    ]);
  });

  it('ALL is a step that takes objects whole; removing and Undo drop and restore steps', async () => {
    const s = setup();
    await s.bus.script(['GRAB', 'ALL']);
    await s.bus.pick({ x: 0, y: 10 });
    await s.bus.pick({ x: 10, y: 0 }, { shift: true });
    await s.bus.submit('U');
    await s.bus.submit('');
    const a = last();
    expect(s.handles(a.ids)).toEqual(['20', '21', '23', '30']);
    expect(a.takes?.map((t) => [s.handles(t.ids), t.pick])).toEqual([
      [['20', '21', '23', '30'], undefined],
      [['23'], { x: 0, y: 10 }],
    ]);
    await s.bus.script(['GRAB', 'ALL']);
    await s.bus.pick({ x: 0, y: 10 });
    await s.bus.pick({ x: 0, y: 10 }, { shift: true });
    await s.bus.submit('');
    expect(last().takes?.map((t) => s.handles(t.ids))).toEqual([['20', '21', '30']]);
  });

  it('the pre-selection carries its steps into the command; Ctrl+A takes objects whole', async () => {
    const s = setup();
    await s.bus.pick({ x: 10, y: 0 });
    await s.bus.submit('GRAB');
    expect(last().takes?.map((t) => [s.handles(t.ids), t.pick])).toEqual([
      [['20'], { x: 10, y: 0 }],
    ]);
    await s.bus.selectAll();
    await s.bus.submit('GRAB');
    expect(last().takes?.map((t) => [s.handles(t.ids), t.pick, t.window])).toEqual([
      [['20', '21', '23', '30'], undefined, undefined],
    ]);
  });
});

describe('selection on prompts that edit (editable)', () => {
  it('drops objects on locked layers, saying how many', async () => {
    const s = setup();
    const got: (readonly EntityId[])[] = [];
    const registry = builtinCommands();
    registry.register({
      name: 'TOUCH',
      usesSelection: 'during',
      async *run(ctx) {
        const a = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
        if (a.kind === 'selection') got.push(a.ids);
      },
    });
    const bus = new PromptBus({
      model: s.model,
      registry,
      view: {
        request: (r) => Promise.resolve({ ok: true, ids: r.op === 'pick' ? [s.id('32')] : [] }),
      },
    });
    const lines: string[] = [];
    bus.on((e) => e.type === 'log' && lines.push(e.line));
    await bus.script(['TOUCH', '25,10', '']);
    expect(lines).toContain('1 was on a locked layer.');
    expect(got).toEqual([[]]);
  });
});

describe('noun-verb pre-selection (PICKFIRST)', () => {
  it('picks and windows at Command: select, and Esc clears them', async () => {
    const s = setup();
    await s.bus.pick({ x: 10, y: 0 });
    expect(s.selections()).toEqual(['20']);
    expect(s.bus.promptText).toBe('Command:');
    await s.bus.pick({ x: 8, y: 11 });
    expect(s.bus.promptText).toBe('Specify opposite corner:');
    await s.bus.pick({ x: -1, y: -1 });
    expect(s.selections()).toEqual(['20', '21', '23']);
    expect(s.bus.promptText).toBe('Command:');
    await s.bus.pick({ x: 0, y: 10 }, { shift: true });
    expect(s.selections()).toEqual(['20', '21']);
    await s.bus.cancel();
    expect(s.selections()).toEqual([]);
  });

  it('Ctrl+A selects all at Command: and at a selection prompt', async () => {
    const s = setup();
    await s.bus.selectAll();
    expect(s.selections()).toEqual(['20', '21', '23', '30']);
    await s.bus.cancel();
    await s.bus.submit('SELECT');
    await s.bus.selectAll();
    expect(s.handles(s.bus.selection)).toEqual(['20', '21', '23', '30']);
  });

  it("answers a command's first Select objects prompt with the pre-selection", async () => {
    const s = setup();
    await s.bus.pick({ x: 10, y: 0 });
    await s.bus.submit('SELECT');
    expect(s.bus.command).toBeUndefined();
    expect(s.selections()).toEqual([]);
    await s.bus.script(['SELECT', 'P']);
    expect(s.handles(s.bus.selection)).toEqual(['20']);
  });

  it('is ignored when PICKFIRST is off', async () => {
    const s = setup({ pickfirst: false });
    await s.bus.pick({ x: 10, y: 0 });
    expect(s.selections() ?? []).toEqual([]);
    await s.bus.submit('SELECT');
    expect(s.bus.promptText).toBe('Select objects:');
  });

  it('follows PICKFIRST set while the drawing is open (M2-59): off deselects, on picks again', async () => {
    const s = setup();
    expect(s.bus.pickfirst).toBe(true);
    await s.bus.pick({ x: 10, y: 0 });
    expect(s.selections()).toEqual(['20']);
    await s.bus.setPickfirst(false);
    expect(s.bus.pickfirst).toBe(false);
    // AutoCAD drops the pre-selection a command could no longer take.
    expect(s.selections()).toEqual([]);
    await s.bus.pick({ x: 10, y: 0 });
    await s.bus.selectAll();
    expect(s.selections()).toEqual([]);
    await s.bus.setPickfirst(true);
    await s.bus.pick({ x: 10, y: 0 });
    expect(s.selections()).toEqual(['20']);
    // Setting what it holds keeps the selection.
    await s.bus.setPickfirst(true);
    expect(s.selections()).toEqual(['20']);
  });

  it('a command that selects nothing (LINE) clears it; a view command (ZOOM) keeps it', async () => {
    const s = setup();
    await s.bus.pick({ x: 10, y: 0 });
    await s.bus.script(['ZOOM', 'E']);
    expect(s.selections()).toEqual(['20']);
    await s.bus.script(['LINE']);
    expect(s.selections()).toEqual([]);
  });

  it('a pick at a point prompt is the point, not a selection', async () => {
    const s = setup();
    await s.bus.submit('LINE');
    await s.bus.pick({ x: 10, y: 0 });
    expect(s.bus.promptText).toBe('Specify next point or [Undo]:');
    expect(s.asked).toEqual([]);
    await s.bus.pick({ x: 20, y: 0 }, { release: true });
    expect(s.bus.promptText).toBe('Specify next point or [Undo]:');
  });

  it('forgets objects erased while selected, and Previous drops them too', async () => {
    const s = setup();
    const registry = builtinCommands();
    registry.register({
      name: 'WIPE',
      usesSelection: 'during',
      async *run(ctx) {
        const a = yield ctx.prompt.selection({ message: 'Select objects' });
        if (a.kind !== 'selection') return;
        ctx.edit((b) => a.ids.forEach((i) => b.removeEntity(i)));
      },
    });
    const bus = new PromptBus({
      model: s.model,
      registry,
      view: {
        request: (r) => Promise.resolve({ ok: true, ids: r.op === 'pick' ? [s.id('20')] : [] }),
      },
    });
    let shown: readonly EntityId[] = [];
    bus.on((e) => {
      if (e.type === 'selection') shown = e.ids;
    });
    await bus.script(['SELECT', 'ALL', '']);
    await bus.pick({ x: 10, y: 0 });
    expect(shown).toEqual([s.id('20')]);
    await bus.submit('WIPE');
    expect(shown).toEqual([]);
    expect(s.model.entityByHandle('20')).toBeUndefined();
    // WIPE's set became the Previous set, and erasing its one object emptied it.
    await bus.script(['SELECT', 'P']);
    expect(s.handles(bus.selection)).toEqual([]);
  });
});

describe('ZOOM Object', () => {
  it('zooms to the objects selected', async () => {
    const s = setup();
    await s.bus.script(['ZOOM', 'O']);
    expect(s.bus.promptText).toBe('Select objects:');
    await s.bus.script(['5,5', '']);
    expect(s.asked.at(-1)).toEqual({ op: 'objects', ids: [s.id('21')] });
  });

  it('uses the pre-selection', async () => {
    const s = setup();
    await s.bus.pick({ x: 10, y: 0 });
    await s.bus.script(['Z', 'O']);
    expect(s.asked.at(-1)).toEqual({ op: 'objects', ids: [s.id('20')] });
    expect(s.bus.command).toBeUndefined();
  });

  it('does nothing when nothing is selected', async () => {
    const s = setup();
    await s.bus.script(['ZOOM', 'O', '']);
    expect(s.asked.filter((r) => r.op === 'objects')).toEqual([]);
  });
});
