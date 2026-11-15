// M3-05 part 4: a dimension's grip menus. AutoCAD 2024 offers, as the cursor rests on a linear or
// aligned dimension's dimension line grip, Stretch, Continue Dimension (DIMCONTINUE), Baseline
// Dimension (DIMBASELINE) and Flip Arrow ("About Modifying Dimension Geometry", Use Dimension
// Line Grips); and on its text grip Stretch, Move with Dim Line, Move Text Only, Move with
// Leader, Above Dim Line, Center Vertically and Reset Text Position ("About Modifying Dimension
// Text", Use Dimension Text Grips). Each can also be typed at the hot grip, as part 1's are.
//
// The dimension engine sits above the engine: as in dimension-commands.test.ts, the bus gets a
// stand-in that draws a dimension as its definition point and places its text a unit above the
// middle of its dimension line (or keeps text the user placed).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  GRIP_CYCLE,
  PromptBus,
  builtinCommands,
  dstyleOverrides,
  gripFunctionsOf,
  type BusEvent,
  type DimStyleRecord,
  type DimensionGeometry,
  type DimensionRegenerator,
  type Entity,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { MODEL_SPACE, record, sampleInit } from '../model/fixtures';

type Linear = Extract<DimensionGeometry, { dimType: 'linear' | 'aligned' }>;

const STYLE = '27';
const ACAD = '12';

/** The stand-in engine: the text a unit above the dimension line's middle, unless placed. */
const regenerate: DimensionRegenerator = (e, _model, measure) => {
  const g = e.geom as DimensionGeometry;
  if (g.dimType !== 'linear' && g.dimType !== 'aligned') return undefined;
  const value = String(Math.abs(g.second.x - g.first.x));
  const width = measure({
    kind: 'MTEXT',
    contents: value,
    style: '',
    position: g.textPosition,
    height: 1,
    width: 0,
    rotation: 0,
    attachment: 5,
    direction: 1,
    lineSpacingStyle: 1,
    lineSpacing: 1,
  });
  if (width === undefined) return undefined;
  const at = g.textUserPositioned
    ? g.textPosition
    : { x: (g.first.x + g.second.x) / 2, y: g.definitionPoint.y + 1 };
  return {
    parts: [{ geom: { kind: 'POINT', position: g.definitionPoint }, defpoint: true }],
    geom: { ...g, textPosition: at },
    measurement: value,
  };
};

function setup(vars: DimStyleRecord['vars'] = {}) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    header: new Map([...init.header!, ['$DIMSTYLE', 'Standard']]),
    tables: {
      ...init.tables,
      appIds: [record(ACAD, 'ACAD')],
      dimStyles: [{ handle: STYLE, name: 'Standard', vars }],
    },
    entities: (init.entities ?? []).filter((e) => e.owner !== MODEL_SPACE),
  });
  const answer = (r: ViewRequest): ViewReply => {
    if (r.op === 'textWidths') return { ok: true, widths: r.texts.map((t) => t.contents.length) };
    if (r.op === 'pick') return { ok: true, ids: [] };
    return { ok: false, message: 'not drawn' };
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: (r) => Promise.resolve(answer(r)) },
    dimensions: regenerate,
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const dims = (): Entity[] =>
    [...model.entities()].filter((e) => e.owner === MODEL_SPACE && e.geom.kind === 'DIMENSION');
  const dim = (i = 0) => dims().at(i)!.geom as Linear;
  const overrides = (i = 0) => dstyleOverrides(dims().at(i)!.xdata, model);
  /** The grip at (x, y) made hot, the selection being every object; `fn` from its menu. */
  const hot = async (x: number, y: number, fn?: string) => {
    await bus.selectAll();
    await bus.pick({ x, y }, { grip: 0.1, ...(fn && { gripFunction: fn }) });
  };
  return { model, bus, log, dims, dim, overrides, hot };
}

/** A horizontal dimension of (0,0)–(10,0), its dimension line at y = 5, text at (5, 6). */
async function withDimension(vars: DimStyleRecord['vars'] = {}) {
  const s = setup(vars);
  await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']);
  expect(s.dim()).toMatchObject({
    first: { x: 0, y: 0 },
    second: { x: 10, y: 0 },
    definitionPoint: { x: 10, y: 5 },
    textPosition: { x: 5, y: 6 },
  });
  return s;
}

