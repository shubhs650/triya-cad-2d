// M2-11: DIMLINEAR, DIMALIGNED, DIMRADIUS, DIMDIAMETER, DIMANGULAR, DIMCONTINUE and DIMBASELINE
// on the PromptBus with AutoCAD 2024's prompts, dimension grips (DIMASSOC 1: the definition
// points move and the dimension is regenerated) and TEXTEDIT on a dimension. The dimension
// engine sits above the engine (`@triya/dims`): these tests give the bus a stand-in that draws
// a dimension as its definition points and says what it measures; the real engine is checked
// over the corpus in packages/testkit/src/dims/dims-commands.corpus.test.ts.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  UNDO_COMMANDS,
  builtinCommands,
  doubleClickCommand,
  dragMotion,
  gripsOf,
  moveGrip,
  type BusEvent,
  type DimStyleRecord,
  type DimensionGeometry,
  type DimensionRegenerator,
  type Entity,
  type EntityGeometry,
  type StringPrompt,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { LAYER_WALLS, MODEL_SPACE, entityInit, sampleInit, snapshot } from '../model/fixtures';

const STYLE = '27';
const ARC = '25';

const standard = (vars: DimStyleRecord['vars'] = {}): DimStyleRecord => ({
  handle: STYLE,
  name: 'Standard',
  vars,
});

const deg = (r: number) => Math.round((r * 180) / Math.PI);

/** What the stand-in engine says a dimension measures, rounded to whole units or degrees. */
function measured(g: DimensionGeometry): string {
  switch (g.dimType) {
    case 'linear':
    case 'aligned': {
      const a =
        g.dimType === 'aligned'
          ? Math.atan2(g.second.y - g.first.y, g.second.x - g.first.x)
          : (g.rotation ?? 0);
      const d = (g.second.x - g.first.x) * Math.cos(a) + (g.second.y - g.first.y) * Math.sin(a);
      return String(Math.round(Math.abs(d) * 1000) / 1000);
    }
    case 'radius':
      return String(
        Math.hypot(g.chordPoint.x - g.definitionPoint.x, g.chordPoint.y - g.definitionPoint.y),
      );
    case 'diameter':
      return String(
        Math.hypot(g.chordPoint.x - g.definitionPoint.x, g.chordPoint.y - g.definitionPoint.y),
      );
    case 'angular3pt': {
      const a = Math.atan2(g.first.y - g.vertex.y, g.first.x - g.vertex.x);
      const b = Math.atan2(g.second.y - g.vertex.y, g.second.x - g.vertex.x);
      return `${Math.abs(deg(b - a))}°`;
    }
    case 'angular': {
      const a = Math.atan2(g.line1End.y - g.line1Start.y, g.line1End.x - g.line1Start.x);
      const b = Math.atan2(
        g.definitionPoint.y - g.line2Start.y,
        g.definitionPoint.x - g.line2Start.x,
      );
      return `${Math.abs(deg(b - a))}°`;
    }
    default:
      return '?';
  }
}

