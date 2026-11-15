// M3-01 part 4: XLINE (through points, Hor, Ver, Ang with Reference, Bisect, Offset with a
// distance or Through) and RAY scripted on the PromptBus, with AutoCAD 2024's prompts and each
// line dragged with the cursor before it is made.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  dragMotion,
  type Entity,
  type EntityGeometry,
  type ViewHost,
} from '../../src/index';
import { LAYER_WALLS, MODEL_SPACE, entityInit, sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** The canvas's pick: the lines and circles within 0.5 of the point. */
function pickHost(model: DocumentModel): ViewHost {
  const near = (g: EntityGeometry, p: { x: number; y: number }): boolean => {
    if (g.kind === 'CIRCLE')
      return Math.abs(Math.hypot(p.x - g.center.x, p.y - g.center.y) - g.radius) <= 0.5;
    if (g.kind !== 'LINE') return false;
    const dx = g.end.x - g.start.x;
    const dy = g.end.y - g.start.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - g.start.x) * dx + (p.y - g.start.y) * dy) / (dx * dx + dy * dy)),
    );
    return Math.hypot(p.x - g.start.x - t * dx, p.y - g.start.y - t * dy) <= 0.5;
  };
  return {
    request: (r) =>
      Promise.resolve(
        r.op === 'pick'
          ? {
              ok: true,
              ids: [...model.entities()].filter((e) => near(e.geom, r.point)).map((e) => e.id),
            }
          : { ok: false, message: 'not drawn' },
      ),
  };
}

function setup() {
  const model = DocumentModel.create(sampleInit());
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({ model, registry: builtinCommands(), view: pickHost(model) });
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  /** Each new xline or ray as [type, base x, y, direction x, y]. */
  const lines = () =>
    added().map((e) => {
      const g = e.geom as { base: { x: number; y: number }; direction: { x: number; y: number } };
      return [e.type, r6(g.base.x), r6(g.base.y), r6(g.direction.x), r6(g.direction.y)];
    });
  return { model, bus, added, lines };
}

const H = r6(Math.SQRT1_2);