describe('a dimension’s grip functions', () => {
  it('a dimension line grip: Stretch, Continue Dimension, Baseline Dimension, Flip Arrow', async () => {
    const s = await withDimension();
    const lineGrip = ['Stretch', 'Continue Dimension', 'Baseline Dimension', 'Flip Arrow'];
    expect(gripFunctionsOf(s.dim(), { x: 0, y: 5 })).toEqual(lineGrip);
    expect(gripFunctionsOf(s.dim(), { x: 10, y: 5 })).toEqual(lineGrip);
    await s.bus.selectAll();
    expect(s.bus.gripMenu({ x: 0.05, y: 5 }, 0.1)?.items).toEqual(lineGrip);
  });

  it('the text grip: Stretch and the six ways to place the text', async () => {
    const s = await withDimension();
    expect(gripFunctionsOf(s.dim(), { x: 5, y: 6 })).toEqual([
      'Stretch',
      'Move with Dim Line',
      'Move Text Only',
      'Move with Leader',
      'Above Dim Line',
      'Center Vertically',
      'Reset Text Position',
    ]);
  });

  it('an extension line origin, and other dimension kinds, keep Stretch alone', async () => {
    const s = await withDimension();
    expect(gripFunctionsOf(s.dim(), { x: 0, y: 0 })).toEqual([]);
    const radius: DimensionGeometry = {
      ...s.dim(),
      dimType: 'radius',
      chordPoint: { x: 3, y: 4 },
      leaderLength: 0,
      definitionPoint: { x: 0, y: 0 },
    } as DimensionGeometry;
    expect(gripFunctionsOf(radius, radius.textPosition)).toEqual([]);
  });
});

describe('Flip Arrow', () => {
  it('flips the arrow at that end at once, in one undo step, and the dimension is redrawn', async () => {
    const s = await withDimension();
    const block = s.dim().block;
    await s.hot(10, 5, 'Flip Arrow');
    expect(s.bus.command).toBeUndefined();
    expect(s.dim().flipArrows).toEqual([false, true]);
    // Regenerated: its block was written again (the stand-in draws its definition point).
    expect(s.dim().block).toBe(block);
    expect(s.bus.selection).toHaveLength(1);
    // Typed at the hot grip, at the other end; again flips it back.
    await s.hot(0, 5);
    await s.bus.submit('FL');
    expect(s.dim().flipArrows).toEqual([true, true]);
    await s.hot(0, 5, 'Flip Arrow');
    expect(s.dim().flipArrows).toEqual([false, true]);
    await s.bus.script(['U']);
    expect(s.dim().flipArrows).toEqual([true, true]);
  });
});

describe('Continue Dimension and Baseline Dimension', () => {
  it('Continue Dimension goes on from the extension line at that end', async () => {
    const s = await withDimension();
    await s.hot(10, 5, 'Continue Dimension');
    expect(s.bus.promptText).toBe(
      'Specify a second extension line origin or [Undo/Select] <Select>:',
    );
    await s.bus.submit('25,0');
    expect(s.dim(1)).toMatchObject({
      first: { x: 10, y: 0 },
      second: { x: 25, y: 0 },
      definitionPoint: { x: 25, y: 5 },
    });
    await s.bus.script(['', '']);
    expect(s.bus.command).toBeUndefined();
    // DIMCONTINUE afterwards goes on from the one it made last.
    await s.bus.script(['DIMCONTINUE', '30,0', '', '']);
    expect(s.dim(2)).toMatchObject({ first: { x: 25, y: 0 }, second: { x: 30, y: 0 } });
  });

  it('from the first end it continues from the first extension line', async () => {
    const s = await withDimension();
    await s.hot(0, 5, 'Continue Dimension');
    await s.bus.script(['-8,0', '', '']);
    expect(s.dim(1)).toMatchObject({ first: { x: 0, y: 0 }, second: { x: -8, y: 0 } });
  });

  it('Baseline Dimension measures from that end, DIMDLI further out', async () => {
    const s = await withDimension({ DIMDLI: 2 });
    await s.hot(0, 5);
    await s.bus.submit('BA');
    expect(s.bus.promptText).toBe(
      'Specify a second extension line origin or [Undo/Select] <Select>:',
    );
    await s.bus.script(['20,0', '', '']);
    expect(s.dim(1)).toMatchObject({
      first: { x: 0, y: 0 },
      second: { x: 20, y: 0 },
      definitionPoint: { x: 20, y: 7 },
    });
  });
});