/** The stand-in dimension engine: the definition points, the text placed at DXF 11 + (0,1). */
const regenerate: DimensionRegenerator = (e, _model, measure) => {
  const g = e.geom as DimensionGeometry;
  if (!('dimType' in g)) return undefined;
  const width = measure({
    kind: 'MTEXT',
    contents: measured(g),
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
    : { x: g.definitionPoint.x, y: g.definitionPoint.y + 1 };
  return {
    parts: [{ geom: { kind: 'POINT', position: g.definitionPoint }, defpoint: true }],
    geom: { ...g, textPosition: at },
    measurement: measured(g),
  };
};

/** Distance from `p` to segment a–b. */
function toSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A test canvas: picks find model-space objects within 0.5; every character is 1 wide. */
function setup(o: { styles?: DimStyleRecord[]; dimensions?: boolean } = {}) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    header: new Map([...init.header!, ['$DIMSTYLE', 'Standard']]),
    tables: { ...init.tables, dimStyles: o.styles ?? [standard()] },
    entities: [
      ...(init.entities ?? []),
      entityInit(ARC, {
        kind: 'ARC',
        center: { x: 50, y: 0 },
        radius: 10,
        startAngle: 0,
        endAngle: Math.PI / 3,
      }),
      entityInit('26', { kind: 'LINE', start: { x: 0, y: 20 }, end: { x: 10, y: 20 } }),
    ],
  });
  const before = new Set([...model.entities()].map((e) => e.id));
  const added = (): Entity[] =>
    [...model.entities()].filter((e) => !before.has(e.id) && e.owner === MODEL_SPACE);
  const near = (g: EntityGeometry, p: { x: number; y: number }): boolean => {
    switch (g.kind) {
      case 'LINE':
        return toSegment(p, g.start, g.end) <= 0.5;
      case 'CIRCLE':
      case 'ARC':
        return Math.abs(Math.hypot(p.x - g.center.x, p.y - g.center.y) - g.radius) <= 0.5;
      case 'DIMENSION':
        return Object.values(g).some(
          (v) => v && typeof v === 'object' && 'x' in v && Math.hypot(v.x - p.x, v.y - p.y) <= 0.5,
        );
      default:
        return false;
    }
  };
  const editors: StringPrompt['editor'][] = [];
  const answer = (r: ViewRequest): ViewReply => {
    if (r.op === 'pick') {
      const ids = model
        .blockEntities(MODEL_SPACE)
        .filter((id) => near(model.entity(id)!.geom, r.point));
      return { ok: true, ids };
    }
    if (r.op === 'textWidths') return { ok: true, widths: r.texts.map((t) => t.contents.length) };
    return { ok: false, message: 'not drawn' };
  };
  const registry = builtinCommands();
  for (const def of UNDO_COMMANDS) registry.register(def);
  const bus = new PromptBus({
    model,
    registry,
    view: { request: (r) => Promise.resolve(answer(r)) },
    ...(o.dimensions !== false && { dimensions: regenerate }),
  });
  const prompts: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'prompt') {
      prompts.push(bus.promptText);
      const p = bus.prompt;
      if (p?.kind === 'string' && p.editor) editors.push(p.editor);
    }
  });
  const dims = () => added().filter((e) => e.geom.kind === 'DIMENSION');
  const dim = <T extends DimensionGeometry['dimType']>(i = -1) =>
    dims().at(i)!.geom as DimensionGeometry & { dimType: T };
  return { model, bus, added, dims, dim, prompts, editors };
}

const said = (bus: PromptBus) => bus.history.join('\n');

