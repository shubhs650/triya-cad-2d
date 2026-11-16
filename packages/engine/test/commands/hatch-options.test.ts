// M4-07 part 2: the rest of -HATCH's command-line options, with AutoCAD 2024's prompts (AutoCAD
// 2024 Help, "-HATCH (Command)", "HATCH (Command)", HPDRAWORDER, HPCOLOR, HPLAYER,
// HPTRANSPARENCY, HPBOUNDRETAIN): draw order (a new hatch goes behind its boundary by default),
// hatch colour, layer and transparency, Retain boundary, Boundary set, draW boundary, remove
// Boundaries and the pattern list (`?`).
import { describe, expect, it } from 'vitest';
import type { EntityGeometry, LwPolylineGeometry } from '../../src/index';
import { LAYER_0 } from '../model/fixtures';
import { circle, line, setup, square } from './hatch-fixtures';

const DASH_PROMPT =
  'Specify internal point or [Properties/Select objects/draW boundary/remove Boundaries/' +
  'Advanced/DRaw order/Origin/hatch COlor/LAyer/Transparency/Undo]:';
const DRAW_ORDER_PROMPT =
  'Enter draw order [do Not assign/send to Back/bring to Front/send beHind boundary/' +
  'bring in front of bounDary] <send beHind boundary>:';
const ADVANCED_PROMPT =
  'Enter an option [Boundary set/Retain boundary/Island detection/Style/Associativity/' +
  'Gap tolerance/separate Hatches]:';

const ellipse = (x: number, y: number, a: number, b: number): EntityGeometry => ({
  kind: 'ELLIPSE',
  center: { x, y },
  majorAxis: { x: a, y: 0 },
  ratio: b / a,
  startParam: 0,
  endParam: 2 * Math.PI,
});

/** A square and a line beside it: the square bounds the hatch, the line does not. */
const squareAndLine = (): EntityGeometry[] => [...square(0, 0, 10), line(20, 0, 30, 0)];

const polylines = (s: ReturnType<typeof setup>) =>
  [...s.model.entities()].filter((e) => e.geom.kind === 'LWPOLYLINE');

describe('HATCH draw order (M4-07 part 2)', () => {
  it('puts a new hatch behind its boundary (HPDRAWORDER 3, AutoCAD’s default)', async () => {
    const s = setup(squareAndLine());
    await s.bus.script(['HATCH', '5,5', '']);
    const h = s.handleOf(s.hatches()[0]!);
    expect(s.order()).toEqual([h, '100', '101', '102', '103', '104']);
    await s.bus.script(['U']);
    expect(s.order()).toEqual(['100', '101', '102', '103', '104']);
  });

  it('asks for the draw order (-HATCH DRaw order) and keeps it for the next hatch', async () => {
    const s = setup(squareAndLine());
    await s.bus.script(['-HATCH']);
    expect(s.bus.promptText).toBe(DASH_PROMPT);
    await s.bus.script(['DR']);
    expect(s.bus.promptText).toBe(DRAW_ORDER_PROMPT);
    await s.bus.script(['D', '5,5', '']);
    const first = s.handleOf(s.hatches()[0]!);
    expect(s.order()).toEqual(['100', '101', '102', '103', first, '104']);
    await s.bus.script(['HATCH', '5,5', '']);
    const second = s.handleOf(s.hatches()[1]!);
    // Just above the boundary's topmost object, which the first hatch is not.
    expect(s.order()).toEqual(['100', '101', '102', '103', second, first, '104']);
  });

  it('sends a hatch to the back, brings it to the front, or leaves it where it is drawn', async () => {
    for (const [option, at] of [
      ['B', 0],
      ['F', 5],
      ['N', 5],
      ['', 0],
    ] as const) {
      const s = setup(squareAndLine());
      await s.bus.script(['-HATCH', 'DR', option, '5,5', '']);
      expect(s.order().indexOf(s.handleOf(s.hatches()[0]!))).toBe(at);
    }
  });

  it('puts each separate hatch behind its own boundary', async () => {
    const s = setup([...square(0, 0, 10), ...square(20, 0, 10)]);
    await s.bus.script(['-HATCH', 'A', 'H', 'Y', '', '5,5', '25,5', '']);
    const [a, b] = s.hatches().map((h) => s.handleOf(h));
    expect(s.order()).toEqual([a, '100', '101', '102', '103', b, '104', '105', '106', '107']);
  });
});

