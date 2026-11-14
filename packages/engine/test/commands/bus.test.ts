// M2-01: scripted command tests on the PromptBus. The commands here are test doubles shaped like
// AutoCAD's (LINE's Close/Undo loop, CIRCLE's radius default, a transparent ZOOM); the real
// commands land with their own tasks and test files (TESTING.md §7). What is checked is the
// bus: Enter repeats, Esc cancels and keeps what was drawn, defaults, keywords, transparent
// commands, FROM/M2P/filters, direct distance, two-point distances and angles, the history.
import { describe, expect, it } from 'vitest';
import {
  CommandRegistry,
  DocumentModel,
  PromptBus,
  type BusEvent,
  type CommandDef,
  type DocumentInit,
  type EntityId,
  type HeaderValue,
  type PromptAnswer,
  type Vec2,
  OSNAP,
} from '../../src/index';
import { LAYER_0, MODEL_SPACE, sampleInit } from '../model/fixtures';

const LINE: CommandDef = {
  name: 'LINE',
  async *run(ctx) {
    const first = yield ctx.prompt.point({ message: 'Specify first point' });
    if (first.kind !== 'point') return;
    const points: Vec2[] = [first.point];
    const ids: EntityId[] = [];
    for (;;) {
      const options = ids.length >= 2 ? ['Close', 'Undo'] : ['Undo'];
      const from = points.at(-1)!;
      const a = yield ctx.prompt.point({
        message: 'Specify next point or',
        options,
        rubberBand: { from },
      });
      if (a.kind === 'keyword' && a.keyword === 'Undo') {
        const id = ids.pop();
        if (id === undefined) {
          ctx.message('All segments already undone.');
          continue;
        }
        ctx.edit((b) => b.removeEntity(id));
        points.pop();
        continue;
      }
      const to = a.kind === 'keyword' ? points[0]! : a.kind === 'point' ? a.point : undefined;
      if (!to) return;
      ctx.edit((b) => {
        ids.push(
          b.addEntity({
            owner: MODEL_SPACE,
            layer: LAYER_0,
            geom: { kind: 'LINE', start: from, end: to },
          }).id,
        );
      });
      ctx.preview([{ kind: 'LINE', start: to, end: to }]);
      if (a.kind === 'keyword') return;
      points.push(to);
    }
  },
};

/** What the test doubles received, in order. */
let got: PromptAnswer[] = [];

const ZOOM: CommandDef = {
  name: 'ZOOM',
  transparent: true,
  async *run(ctx) {
    got.push(yield ctx.prompt.keyword({ message: 'Enter an option', options: ['All', 'Extents'] }));
  },
};

const CIRCLE: CommandDef = {
  name: 'CIRCLE',
  async *run(ctx) {
    const c = yield ctx.prompt.point({ message: 'Specify center point for circle' });
    if (c.kind !== 'point') return;
    got.push(
      yield ctx.prompt.distance({
        message: 'Specify radius of circle or',
        options: ['Diameter'],
        base: c.point,
        default: { kind: 'distance', value: 10 },
      }),
    );
  },
};

const DIST: CommandDef = {
  name: 'DIST',
  async *run(ctx) {
    got.push(yield ctx.prompt.distance({ message: 'Specify distance' }));
  },
};

const ROTATE: CommandDef = {
  name: 'ROTATE',
  async *run(ctx) {
    got.push(yield ctx.prompt.angle({ message: 'Specify rotation angle', base: { x: 0, y: 0 } }));
    got.push(yield ctx.prompt.angle({ message: 'Specify second angle' }));
  },
};

const POLYGON: CommandDef = {
  name: 'POLYGON',
  async *run(ctx) {
    got.push(
      yield ctx.prompt.integer({
        message: 'Enter number of sides',
        default: { kind: 'number', value: 4 },
      }),
    );
    got.push(yield ctx.prompt.real({ message: 'Enter a factor' }));
  },
};

const LAYER: CommandDef = {
  name: 'LAYER',
  dashVariant: true,
  async *run(ctx) {
    got.push({ kind: 'string', value: ctx.dash ? 'dash' : 'dialog' });
    got.push(yield ctx.prompt.string({ message: 'Enter name list of layer(s)', spaces: true }));
  },
};