describe('DIMLINEAR', () => {
  it('asks AutoCAD 2024 prompts and makes a horizontal dimension above the origins', async () => {
    const s = setup();
    await s.bus.submit('DIMLINEAR');
    expect(s.bus.promptText).toBe('Specify first extension line origin or <select object>:');
    await s.bus.submit('0,0');
    expect(s.bus.promptText).toBe('Specify second extension line origin:');
    await s.bus.submit('10,5');
    expect(s.bus.promptText).toBe(
      'Specify dimension line location or [Mtext/Text/Angle/Horizontal/Vertical/Rotated]:',
    );
    await s.bus.submit('5,8');
    expect(s.bus.command).toBeUndefined();
    expect(s.dims()).toHaveLength(1);
    const e = s.dims()[0]!;
    // The current layer (WALLS) and dimension style; a `*D` block of its own, drawn.
    expect(e.layer).toBe(LAYER_WALLS);
    const g = s.dim<'linear'>();
    expect(g).toMatchObject({
      dimType: 'linear',
      style: STYLE,
      first: { x: 0, y: 0 },
      second: { x: 10, y: 5 },
      rotation: 0,
      definitionPoint: { x: 10, y: 8 },
      textPosition: { x: 10, y: 9 },
      text: '',
      textUserPositioned: false,
    });
    expect(s.model.blocks.get(g.block!)?.name).toMatch(/^\*D\d+$/);
    expect(s.model.blockEntities(g.block!)).toHaveLength(1);
    expect(s.bus.history).toContain('Dimension text = 10');
  });

  it('is vertical with the location beside the origins, and one undo step', async () => {
    const s = setup();
    const before = snapshot(s.model);
    await s.bus.script(['DIMLINEAR', '0,0', '10,5', '12,2']);
    expect(s.dim<'linear'>()).toMatchObject({
      rotation: Math.PI / 2,
      definitionPoint: { x: 12, y: 5 },
    });
    expect(s.bus.history).toContain('Dimension text = 5');
    await s.bus.script(['U']);
    expect(snapshot(s.model)).toEqual(before);
  });

  it('takes Horizontal, Vertical and Rotated', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,5', 'H', '12,2']);
    expect(s.dim<'linear'>().rotation).toBe(0);
    await s.bus.script(['DIMLINEAR', '0,0', '10,5', 'V', '5,8']);
    expect(s.dim<'linear'>().rotation).toBe(Math.PI / 2);
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', 'R']);
    expect(s.bus.promptText).toBe('Specify angle of dimension line <0>:');
    await s.bus.script(['30', '0,5']);
    expect(s.dim<'linear'>().rotation).toBeCloseTo(Math.PI / 6, 12);
  });

  it('dimensions a selected line, arc or polyline segment', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '']);
    expect(s.bus.promptText).toBe('Select object to dimension:');
    await s.bus.pick({ x: 5, y: 20 });
    expect(s.bus.promptText).toMatch(/^Specify dimension line location/);
    await s.bus.submit('5,25');
    expect(s.dim<'linear'>()).toMatchObject({ first: { x: 0, y: 20 }, second: { x: 10, y: 20 } });
    await s.bus.script(['DIMLINEAR', '']);
    await s.bus.pick({ x: 60, y: 0 });
    await s.bus.submit('55,-5');
    expect(s.dim<'linear'>().first).toEqual({ x: 60, y: 0 });
    expect(s.dim<'linear'>().second.x).toBeCloseTo(55, 12);
    // A circle is not taken by DIMLINEAR.
    await s.bus.script(['DIMLINEAR', '']);
    await s.bus.pick({ x: 7, y: 5 });
    expect(said(s.bus)).toMatch(/Object selected is not a line, arc or polyline segment\./);
  });

  it('refuses two origins at one point', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '1,1', '1,1']);
    expect(s.bus.history).toContain('Extension line origins must be different points.');
    expect(s.bus.promptText).toBe('Specify second extension line origin:');
  });

  it('Text: the override, with the measurement as the default', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', 'T']);
    expect(s.bus.promptText).toBe('Enter dimension text <10>:');
    await s.bus.script(['<> TYP', '5,3']);
    expect(s.dim<'linear'>().text).toBe('<> TYP');
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', 'T', '', '5,3']);
    expect(s.dim<'linear'>().text).toBe('');
  });

  it('Mtext opens the MTEXT editor on <>, the measurement', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', 'M']);
    expect(s.editors.at(-1)).toMatchObject({ kind: 'mtext', value: '<>', height: 0.18 });
    await s.bus.answer({ kind: 'string', value: '2X <>', editor: true });
    await s.bus.submit('5,3');
    expect(s.dim<'linear'>().text).toBe('2X <>');
  });

  it('Angle sets the text angle', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', 'A']);
    expect(s.bus.promptText).toBe('Specify angle of dimension text:');
    await s.bus.script(['45', '5,3']);
    expect(s.dim<'linear'>().textRotation).toBeCloseTo(Math.PI / 4, 12);
  });

  it('drags the dimension it will make', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,5']);
    const drag = s.bus.prompt!.drag!;
    expect(drag).toMatchObject({ kind: 'dimension', layer: LAYER_WALLS });
    const m = dragMotion(drag, { x: 12, y: 2 })!;
    expect(m.ids).toEqual([]);
    expect(m.adding?.geom).toMatchObject({ dimType: 'linear', rotation: Math.PI / 2 });
    await s.bus.submit('12,2');
    expect(s.dim<'linear'>().definitionPoint).toEqual(
      (m.adding!.geom as DimensionGeometry).definitionPoint,
    );
  });

  it('Esc at the location makes nothing', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0']);
    await s.bus.cancel();
    expect(s.dims()).toHaveLength(0);
  });

  it('says so in a drawing without a dimension style', async () => {
    const s = setup({ styles: [] });
    await s.bus.submit('DIMLINEAR');
    expect(s.bus.history).toContain('The drawing has no dimension style.');
    expect(s.bus.command).toBeUndefined();
  });

  it('is DLI, and DIMALIGNED DAL (acad.pgp)', async () => {
    const s = setup();
    await s.bus.script(['DLI', '0,0', '10,0', '5,5']);
    await s.bus.script(['DAL', '0,0', '10,10', '0,10']);
    expect(s.dims().map((e) => (e.geom as DimensionGeometry).dimType)).toEqual([
      'linear',
      'aligned',
    ]);
  });
});

