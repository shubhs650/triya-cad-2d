// M3-01 part 6: AutoCAD 2024's "(hold Ctrl to switch direction)" for ARC and PLINE's arcs (AutoCAD
// 2024 Help, "ARC (Command)": "Arcs are drawn in a counterclockwise direction by default. Hold down
// the Ctrl key as you drag to draw in a clockwise direction"; "PLINE (Command)", Direction: "Press
// Ctrl to draw in a clockwise direction"). A pick made with Ctrl held, at a prompt that says so,
// draws the arc the other way round; the dragged arc follows Ctrl as it is held. Typed values are
// as before (a negative angle, chord or radius still turns the arc).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  dragMotion,
  type Entity,
  type LwPolylineGeometry,
  type Prompt,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const deg = (rad: number) => r6(((((rad * 180) / Math.PI) % 360) + 360) % 360) % 360;
const CTRL = ' (hold Ctrl to switch direction)';

function setup() {
  const model = DocumentModel.create(sampleInit());
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  /** The last new arc as [cx, cy, r, start°, end°] (the DXF arc, counter-clockwise). */
  const arc = () => {
    const g = added().at(-1)!.geom;
    if (g.kind !== 'ARC') return [g.kind];
    return [r6(g.center.x), r6(g.center.y), r6(g.radius), deg(g.startAngle), deg(g.endAngle)];
  };
  /** The last new polyline's vertices as [x, y, bulge]. */
  const vertices = () =>
    (added().at(-1)!.geom as LwPolylineGeometry).vertices.map((v) => [
      r6(v.x),
      r6(v.y),
      r6(v.bulge),
    ]);
  const ctrlPick = (x: number, y: number) => bus.pick({ x, y }, { ctrl: true });
  return { model, bus, added, arc, vertices, ctrlPick };
}

/** The drag's geometry at a cursor position, Ctrl held or not. */
const dragged = (p: Prompt | undefined, x: number, y: number, ctrl = false) =>
  p?.drag && dragMotion(p.drag, { x, y }, { ctrl })?.adding?.geom;

const arcOf = (g: ReturnType<typeof dragged>) =>
  g?.kind === 'ARC' ? [r6(g.radius), deg(g.startAngle), deg(g.endAngle)] : g?.kind;