describe('XLINE', () => {
  it('through a point and each through point, until Enter', async () => {
    const { bus, added, lines } = setup();
    await bus.submit('XL');
    expect(bus.promptText).toBe('Specify a point or [Hor/Ver/Ang/Bisect/Offset]:');
    await bus.submit('1,1');
    expect(bus.promptText).toBe('Specify through point:');
    expect(dragMotion(bus.prompt!.drag!, { x: 1, y: 5 })?.adding?.geom).toMatchObject({
      kind: 'XLINE',
      base: { x: 1, y: 1 },
      direction: { x: 0, y: 1 },
    });
    await bus.submit('2,2');
    expect(bus.promptText).toBe('Specify through point:');
    await bus.submit('1,1'); // on the base point: no line
    await bus.submit('-1,1');
    await bus.submit('');
    expect(bus.command).toBeUndefined();
    expect(lines()).toEqual([
      ['XLINE', 1, 1, H, H],
      ['XLINE', 1, 1, -1, 0],
    ]);
    expect(added()[0]).toMatchObject({ owner: MODEL_SPACE, layer: LAYER_WALLS });
  });

  it('Hor and Ver: through each point', async () => {
    const { bus, lines } = setup();
    await bus.script(['XLINE', 'H', '0,5', '0,7', '', 'XLINE', 'V']);
    expect(bus.promptText).toBe('Specify through point:');
    expect(dragMotion(bus.prompt!.drag!, { x: 3, y: 3 })?.adding?.geom).toMatchObject({
      kind: 'XLINE',
      base: { x: 3, y: 3 },
      direction: { x: 0, y: 1 },
    });
    await bus.script(['4,0', '']);
    expect(lines()).toEqual([
      ['XLINE', 0, 5, 1, 0],
      ['XLINE', 0, 7, 1, 0],
      ['XLINE', 4, 0, 0, 1],
    ]);
  });

  it('Ang: at a typed angle, which is shown and taken by Enter next time', async () => {
    const { bus, lines } = setup();
    await bus.script(['XLINE', 'A']);
    expect(bus.promptText).toBe('Enter angle of xline (0) or [Reference]:');
    await bus.script(['45', '0,0', '']);
    await bus.script(['XLINE', 'A']);
    expect(bus.promptText).toBe('Enter angle of xline (45) or [Reference]:');
    await bus.script(['', '0,3', '']);
    expect(lines()).toEqual([
      ['XLINE', 0, 0, H, H],
      ['XLINE', 0, 3, H, H],
    ]);
  });

  it('Ang Reference: an angle from a picked line', async () => {
    const init = sampleInit();
    const model = DocumentModel.create({
      ...init,
      entities: [entityInit('20', { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } })],
    });
    const bus = new PromptBus({ model, registry: builtinCommands(), view: pickHost(model) });
    await bus.script(['XLINE', 'A', 'R']);
    expect(bus.promptText).toBe('Select a line object:');
    await bus.pick({ x: 5, y: 5 });
    expect(bus.promptText).toBe('Enter angle of xline <0>:');
    await bus.submit('45');
    expect(bus.promptText).toBe('Specify through point:');
    await bus.script(['3,3', '']);
    const x = [...model.entities()].find((e) => e.type === 'XLINE')!.geom as {
      direction: { x: number; y: number };
    };
    // 45° from the 45° line: straight up.
    expect([r6(x.direction.x), r6(x.direction.y)]).toEqual([0, 1]);
  });

  it('Bisect: halving the angle at the vertex, for each end point', async () => {
    const { bus, lines } = setup();
    await bus.script(['XLINE', 'B']);
    expect(bus.promptText).toBe('Specify angle vertex point:');
    await bus.submit('0,0');
    expect(bus.promptText).toBe('Specify angle start point:');
    await bus.submit('10,0');
    expect(bus.promptText).toBe('Specify angle end point:');
    expect(dragMotion(bus.prompt!.drag!, { x: 0, y: 4 })?.adding?.geom).toMatchObject({
      kind: 'XLINE',
      base: { x: 0, y: 0 },
    });
    await bus.script(['0,4', '-3,0', '']);
    expect(lines()).toEqual([
      ['XLINE', 0, 0, H, H],
      // Opposite rays: the bisector is square to them.
      ['XLINE', 0, 0, 0, 1],
    ]);
  });

  it('Offset: parallel to a picked line at a distance, on the side picked', async () => {
    const { bus, lines } = setup();
    await bus.script(['XLINE', 'O']);
    expect(bus.promptText).toBe('Specify offset distance or [Through] <Through>:');
    await bus.submit('2');
    expect(bus.promptText).toBe('Select a line object:');
    // The fixture's line along +X from the origin.
    await bus.pick({ x: 5, y: 0 });
    expect(bus.promptText).toBe('Specify side to offset:');
    expect(dragMotion(bus.prompt!.drag!, { x: 4, y: -9 })?.adding?.geom).toMatchObject({
      kind: 'XLINE',
      base: { x: 0, y: -2 },
    });
    await bus.submit('3,5');
    expect(bus.promptText).toBe('Select a line object:');
    await bus.submit('');
    expect(lines()).toEqual([['XLINE', 0, 2, 1, 0]]);
    // The distance is offered next time.
    await bus.script(['XLINE', 'O']);
    expect(bus.promptText).toBe('Specify offset distance or [Through] <2.0000>:');
  });

  it('Offset Through: parallel to a picked line through a point', async () => {
    const { bus, lines } = setup();
    await bus.script(['XLINE', 'O', '']);
    expect(bus.promptText).toBe('Select a line object:');
    await bus.pick({ x: 0, y: 5 });
    expect(bus.promptText).toBe('Specify through point:');
    await bus.script(['7,1', '']);
    expect(lines()).toEqual([['XLINE', 7, 1, 0, 1]]);
  });

  it('says so when the object picked is not a line', async () => {
    const { bus } = setup();
    await bus.script(['XLINE', 'O', 'T']);
    // The fixture's circle at (5, 5) r 2 is not a line object.
    await bus.pick({ x: 5, y: 7 });
    expect(bus.history.at(-1)).toBe('Selected entity is not a line, polyline, xline or ray.');
    expect(bus.promptText).toBe('Select a line object:');
    await bus.pick({ x: 5, y: 0 });
    expect(bus.promptText).toBe('Specify through point:');
  });
});