describe('DIMALIGNED', () => {
  it('runs along the origins, its dimension line through the location', async () => {
    const s = setup();
    await s.bus.script(['DIMALIGNED', '0,0', '10,10']);
    expect(s.bus.promptText).toBe('Specify dimension line location or [Mtext/Text/Angle]:');
    await s.bus.submit('0,10');
    const g = s.dim<'aligned'>();
    expect(g.dimType).toBe('aligned');
    expect(g.definitionPoint.x).toBeCloseTo(5, 12);
    expect(g.definitionPoint.y).toBeCloseTo(15, 12);
    expect(g).not.toHaveProperty('rotation');
    expect(s.bus.history).toContain(
      `Dimension text = ${Math.round(Math.hypot(10, 10) * 1000) / 1000}`,
    );
  });
});

describe('DIMRADIUS and DIMDIAMETER', () => {
  it('DIMRADIUS: the chord point toward the location, the text at it', async () => {
    const s = setup();
    await s.bus.submit('DIMRADIUS');
    expect(s.bus.promptText).toBe('Select arc or circle:');
    await s.bus.pick({ x: 7, y: 5 });
    expect(s.bus.promptText).toBe('Specify dimension line location or [Mtext/Text/Angle]:');
    await s.bus.submit('10,5');
    expect(s.dim<'radius'>()).toMatchObject({
      dimType: 'radius',
      definitionPoint: { x: 5, y: 5 },
      chordPoint: { x: 7, y: 5 },
      textPosition: { x: 10, y: 5 },
      textUserPositioned: true,
      leaderLength: 3,
    });
    expect(s.bus.history).toContain('Dimension text = 2');
  });

  it('DIMDIAMETER: the far end of the diameter in DXF 10', async () => {
    const s = setup();
    await s.bus.script(['DIMDIAMETER']);
    await s.bus.pick({ x: 55, y: 5 * Math.sqrt(3) * 0 + 8.66 });
    await s.bus.submit('50,-20');
    const g = s.dim<'diameter'>();
    expect(g.chordPoint.x).toBeCloseTo(50, 12);
    expect(g.chordPoint.y).toBeCloseTo(-10, 12);
    expect(g.definitionPoint.y).toBeCloseTo(10, 12);
  });

  it('refuses a line', async () => {
    const s = setup();
    await s.bus.script(['DIMRADIUS']);
    await s.bus.pick({ x: 5, y: 0 });
    expect(s.bus.history).toContain('Object selected is not a circle or arc.');
    expect(s.bus.promptText).toBe('Select arc or circle:');
  });
});