describe('ARC with Ctrl held', () => {
  it('SCE: clockwise from the start to the end direction; dragged so with Ctrl', async () => {
    const { bus, arc, ctrlPick } = setup();
    await bus.script(['ARC', '10,0', 'C', '0,0']);
    expect(bus.promptText).toBe(`Specify end point of arc${CTRL} or [Angle/chord Length]:`);
    expect(arcOf(dragged(bus.prompt, 0, 5))).toEqual([10, 0, 90]);
    expect(arcOf(dragged(bus.prompt, 0, 5, true))).toEqual([10, 90, 0]);
    await ctrlPick(0, 5);
    expect(arc()).toEqual([0, 0, 10, 90, 0]);
    expect(bus.history.at(-1)).toBe(
      `Specify end point of arc${CTRL} or [Angle/chord Length]: 0.0000,5.0000`,
    );
    // Without Ctrl, counter-clockwise as before.
    await bus.script(['ARC', '10,0', 'C', '0,0']);
    await bus.pick({ x: 0, y: 5 });
    expect(arc()).toEqual([0, 0, 10, 0, 90]);
  });

  it('SCA and SCL: the angle or chord turned clockwise', async () => {
    const { bus, arc, ctrlPick } = setup();
    await bus.script(['ARC', '10,0', 'C', '0,0', 'A']);
    expect(bus.promptText).toBe(`Specify included angle${CTRL}:`);
    expect(arcOf(dragged(bus.prompt, 0, 5, true))).toEqual([10, 270, 0]);
    await ctrlPick(0, 5);
    expect(arc()).toEqual([0, 0, 10, 270, 0]);
    await bus.script(['ARC', '10,0', 'C', '0,0', 'L']);
    expect(bus.promptText).toBe(`Specify length of chord${CTRL}:`);
    // A chord of 10 on a radius of 10 is 60°.
    expect(arcOf(dragged(bus.prompt, 10, 10, true))).toEqual([10, 300, 0]);
    await ctrlPick(10, 10);
    expect(arc()).toEqual([0, 0, 10, 300, 0]);
    // Typed, the value is as given: Ctrl is the mouse's.
    await bus.script(['ARC', '10,0', 'C', '0,0', 'A', '90']);
    expect(arc()).toEqual([0, 0, 10, 0, 90]);
  });

  it('CSE: centre first, then the start, then the end clockwise', async () => {
    const { bus, arc, ctrlPick } = setup();
    await bus.script(['ARC', 'C', '0,0', '10,0']);
    await ctrlPick(-5, 0);
    expect(arc()).toEqual([0, 0, 10, 180, 0]);
  });

  it('SEC, SEA, SER and SED: the other way between the same ends', async () => {
    const { bus, arc, ctrlPick } = setup();
    await bus.script(['ARC', '10,0', 'E', '-10,0']);
    expect(bus.promptText).toBe(`Specify center point of arc${CTRL} or [Angle/Direction/Radius]:`);
    expect(arcOf(dragged(bus.prompt, 0, 0, true))).toEqual([10, 180, 0]);
    await ctrlPick(0, 0);
    expect(arc()).toEqual([0, 0, 10, 180, 0]);

    await bus.script(['ARC', '10,0', 'E', '-10,0', 'A']);
    expect(bus.promptText).toBe(`Specify included angle${CTRL}:`);
    await bus.pick({ x: 10, y: 10 });
    expect(arc()).toEqual([0, -10, 14.142136, 45, 135]);
    await bus.script(['ARC', '10,0', 'E', '-10,0', 'A']);
    expect(arcOf(dragged(bus.prompt, 10, 10, true))).toEqual([14.142136, 225, 315]);
    await ctrlPick(10, 10);
    expect(arc()).toEqual([0, 10, 14.142136, 225, 315]);

    await bus.script(['ARC', '10,0', 'E', '-10,0', 'R']);
    expect(bus.promptText).toBe(`Specify radius of arc${CTRL}:`);
    // A radius of 10.5 from the end: the minor arc, below the chord when clockwise.
    await bus.pick({ x: -10, y: 10.5 });
    const ccw = arc();
    await bus.script(['ARC', '10,0', 'E', '-10,0', 'R']);
    await ctrlPick(-10, 10.5);
    const cw = arc();
    expect(ccw[1]).toBeLessThan(0);
    expect(cw[1]).toBeCloseTo(-(ccw[1] as number), 6);
    expect(cw[2]).toBeCloseTo(ccw[2] as number, 6);

    await bus.script(['ARC', '10,0', 'E', '-10,0', 'D']);
    expect(bus.promptText).toBe(`Specify tangent direction for the start point of arc${CTRL}:`);
    await bus.pick({ x: 10, y: 10 });
    expect(arc()).toEqual([0, 0, 10, 0, 180]);
    await bus.script(['ARC', '10,0', 'E', '-10,0', 'D']);
    expect(arcOf(dragged(bus.prompt, 10, 10, true))).toEqual([10, 180, 0]);
    await ctrlPick(10, 10);
    expect(arc()).toEqual([0, 0, 10, 180, 0]);
  });

  it('Continue: leaves the last line backwards, on the same circle', async () => {
    const { bus, arc, ctrlPick } = setup();
    await bus.script(['L', '0,0', '10,0', '', 'ARC', '']);
    expect(bus.promptText).toBe(`Specify end point of arc${CTRL}:`);
    expect(arcOf(dragged(bus.prompt, 10, 10))).toEqual([5, 270, 90]);
    expect(arcOf(dragged(bus.prompt, 10, 10, true))).toEqual([5, 90, 270]);
    await ctrlPick(10, 10);
    expect(arc()).toEqual([10, 5, 5, 90, 270]);
  });

  it('3P has no direction to switch: Ctrl changes nothing', async () => {
    const { bus, arc, ctrlPick } = setup();
    await bus.script(['ARC', '10,0', '0,10']);
    expect(bus.promptText).toBe('Specify end point of arc:');
    expect(arcOf(dragged(bus.prompt, -10, 0, true))).toEqual([10, 0, 180]);
    await ctrlPick(-10, 0);
    expect(arc()).toEqual([0, 0, 10, 0, 180]);
  });

  it('a Ctrl pick at a prompt without the switch is a plain point', async () => {
    const { bus, added, ctrlPick } = setup();
    await bus.script(['L']);
    await ctrlPick(1, 2);
    await ctrlPick(3, 4);
    await bus.submit('');
    expect(added().at(-1)!.geom).toMatchObject({
      kind: 'LINE',
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 },
    });
    // A distance or angle picked from a base without the switch: as without Ctrl.
    await bus.script(['CIRCLE', '0,0']);
    await ctrlPick(3, 4);
    expect(added().at(-1)!.geom).toMatchObject({ kind: 'CIRCLE', radius: 5 });
  });
});