const SELECT: CommandDef = {
  name: 'SELECT',
  async *run(ctx) {
    got.push(yield ctx.prompt.selection({ message: 'Select objects' }));
  },
};

const BOOM: CommandDef = {
  name: 'BOOM',
  async *run(ctx) {
    ctx.edit((b) =>
      b.addEntity({
        owner: MODEL_SPACE,
        layer: LAYER_0,
        geom: { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      }),
    );
    yield ctx.prompt.point({ message: 'Specify a point' });
    throw new Error('the command failed');
  },
};

function setup(header: Iterable<readonly [string, HeaderValue]> = []) {
  got = [];
  const base = sampleInit();
  const init: DocumentInit = { ...base, header: new Map([...(base.header ?? []), ...header]) };
  const model = DocumentModel.create(init);
  const registry = new CommandRegistry([
    LINE,
    ZOOM,
    CIRCLE,
    DIST,
    ROTATE,
    POLYGON,
    LAYER,
    SELECT,
    BOOM,
  ]);
  const bus = new PromptBus({ model, registry });
  const events: BusEvent[] = [];
  bus.on((e) => events.push(e));
  const commits = () => events.flatMap((e) => (e.type === 'commit' ? [e.record] : []));
  const lines = () =>
    model
      .blockEntities(MODEL_SPACE)
      .map((id) => model.entity(id)!.geom)
      .filter((g) => g.kind === 'LINE') as { start: Vec2; end: Vec2 }[];
  return { model, bus, events, commits, lines };
}

const near = (a: Vec2, b: Vec2): void => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe('PromptBus', () => {
  it('runs L ↵ 0,0 ↵ @100<45 ↵ ↵ into one line and one undo record', async () => {
    const { bus, commits, lines } = setup();
    const before = lines().length;
    await bus.script(['L', '0,0', '@100<45', '']);
    const added = lines().slice(before);
    expect(added).toHaveLength(1);
    near(added[0]!.start, { x: 0, y: 0 });
    near(added[0]!.end, { x: 100 * Math.SQRT1_2, y: 100 * Math.SQRT1_2 });
    expect(commits()).toHaveLength(1);
    expect(commits()[0]!.command).toBe('LINE');
    expect(bus.command).toBeUndefined();
    expect(bus.promptText).toBe('Command:');
    expect(bus.history).toEqual([
      'Command: L',
      'Specify first point: 0,0',
      'Specify next point or [Undo]: @100<45',
      'Specify next point or [Undo]:',
    ]);
    expect(bus.recent).toEqual(['L']);
  });

  it('repeats the last command on Enter at Command:', async () => {
    const { bus, lines } = setup();
    const before = lines().length;
    await bus.submit('');
    expect(bus.command).toBeUndefined();
    await bus.script(['LINE', '0,0', '10,0', '', '', '0,5', '10,5', '']);
    expect(lines().length - before).toBe(2);
    expect(bus.history).toContain('LINE');
    await bus.answer({ kind: 'enter' });
    expect(bus.command).toBe('LINE');
  });

  it('keeps the segments drawn before Esc, as one record', async () => {
    const { bus, commits, lines, events } = setup();
    const before = lines().length;
    await bus.script(['LINE', '0,0', '10,0', '10,10']);
    expect(bus.promptText).toBe('Specify next point or [Close/Undo]:');
    await bus.cancel();
    expect(lines().length - before).toBe(2);
    expect(commits()).toHaveLength(1);
    expect(commits()[0]!.changes).toHaveLength(2);
    expect(bus.history.at(-1)).toBe('Specify next point or [Close/Undo]: *Cancel*');
    expect(events.at(-1)).toEqual({ type: 'idle' });
    expect(events.filter((e) => e.type === 'preview').at(-1)).toEqual({
      type: 'preview',
      geometry: [],
    });
    await bus.cancel();
    expect(bus.history.at(-1)).toBe('Command: *Cancel*');
    expect(commits()).toHaveLength(1);
  });

  it('commits nothing for a command cancelled before it edits', async () => {
    const { bus, commits } = setup();
    await bus.script(['LINE', '0,0']);
    await bus.cancel();
    expect(commits()).toHaveLength(0);
  });

  it('matches option keywords by their capitals, and closes and undoes', async () => {
    const { bus, lines } = setup();
    const before = lines().length;
    await bus.script(['LINE', '0,0', '10,0', 'u', 'u', '10,10', '0,10', 'cl']);
    const added = lines().slice(before);
    expect(added).toHaveLength(3);
    near(added[2]!.end, { x: 0, y: 0 });
    expect(bus.history).toContain('All segments already undone.');
    expect(bus.command).toBeUndefined();
  });

  it('refuses input a prompt cannot take, and asks again', async () => {
    const { bus } = setup();
    await bus.script(['LINE', 'hello']);
    expect(bus.history.at(-1)).toBe('Point or option keyword required.');
    await bus.submit('3,');
    expect(bus.history.at(-1)).toBe('Invalid point.');
    await bus.submit('10');
    expect(bus.history.at(-1)).toBe('Invalid point.');
    await bus.submit('Close');
    expect(bus.history.at(-1)).toBe('Point or option keyword required.');
    await bus.answer({ kind: 'distance', value: 3 });
    expect(bus.history.at(-1)).toBe('Point or option keyword required.');
    await bus.answer({ kind: 'keyword', keyword: 'Close' });
    expect(bus.history.at(-1)).toBe('Point or option keyword required.');
    expect(bus.promptText).toBe('Specify first point:');
    await bus.answer({ kind: 'point', point: { x: 1, y: 1 } });
    expect(bus.lastPoint).toEqual({ x: 1, y: 1 });
    expect(bus.promptText).toBe('Specify next point or [Undo]:');
  });

  it('gives unknown commands and dash variants as AutoCAD does', async () => {
    const { bus } = setup();
    await bus.submit('FOO');
    expect(bus.history.at(-1)).toBe('Unknown command "FOO".  Press F1 for help.');
    await bus.submit('-LINE');
    expect(bus.history.at(-1)).toBe('Unknown command "-LINE".  Press F1 for help.');
    await bus.submit('CIRCLE');
    expect(bus.command).toBe('CIRCLE');
    await bus.cancel();
    await bus.script(['-la', 'Walls, Doors']);
    await bus.script(['LAYER', "'ZOOM"]);
    expect(got).toEqual([
      { kind: 'string', value: 'dash' },
      { kind: 'string', value: 'Walls, Doors' },
      { kind: 'string', value: 'dialog' },
      { kind: 'string', value: "'ZOOM" },
    ]);
  });

  it('runs transparent commands inside another and resumes it', async () => {
    const { bus, events, lines } = setup();
    const before = lines().length;
    await bus.script(['LINE', '0,0', "'Z"]);
    expect(bus.command).toBe('ZOOM');
    expect(bus.promptText).toBe('>>Enter an option [All/Extents]:');
    expect(events.at(-1)).toMatchObject({
      type: 'prompt',
      text: '>>Enter an option [All/Extents]:',
    });
    await bus.submit("'ZOOM");
    expect(bus.history.at(-1)).toBe('** Cannot nest transparent commands **');
    await bus.submit('e');
    expect(got).toEqual([{ kind: 'keyword', keyword: 'Extents' }]);
    expect(bus.history.slice(-2)).toEqual([
      '>>Enter an option [All/Extents]: e',
      'Resuming LINE command.',
    ]);
    expect(bus.promptText).toBe('Specify next point or [Undo]:');
    await bus.submit("'LINE");
    expect(bus.history.at(-1)).toBe('** That command may not be invoked transparently **');
    await bus.submit("'NOPE");
    expect(bus.history.at(-1)).toBe('Unknown command "NOPE".  Press F1 for help.');
    await bus.script(['5,0', '']);
    expect(lines().length - before).toBe(1);
    expect(bus.recent).toEqual(['LINE']);
  });

  it('runs a transparent command normally at Command:, and Esc inside one cancels both', async () => {
    const { bus } = setup();
    await bus.submit("'ZOOM");
    expect(bus.command).toBe('ZOOM');
    expect(bus.promptText).toBe('Enter an option [All/Extents]:');
    await bus.submit('a');
    await bus.script(['LINE', '0,0', "'ZOOM"]);
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    expect(bus.history.at(-1)).toBe('>>Enter an option [All/Extents]: *Cancel*');
  });

  it('starts a command from a button by cancelling the running one, or nests a transparent one', async () => {
    const { bus } = setup();
    await bus.script(['LINE', '0,0']);
    await bus.invoke('zoom');
    expect(bus.command).toBe('ZOOM');
    await bus.submit('a');
    expect(bus.command).toBe('LINE');
    await bus.invoke('CIRCLE');
    expect(bus.command).toBe('CIRCLE');
    expect(bus.history).toContain('Command: CIRCLE');
    await bus.invoke('-LAYER');
    expect(bus.command).toBe('LAYER');
    await bus.invoke('NOPE');
    expect(bus.history.at(-1)).toBe('Unknown command "NOPE".  Press F1 for help.');
  });

  it('answers Enter with the default, and measures distances from the base or two points', async () => {
    const { bus } = setup([['$LUPREC', 2]]);
    await bus.script(['CIRCLE', '5,5']);
    expect(bus.promptText).toBe('Specify radius of circle or [Diameter] <10.00>:');
    await bus.submit('');
    await bus.script(['CIRCLE', '5,5', '2.5*2']);
    await bus.script(['CIRCLE', '5,5', 'd']);
    await bus.script(['CIRCLE', '5,5', '8,9']);
    await bus.script(['CIRCLE', '5,5']);
    await bus.answer({ kind: 'point', point: { x: 5, y: 7 } });
    await bus.script(['CIRCLE', '5,5', 'abc']);
    expect(bus.history.at(-1)).toBe('Requires numeric distance or two points.');
    await bus.cancel();
    await bus.script(['DIST', '0,0']);
    expect(bus.promptText).toBe('Specify second point:');
    expect(bus.prompt).toMatchObject({ kind: 'point', message: 'Specify second point' });
    await bus.submit('@0,7');
    await bus.script(['DIST', '1,1']);
    await bus.answer({ kind: 'point', point: { x: 4, y: 5 } });
    expect(got).toEqual([
      { kind: 'distance', value: 10 },
      { kind: 'distance', value: 5 },
      { kind: 'keyword', keyword: 'Diameter' },
      { kind: 'distance', value: 5 },
      { kind: 'distance', value: 2 },
      { kind: 'distance', value: 7 },
      { kind: 'distance', value: 5 },
    ]);
  });

  it('reads feet and inches in architectural units (M2-35 part 7)', async () => {
    const { bus, lines } = setup([['$LUNITS', 4]]);
    await bus.script(['CIRCLE', '5,5', `1'-6"`]);
    await bus.script(['CIRCLE', '5,5', '2-1/2']);
    await bus.script(['CIRCLE', '5,5', '1-1/2"']);
    await bus.script(['CIRCLE', '5,5', `5'6'`]);
    expect(bus.history.at(-1)).toBe('Requires numeric distance or two points.');
    await bus.cancel();
    expect(got).toEqual([
      { kind: 'distance', value: 18 },
      { kind: 'distance', value: 2.5 },
      { kind: 'distance', value: 1.5 },
    ]);
    const before = lines().length;
    await bus.script(['LINE', `1',2'`]);
    bus.pointer({ x: 12, y: 100 });
    await bus.submit(`1'`);
    await bus.submit(`@6",0`);
    await bus.submit('');
    near(lines().slice(before)[0]!.start, { x: 12, y: 24 });
    near(lines().slice(before)[0]!.end, { x: 12, y: 36 });
    near(lines().slice(before)[1]!.end, { x: 18, y: 36 });
  });

  it('shows defaults and echoes picks in the drawing units (M2-35 part 17)', async () => {
    const { bus } = setup([
      ['$LUNITS', 4],
      ['$LUPREC', 4],
      ['$AUNITS', 1],
      ['$AUPREC', 2],
    ]);
    await bus.script(['CIRCLE', '5,5']);
    expect(bus.promptText).toBe(`Specify radius of circle or [Diameter] <0'-10">:`);
    await bus.answer({ kind: 'distance', value: 18.25 });
    expect(bus.history.at(-1)).toBe(`Specify radius of circle or [Diameter] <0'-10">: 1'-6 1/4"`);
    await bus.script(['ROTATE']);
    await bus.answer({ kind: 'angle', value: Math.PI / 4 });
    expect(bus.history.at(-1)).toBe(`Specify rotation angle: 45d0'`);
    await bus.cancel();
    await bus.script(['LINE']);
    await bus.answer({ kind: 'point', point: { x: 30, y: 6.5 } });
    expect(bus.history.at(-1)).toBe(`Specify first point: 2'-6",0'-6 1/2"`);
    await bus.cancel();
  });

  it('reads 1-1/2 as arithmetic in decimal units', async () => {
    const { bus } = setup();
    await bus.script(['CIRCLE', '5,5', '1-1/2']);
    await bus.script(['CIRCLE', '5,5', `1'`]);
    expect(bus.history.at(-1)).toBe('Requires numeric distance or two points.');
    await bus.cancel();
    expect(got).toEqual([{ kind: 'distance', value: 0.5 }]);
  });

  it('reads angles in ANGBASE and ANGDIR, typed or from points', async () => {
    const { bus } = setup([
      ['$ANGBASE', Math.PI / 2],
      ['$ANGDIR', 1],
    ]);
    await bus.script(['ROTATE', '30', '0,0', '@1<0']);
    await bus.script(['ROTATE', '-1,0', 'xyz']);
    expect(bus.history.at(-1)).toBe('Requires valid numeric angle or second point.');
    await bus.answer({ kind: 'angle', value: 1 });
    const values = got.map((a) => (a.kind === 'angle' ? a.value : NaN));
    expect(values[0]).toBeCloseTo(Math.PI / 3, 12);
    expect(values[1]).toBeCloseTo(Math.PI / 2, 12);
    expect(values[2]).toBeCloseTo(Math.PI, 12);
    expect(values[3]).toBe(1);
  });

  it('checks integer and real input', async () => {
    const { bus } = setup();
    await bus.script(['POLYGON', '2.5']);
    expect(bus.history.at(-1)).toBe('Requires an integer value.');
    await bus.answer({ kind: 'number', value: 2.5 });
    expect(bus.history.at(-1)).toBe('Requires an integer value.');
    await bus.submit('');
    await bus.submit('x');
    expect(bus.history.at(-1)).toBe('Requires numeric value.');
    await bus.submit('3/4');
    await bus.script(['POLYGON', '6', '1']);
    expect(got).toEqual([
      { kind: 'number', value: 4 },
      { kind: 'number', value: 0.75 },
      { kind: 'number', value: 6 },
      { kind: 'number', value: 1 },
    ]);
  });

  it('takes a whole selection from a front-end; text that is no mode is refused (M2-03)', async () => {
    const { bus } = setup();
    await bus.script(['SELECT', 'XYZ']);
    expect(bus.history.at(-2)).toBe('*Invalid selection*');
    await bus.answer({ kind: 'selection', ids: [1, 2] });
    expect(got).toEqual([{ kind: 'selection', ids: [1, 2] }]);
    expect(bus.history.at(-1)).toBe('Select objects: 2 found');
  });

  it('collects FROM, M2P and point filters before the command sees the point', async () => {
    const { bus, lines } = setup();
    const before = lines().length;
    await bus.script(['LINE', 'FROM']);
    expect(bus.promptText).toBe('Base point:');
    await bus.submit('10,10');
    expect(bus.promptText).toBe('<Offset>:');
    await bus.submit('@5,0');
    expect(bus.lastPoint).toEqual({ x: 15, y: 10 });
    await bus.script(['m2p', '0,0', '20,4']);
    await bus.script(['.x', '7,100']);
    expect(bus.promptText).toBe('(need Y):');
    await bus.script(['1,9']);
    await bus.script(['.y', '100,3', '8,100']);
    await bus.script(['.xy', '1,2']);
    await bus.script(['.z']);
    expect(bus.promptText).toBe('.Z of');
    await bus.script(['5,5', '6,6']);
    await bus.script(['.xz', 'FROM', '0,0', '@2,2', '0,0']);
    await bus.script(['']);
    const ends = lines()
      .slice(before)
      .map((l) => l.end);
    expect(ends).toEqual([
      { x: 10, y: 2 },
      { x: 7, y: 9 },
      { x: 8, y: 3 },
      { x: 1, y: 2 },
      { x: 6, y: 6 },
      { x: 2, y: 0 },
    ]);
    expect(bus.history).toContain('Base point: 10,10');
    expect(bus.history).toContain('<Offset>: @5,0');
  });

  it('refuses a bad point inside a modifier and keeps it through a transparent command', async () => {
    const { bus } = setup();
    await bus.script(['LINE', 'FROM', 'abc']);
    expect(bus.history.at(-1)).toBe('Invalid point.');
    await bus.answer({ kind: 'enter' });
    expect(bus.history.at(-1)).toBe('Invalid point.');
    await bus.answer({ kind: 'point', point: { x: 1, y: 1 } });
    expect(bus.promptText).toBe('<Offset>:');
    await bus.script(["'ZOOM", 'a']);
    expect(bus.promptText).toBe('<Offset>:');
    await bus.submit('@1,0');
    expect(bus.lastPoint).toEqual({ x: 2, y: 1 });
    await bus.cancel();
    await bus.script(['DIST', 'm2p', '0,0', '2,0', '1,3']);
    expect(got.at(-1)).toEqual({ kind: 'distance', value: 3 });
  });

  it('asks "of" after a typed object snap override, keeping the rubber band (M2-04)', async () => {
    const { bus, lines, events } = setup();
    const before = lines().length;
    await bus.script(['LINE', '0,0', 'end']);
    expect(bus.promptText).toBe('of');
    expect(bus.prompt).toMatchObject({
      kind: 'point',
      message: 'of',
      osnap: OSNAP.END,
      rubberBand: { from: { x: 0, y: 0 } },
    });
    expect(events.at(-1)).toMatchObject({ type: 'prompt', text: 'of' });
    // The front-end snapped the click with the override's modes: the point is the command's.
    await bus.pick({ x: 10, y: 5 });
    expect(bus.prompt).toMatchObject({ message: 'Specify next point or' });
    expect(bus.prompt).not.toHaveProperty('osnap');
    // NONe: no object snap for the next point; a typed point at "of" is taken as typed.
    await bus.script(['non']);
    expect(bus.prompt).toMatchObject({ osnap: 0 });
    await bus.script(['20,0', '']);
    const ends = lines()
      .slice(before)
      .map((l) => l.end);
    expect(ends).toEqual([
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ]);
    expect(bus.history).toContain('Specify next point or [Undo]: end');
    expect(bus.history).toContain('of 20,0');
  });

  it('refuses a click an override found nothing at, and keeps asking "of" (M2-04)', async () => {
    const { bus } = setup();
    await bus.script(['LINE', '0,0', 'mid,end']);
    expect(bus.prompt).toMatchObject({ osnap: OSNAP.MID | OSNAP.END });
    await bus.pick({ x: 3, y: 3 }, { missed: true });
    expect(bus.history.at(-1)).toBe('Invalid point.');
    expect(bus.promptText).toBe('of');
    await bus.cancel();
    expect(bus.command).toBeUndefined();
  });

  it("takes an override at FROM's base point and at a distance prompt (M2-04)", async () => {
    const { bus } = setup();
    await bus.script(['LINE', 'FROM', 'cen']);
    expect(bus.promptText).toBe('of');
    expect(bus.prompt).toMatchObject({ osnap: OSNAP.CEN });
    await bus.pick({ x: 10, y: 10 });
    expect(bus.promptText).toBe('<Offset>:');
    await bus.submit('@5,0');
    expect(bus.lastPoint).toEqual({ x: 15, y: 10 });
    await bus.cancel();
    await bus.script(['DIST', 'int']);
    expect(bus.prompt).toMatchObject({ kind: 'point', osnap: OSNAP.INT });
    await bus.pick({ x: 1, y: 1 });
    await bus.script(['@0,4']);
    expect(got.at(-1)).toEqual({ kind: 'distance', value: 4 });
  });

  it('takes a number at a rubber band as a direct distance towards the cursor', async () => {
    const { bus, lines } = setup();
    const before = lines().length;
    await bus.script(['LINE', '10,10']);
    await bus.submit('5');
    expect(bus.history.at(-1)).toBe('Invalid point.');
    bus.pointer({ x: 10, y: 10 });
    await bus.submit('5');
    expect(bus.history.at(-1)).toBe('Invalid point.');
    bus.pointer({ x: 10, y: 50 });
    await bus.submit('2*10');
    bus.pointer(undefined);
    await bus.submit('');
    near(lines().slice(before)[0]!.end, { x: 10, y: 30 });
  });

  it('ends a command that throws, keeping and committing what it drew', async () => {
    const { bus, commits } = setup();
    await bus.script(['BOOM', '0,0']);
    expect(bus.history.at(-1)).toBe('; error: the command failed');
    expect(bus.command).toBeUndefined();
    expect(commits()).toHaveLength(1);
    expect(commits()[0]!.command).toBe('BOOM');
  });

  it('applies edits through the host, and stops telling a listener that left', async () => {
    const base = sampleInit();
    const model = DocumentModel.create(base);
    const applied: unknown[] = [];
    const bus = new PromptBus({
      model,
      registry: new CommandRegistry([LINE]),
      apply: (cs) => {
        applied.push(cs);
        model.apply(cs);
      },
    });
    const seen: BusEvent[] = [];
    const off = bus.on((e) => seen.push(e));
    await bus.script(['LINE', '0,0', '1,0']);
    off();
    await bus.submit('');
    expect(applied).toHaveLength(1);
    expect(seen.some((e) => e.type === 'commit')).toBe(false);
    expect(seen.filter((e) => e.type === 'start')).toEqual([
      { type: 'start', command: 'LINE', transparent: false },
    ]);
  });
});

describe('CommandRegistry', () => {
  it('finds commands by name, acad.pgp alias, own alias and dash variant', () => {
    const extra: CommandDef = { name: 'REVCLOUD', aliases: ['RC'], async *run() {} };
    const r = new CommandRegistry([LINE, LAYER, extra]);
    expect(r.resolve('line')?.def.name).toBe('LINE');
    expect(r.resolve(' l ')?.def.name).toBe('LINE');
    expect(r.resolve('rc')?.def.name).toBe('REVCLOUD');
    expect(r.resolve('-LA')).toMatchObject({ def: { name: 'LAYER' }, dash: true });
    expect(r.resolve('LA')).toMatchObject({ def: { name: 'LAYER' }, dash: false });
    expect(r.resolve('-L')).toBeUndefined();
    expect(r.resolve('C')).toBeUndefined();
    expect(r.resolve('')).toBeUndefined();
    expect(r.alias('c')).toBe('CIRCLE');
    expect(r.get('layer')?.name).toBe('LAYER');
    expect(r.names()).toEqual(['LAYER', 'LINE', 'REVCLOUD']);
  });

  it('refuses a second command of a name, lower-case names and an alias naming another command', () => {
    const r = new CommandRegistry([LINE]);
    expect(() => r.register(LINE)).toThrow('registered twice');
    expect(() => r.register({ name: 'Circle', async *run() {} })).toThrow('upper case');
    expect(() => r.register({ name: 'LINE2', aliases: ['C'], async *run() {} })).toThrow(
      'already names CIRCLE',
    );
    r.register({ name: 'CIRCLE', aliases: ['C'], async *run() {} });
    expect(r.resolve('c')?.def.name).toBe('CIRCLE');
  });
});