describe('DIMANGULAR', () => {
  it('two lines: the angle the location is in', async () => {
    const s = setup();
    await s.bus.submit('DIMANGULAR');
    expect(s.bus.promptText).toBe('Select arc, circle, line, or <specify vertex>:');
    await s.bus.pick({ x: 5, y: 0 });
    expect(s.bus.promptText).toBe('Select second line:');
    await s.bus.pick({ x: 0, y: 5 });
    expect(s.bus.promptText).toBe('Specify dimension arc line location or [Mtext/Text/Angle]:');
    await s.bus.submit('3,3');
    expect(s.dim<'angular'>()).toMatchObject({
      dimType: 'angular',
      line1Start: { x: 0, y: 0 },
      line1End: { x: 10, y: 0 },
      line2Start: { x: 0, y: 0 },
      definitionPoint: { x: 0, y: 10 },
      arcPoint: { x: 3, y: 3 },
    });
    expect(s.bus.history).toContain('Dimension text = 90°');
  });

  it('says parallel lines are parallel', async () => {
    const s = setup();
    await s.bus.script(['DIMANGULAR']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 5, y: 20 });
    expect(s.bus.history).toContain('Lines are parallel.');
    expect(s.bus.promptText).toBe('Select second line:');
  });

  it('an arc: its centre the vertex, its ends the ends', async () => {
    const s = setup();
    await s.bus.script(['DIMANGULAR']);
    await s.bus.pick({ x: 60, y: 0 });
    await s.bus.submit('62,8');
    const g = s.dim<'angular3pt'>();
    expect(g.vertex).toEqual({ x: 50, y: 0 });
    expect(g.first).toEqual({ x: 60, y: 0 });
    expect(g.second.x).toBeCloseTo(55, 12);
    expect(g.definitionPoint).toEqual({ x: 62, y: 8 });
    expect(s.bus.history).toContain('Dimension text = 60°');
  });

  it('a circle: the pick and a second point', async () => {
    const s = setup();
    await s.bus.script(['DIMANGULAR']);
    await s.bus.pick({ x: 7, y: 5 });
    expect(s.bus.promptText).toBe('Specify second angle endpoint:');
    await s.bus.script(['5,9', '9,9']);
    expect(s.dim<'angular3pt'>()).toMatchObject({
      vertex: { x: 5, y: 5 },
      first: { x: 7, y: 5 },
      second: { x: 5, y: 9 },
    });
  });

  it('three points after Enter', async () => {
    const s = setup();
    await s.bus.script(['DIMANGULAR', '']);
    expect(s.bus.promptText).toBe('Specify angle vertex:');
    await s.bus.script(['0,0']);
    expect(s.bus.promptText).toBe('Specify first angle endpoint:');
    await s.bus.script(['10,0']);
    expect(s.bus.promptText).toBe('Specify second angle endpoint:');
    await s.bus.script(['0,10', '4,4']);
    expect(s.dim<'angular3pt'>()).toMatchObject({
      vertex: { x: 0, y: 0 },
      first: { x: 10, y: 0 },
      second: { x: 0, y: 10 },
      definitionPoint: { x: 4, y: 4 },
    });
  });
});