describe('PLINE arcs with Ctrl held', () => {
  const ENDPOINT = `Specify endpoint of arc${CTRL} or`;

  it('an endpoint alone: the arc leaves backwards, the other way round the same circle', async () => {
    const { bus, vertices, ctrlPick } = setup();
    await bus.script(['PL', '0,0', '10,0', 'A']);
    expect(bus.promptText).toBe(
      `${ENDPOINT} [Angle/CEnter/CLose/Direction/Halfwidth/Line/Radius/Second pt/Undo/Width]:`,
    );
    const drag = dragged(bus.prompt, 10, 10, true);
    expect(drag).toMatchObject({ kind: 'LWPOLYLINE' });
    expect((drag as LwPolylineGeometry).vertices[0]!.bulge).toBeCloseTo(-1, 9);
    await ctrlPick(10, 10);
    await bus.submit('');
    expect(vertices()).toEqual([
      [0, 0, 0],
      [10, 0, -1],
      [10, 10, 0],
    ]);
  });

  it('CEnter and Angle turn clockwise with Ctrl', async () => {
    const { bus, vertices, ctrlPick } = setup();
    // CEnter 0,10 from 0,0: the end 10,10 counter-clockwise is a quarter, clockwise three.
    await bus.script(['PL', '0,0', 'A', 'CE', '0,10']);
    expect(bus.promptText).toBe(`${ENDPOINT} [Angle/Length]:`);
    await ctrlPick(10, 10);
    // Angle 90, then an end clockwise.
    await bus.script(['A', '90']);
    expect(bus.promptText).toBe(`${ENDPOINT} [CEnter/Radius]:`);
    await ctrlPick(20, 10);
    // CEnter then Angle, picked at 45° from the centre.
    await bus.script(['CE', '20,0', 'A']);
    expect(bus.promptText).toBe(`Specify included angle${CTRL}:`);
    await ctrlPick(30, 10);
    await bus.submit('');
    const v = vertices();
    // From 0,0 about 0,10 clockwise round to 10,10: three quarters (bulge −tan(67.5°)).
    expect(v[0]).toEqual([0, 0, r6(-Math.tan((3 * Math.PI) / 8))]);
    expect(v[1]).toEqual([10, 10, r6(-Math.tan(Math.PI / 8))]);
    expect(v[2]![2]).toBeCloseTo(-Math.tan(Math.PI / 16), 6);
  });

  it('says so at each prompt that switches, not at Second pt', async () => {
    const { bus } = setup();
    const after = async (script: string[], text: string | RegExp) => {
      await bus.script(['PL', '0,0', 'A', ...script]);
      if (typeof text === 'string') expect(bus.promptText).toBe(text);
      else expect(bus.promptText).toMatch(text);
      await bus.cancel();
    };
    await after(['CE', '20,0', 'L'], `Specify length of chord${CTRL}:`);
    await after(['R', '5'], `${ENDPOINT} [Angle]:`);
    await after(
      ['R', '5', 'A', '90'],
      /^Specify direction of chord for arc \(hold Ctrl to switch direction\) <[\d.]+>:$/,
    );
    await after(['D', '90'], `Specify endpoint of the arc${CTRL}:`);
    await after(['S', '25,15'], 'Specify end point of arc:');
    // The included angle asked first (Angle, Radius Angle) is not the last value: no switch.
    await after(['A'], 'Specify included angle:');
  });

  it('Radius then a picked end: the minor arc clockwise; Direction then the end', async () => {
    const { bus, vertices, ctrlPick } = setup();
    await bus.script(['PL', '0,0', 'A', 'R', '5']);
    await ctrlPick(10, 0);
    await bus.script(['D', '90']);
    await ctrlPick(20, 0);
    await bus.script(['R', '5', 'A', '90']);
    // The chord's direction picked with Ctrl: the included angle the other way.
    await ctrlPick(30, 0);
    await bus.submit('');
    const v = vertices();
    expect(v[0]).toEqual([0, 0, -1]);
    // Leaving 10,0 heading north (90°) to 20,0 is a clockwise half; Ctrl: the other half.
    expect(v[1]).toEqual([10, 0, 1]);
    expect(v[2]![2]).toBeCloseTo(-Math.tan(Math.PI / 8), 6);
  });
});

describe('DIST Arc with Ctrl held', () => {
  it('measures the arc drawn the other way', async () => {
    const { bus, ctrlPick } = setup();
    await bus.script(['DIST', '0,0', 'M', '10,0', 'A']);
    expect(bus.promptText).toMatch(/^Specify endpoint of arc \(hold Ctrl to switch direction\) or/);
    // On east from 10,0 to 15,5: a quarter of radius 5; with Ctrl the other three quarters.
    await ctrlPick(15, 5);
    expect(bus.history.at(-1)).toBe(`Distance = ${(10 + 7.5 * Math.PI).toFixed(4)}`);
  });
});