describe('HATCH colour, layer and transparency (M4-07 part 2)', () => {
  it('gives new hatches a colour (hatch COlor): a number, a name, true colour, or the current', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'CO']);
    expect(s.bus.promptText).toBe(
      'Enter new color for hatch or [. (use current)/Truecolor/COlorbook] <use current>:',
    );
    await s.bus.script(['1', '', '5,5', '']);
    expect(s.hatches()[0]!.color).toEqual({ kind: 'aci', index: 1 });
    await s.bus.script(['-HATCH', 'CO']);
    expect(s.bus.promptText).toBe(
      'Enter new color for hatch or [. (use current)/Truecolor/COlorbook] <red>:',
    );
    await s.bus.script(['T']);
    expect(s.bus.promptText).toBe('Red, Green, Blue:');
    await s.bus.script(['10,20,30', '', '5,5', '']);
    expect(s.hatches()[1]!.color).toEqual({ kind: 'rgb', r: 10, g: 20, b: 30 });
    await s.bus.script(['-HATCH', 'CO', 'blue', '', '5,5', '']);
    expect(s.hatches()[2]!.color).toEqual({ kind: 'aci', index: 5 });
    await s.bus.script(['-HATCH', 'CO', '.', '', '5,5', '']);
    expect(s.hatches()[3]!.color).toEqual({ kind: 'byLayer' });
  });

  it('refuses a colour it cannot read, and keeps the one it had', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'CO', 'purple']);
    expect(s.log).toContain('Invalid color.');
    expect(s.bus.promptText).toBe(DASH_PROMPT);
    await s.bus.script(['CO', 'T', '300,0,0', 'CO', 'T', 'red']);
    expect(s.log.filter((l) => l === 'Invalid color.')).toHaveLength(3);
    await s.bus.script(['CO', 'CO', 'NOBOOK']);
    expect(s.log).toContain('Color book "NOBOOK" not found.');
    await s.bus.script(['CO', '', '', '5,5', '']);
    expect(s.hatches()[0]!.color).toEqual({ kind: 'byLayer' });
  });

  it('puts new hatches on a layer (LAyer), making the layer when the drawing has none', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'LA']);
    expect(s.bus.promptText).toBe(
      'Enter layer name for new hatch objects or [. (use current)] <use current>:',
    );
    await s.bus.script(['0', '5,5', '']);
    expect(s.hatches()[0]!.layer).toBe(LAYER_0);
    await s.bus.script(['-HATCH', 'LA']);
    expect(s.bus.promptText).toBe(
      'Enter layer name for new hatch objects or [. (use current)] <0>:',
    );
    await s.bus.script(['Hatch fills', '5,5', '']);
    const made = [...s.model.tables.layers.values()].find((l) => l.name === 'Hatch fills');
    expect(made).toBeDefined();
    expect(s.hatches()[1]!.layer).toBe(made!.handle);
    // One undo step takes the hatch and its layer back.
    await s.bus.script(['U']);
    expect([...s.model.tables.layers.values()].some((l) => l.name === 'Hatch fills')).toBe(false);
    await s.bus.script(['-HATCH', 'LA', 'a<b']);
    expect(s.log).toContain('Invalid layer name.');
    await s.bus.script(['LA', '.', '5,5', '']);
    expect(s.hatches().at(-1)!.layer).not.toBe(LAYER_0);
  });

  it('gives new hatches a transparency (HPTRANSPARENCY), kept in the drawing', async () => {
    const s = setup(square(0, 0, 10), { header: [['CETRANSPARENCY', '30']] });
    await s.bus.script(['-HATCH', 'T']);
    expect(s.bus.promptText).toBe(
      'Enter transparency value for new hatch objects or [ByLayer/ByBlock/. (use current)] <use current>:',
    );
    // Use current: CETRANSPARENCY.
    await s.bus.script(['', '5,5', '']);
    expect(s.hatches()[0]!.transparency).toEqual({ alpha: 179 });
    await s.bus.script(['-HATCH', 'T', '50', '5,5', '']);
    expect(s.hatches()[1]!.transparency).toEqual({ alpha: 128 });
    expect(s.model.header.get('HPTRANSPARENCY')).toBe('50');
    await s.bus.script(['-HATCH', 'T']);
    expect(s.bus.promptText).toMatch(/<50>:$/);
    await s.bus.script(['95']);
    expect(s.log).toContain('Value must be ByLayer, ByBlock or between 0 and 90.');
    await s.bus.script(['T', 'BYB', '5,5', '']);
    expect(s.hatches()[2]!.transparency).toBe('ByBlock');
    await s.bus.script(['-HATCH', 'T', '.', '5,5', '']);
    expect(s.hatches()[3]!.transparency).toEqual({ alpha: 179 });
    expect(s.model.header.get('HPTRANSPARENCY')).toBe('use current');
  });

  it('keeps a transparency set though nothing is hatched', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'T', '20', '']);
    expect(s.model.header.get('HPTRANSPARENCY')).toBe('20');
    await s.bus.script(['-HATCH', 'T', '']);
    expect(s.model.header.get('HPTRANSPARENCY')).toBe('20');
  });

  it('reads HPTRANSPARENCY as SETVAR left it', async () => {
    const s = setup(square(0, 0, 10), { header: [['HPTRANSPARENCY', 'ByLayer']] });
    await s.bus.script(['HATCH', '5,5', '']);
    expect(s.hatches()[0]!.transparency).toBe('ByLayer');
  });
});