describe('DIMCONTINUE and DIMBASELINE', () => {
  it('DIMCONTINUE goes on from the last dimension along its dimension line', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']);
    await s.bus.submit('DIMCONTINUE');
    expect(s.bus.promptText).toBe(
      'Specify a second extension line origin or [Undo/Select] <Select>:',
    );
    await s.bus.script(['20,0', '35,0']);
    expect(s.dims()).toHaveLength(3);
    expect(s.dim<'linear'>(1)).toMatchObject({
      first: { x: 10, y: 0 },
      second: { x: 20, y: 0 },
      rotation: 0,
      definitionPoint: { x: 20, y: 5 },
    });
    expect(s.dim<'linear'>(2)).toMatchObject({
      first: { x: 20, y: 0 },
      second: { x: 35, y: 0 },
      definitionPoint: { x: 35, y: 5 },
    });
    expect(s.bus.history).toContain('Dimension text = 15');
    // Enter: Select; Enter again ends.
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Select continued dimension:');
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
  });

  it('DIMBASELINE: from the first origin, DIMDLI further out each time', async () => {
    const s = setup({ styles: [standard({ DIMDLI: 1, DIMSCALE: 2 })] });
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']);
    await s.bus.script(['DIMBASELINE', '20,0', '30,0', '', '']);
    expect(s.dim<'linear'>(1)).toMatchObject({
      first: { x: 0, y: 0 },
      second: { x: 20, y: 0 },
      definitionPoint: { x: 20, y: 7 },
    });
    expect(s.dim<'linear'>(2)).toMatchObject({
      first: { x: 0, y: 0 },
      second: { x: 30, y: 0 },
      definitionPoint: { x: 30, y: 9 },
    });
  });

  it('DIMBASELINE below the origins goes further down', async () => {
    const s = setup({ styles: [standard({ DIMDLI: 1 })] });
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,-5', 'DIMBASELINE', '20,0', '', '']);
    expect(s.dim<'linear'>().definitionPoint).toEqual({ x: 20, y: -6 });
  });

  it('Undo takes back the last one and goes on from before it', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5', 'DIMCONTINUE', '20,0', 'U']);
    expect(s.dims()).toHaveLength(1);
    await s.bus.script(['25,0', '', '']);
    expect(s.dim<'linear'>()).toMatchObject({ first: { x: 10, y: 0 }, second: { x: 25, y: 0 } });
    // No block is left behind by the one undone.
    const dBlocks = [...s.model.blocks.values()].filter((b) => b.name.startsWith('*D'));
    expect(dBlocks).toHaveLength(2);
  });

  it('Select takes another dimension, from the extension line nearest the pick', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5', 'DIMLINEAR', '0,20', '10,20', '5,25']);
    await s.bus.script(['DIMBASELINE', 'S']);
    expect(s.bus.promptText).toBe('Select base dimension:');
    // The first dimension (by its text), from its second extension line origin.
    await s.bus.pick({ x: 10, y: 6 });
    await s.bus.script(['25,0', '', '']);
    expect(s.dim<'linear'>()).toMatchObject({ first: { x: 10, y: 0 }, second: { x: 25, y: 0 } });
  });

  it('asks for the dimension in a drawing whose last one was erased', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5', 'ERASE', 'L', '', 'DIMCONTINUE']);
    expect(s.bus.promptText).toBe('Select continued dimension:');
    await s.bus.pick({ x: 5, y: 0 });
    expect(s.bus.history).toContain('Dimension must be linear or angular.');
  });

  it('an angular chain goes round the vertex', async () => {
    const s = setup({ styles: [standard({ DIMDLI: 1 })] });
    await s.bus.script(['DIMANGULAR', '', '0,0', '10,0', '10,10', '4,1']);
    await s.bus.script(['DIMCONTINUE', '0,10', '', '']);
    const c = s.dim<'angular3pt'>();
    expect(c).toMatchObject({
      vertex: { x: 0, y: 0 },
      first: { x: 10, y: 10 },
      second: { x: 0, y: 10 },
    });
    expect(Math.hypot(c.definitionPoint.x, c.definitionPoint.y)).toBeCloseTo(Math.hypot(4, 1), 12);
    // From the last one made, the continued dimension: its first origin, a DIMDLI further out.
    await s.bus.script(['DIMBASELINE', '-10,0', '', '']);
    const b = s.dim<'angular3pt'>();
    expect(b.first).toEqual({ x: 10, y: 10 });
    expect(Math.hypot(b.definitionPoint.x, b.definitionPoint.y)).toBeCloseTo(
      Math.hypot(4, 1) + 1,
      12,
    );
  });
});

