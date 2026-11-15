// M3-01 part 3: PLINE scripted on the PromptBus as the command line drives it (AutoCAD 2024
// Help, "PLINE (Command)"): line and arc segments in one LWPOLYLINE, every arc option (Angle,
// CEnter, CLose, Direction, Radius, Second pt), Width and Halfwidth with PLINEWID, Length, Undo
// and Close, the segment dragged while its point is asked, and Esc keeping what is drawn.
import { describe, expect, it } from 'vitest';
import {
  CommandRegistry,
  DocumentModel,
  PromptBus,
  arcSegment,
  builtinCommands,
  dragMotion,
  type ArcStep,
  type BusEvent,
  type Entity,
  type HeaderValue,
  type LwPolylineGeometry,
  type Prompt,
} from '../../src/index';
import { LAYER_WALLS, MODEL_SPACE, sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const T8 = r6(Math.tan(Math.PI / 8));

function setup(header: [string, HeaderValue][] = []) {
  const init = sampleInit();
  for (const [k, v] of header) (init.header as Map<string, HeaderValue>).set(k, v);
  const model = DocumentModel.create(init);
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const events: BusEvent[] = [];
  bus.on((e) => events.push(e));
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  const pline = (i = 0): LwPolylineGeometry => {
    const e = added()[i];
    expect(e?.type).toBe('LWPOLYLINE');
    return e!.geom as LwPolylineGeometry;
  };
  /** The polyline's vertices as [x, y, bulge]. */
  const vertices = (i = 0) => pline(i).vertices.map((v) => [r6(v.x), r6(v.y), r6(v.bulge)]);
  /** Each vertex's [start width, end width]. */
  const widths = (i = 0) =>
    pline(i).vertices.map((v) => [r6(v.startWidth ?? 0), r6(v.endWidth ?? 0)]);
  return { model, bus, events, added, pline, vertices, widths };
}

/** The drag's geometry at a cursor position. */
const dragged = (p: Prompt | undefined, x: number, y: number) =>
  p?.drag && dragMotion(p.drag, { x, y })?.adding?.geom;

describe('PLINE', () => {
  it('draws line segments as one LWPOLYLINE with AutoCAD 2024 prompts', async () => {
    const { bus, added, vertices, pline, events } = setup();
    await bus.script(['PL', '0,0']);
    expect(bus.history.at(-1)).toBe('Current line-width is 0.0000');
    expect(bus.promptText).toBe('Specify next point or [Arc/Halfwidth/Length/Undo/Width]:');
    await bus.submit('10,0');
    expect(bus.promptText).toBe('Specify next point or [Arc/Close/Halfwidth/Length/Undo/Width]:');
    await bus.script(['10,10', '']);
    expect(bus.promptText).toBe('Command:');
    expect(added()).toHaveLength(1);
    expect(added()[0]).toMatchObject({ owner: MODEL_SPACE, layer: LAYER_WALLS });
    expect(vertices()).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ]);
    expect(pline().closed).toBe(false);
    expect(pline().constantWidth).toBeUndefined();
    // One command, one undo step, however many segments.
    expect(events.filter((e) => e.type === 'commit')).toHaveLength(1);
  });

  it('closes with Close, and Esc keeps the segments drawn', async () => {
    const { bus, added, vertices, pline } = setup();
    await bus.script(['PLINE', '0,0', '10,0', '10,10', 'C']);
    expect(bus.promptText).toBe('Command:');
    expect(vertices()).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ]);
    expect(pline().closed).toBe(true);
    await bus.script(['PLINE', '0,0', '5,0', '5,5']);
    await bus.cancel();
    expect(added()).toHaveLength(2);
    expect(vertices(1)).toEqual([
      [0, 0, 0],
      [5, 0, 0],
      [5, 5, 0],
    ]);
    // A start point alone draws nothing.
    await bus.script(['PLINE', '3,3', '']);
    expect(added()).toHaveLength(2);
  });

  it('draws arcs tangent to the last segment, back to lines with Line', async () => {
    const { bus, vertices } = setup();
    await bus.script(['PL', '0,0', '10,0', 'A']);
    expect(bus.promptText).toBe(
      'Specify endpoint of arc (hold Ctrl to switch direction) or [Angle/CEnter/CLose/Direction/Halfwidth/Line/Radius/Second pt/Undo/Width]:',
    );
    // Tangent to +X at 10,0 to 10,10: a half circle counter-clockwise (bulge 1).
    await bus.submit('10,10');
    expect(bus.promptText).toBe(
      'Specify endpoint of arc (hold Ctrl to switch direction) or [Angle/CEnter/CLose/Direction/Halfwidth/Line/Radius/Second pt/Undo/Width]:',
    );
    // The next arc goes on tangent: heading -X at 10,10, to 0,10 is straight on: no arc.
    await bus.submit('0,10');
    expect(bus.history.at(-1)).toBe('*Invalid*');
    await bus.script(['L', '0,10', '']);
    expect(vertices()).toEqual([
      [0, 0, 0],
      [10, 0, 1],
      [10, 10, 0],
      [0, 10, 0],
    ]);
  });

  it('starts an arc in the last line or arc drawn direction, else east', async () => {
    const { bus, vertices } = setup();
    await bus.script(['PL', '0,0', 'A']);
    expect(bus.promptText).toBe(
      'Specify endpoint of arc (hold Ctrl to switch direction) or [Angle/CEnter/Direction/Halfwidth/Line/Radius/Second pt/Undo/Width]:',
    );
    await bus.script(['0,10', '']);
    expect(vertices()).toEqual([
      [0, 0, 1],
      [0, 10, 0],
    ]);
  });

  it('takes every arc option: Angle, CEnter, Direction, Radius, Second pt', async () => {
    const { bus, vertices } = setup();
    // Angle then the end: 90° counter-clockwise from 0,0 to 10,0.
    await bus.script(['PL', '0,0', 'A', 'A', '90']);
    expect(bus.promptText).toBe(
      'Specify endpoint of arc (hold Ctrl to switch direction) or [CEnter/Radius]:',
    );
    await bus.submit('10,0');
    // CEnter then the end: about 15,0 from 10,0 to 20,0, counter-clockwise (half a turn).
    await bus.script(['CE', '15,0']);
    expect(bus.promptText).toBe(
      'Specify endpoint of arc (hold Ctrl to switch direction) or [Angle/Length]:',
    );
    await bus.submit('20,0');
    // Direction then the end: leaving 20,0 north, to 30,0 (clockwise half a turn).
    await bus.submit('D');
    expect(bus.promptText).toBe('Specify the tangent direction for the start point of arc:');
    await bus.submit('90');
    expect(bus.promptText).toBe('Specify endpoint of the arc (hold Ctrl to switch direction):');
    await bus.submit('30,0');
    // Radius then the end: radius 5 from 30,0 to 40,0 (the minor arc, counter-clockwise).
    await bus.script(['R', '5']);
    expect(bus.promptText).toBe(
      'Specify endpoint of arc (hold Ctrl to switch direction) or [Angle]:',
    );
    await bus.submit('40,0');
    // Second pt: through 45,5 to 50,0 (clockwise).
    await bus.submit('S');
    expect(bus.promptText).toBe('Specify second point on arc:');
    await bus.submit('45,5');
    expect(bus.promptText).toBe('Specify end point of arc:');
    await bus.script(['50,0', '']);
    expect(vertices()).toEqual([
      [0, 0, T8],
      [10, 0, 1],
      [20, 0, -1],
      [30, 0, 1],
      [40, 0, -1],
      [50, 0, 0],
    ]);
  });

  it('takes CEnter with Angle or chord Length, and Angle with CEnter or Radius', async () => {
    const { bus, vertices } = setup();
    // CEnter 5,0 and 90°: from 0,0 a quarter turn counter-clockwise ends at 5,-5.
    await bus.script(['PL', '0,0', 'A', 'CE', '5,0', 'A']);
    expect(bus.promptText).toBe('Specify included angle (hold Ctrl to switch direction):');
    await bus.submit('90');
    // CEnter 10,-5 with a chord of 5·√2: a quarter turn to 10,-10.
    await bus.script(['CE', '10,-5', 'L']);
    expect(bus.promptText).toBe('Specify length of chord (hold Ctrl to switch direction):');
    await bus.submit(String(5 * Math.SQRT2));
    // Angle 180 about the centre 15,-10: to 20,-10.
    await bus.script(['A', '180', 'CE', '15,-10']);
    // Angle 90 with radius 5, the chord's direction defaulting to the tangent's turned by 45°.
    await bus.script(['A', '90', 'R']);
    expect(bus.promptText).toBe('Specify radius of arc:');
    await bus.submit('5');
    expect(bus.promptText).toBe(
      'Specify direction of chord for arc (hold Ctrl to switch direction) <135>:',
    );
    await bus.script(['', '']);
    expect(vertices()).toEqual([
      [0, 0, T8],
      [5, -5, T8],
      [10, -10, 1],
      [20, -10, T8],
      [15, -5, 0],
    ]);
  });

  it('takes Radius with an included angle and the chord direction', async () => {
    const { bus, vertices } = setup();
    await bus.script(['PL', '0,0', 'A', 'R', '5', 'A']);
    expect(bus.promptText).toBe('Specify included angle:');
    await bus.submit('90');
    expect(bus.promptText).toBe(
      'Specify direction of chord for arc (hold Ctrl to switch direction) <45>:',
    );
    await bus.script(['0', '']);
    expect(vertices()).toEqual([
      [0, 0, T8],
      [r6(5 * Math.SQRT2), 0, 0],
    ]);
  });

  it('closes with an arc tangent to the last segment (CLose)', async () => {
    const { bus, vertices, pline } = setup();
    await bus.script(['PL', '0,0', '10,0', '10,10', 'A', 'CL']);
    expect(bus.promptText).toBe('Command:');
    expect(pline().closed).toBe(true);
    // From 10,10 heading north back to 0,0: the arc turns left (counter-clockwise).
    const v = vertices();
    expect(v.slice(0, 2)).toEqual([
      [0, 0, 0],
      [10, 0, 0],
    ]);
    expect(v[2]!.slice(0, 2)).toEqual([10, 10]);
    expect(v[2]![2]).toBeGreaterThan(0);
  });

  it('draws widths: Width and Halfwidth taper a segment, the end width goes on (PLINEWID)', async () => {
    const { bus, model, widths, pline } = setup();
    await bus.script(['PL', '0,0', 'W']);
    expect(bus.promptText).toBe('Specify starting width <0.0000>:');
    await bus.submit('2');
    expect(bus.promptText).toBe('Specify ending width <2.0000>:');
    await bus.script(['0', '10,0']);
    // The ending width is the width from here on.
    await bus.script(['20,0', 'H']);
    expect(bus.promptText).toBe('Specify starting half-width <0.0000>:');
    await bus.submit('1');
    expect(bus.promptText).toBe('Specify ending half-width <1.0000>:');
    await bus.script(['', '30,0', '']);
    expect(widths()).toEqual([
      [2, 0],
      [0, 0],
      [2, 2],
      [2, 2],
    ]);
    expect(pline().constantWidth).toBeUndefined();
    expect(model.header.get('$PLINEWID')).toBe(2);
    // The next polyline starts at the last width, all one width: a constant width.
    await bus.script(['PL', '0,5']);
    expect(bus.history.at(-1)).toBe('Current line-width is 2.0000');
    await bus.script(['10,5', '']);
    expect(pline(1).constantWidth).toBe(2);
    expect(widths(1)).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it('refuses a negative width', async () => {
    const { bus } = setup();
    await bus.script(['PL', '0,0', 'W', '-1']);
    expect(bus.history.at(-1)).toBe('Value must be positive or zero.');
    expect(bus.promptText).toBe('Specify starting width <0.0000>:');
  });

  it('sets widths in arc mode too, and stays in arc mode', async () => {
    const { bus, widths } = setup([['$PLINEWID', 1]]);
    await bus.script(['PL', '0,0', 'A', 'W', '', '3']);
    expect(bus.promptText).toMatch(
      /^Specify endpoint of arc \(hold Ctrl to switch direction\) or \[/,
    );
    await bus.script(['0,10', '']);
    expect(widths()).toEqual([
      [1, 3],
      [3, 3],
    ]);
  });

  it('goes on in the last direction with Length, tangent after an arc', async () => {
    const { bus, vertices } = setup();
    await bus.script(['PL', '0,0', '10,0', 'L']);
    expect(bus.promptText).toBe('Specify length of line:');
    await bus.script(['5', 'A', '15,10', 'L', 'L', '5', '']);
    // After the arc ending at 15,10 heading west, Length goes on west.
    expect(vertices()).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [15, 0, 1],
      [15, 10, 0],
      [10, 10, 0],
    ]);
  });

  it('undoes segments one at a time, back to the start point', async () => {
    const { bus, added, vertices } = setup();
    await bus.script(['PL', '0,0', '10,0', 'A', '10,10', 'U']);
    // Undo keeps arc mode, from 10,0 again.
    expect(bus.promptText).toMatch(
      /^Specify endpoint of arc \(hold Ctrl to switch direction\) or \[Angle\/CEnter\/CLose/,
    );
    await bus.script(['L', 'U']);
    expect(added()).toHaveLength(0);
    expect(bus.promptText).toBe('Specify next point or [Arc/Halfwidth/Length/Undo/Width]:');
    await bus.submit('U');
    expect(bus.history.at(-1)).toBe('All segments already undone.');
    await bus.script(['5,5', '']);
    expect(vertices()).toEqual([
      [0, 0, 0],
      [5, 5, 0],
    ]);
  });

  it('drags the next segment with its widths, and the arc in arc mode', async () => {
    const { bus } = setup();
    await bus.script(['PL', '0,0', 'W', '1', '3']);
    const line = dragged(bus.prompt, 10, 0) as LwPolylineGeometry;
    expect(line).toMatchObject({ kind: 'LWPOLYLINE', closed: false });
    expect(line.vertices.map((v) => [v.x, v.y, v.bulge, v.startWidth, v.endWidth])).toEqual([
      [0, 0, 0, 1, 3],
      [10, 0, 0, 1, 3],
    ]);
    expect(bus.prompt).toMatchObject({ rubberBand: { from: { x: 0, y: 0 } } });
    await bus.submit('A');
    const arc = dragged(bus.prompt, 0, 10) as LwPolylineGeometry;
    expect(arc.vertices.map((v) => [r6(v.x), r6(v.y), r6(v.bulge)])).toEqual([
      [0, 0, 1],
      [0, 10, 0],
    ]);
    // Second pt's end is dragged through the second point.
    await bus.script(['S', '5,5']);
    const through = dragged(bus.prompt, 10, 0) as LwPolylineGeometry;
    expect(r6(through.vertices[0]!.bulge)).toBe(-1);
    // Radius's end, CEnter's end, Angle's end and centre, Angle and Radius's chord direction.
    await bus.script(['10,0', 'R', '5']);
    expect(r6((dragged(bus.prompt, 20, 0) as LwPolylineGeometry).vertices[0]!.bulge)).toBe(1);
    await bus.script(['20,0', 'CE', '25,0']);
    expect(r6((dragged(bus.prompt, 30, 0) as LwPolylineGeometry).vertices[0]!.bulge)).toBe(1);
    await bus.script(['30,0', 'A', '90']);
    expect(r6((dragged(bus.prompt, 40, 0) as LwPolylineGeometry).vertices[0]!.bulge)).toBe(T8);
    await bus.submit('CE');
    expect(r6((dragged(bus.prompt, 35, 0) as LwPolylineGeometry).vertices[0]!.bulge)).toBe(T8);
    // About 35,0 a quarter turn ends at 35,-5; then the chord follows the cursor's direction.
    await bus.script(['35,0', 'A', '90', 'R', '5']);
    const chord = dragged(bus.prompt, 45, -5) as LwPolylineGeometry;
    expect(chord.vertices.map((v) => [r6(v.x), r6(v.y)])).toEqual([
      [35, -5],
      [r6(35 + 5 * Math.SQRT2), -5],
    ]);
    // The cursor on the start makes no segment.
    await bus.cancel();
    await bus.script(['PL', '0,0']);
    expect(dragged(bus.prompt, 0, 0)).toBeUndefined();
  });

  it('draws with PLINEGEN as the linetype generation', async () => {
    const { bus, pline } = setup([['$PLINEGEN', 1]]);
    await bus.script(['PL', '0,0', '10,0', '']);
    expect(pline().plinegen).toBe(true);
  });

  it('ends at Enter wherever a value is asked, and refuses what makes no arc', async () => {
    const { bus, added, vertices } = setup();
    await bus.script(['PL', '']);
    expect(bus.promptText).toBe('Command:');
    const ends = [
      ['D', ''],
      ['S', ''],
      ['S', '5,5', ''],
      ['A', ''],
      ['A', '90', ''],
      ['A', '90', 'R', ''],
      ['A', '90', 'R', '5', 'A'],
      ['A', '90', 'CE', ''],
      ['CE', ''],
      ['CE', '5,0', ''],
      ['CE', '5,0', 'A', ''],
      ['CE', '5,0', 'L', ''],
      ['R', ''],
      ['R', '5', ''],
      ['R', '5', 'A', ''],
    ];
    for (const keys of ends) {
      await bus.script(['PL', '0,0', 'A', ...keys]);
      expect(bus.promptText, keys.join(' ')).toMatch(/^Command:$|^Specify direction of chord/);
      await bus.cancel();
    }
    expect(added()).toHaveLength(0);
    const refused = [
      ['A', '90', '0,0'],
      ['CE', '5,0', '5,0'],
      ['R', '1', '10,0'],
      ['S', '5,5', '5,5'],
    ];
    for (const keys of refused) {
      await bus.script(['PL', '0,0', 'A', ...keys]);
      expect(bus.history.at(-1), keys.join(' ')).toBe('*Invalid*');
      await bus.cancel();
    }
    await bus.script(['PL', '0,0', 'A', 'R', '0']);
    expect(bus.history.at(-1)).toBe('Value must be positive and nonzero.');
    await bus.cancel();
    // Arc CLose straight back along the tangent makes no arc; Length's Enter asks again; a
    // negative length goes back.
    await bus.script(['PL', '0,0', '10,0', 'A', 'CL']);
    expect(bus.history.at(-1)).toBe('*Invalid*');
    await bus.script(['L', 'L', '']);
    expect(bus.promptText).toBe('Specify next point or [Arc/Close/Halfwidth/Length/Undo/Width]:');
    await bus.script(['L', '-4', '']);
    expect(vertices()).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [6, 0, 0],
    ]);
  });

  it("offers its arc segments to other commands' next-point prompts (arcSegment)", async () => {
    const model = DocumentModel.create(sampleInit());
    const steps: (ArcStep | undefined)[] = [];
    const registry = new CommandRegistry([
      {
        name: 'MEASURE',
        async *run(ctx) {
          for (;;) {
            const step = yield* arcSegment(ctx, {
              start: { x: 0, y: 0 },
              direction: { x: 1, y: 0 },
              options: ['Line', 'Undo'],
              layer: LAYER_WALLS,
              prefix: '<Add mode> ',
            });
            steps.push(step);
            if (!step || step.kind === 'enter') return;
          }
        },
      },
    ]);
    const bus = new PromptBus({ model, registry });
    await bus.submit('MEASURE');
    expect(bus.promptText).toBe(
      '<Add mode> Specify endpoint of arc (hold Ctrl to switch direction) or [Angle/CEnter/Direction/Line/Radius/Second pt/Undo]:',
    );
    expect(r6((dragged(bus.prompt, 0, 10) as LwPolylineGeometry).vertices[0]!.bulge)).toBe(1);
    await bus.script(['0,10', 'U', '']);
    expect(steps.map((s) => s?.kind)).toEqual(['arc', 'keyword', 'enter']);
    expect(steps[1]).toEqual({ kind: 'keyword', keyword: 'Undo' });
  });
});