describe('HATCH boundaries (M4-07 part 2)', () => {
  it('keeps the boundaries it found as polylines (Advanced, Retain boundary)', async () => {
    const s = setup([...square(0, 0, 100), circle(50, 50, 10)]);
    await s.bus.script(['-HATCH', 'A']);
    expect(s.bus.promptText).toBe(ADVANCED_PROMPT);
    await s.bus.script(['R']);
    expect(s.bus.promptText).toBe('Retain derived boundaries? [Yes/No] <N>:');
    await s.bus.script(['Y', '', '5,5', '']);
    const kept = polylines(s).map((e) => e.geom as LwPolylineGeometry);
    expect(kept).toHaveLength(2);
    expect(kept.every((g) => g.closed)).toBe(true);
    expect(kept[0]!.vertices.map((v) => [v.x, v.y, v.bulge])).toEqual([
      [0, 0, 0],
      [100, 0, 0],
      [100, 100, 0],
      [0, 100, 0],
    ]);
    // The circle as two half circles.
    expect(kept[1]!.vertices).toHaveLength(2);
    expect(kept[1]!.vertices.map((v) => Math.abs(v.bulge))).toEqual([1, 1]);
    // The hatch is drawn behind the boundary it keeps too.
    expect(s.order()[0]).toBe(s.handleOf(s.hatches()[0]!));
    await s.bus.script(['U']);
    expect(polylines(s)).toHaveLength(0);
    expect(s.hatches()).toHaveLength(0);
  });

  it('keeps an elliptical boundary as an ellipse, and none for selected objects', async () => {
    const s = setup([...square(0, 0, 100), ellipse(50, 50, 20, 10), circle(200, 0, 5)]);
    await s.bus.script(['-HATCH', 'A', 'R', 'Y', '', '5,5', '']);
    const ellipses = [...s.model.entities()].filter((e) => e.geom.kind === 'ELLIPSE');
    expect(ellipses).toHaveLength(2);
    expect(polylines(s)).toHaveLength(1);
    await s.bus.script(['-HATCH', 'S']);
    await s.bus.answer({ kind: 'selection', ids: [s.idOf('105')] });
    await s.bus.script(['', '']);
    expect(s.hatches()).toHaveLength(2);
    expect(polylines(s)).toHaveLength(1);
  });

  it('finds boundaries among a set of objects chosen (Advanced, Boundary set)', async () => {
    const s = setup([...square(0, 0, 100), ...square(20, 20, 20)]);
    await s.bus.script(['-HATCH', 'A', 'B']);
    expect(s.bus.promptText).toBe(
      'Specify candidate set for boundary [New/Everything] <Everything>:',
    );
    await s.bus.script(['N']);
    expect(s.bus.promptText).toBe('Select objects:');
    await s.bus.answer({ kind: 'selection', ids: ['100', '101', '102', '103'].map(s.idOf) });
    expect(s.bus.promptText).toBe(ADVANCED_PROMPT);
    await s.bus.script(['B']);
    expect(s.bus.promptText).toBe('Specify candidate set for boundary [New/Everything] <current>:');
    await s.bus.script(['', '', '30,30', '']);
    // Only the big square: the small one is not in the set, so it is no island.
    expect(s.hatches()[0]!.geom.loops).toHaveLength(1);
    // Everything: the small square bounds again.
    await s.bus.script(['-HATCH', 'A', 'B', 'N']);
    await s.bus.answer({ kind: 'selection', ids: ['100', '101'].map(s.idOf) });
    await s.bus.script(['B', 'E', 'B', 'N']);
    // Nothing selected: the set stays as it was.
    await s.bus.answer({ kind: 'selection', ids: [] });
    await s.bus.script(['', '30,30', '']);
    expect(s.hatches()[1]!.geom.loops).toHaveLength(1);
    expect(s.hatches()[1]!.geom.seedPoints).toEqual([{ x: 30, y: 30 }]);
    await s.bus.script(['-HATCH', '5,5', '']);
    expect(s.hatches()[2]!.geom.loops).toHaveLength(2);
  });

  it('hatches a boundary drawn point by point, islands too (draW boundary)', async () => {
    const s = setup([]);
    await s.bus.script(['-HATCH', 'W']);
    expect(s.bus.promptText).toBe('Retain polyline boundary? [Yes/No] <N>:');
    await s.bus.script(['Y']);
    expect(s.bus.promptText).toBe('Specify start point:');
    await s.bus.script(['0,0']);
    expect(s.bus.promptText).toBe('Specify next point or [Arc/Length/Undo]:');
    await s.bus.script(['10,0', '10,10', '0,10', '']);
    expect(s.bus.promptText).toBe('Specify start point for new island boundary or <apply hatch>:');
    await s.bus.script(['2,2', '4,2', '4,4', '']);
    expect(s.bus.promptText).toBe('Specify start point for new island boundary or <apply hatch>:');
    await s.bus.submit('');
    const [h] = s.hatches();
    expect(h!.geom.loops.map((l) => l.flags)).toEqual([3, 18]);
    expect(h!.geom.loops[0]!.polyline!.vertices).toHaveLength(4);
    expect(h!.geom.seedPoints).toEqual([]);
    expect(polylines(s)).toHaveLength(2);
    // The command has ended.
    expect(s.bus.promptText).toBe('Command:');
    expect(s.order()[0]).toBe(s.handleOf(h!));
  });

  it('draws no polylines unless asked, refuses a boundary with no area, and takes arcs', async () => {
    const s = setup([]);
    await s.bus.script(['-HATCH', 'W', '', '0,0', '10,0', '']);
    expect(s.log).toContain('Valid hatch boundary not found.');
    expect(s.bus.promptText).toBe('Specify start point:');
    await s.bus.script(['0,0', '10,0', 'A', '0,10', '', '']);
    const [h] = s.hatches();
    expect(h!.geom.loops[0]!.polyline!.vertices.some((v) => v.bulge !== 0)).toBe(true);
    expect(polylines(s)).toHaveLength(0);
  });

  it('closes a boundary drawn back to its start, and goes back without one', async () => {
    const s = setup([]);
    await s.bus.script(['-HATCH', 'W', 'N', '']);
    expect(s.bus.promptText).toBe(DASH_PROMPT);
    await s.bus.script(['W', '', '0,0', '10,0', '10,10', '0,0', '', '']);
    expect(s.hatches()[0]!.geom.loops[0]!.polyline!.vertices).toHaveLength(3);
  });

  it('takes islands back out of a picked area (remove Boundaries)', async () => {
    const s = setup([...square(0, 0, 100), circle(50, 50, 30), circle(50, 50, 10)]);
    await s.bus.script(['HATCH', '5,5']);
    expect(s.bus.promptText).toBe(
      'Pick internal point or [Select objects/remove Boundaries/Undo]:',
    );
    await s.bus.script(['B']);
    expect(s.bus.promptText).toBe('Select objects or [Add boundaries]:');
    // The square is the area's outer boundary, which stays.
    await s.bus.answer({ kind: 'selection', ids: [s.idOf('100'), s.idOf('104')] });
    expect(s.bus.promptText).toBe('Select objects or [Add boundaries]:');
    await s.bus.script(['A', '']);
    const loops = s.hatches()[0]!.geom.loops;
    // The square and the small circle, now an island of the area itself.
    expect(loops).toHaveLength(2);
    expect(loops[1]!.edges![0]).toMatchObject({ type: 'arc', radius: 10 });
    expect(loops[1]!.flags).toBe(16);
  });

  it('leaves areas alone that the objects removed do not bound', async () => {
    const s = setup([
      ...square(0, 0, 10),
      circle(5, 5, 2),
      circle(50, 50, 10),
      line(80, 80, 90, 90),
    ]);
    await s.bus.script(['-HATCH', 'S']);
    await s.bus.answer({ kind: 'selection', ids: [s.idOf('105')] });
    await s.bus.script(['K', '1,1', 'B']);
    await s.bus.answer({ kind: 'selection', ids: [s.idOf('106')] });
    await s.bus.script(['', '']);
    expect(s.hatches()[0]!.geom.loops).toHaveLength(3);
  });

  it('takes selected objects back out (remove Boundaries), Enter going back to the area prompt', async () => {
    const s = setup([circle(0, 0, 10), circle(0, 0, 5)]);
    await s.bus.script(['-HATCH', 'S']);
    await s.bus.answer({ kind: 'selection', ids: [s.idOf('100'), s.idOf('101')] });
    await s.bus.script(['K', 'B']);
    await s.bus.answer({ kind: 'selection', ids: [s.idOf('101')] });
    await s.bus.submit('');
    expect(s.bus.promptText).toBe(DASH_PROMPT);
    await s.bus.submit('');
    const loops = s.hatches()[0]!.geom.loops;
    expect(loops).toHaveLength(1);
    expect(loops[0]!.edges![0]).toMatchObject({ type: 'arc', radius: 10 });
  });

  it('drops an area whose every object is taken out', async () => {
    const s = setup([circle(0, 0, 10)]);
    await s.bus.script(['HATCH', 'S']);
    await s.bus.answer({ kind: 'selection', ids: [s.idOf('100')] });
    await s.bus.script(['K', 'B']);
    await s.bus.answer({ kind: 'selection', ids: [s.idOf('100')] });
    await s.bus.script(['', '']);
    expect(s.hatches()).toHaveLength(0);
  });
});