describe('dimension grips (DIMASSOC 1)', () => {
  const linear = (): DimensionGeometry =>
    ({
      kind: 'DIMENSION',
      dimType: 'linear',
      style: STYLE,
      first: { x: 0, y: 0 },
      second: { x: 10, y: 0 },
      rotation: 0,
      definitionPoint: { x: 10, y: 5 },
      textPosition: { x: 5, y: 6 },
      textUserPositioned: false,
      text: '',
      textRotation: 0,
      horizontalDirection: 0,
      attachment: 5,
      lineSpacingStyle: 1,
      lineSpacing: 1,
    }) as DimensionGeometry;

  it('a linear dimension shows its origins, both dimension line ends and its text', () => {
    expect(gripsOf(linear())).toEqual([
      { point: { x: 0, y: 0 }, kind: 'stretch' },
      { point: { x: 10, y: 0 }, kind: 'stretch' },
      { point: { x: 0, y: 5 }, kind: 'dimline' },
      { point: { x: 10, y: 5 }, kind: 'dimline' },
      { point: { x: 5, y: 6 }, kind: 'stretch' },
    ]);
  });

  it('an origin stretches, a dimension line end moves the line, the text stays put', () => {
    const g = linear();
    const origin = moveGrip(g, { x: 10, y: 0 }, { x: 15, y: 0 });
    expect(origin).toMatchObject({ kind: 'shape', geom: { second: { x: 15, y: 0 } } });
    const line = moveGrip(g, { x: 0, y: 5 }, { x: 0, y: 8 });
    expect(line).toMatchObject({ kind: 'shape', geom: { definitionPoint: { x: 10, y: 8 } } });
    const text = moveGrip(g, { x: 5, y: 6 }, { x: 3, y: 9 });
    expect(text).toMatchObject({
      kind: 'shape',
      geom: { textPosition: { x: 3, y: 9 }, textUserPositioned: true },
    });
  });

  it('other kinds show each definition point once, the text last', () => {
    const {
      first: _f,
      second: _s,
      rotation: _r,
      ...fields
    } = linear() as DimensionGeometry & {
      dimType: 'linear';
    };
    const g = {
      ...fields,
      dimType: 'radius',
      definitionPoint: { x: 0, y: 0 },
      chordPoint: { x: 2, y: 0 },
      textPosition: { x: 4, y: 0 },
      leaderLength: 2,
    } as unknown as DimensionGeometry;
    expect(gripsOf(g).map((x) => x.point)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it('dragging a grip regenerates the dimension', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']);
    const block = s.dim<'linear'>().block!;
    const [inside] = s.model.blockEntities(block);
    // Selected by its text (the stand-in puts it a unit over DXF 10), then its second origin.
    await s.bus.pick({ x: 10, y: 6 });
    await s.bus.pick({ x: 10, y: 0 }, { grip: 0.1 });
    expect(s.bus.command).toBe('GRIP');
    await s.bus.submit('15,0');
    expect(s.dim<'linear'>().second).toEqual({ x: 15, y: 0 });
    expect(s.dim<'linear'>().block).toBe(block);
    // The block was drawn afresh: its contents are new.
    expect(s.model.blockEntities(block)).not.toContain(inside);
  });
});

describe('TEXTEDIT on a dimension', () => {
  it('edits its text override in the MTEXT editor and regenerates it', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']);
    const block = s.dim<'linear'>().block!;
    const [inside] = s.model.blockEntities(block);
    await s.bus.script(['TEXTEDIT']);
    await s.bus.pick({ x: 10, y: 6 });
    expect(s.editors.at(-1)).toMatchObject({ kind: 'mtext', value: '<>' });
    await s.bus.answer({ kind: 'string', value: '<> TYP', editor: true });
    expect(s.dim<'linear'>().text).toBe('<> TYP');
    expect(s.model.blockEntities(block)).not.toContain(inside);
    // Back to the measurement alone.
    await s.bus.pick({ x: 10, y: 6 });
    expect(s.editors.at(-1)).toMatchObject({ value: '<> TYP' });
    await s.bus.answer({ kind: 'string', value: '<>', editor: true });
    expect(s.dim<'linear'>().text).toBe('');
  });

  it('is what a double click on a dimension runs', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']);
    expect(doubleClickCommand(s.dims()[0]!)).toBe('TEXTEDIT');
  });
});
