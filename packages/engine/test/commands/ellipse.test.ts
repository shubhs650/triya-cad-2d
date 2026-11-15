// M3-01 part 4: ELLIPSE scripted on the PromptBus as the command line drives it: Axis, End;
// Center; Rotation; and elliptical arcs by angle, parameter and included angle, with AutoCAD
// 2024's prompts and the ellipse dragged with the cursor.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  dragMotion,
  pointAt,
  type Ellipse,
  type Entity,
} from '../../src/index';
import { LAYER_WALLS, MODEL_SPACE, sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const DEG = Math.PI / 180;

function setup() {
  const model = DocumentModel.create(sampleInit());
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  const ellipses = () =>
    added().map((e) => {
      const g = e.geom as Ellipse;
      return [
        r6(g.center.x),
        r6(g.center.y),
        r6(g.majorAxis.x),
        r6(g.majorAxis.y),
        r6(g.ratio),
        r6(g.startParam),
        r6(g.endParam),
      ];
    });
  return { model, bus, added, ellipses };
}

/** A point of an ellipse at DXF parameter t. */
function at(e: Ellipse, t: number) {
  const p = pointAt(e, t);
  return { x: r6(p.x), y: r6(p.y) };
}

describe('ELLIPSE', () => {
  it('Axis, End: two axis endpoints and the distance to the other axis', async () => {
    const { bus, added, ellipses } = setup();
    await bus.submit('EL');
    expect(bus.promptText).toBe('Specify axis endpoint of ellipse or [Arc/Center]:');
    await bus.submit('0,0');
    expect(bus.promptText).toBe('Specify other endpoint of axis:');
    await bus.submit('10,0');
    expect(bus.promptText).toBe('Specify distance to other axis or [Rotation]:');
    // Dragged: the cursor's distance from the centre is half the other axis.
    const drag = bus.prompt!.drag!;
    expect(drag).toMatchObject({ kind: 'sketch', layer: LAYER_WALLS });
    expect(dragMotion(drag, { x: 5, y: 2 })?.adding?.geom).toMatchObject({
      kind: 'ELLIPSE',
      center: { x: 5, y: 0 },
      ratio: 0.4,
    });
    await bus.submit('3');
    expect(ellipses()).toEqual([[5, 0, -5, 0, 0.6, 0, r6(2 * Math.PI)]]);
    expect(added()[0]).toMatchObject({ type: 'ELLIPSE', owner: MODEL_SPACE, layer: LAYER_WALLS });
  });

  it('turns the major axis when the second axis is the longer', async () => {
    const { bus, ellipses } = setup();
    await bus.script(['ELLIPSE', '0,0', '4,0', '5']);
    // The first axis (half 2, from the centre towards (0,0)) is the minor one: the major axis,
    // 5 long, is a quarter turn CCW from it.
    expect(ellipses()).toEqual([[2, 0, 0, -5, 0.4, 0, r6(2 * Math.PI)]]);
  });

  it('Center: the centre, an axis endpoint, then the other axis', async () => {
    const { bus, ellipses } = setup();
    await bus.script(['ELLIPSE', 'C']);
    expect(bus.promptText).toBe('Specify center of ellipse:');
    await bus.submit('10,10');
    expect(bus.promptText).toBe('Specify endpoint of axis:');
    await bus.submit('@0,8');
    await bus.submit('2');
    expect(ellipses()).toEqual([[10, 10, 0, 8, 0.25, 0, r6(2 * Math.PI)]]);
  });

  it('Rotation: a circle on the first axis turned about it, refusing past 89.4°', async () => {
    const { bus, ellipses } = setup();
    await bus.script(['ELLIPSE', '0,0', '10,0', 'R']);
    expect(bus.promptText).toBe('Specify rotation around major axis:');
    const drag = bus.prompt!.drag!;
    // The cursor at 60° from the centre: ratio cos 60°.
    const g = dragMotion(drag, { x: 5 + Math.cos(60 * DEG), y: Math.sin(60 * DEG) })?.adding
      ?.geom as Ellipse;
    expect(r6(g.ratio)).toBe(0.5);
    await bus.submit('89.5');
    expect(bus.history.at(-1)).toBe('*Invalid*');
    expect(bus.command).toBe('ELLIPSE');
    await bus.submit('60');
    expect(ellipses()).toEqual([[5, 0, -5, 0, 0.5, 0, r6(2 * Math.PI)]]);
  });

  it('refuses a zero axis and a zero other axis', async () => {
    const { bus, ellipses } = setup();
    await bus.script(['ELLIPSE', '1,1', '1,1']);
    expect(bus.history.at(-1)).toBe('*Invalid*');
    expect(bus.promptText).toBe('Specify other endpoint of axis:');
    await bus.script(['5,1', '0']);
    expect(bus.history.at(-1)).toBe('*Invalid*');
    await bus.submit('1');
    expect(ellipses()).toHaveLength(1);
  });

  it('Arc: start and end angles counted from the first axis', async () => {
    const { bus, added } = setup();
    await bus.script(['ELLIPSE', 'A']);
    expect(bus.promptText).toBe('Specify axis endpoint of elliptical arc or [Center]:');
    // First axis from (10,0) to (-10,0): angles count from (10,0), the first endpoint.
    await bus.script(['10,0', '-10,0', '5']);
    expect(bus.promptText).toBe('Specify start angle or [Parameter]:');
    // While the start is asked, the whole ellipse is dragged.
    expect(dragMotion(bus.prompt!.drag!, { x: 3, y: 3 })?.adding?.geom).toMatchObject({
      kind: 'ELLIPSE',
      startParam: 0,
    });
    await bus.submit('0');
    expect(bus.promptText).toBe('Specify end angle or [Parameter/Included angle]:');
    // Dragged from the start to the cursor's angle: a quarter, at the cursor straight up.
    const drag = dragMotion(bus.prompt!.drag!, { x: 0, y: 7 })?.adding?.geom as Ellipse;
    expect(at(drag, drag.endParam)).toEqual({ x: 0, y: 5 });
    await bus.submit('90');
    const e = added()[0]!.geom as Ellipse;
    expect(at(e, e.startParam)).toEqual({ x: 10, y: 0 });
    expect(at(e, e.endParam)).toEqual({ x: 0, y: 5 });
  });

  it('Arc: angles follow the first axis even when it is the minor one, and picks agree', async () => {
    const { bus, added } = setup();
    // First axis vertical from the centre (0,0) up to (0,2); the other axis is 6 long each way.
    await bus.script(['ELLIPSE', 'A', 'C', '0,0', '0,2', '6']);
    // Start at 90° from the first axis (pointing up): that is (-6, 0).
    await bus.submit('90');
    // End picked straight down from the centre: 180° from the first axis.
    await bus.answer({ kind: 'point', point: { x: 0, y: -4 } });
    const e = added()[0]!.geom as Ellipse;
    expect(r6(e.ratio)).toBe(r6(2 / 6));
    expect(at(e, e.startParam)).toEqual({ x: -6, y: 0 });
    expect(at(e, e.endParam)).toEqual({ x: 0, y: -2 });
  });

  it('Arc: an angle meets the ellipse along the ray, a parameter is p(u) = c + a cos u + b sin u', async () => {
    const { bus, added } = setup();
    await bus.script(['ELLIPSE', 'A', '-4,0', '4,0', '2']);
    // Angles count from the first endpoint, (−4, 0): 0 there.
    await bus.script(['P']);
    expect(bus.promptText).toBe('Specify start parameter or [Angle]:');
    await bus.submit('0');
    expect(bus.promptText).toBe('Specify end parameter or [Angle/Included angle]:');
    await bus.submit('A');
    expect(bus.promptText).toBe('Specify end angle or [Parameter/Included angle]:');
    await bus.submit('45');
    const e = added()[0]!.geom as Ellipse;
    expect(at(e, e.startParam)).toEqual({ x: -4, y: 0 });
    // The ray at 45° from (−1, 0), CCW: direction (−1, −1)/√2, which meets x²/16 + y²/4 = 1
    // at x = y = −4/√5.
    const k = r6(-4 / Math.sqrt(5));
    expect(at(e, e.endParam)).toEqual({ x: k, y: k });

    await bus.script(['ELLIPSE', 'A', '-4,0', '4,0', '2', 'P', '0', '45']);
    const p = added()[1]!.geom as Ellipse;
    // Parameter 45°: c + a cos 45° + b sin 45° with a = (−4, 0), b = (0, −2).
    const h = Math.SQRT1_2;
    expect(at(p, p.endParam)).toEqual({ x: r6(-4 * h), y: r6(-2 * h) });
  });

  it('Arc: Included angle from the start angle, 180 by default', async () => {
    const { bus, added } = setup();
    await bus.script(['ELLIPSE', 'A', '0,0', '10,0', '2', '90', 'I']);
    expect(bus.promptText).toBe('Specify included angle for arc <180>:');
    await bus.submit('');
    const e = added()[0]!.geom as Ellipse;
    // From the top of the ellipse (90° from the first endpoint (0,0), i.e. from −X: down)…
    expect(at(e, e.startParam)).toEqual({ x: 5, y: -2 });
    expect(at(e, e.endParam)).toEqual({ x: 5, y: 2 });
  });
});
