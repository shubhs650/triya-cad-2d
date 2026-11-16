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
  ChangeSetBuilder,
  DocumentModel,
  GRIP_CYCLE,
  PromptBus,
  builtinCommands,
  dstyleOverrides,
  gripFunctionsOf,
  gripsOf,
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
    [...model.entities()].filter(
      (e) =>
        e.owner === MODEL_SPACE &&
        (e.geom.kind === 'DIMENSION' ||
          e.geom.kind === 'ARC_DIMENSION' ||
          e.geom.kind === 'LARGE_RADIAL_DIMENSION'),
    );
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

  it("an extension line origin, and a radius dimension's centre, keep Stretch alone", async () => {
    const s = await withDimension();
    expect(gripFunctionsOf(s.dim(), { x: 0, y: 0 })).toEqual([]);
    const radius: DimensionGeometry = {
      ...s.dim(),
      dimType: 'radius',
      chordPoint: { x: 3, y: 4 },
      leaderLength: 0,
      definitionPoint: { x: 0, y: 0 },
    } as DimensionGeometry;
    expect(gripFunctionsOf(radius, radius.definitionPoint)).toEqual([]);
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

// M3-05 part 7: the other dimensions' grip menus. AutoCAD's help names the functions without
// saying which dimensions have which; the drafter's expectation is encoded here (see
// edit/grip-functions.ts): angular arc ends as a linear dimension line's ends, an arc length
// dimension's and a radial one's arrowheads Stretch and Flip Arrow, an ordinate leader end
// Stretch, Continue and Baseline Dimension, and every text grip the text functions.
describe('grip menus of radial, angular, ordinate and arc length dimensions', () => {
  const TEXT = [
    'Stretch',
    'Move with Dim Line',
    'Move Text Only',
    'Move with Leader',
    'Above Dim Line',
    'Center Vertically',
    'Reset Text Position',
  ];
  const LINE = ['Stretch', 'Continue Dimension', 'Baseline Dimension', 'Flip Arrow'];
  const ARROW = ['Stretch', 'Flip Arrow'];
  const r = Math.SQRT1_2 * 10;

  /** A drawing holding the dimension `geom`, in the linear one's style, and nothing else. */
  async function withDim(geom: object) {
    const s = await withDimension();
    const { first: _f, second: _s, rotation: _r, ...fields } = s.dim();
    const e = s.dims().at(0)!;
    const b = new ChangeSetBuilder(s.model);
    b.removeEntity(e.id);
    b.addEntity({
      owner: MODEL_SPACE,
      layer: e.layer,
      ...(e.xdata && { xdata: e.xdata }),
      geom: { ...fields, textUserPositioned: true, ...geom } as DimensionGeometry,
    });
    s.model.apply(b.build());
    const g = () => s.dims().at(0)!.geom as DimensionGeometry;
    return { ...s, g };
  }

  const radius = {
    kind: 'DIMENSION',
    dimType: 'radius',
    definitionPoint: { x: 0, y: 0 },
    chordPoint: { x: 10, y: 0 },
    leaderLength: 0,
    textPosition: { x: 15, y: 0 },
  };
  const angle3 = {
    kind: 'DIMENSION',
    dimType: 'angular3pt',
    vertex: { x: 0, y: 0 },
    first: { x: 20, y: 0 },
    second: { x: 0, y: 20 },
    // The arc at radius 10, its ends at (10, 0) and (0, 10).
    definitionPoint: { x: r, y: r },
    textPosition: { x: 9, y: 9 },
  };
  const ordinate = {
    kind: 'DIMENSION',
    dimType: 'ordinate',
    axis: 'x',
    definitionPoint: { x: 0, y: 0 },
    feature: { x: 5, y: 3 },
    leaderEnd: { x: 5, y: 10 },
    textPosition: { x: 5, y: 12 },
  };

  it('a radius dimension: the arrowhead Stretch and Flip Arrow, the centre none, the text its seven', async () => {
    const s = await withDim(radius);
    expect(gripFunctionsOf(s.g(), { x: 10, y: 0 })).toEqual(ARROW);
    expect(gripFunctionsOf(s.g(), { x: 0, y: 0 })).toEqual([]);
    expect(gripFunctionsOf(s.g(), { x: 15, y: 0 })).toEqual(TEXT);
    await s.bus.selectAll();
    expect(s.bus.gripMenu({ x: 10.05, y: 0 }, 0.1)?.items).toEqual(ARROW);
  });

  it("a diameter's two ends, a jogged radius's arrowhead", async () => {
    const d = await withDim({ ...radius, dimType: 'diameter', definitionPoint: { x: -10, y: 0 } });
    expect(gripFunctionsOf(d.g(), { x: 10, y: 0 })).toEqual(ARROW);
    expect(gripFunctionsOf(d.g(), { x: -10, y: 0 })).toEqual(ARROW);
    const jogged = {
      ...radius,
      kind: 'LARGE_RADIAL_DIMENSION',
      dimType: 'jogged',
      overrideCenter: { x: 0, y: 4 },
      jogPoint: { x: 5, y: 2 },
    };
    const j = await withDim(jogged);
    expect(gripFunctionsOf(j.g(), { x: 10, y: 0 })).toEqual(ARROW);
    expect(gripFunctionsOf(j.g(), { x: 5, y: 2 })).toEqual([]);
  });

  it("an angle's arc ends are dimension line grips with the linear dimension's four", async () => {
    const s = await withDim(angle3);
    expect(gripsOf(s.g()).filter((x) => x.kind === 'dimline')).toHaveLength(2);
    expect(gripFunctionsOf(s.g(), { x: 10, y: 0 })).toEqual(LINE);
    expect(gripFunctionsOf(s.g(), { x: 0, y: 10 })).toEqual(LINE);
    expect(gripFunctionsOf(s.g(), { x: 20, y: 0 })).toEqual([]);
    expect(gripFunctionsOf(s.g(), { x: 9, y: 9 })).toEqual(TEXT);
    // A two-line angle: lines (2,0)–(20,0) and (0,2)–(0,20), meeting at the origin.
    const two = await withDim({
      kind: 'DIMENSION',
      dimType: 'angular',
      line1Start: { x: 2, y: 0 },
      line1End: { x: 20, y: 0 },
      line2Start: { x: 0, y: 2 },
      definitionPoint: { x: 0, y: 20 },
      arcPoint: { x: 3, y: 4 },
      textPosition: { x: 4, y: 4 },
    });
    expect(gripFunctionsOf(two.g(), { x: 5, y: 0 })).toEqual(LINE);
    expect(gripFunctionsOf(two.g(), { x: 0, y: 5 })).toEqual(LINE);
  });

  it("an arc length dimension's arc ends: Stretch and Flip Arrow", async () => {
    const s = await withDim({
      kind: 'ARC_DIMENSION',
      dimType: 'arc',
      center: { x: 0, y: 0 },
      first: { x: 10, y: 0 },
      second: { x: 0, y: 10 },
      startAngle: 0,
      endAngle: Math.PI / 2,
      partial: false,
      definitionPoint: { x: 15 * Math.SQRT1_2, y: 15 * Math.SQRT1_2 },
      textPosition: { x: 12, y: 12 },
    });
    expect(gripFunctionsOf(s.g(), { x: 15, y: 0 })).toEqual(ARROW);
    expect(gripFunctionsOf(s.g(), { x: 0, y: 15 })).toEqual(ARROW);
    await s.hot(0, 15, 'Flip Arrow');
    expect(s.g().flipArrows).toEqual([false, true]);
  });

  it("an ordinate dimension's leader end: Stretch, Continue Dimension, Baseline Dimension", async () => {
    const s = await withDim(ordinate);
    expect(gripFunctionsOf(s.g(), { x: 5, y: 10 })).toEqual([
      'Stretch',
      'Continue Dimension',
      'Baseline Dimension',
    ]);
    expect(gripFunctionsOf(s.g(), { x: 5, y: 3 })).toEqual([]);
    await s.hot(5, 10, 'Continue Dimension');
    expect(s.bus.promptText).toBe('Specify feature location or [Undo/Select] <Select>:');
    await s.bus.submit('12,4');
    expect(s.dims().at(1)!.geom).toMatchObject({
      dimType: 'ordinate',
      feature: { x: 12, y: 4 },
      leaderEnd: { x: 12, y: 10 },
    });
  });

  it('Flip Arrow flips a radius arrowhead, an angle end and a diameter’s far end', async () => {
    const s = await withDim(radius);
    await s.hot(10, 0, 'Flip Arrow');
    expect(s.bus.command).toBeUndefined();
    expect(s.g().flipArrows).toEqual([true, false]);
    const a = await withDim(angle3);
    await a.hot(0, 10);
    await a.bus.submit('FL');
    expect(a.g().flipArrows).toEqual([false, true]);
    const d = await withDim({ ...radius, dimType: 'diameter', definitionPoint: { x: -10, y: 0 } });
    await d.hot(-10, 0, 'Flip Arrow');
    expect(d.g().flipArrows).toEqual([false, true]);
  });

  it("an angle's arc end grip moves the arc in or out about the vertex", async () => {
    const s = await withDim(angle3);
    await s.hot(0, 10);
    await s.bus.submit('3,15');
    const g = s.g() as Extract<DimensionGeometry, { dimType: 'angular3pt' }>;
    const k = Math.hypot(3, 15) / 10;
    expect(g.definitionPoint.x).toBeCloseTo(r * k, 9);
    expect(g.definitionPoint.y).toBeCloseTo(r * k, 9);
    expect(g.first).toEqual({ x: 20, y: 0 });
  });

  it('Continue and Baseline Dimension go on from the angle’s extension line at that end', async () => {
    const s = await withDim(angle3);
    await s.hot(0, 10, 'Continue Dimension');
    expect(s.bus.promptText).toBe(
      'Specify a second extension line origin or [Undo/Select] <Select>:',
    );
    await s.bus.submit('-20,0');
    expect(s.dims().at(1)!.geom).toMatchObject({
      dimType: 'angular3pt',
      vertex: { x: 0, y: 0 },
      first: { x: 0, y: 20 },
      second: { x: -20, y: 0 },
    });
  });

  it('Move with Dim Line turns a radius about its centre to point at the text', async () => {
    const s = await withDim(radius);
    await s.hot(15, 0, 'Move with Dim Line');
    await s.bus.submit('0,15');
    const g = s.g() as Extract<DimensionGeometry, { dimType: 'radius' | 'diameter' }>;
    expect(g.chordPoint.x).toBeCloseTo(0, 9);
    expect(g.chordPoint.y).toBeCloseTo(10, 9);
    expect(g).toMatchObject({ textPosition: { x: 0, y: 15 }, textUserPositioned: true });
    expect(s.overrides()).toEqual({ DIMTMOVE: 0 });
    // A diameter turns both ends.
    const d = await withDim({ ...radius, dimType: 'diameter', definitionPoint: { x: -10, y: 0 } });
    await d.hot(15, 0, 'Move with Dim Line');
    await d.bus.submit('0,-15');
    const dg = d.g() as Extract<DimensionGeometry, { dimType: 'radius' | 'diameter' }>;
    expect(dg.chordPoint.y).toBeCloseTo(-10, 9);
    expect(dg.definitionPoint.y).toBeCloseTo(10, 9);
  });

  it("Move with Dim Line takes an angle's arc through the text, an ordinate's leader end with it", async () => {
    const s = await withDim(angle3);
    await s.hot(9, 9, 'Move with Dim Line');
    await s.bus.submit('12,16');
    const g = s.g() as Extract<DimensionGeometry, { dimType: 'angular3pt' }>;
    expect(Math.hypot(g.definitionPoint.x, g.definitionPoint.y)).toBeCloseTo(20, 9);
    expect(g.textPosition).toEqual({ x: 12, y: 16 });
    const o = await withDim(ordinate);
    await o.hot(5, 12, 'Move with Dim Line');
    await o.bus.submit('8,14');
    expect(o.g()).toMatchObject({ leaderEnd: { x: 8, y: 12 }, textPosition: { x: 8, y: 14 } });
  });

  it('Move Text Only and Reset Text Position on a radius', async () => {
    const s = await withDim(radius);
    await s.hot(15, 0, 'Move Text Only');
    await s.bus.submit('20,5');
    expect(s.g()).toMatchObject({
      textPosition: { x: 20, y: 5 },
      chordPoint: { x: 10, y: 0 },
      textUserPositioned: true,
    });
    expect(s.overrides()).toEqual({ DIMTMOVE: 2 });
    await s.hot(20, 5, 'Reset Text Position');
    expect(s.g()).toMatchObject({ textUserPositioned: false });
  });
});
