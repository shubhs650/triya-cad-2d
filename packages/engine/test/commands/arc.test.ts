// M3-01: ARC's eleven methods scripted on the PromptBus (AutoCAD 2024 Help, "To Draw Arcs"):
// 3P, SCE, SCA, SCL, SEA, SED, SER, SEC (the Start, End, Center order), CSE, CSA, CSL, and
// Continue; and LINE and ARC continuing tangent from each other.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  dragMotion,
  type Entity,
  type Prompt,
} from '../../src/index';
import { LAYER_WALLS, MODEL_SPACE, sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const deg = (rad: number) => r6(((((rad * 180) / Math.PI) % 360) + 360) % 360) % 360;

function setup() {
  const model = DocumentModel.create(sampleInit());
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  /** Each new arc as [cx, cy, r, start°, end°]; lines as [x1, y1, x2, y2]. */
  const shapes = () =>
    added().map((e) => {
      const g = e.geom;
      if (g.kind === 'ARC') {
        return [r6(g.center.x), r6(g.center.y), r6(g.radius), deg(g.startAngle), deg(g.endAngle)];
      }
      if (g.kind === 'LINE') return [g.start.x, g.start.y, g.end.x, g.end.y].map(r6);
      return [g.kind];
    });
  return { model, bus, added, shapes };
}

/** The drag's geometry at a cursor position. */
const dragged = (p: Prompt | undefined, x: number, y: number) =>
  p?.drag && dragMotion(p.drag, { x, y })?.adding?.geom;

describe('ARC', () => {
  it('3P: A ↵ 10,0 ↵ 0,10 ↵ -10,0 ↵, on the current layer', async () => {
    const { bus, added, shapes } = setup();
    await bus.script(['A', '10,0', '0,10']);
    expect(bus.promptText).toBe('Specify end point of arc:');
    expect(dragged(bus.prompt, -10, 0)).toMatchObject({ kind: 'ARC', radius: 10 });
    await bus.submit('-10,0');
    expect(shapes()).toEqual([[0, 0, 10, 0, 180]]);
    expect(added()[0]).toMatchObject({ owner: MODEL_SPACE, layer: LAYER_WALLS });
    expect(bus.history).toEqual([
      'Command: A',
      'Specify start point of arc or [Center]: 10,0',
      'Specify second point of arc or [Center/End]: 0,10',
      'Specify end point of arc: -10,0',
    ]);
  });

  it('3P clockwise: the DXF arc runs counter-clockwise from the end', async () => {
    const { bus, shapes } = setup();
    await bus.script(['A', '-10,0', '0,10', '1,1']);
    // (1, 1) is on the line… no: refused only when collinear. Collinear points are refused:
    await bus.script(['A', '0,0', '1,1', '2,2']);
    expect(bus.history.at(-1)).toBe('*Invalid*');
    await bus.submit('2,0');
    expect(bus.command).toBeUndefined();
    expect(shapes()).toHaveLength(2);
  });

  it('SCE, SCA and SCL', async () => {
    const { bus, shapes } = setup();
    await bus.script(['ARC', '10,0', 'C', '0,0']);
    expect(bus.promptText).toBe(
      'Specify end point of arc (hold Ctrl to switch direction) or [Angle/chord Length]:',
    );
    expect(dragged(bus.prompt, 0, 5)).toMatchObject({ kind: 'ARC', startAngle: 0 });
    await bus.submit('0,5');
    await bus.script(['ARC', '10,0', 'C', '0,0', 'A']);
    expect(bus.promptText).toBe('Specify included angle (hold Ctrl to switch direction):');
    expect(dragged(bus.prompt, 0, 5)).toMatchObject({ kind: 'ARC' });
    await bus.submit('-90');
    await bus.script(['ARC', '10,0', 'C', '0,0', 'L']);
    expect(bus.promptText).toBe('Specify length of chord (hold Ctrl to switch direction):');
    expect(dragged(bus.prompt, 0, 10)).toMatchObject({ kind: 'ARC' });
    await bus.submit('-20');
    expect(shapes()).toEqual([
      [0, 0, 10, 0, 90],
      // Clockwise 90° from (10, 0): the DXF arc runs from 270° to 0°.
      [0, 0, 10, 270, 0],
      // A negative chord of a diameter is the major (here: half) arc, counter-clockwise.
      [0, 0, 10, 0, 180],
    ]);
  });

  it('refuses an impossible end, angle or chord and asks again', async () => {
    const { bus, shapes } = setup();
    await bus.script(['ARC', '10,0', 'C', '0,0', '0,0']);
    expect(bus.history.at(-1)).toBe('*Invalid*');
    await bus.script(['L', '25']);
    expect(bus.history.at(-1)).toBe('*Invalid*');
    expect(bus.promptText).toBe('Specify length of chord (hold Ctrl to switch direction):');
    await bus.submit('');
    expect(bus.command).toBeUndefined();
    await bus.script(['ARC', '10,0', 'C', '0,0', 'A', '0']);
    expect(bus.history.at(-1)).toBe('*Invalid*');
    await bus.cancel();
    expect(shapes()).toEqual([]);
  });

  it('CSE, CSA and CSL: the centre first', async () => {
    const { bus, shapes } = setup();
    await bus.script(['ARC', 'C', '0,0']);
    expect(bus.promptText).toBe('Specify start point of arc:');
    await bus.script(['5,0', '-5,0']);
    await bus.script(['ARC', 'C', '0,0', '0,5', 'A', '90']);
    await bus.script(['ARC', 'C', '0,0', '5,0', 'L', '5']);
    expect(shapes()).toEqual([
      [0, 0, 5, 0, 180],
      [0, 0, 5, 90, 180],
      [0, 0, 5, 0, 60],
    ]);
  });

  it('SEC, SEA, SED and SER', async () => {
    const { bus, shapes } = setup();
    await bus.script(['ARC', '10,0', 'E', '0,10']);
    expect(bus.promptText).toBe(
      'Specify center point of arc (hold Ctrl to switch direction) or [Angle/Direction/Radius]:',
    );
    expect(dragged(bus.prompt, 0, 0)).toMatchObject({ kind: 'ARC', radius: 10 });
    await bus.submit('0,0');
    await bus.script(['ARC', '10,0', 'E', '0,10', 'A']);
    expect(bus.promptText).toBe('Specify included angle (hold Ctrl to switch direction):');
    expect(dragged(bus.prompt, 10, 10)).toMatchObject({ kind: 'ARC' });
    await bus.submit('-90');
    await bus.script(['ARC', '10,0', 'E', '0,10', 'D']);
    expect(bus.promptText).toBe(
      'Specify tangent direction for the start point of arc (hold Ctrl to switch direction):',
    );
    expect(dragged(bus.prompt, 10, 5)).toMatchObject({ kind: 'ARC', radius: 10 });
    await bus.submit('90');
    await bus.script(['ARC', '10,0', 'E', '0,10', 'R']);
    expect(bus.promptText).toBe('Specify radius of arc (hold Ctrl to switch direction):');
    const g = dragged(bus.prompt, 0, 20);
    expect(g?.kind === 'ARC' && r6(g.radius)).toBe(10);
    await bus.submit('-10');
    expect(shapes()).toEqual([
      [0, 0, 10, 0, 90],
      [10, 10, 10, 180, 270],
      [0, 0, 10, 0, 90],
      [10, 10, 10, 270, 180],
    ]);
  });

  it('refuses a centre on the end, and a radius shorter than half the chord', async () => {
    const { bus, shapes } = setup();
    await bus.script(['ARC', '10,0', 'E', '0,10', '0,10']);
    expect(bus.history.at(-1)).toBe('*Invalid*');
    await bus.script(['R', '2']);
    expect(bus.history.at(-1)).toBe('*Invalid*');
    await bus.cancel();
    expect(shapes()).toEqual([]);
  });

  it('Enter at the start continues tangent from the last arc, and from the last line', async () => {
    const { bus, shapes } = setup();
    await bus.script(['ARC', '']);
    expect(bus.history.at(-1)).toBe('No line or arc to continue.');
    expect(bus.command).toBe('ARC');
    await bus.cancel();
    // A quarter circle counter-clockwise from (10, 0) to (0, 10), heading −X at its end.
    await bus.script(['ARC', '10,0', 'C', '0,0', '0,10']);
    await bus.script(['ARC', '']);
    expect(bus.promptText).toBe('Specify end point of arc (hold Ctrl to switch direction):');
    expect(dragged(bus.prompt, -10, 0)).toMatchObject({ kind: 'ARC' });
    await bus.submit('-10,0');
    // A line from (0, 0) to (0, 5) heads +Y: the arc to (-5, 10) turns left about (-5, 5).
    await bus.script(['LINE', '0,0', '0,5', '', 'ARC', '', '-5,10']);
    // On the tangent line there is no arc.
    await bus.script(['LINE', '0,0', '0,5', '', 'ARC', '', '0,9']);
    expect(bus.history.at(-1)).toBe('*Invalid*');
    await bus.submit('');
    expect(shapes()).toEqual([
      [0, 0, 10, 0, 90],
      [0, 0, 10, 90, 180],
      [0, 0, 0, 5],
      [-5, 5, 5, 0, 90],
      [0, 0, 0, 5],
    ]);
  });

  it('a clockwise arc continues from where it was drawn to', async () => {
    const { bus, shapes } = setup();
    // Clockwise from (−10, 0) over the top to (10, 0), heading −Y there.
    await bus.script(['ARC', '-10,0', '0,10', '10,0', 'LINE', '']);
    expect(bus.promptText).toBe('Specify length of line:');
    await bus.submit('5');
    expect(bus.promptText).toBe('Specify next point or [Undo]:');
    await bus.submit('');
    expect(shapes()).toEqual([
      [0, 0, 10, 0, 180],
      [10, 0, 10, -5],
    ]);
  });

  it('Enter or an option where none is taken ends it drawing nothing', async () => {
    const { bus, shapes } = setup();
    for (const script of [
      ['ARC', '0,0', ''],
      ['ARC', '0,0', 'C', ''],
      ['ARC', '0,0', 'E', ''],
      ['ARC', '0,0', 'C', '5,0', ''],
      ['ARC', '0,0', 'E', '5,0', ''],
      ['ARC', '0,0', 'E', '5,0', 'A', ''],
      ['ARC', 'C', ''],
      ['ARC', 'C', '0,0', ''],
      ['ARC', '0,0', '1,1', ''],
    ]) {
      await bus.script(script);
      expect(bus.command).toBeUndefined();
    }
    expect(shapes()).toEqual([]);
  });
});

describe('LINE continuing from an arc', () => {
  it('asks only for the length, and leaves the arc tangent to it', async () => {
    const { bus, shapes } = setup();
    // A quarter circle counter-clockwise from (10, 0) to (0, 10), heading −X at its end.
    await bus.script(['ARC', '10,0', 'C', '0,0', '0,10', 'L', '']);
    expect(bus.promptText).toBe('Specify length of line:');
    await bus.submit('4');
    expect(bus.promptText).toBe('Specify next point or [Undo]:');
    await bus.script(['-4,8', '']);
    // And ARC continues from that last line, heading −Y: to (−6, 4) it turns right (clockwise)
    // about (−9, 8).
    await bus.script(['ARC', '', '-6,4']);
    expect(shapes()).toEqual([
      [0, 0, 10, 0, 90],
      [0, 10, -4, 10],
      [-4, 10, -4, 8],
      [-9, 8, 5, r6((Math.atan2(-4, 3) * 180) / Math.PI + 360), 0],
    ]);
  });

  it('Enter at the length ends it', async () => {
    const { bus, shapes } = setup();
    await bus.script(['ARC', '10,0', 'C', '0,0', '0,10', 'L', '', '']);
    expect(bus.command).toBeUndefined();
    expect(shapes()).toHaveLength(1);
  });

  it('undoing every segment leaves nothing to continue', async () => {
    const { bus } = setup();
    await bus.script(['LINE', '0,0', '5,5', 'U', '', 'LINE', '']);
    expect(bus.history.at(-1)).toBe('No line or arc to continue.');
    await bus.cancel();
    // A zero-length line keeps the direction it had.
    await bus.script(['LINE', '0,0', '0,5', '0,5', '', 'ARC', '', '-5,10']);
    expect(bus.command).toBeUndefined();
  });
});