describe('RAY', () => {
  it('from a start point through each point, until Enter', async () => {
    const { bus, lines } = setup();
    await bus.submit('RAY');
    expect(bus.promptText).toBe('Specify start point:');
    await bus.submit('2,2');
    expect(bus.promptText).toBe('Specify through point:');
    expect(dragMotion(bus.prompt!.drag!, { x: 2, y: 0 })?.adding?.geom).toMatchObject({
      kind: 'RAY',
      base: { x: 2, y: 2 },
      direction: { x: 0, y: -1 },
    });
    await bus.script(['5,2', '2,6', '']);
    expect(bus.command).toBeUndefined();
    expect(lines()).toEqual([
      ['RAY', 2, 2, 1, 0],
      ['RAY', 2, 2, 0, 1],
    ]);
  });
});

describe('XLINE and RAY ended early', () => {
  it('Enter (no answer) or Esc at any prompt draws nothing', async () => {
    const { bus, added } = setup();
    const scripts = [
      ['XLINE'],
      ['XLINE', '0,0'],
      ['XLINE', 'H'],
      ['XLINE', 'A'],
      ['XLINE', 'A', 'R'],
      ['XLINE', 'B'],
      ['XLINE', 'B', '0,0'],
      ['XLINE', 'B', '0,0', '1,0'],
      ['XLINE', 'O'],
      ['RAY'],
      ['RAY', '0,0'],
    ];
    for (const script of scripts) {
      await bus.script(script);
      expect(bus.command).toBeDefined();
      await bus.cancel();
      expect(bus.command).toBeUndefined();
      // Enter where a value is wanted ends the command too, as AutoCAD does.
      await bus.script(script);
      await bus.submit('');
      if (bus.command) await bus.cancel();
    }
    expect(added()).toEqual([]);
  });

  it('Offset: refuses a zero distance, Enter takes the last, Esc at the side ends', async () => {
    const { bus, lines } = setup();
    await bus.script(['XLINE', 'O', '0']);
    expect(bus.history.at(-1)).toBe('Value must be positive and nonzero.');
    await bus.script(['3']);
    await bus.pick({ x: 5, y: 0 });
    await bus.cancel();
    await bus.script(['XLINE', 'O', '']);
    expect(bus.promptText).toBe('Select a line object:');
    await bus.pick({ x: 5, y: 0 });
    await bus.script(['1,1', '']);
    expect(lines()).toEqual([['XLINE', 0, 3, 1, 0]]);
    // Through brings the distance back to Through.
    await bus.script(['XLINE', 'O', 'T', '']);
    await bus.script(['XLINE', 'O']);
    expect(bus.promptText).toBe('Specify offset distance or [Through] <Through>:');
    await bus.cancel();
  });

  it('Ang Reference: Enter takes the line’s own angle; Ang takes a picked angle', async () => {
    const { bus, lines } = setup();
    await bus.script(['XLINE', 'A', 'R']);
    await bus.pick({ x: 5, y: 0 });
    await bus.script(['', '0,4', '']);
    await bus.script(['XLINE', 'A']);
    await bus.answer({ kind: 'angle', value: Math.PI / 2 });
    await bus.script(['2,0', '']);
    expect(lines()).toEqual([
      ['XLINE', 0, 4, 1, 0],
      ['XLINE', 2, 0, 0, 1],
    ]);
  });
});