describe('HATCH pattern list (M4-07 part 2)', () => {
  it('lists the library’s patterns (-HATCH Properties ?), all or by wildcard', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'P']);
    expect(s.bus.promptText).toBe(
      'Enter a pattern name or [?/Solid/User defined/Gradient] <TRIYA_LINES45>:',
    );
    await s.bus.script(['?']);
    expect(s.bus.promptText).toBe('Pattern(s) to list <*>:');
    await s.bus.submit('');
    expect(s.log).toContain('TRIYA_LINES45 - 45 degree lines');
    expect(s.log).toContain('TRIYA_GRID');
    expect(s.log).toContain('MINE - My own');
    expect(s.bus.promptText).toBe(
      'Enter a pattern name or [?/Solid/User defined/Gradient] <TRIYA_LINES45>:',
    );
    const before = s.log.length;
    await s.bus.script(['?', 'triya*']);
    expect(s.log.slice(before)).not.toContain('MINE - My own');
    expect(s.log.slice(before)).toContain('TRIYA_GRID');
  });

  it('says when there is no pattern library to list', async () => {
    const s = setup(square(0, 0, 10), { noView: true });
    await s.bus.script(['-HATCH', 'P', '?', '']);
    expect(s.log).toContain('There is no view to change.');
    expect(s.bus.promptText).toBe(
      'Enter a pattern name or [?/Solid/User defined/Gradient] <TRIYA_LINES45>:',
    );
  });
});