describe('the text grip', () => {
  it('Move Text Only puts the text at the point, DIMTMOVE 2 for this dimension', async () => {
    const s = await withDimension();
    await s.hot(5, 6, 'Move Text Only');
    expect(s.log.at(-1)).toBe('** MOVE TEXT ONLY **');
    expect(s.bus.promptText).toBe('Specify point to place text or [eXit]:');
    expect(s.bus.prompt).toMatchObject({
      drag: { kind: 'grip', grip: { x: 5, y: 6 }, fn: 'Move Text Only' },
    });
    await s.bus.submit('15,12');
    expect(s.dim()).toMatchObject({
      textPosition: { x: 15, y: 12 },
      textUserPositioned: true,
      definitionPoint: { x: 10, y: 5 },
    });
    expect(s.overrides()).toEqual({ DIMTMOVE: 2 });
    expect(s.bus.command).toBeUndefined();
    await s.bus.script(['U']);
    expect(s.dim()).toMatchObject({ textPosition: { x: 5, y: 6 }, textUserPositioned: false });
    expect(s.overrides()).toEqual({});
  });

  it('Move with Leader: DIMTMOVE 1', async () => {
    const s = await withDimension();
    await s.hot(5, 6);
    await s.bus.script(['LE', '-6,9']);
    expect(s.dim()).toMatchObject({ textPosition: { x: -6, y: 9 }, textUserPositioned: true });
    expect(s.overrides()).toEqual({ DIMTMOVE: 1 });
  });

  it('Move with Dim Line takes the dimension line with the text, DIMTMOVE 0', async () => {
    const s = await withDimension({ DIMTMOVE: 2 });
    await s.hot(5, 6, 'Move with Dim Line');
    await s.bus.submit('3,10');
    expect(s.dim()).toMatchObject({
      textPosition: { x: 3, y: 10 },
      textUserPositioned: true,
      definitionPoint: { x: 10, y: 9 },
    });
    expect(s.overrides()).toEqual({ DIMTMOVE: 0 });
  });

  it('Ctrl cycles the functions that take a point, Ctrl at the last back to Stretch', async () => {
    const s = await withDimension();
    await s.hot(5, 6);
    const ctrl = () => s.bus.answer({ kind: 'keyword', keyword: GRIP_CYCLE });
    await ctrl();
    expect(s.log.at(-1)).toBe('** MOVE WITH DIM LINE **');
    await ctrl();
    expect(s.log.at(-1)).toBe('** MOVE TEXT ONLY **');
    await ctrl();
    expect(s.log.at(-1)).toBe('** MOVE WITH LEADER **');
    await ctrl();
    expect(s.log.at(-1)).toBe('** STRETCH **');
  });

  it('a dimension line grip has nothing to Ctrl-cycle to', async () => {
    const s = await withDimension();
    await s.hot(10, 5);
    expect(s.bus.prompt?.ctrlCycles).toBeUndefined();
  });

  it('Above Dim Line: DIMTAD 1 for this dimension, the text back home, at once', async () => {
    const s = await withDimension();
    await s.hot(5, 6, 'Move Text Only');
    await s.bus.submit('15,12');
    await s.hot(15, 12, 'Above Dim Line');
    expect(s.bus.command).toBeUndefined();
    expect(s.dim()).toMatchObject({ textPosition: { x: 5, y: 6 }, textUserPositioned: false });
    expect(s.overrides()).toEqual({ DIMTMOVE: 2, DIMTAD: 1 });
  });

  it('Center Vertically: DIMTAD 0 and DIMTVP 0 for this dimension', async () => {
    const s = await withDimension({ DIMTAD: 1, DIMTVP: 1 });
    await s.hot(5, 6);
    await s.bus.submit('CE');
    expect(s.bus.command).toBeUndefined();
    expect(s.overrides()).toEqual({ DIMTAD: 0, DIMTVP: 0 });
  });

  it('Reset Text Position puts the text back where the style places it', async () => {
    const s = await withDimension();
    await s.hot(5, 6);
    await s.bus.submit('20,20');
    expect(s.dim()).toMatchObject({ textPosition: { x: 20, y: 20 }, textUserPositioned: true });
    await s.hot(20, 20, 'Reset Text Position');
    expect(s.dim()).toMatchObject({ textPosition: { x: 5, y: 6 }, textUserPositioned: false });
    expect(s.overrides()).toEqual({});
  });
});
