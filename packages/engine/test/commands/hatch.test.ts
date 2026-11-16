// M4-07 part 1: HATCH and -HATCH on the PromptBus, with AutoCAD 2024's prompts (AutoCAD 2024
// Help, "HATCH (Command)", "-HATCH (Command)", HPNAME, HPSCALE, HPANG, HPSPACE, HPDOUBLE,
// HPISLANDDETECTION, HPISLANDDETECTIONMODE, HPGAPTOL, HPSEPARATE, HPORIGIN). Pick points find
// the area around them (edit/hatch-boundary.ts); Enter makes the hatch, non-associative
// (DEC-015), its pattern lines placed by the app's pattern library (`hatchPattern`).
import { describe, expect, it } from 'vitest';
import type { EntityGeometry } from '../../src/index';
import { LAYER_WALLS, MODEL_SPACE } from '../model/fixtures';
import { circle, line, placements, setup, square, text } from './hatch-fixtures';

describe('HATCH (M4-07)', () => {
  it('hatches the area around a picked point with the current pattern, once Enter is pressed', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['HATCH']);
    expect(s.bus.promptText).toBe('Pick internal point or [Select objects/Undo/seTtings]:');
    await s.bus.submit('5,5');
    // Previewed until Enter, the prompt asked again.
    expect(s.previews.at(-1)?.[0]).toMatchObject({ kind: 'HATCH', pattern: 'TRIYA_LINES45' });
    expect(s.hatches()).toHaveLength(0);
    expect(s.bus.promptText).toBe(
      'Pick internal point or [Select objects/remove Boundaries/Undo/seTtings]:',
    );
    await s.bus.submit('');
    const [h] = s.hatches();
    expect(h).toBeDefined();
    expect(h!.layer).toBe(LAYER_WALLS); // $CLAYER
    expect(h!.owner).toBe(MODEL_SPACE);
    expect(h!.geom).toMatchObject({
      pattern: 'TRIYA_LINES45',
      solid: false,
      associative: false,
      style: 0,
      patternType: 1,
      patternAngle: 0,
      patternScale: 1,
      double: false,
      seedPoints: [{ x: 5, y: 5 }],
    });
    expect(h!.geom.loops).toHaveLength(1);
    expect(h!.geom.loops[0]!.edges!.map((e) => e.type)).toEqual(['line', 'line', 'line', 'line']);
    expect(h!.geom.patternLines).toHaveLength(1);
    expect(placements(s.requests).at(-1)).toMatchObject({
      name: 'TRIYA_LINES45',
      placements: [{ angle: 0, scale: 1, origin: { x: 0, y: 0 } }],
    });
    // One undo step.
    await s.bus.script(['U']);
    expect(s.hatches()).toHaveLength(0);
  });

  it('says when no area is around the point, and keeps asking', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['H', '20,20']);
    expect(s.log).toContain('Valid hatch boundary not found.');
    expect(s.bus.promptText).toBe('Pick internal point or [Select objects/Undo/seTtings]:');
    await s.bus.submit('');
    expect(s.hatches()).toHaveLength(0);
  });

  it('leaves out objects on layers that are off, and objects outside the view', async () => {
    const s = setup([...square(0, 0, 10).map((g) => [g, '12'] as [EntityGeometry, string])]);
    await s.bus.script(['HATCH', '5,5']);
    expect(s.log).toContain('Valid hatch boundary not found.');
    const far = setup(square(1000, 1000, 10));
    await far.bus.script(['HATCH', '1005,1005']);
    expect(far.log).toContain('Valid hatch boundary not found.');
  });

  it('takes several areas into one hatch, Undo taking back the last', async () => {
    const s = setup([...square(0, 0, 10), ...square(20, 0, 10), ...square(40, 0, 10)]);
    await s.bus.script(['HATCH', '5,5', '25,5', '45,5', 'U', '']);
    const [h] = s.hatches();
    expect(s.hatches()).toHaveLength(1);
    expect(h!.geom.loops).toHaveLength(2);
    expect(h!.geom.seedPoints).toEqual([
      { x: 5, y: 5 },
      { x: 25, y: 5 },
    ]);
  });

  it('makes islands of the closed objects inside, text included', async () => {
    const s = setup([
      ...square(0, 0, 100),
      circle(50, 50, 30),
      circle(50, 50, 10),
      {
        kind: 'TEXT',
        value: 'T',
        style: 'STANDARD',
        position: { x: 5, y: 90 },
        height: 2,
        rotation: 0,
        widthFactor: 1,
        oblique: 0,
        halign: 0,
        valign: 0,
        backward: false,
        upsideDown: false,
      },
    ]);
    await s.bus.script(['HATCH', '5,5', '']);
    // The square, both circles (Normal style) and the text's box.
    expect(s.hatches()[0]!.geom.loops).toHaveLength(4);
  });

  it('sets the island style, island detection, gap tolerance and separate hatches (-HATCH Advanced)', async () => {
    const curves = [...square(0, 0, 100), circle(50, 50, 30), circle(50, 50, 10)];
    const s = setup(curves);
    await s.bus.script(['-HATCH']);
    expect(s.bus.promptText).toBe(
      'Specify internal point or [Properties/Select objects/draW boundary/remove Boundaries/' +
        'Advanced/DRaw order/Origin/hatch COlor/LAyer/Transparency/Undo]:',
    );
    await s.bus.script(['A']);
    expect(s.bus.promptText).toBe(
      'Enter an option [Boundary set/Retain boundary/Island detection/Style/Associativity/' +
        'Gap tolerance/separate Hatches]:',
    );
    await s.bus.script(['S']);
    expect(s.bus.promptText).toBe('Enter island detection style [Ignore/Outer/Normal] <Normal>:');
    await s.bus.script(['O', '', '5,5', '']);
    expect(s.hatches()[0]!.geom).toMatchObject({ style: 1 });
    expect(s.hatches()[0]!.geom.loops).toHaveLength(2);

    // Kept for the next hatch: Island detection off is Ignore.
    await s.bus.script(['-HATCH', 'A', 'I']);
    expect(s.bus.promptText).toBe('Do you want island detection? [Yes/No] <Y>:');
    await s.bus.script(['N', '', '5,5', '']);
    expect(s.hatches()[1]!.geom.loops).toHaveLength(1);
    expect(s.hatches()[1]!.geom.style).toBe(2);
  });

  it('closes gaps up to the gap tolerance', async () => {
    const s = setup([
      line(0, 0, 10, 0),
      line(10, 0, 10, 10),
      line(10, 10, 0, 10),
      line(0, 10, 0, 0.5),
    ]);
    await s.bus.script(['-HATCH', '5,5']);
    expect(s.log).toContain('Valid hatch boundary not found.');
    await s.bus.script(['A', 'G']);
    expect(s.bus.promptText).toBe('Specify a boundary gap tolerance value <0.0000>:');
    await s.bus.script(['1', '', '5,5', '']);
    expect(s.hatches()).toHaveLength(1);
  });

  it('makes a hatch per area with separate hatches', async () => {
    const s = setup([...square(0, 0, 10), ...square(20, 0, 10)]);
    await s.bus.script(['-HATCH', 'A', 'H']);
    expect(s.bus.promptText).toBe('Create separate hatches? [Yes/No] <N>:');
    await s.bus.script(['Y', '', '5,5', '25,5', '']);
    expect(s.hatches()).toHaveLength(2);
    await s.bus.script(['U']);
    expect(s.hatches()).toHaveLength(0);
  });

  it('keeps hatches non-associative (DEC-015)', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'A', 'A']);
    expect(s.bus.promptText).toBe('Do you want associativity? [Yes/No] <N>:');
    await s.bus.script(['Y']);
    expect(s.log).toContain('Triya makes non-associative hatches.');
    await s.bus.script(['', '5,5', '']);
    expect(s.hatches()[0]!.geom.associative).toBe(false);
  });

  it('sets the pattern, scale and angle (-HATCH Properties), kept for HATCH', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'P']);
    expect(s.bus.promptText).toBe(
      'Enter a pattern name or [?/Solid/User defined/Gradient] <TRIYA_LINES45>:',
    );
    await s.bus.script(['triya_grid']);
    expect(s.bus.promptText).toBe('Specify a scale for the pattern <1.0000>:');
    await s.bus.script(['2']);
    expect(s.bus.promptText).toBe('Specify an angle for the pattern <0>:');
    await s.bus.script(['30', '5,5', '']);
    expect(s.hatches()[0]!.geom).toMatchObject({
      pattern: 'TRIYA_GRID',
      patternScale: 2,
      patternType: 1,
    });
    expect(s.hatches()[0]!.geom.patternAngle).toBeCloseTo(Math.PI / 6, 12);
    expect(placements(s.requests).at(-1)!.placements[0]!.scale).toBe(2);
    await s.bus.script(['HATCH', '5,5', '']);
    expect(s.hatches()[1]!.geom.pattern).toBe('TRIYA_GRID');
  });

  it('refuses a pattern the library lacks', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'P', 'NOPE']);
    expect(s.log).toContain('Pattern "NOPE" is not in the pattern library.');
    expect(s.bus.promptText).toBe(
      'Enter a pattern name or [?/Solid/User defined/Gradient] <TRIYA_LINES45>:',
    );
  });

  it('fills solid', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'P', 'S', '5,5', '']);
    expect(s.hatches()[0]!.geom).toMatchObject({
      pattern: 'SOLID',
      solid: true,
      patternType: 1,
      patternLines: [],
    });
  });

  it('makes user-defined lines: angle, spacing and doubled', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'P', 'U']);
    expect(s.bus.promptText).toBe('Specify angle for crosshatch lines <0>:');
    await s.bus.script(['90']);
    expect(s.bus.promptText).toBe('Specify spacing between the lines <1.0000>:');
    await s.bus.script(['2']);
    expect(s.bus.promptText).toBe('Double hatch area? [Yes/No] <N>:');
    await s.bus.script(['Y', '5,5', '']);
    const g = s.hatches()[0]!.geom;
    expect(g).toMatchObject({ pattern: '_USER', patternType: 0, patternScale: 2, double: true });
    expect(g.patternLines).toHaveLength(2);
    expect(g.patternLines[0]!.angle).toBeCloseTo(Math.PI / 2, 12);
    expect(g.patternLines[0]!.offset.x).toBeCloseTo(-2, 12);
  });

  it('places the pattern about a new origin (-HATCH Origin)', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'O']);
    expect(s.bus.promptText).toBe('[Use current origin/Set new origin] <Use current origin>:');
    await s.bus.script(['S']);
    expect(s.bus.promptText).toBe('Specify origin point:');
    await s.bus.script(['3,4']);
    expect(s.bus.promptText).toBe('Store as default origin? [Yes/No] <N>:');
    await s.bus.script(['N', '5,5', '']);
    expect(placements(s.requests).at(-1)!.placements[0]!.origin).toEqual({ x: 3, y: 4 });
    // Not stored: the next hatch starts from (0, 0) again.
    await s.bus.script(['-HATCH', '5,5', '']);
    expect(placements(s.requests).at(-1)!.placements[0]!.origin).toEqual({ x: 0, y: 0 });
  });

  it('hatches selected objects (Select objects), islands by style', async () => {
    const s = setup([circle(0, 0, 10), circle(0, 0, 5), line(0, 20, 10, 20)]);
    await s.bus.script(['HATCH', 'S']);
    expect(s.bus.promptText).toBe('Select objects or [picK internal point/Undo]:');
    await s.bus.answer({ kind: 'selection', ids: [s.idOf('100'), s.idOf('101'), s.idOf('102')] });
    expect(s.bus.promptText).toBe('Select objects or [picK internal point/Undo]:');
    await s.bus.submit('');
    const [h] = s.hatches();
    expect(h!.geom.loops.map((l) => l.edges![0]!.type)).toEqual(['arc', 'arc']);
    expect(h!.geom.seedPoints).toEqual([]);
  });

  it('says when the objects selected bound nothing', async () => {
    const s = setup([line(0, 20, 10, 20)]);
    await s.bus.script(['HATCH', 'S']);
    await s.bus.answer({ kind: 'selection', ids: [s.idOf('100')] });
    expect(s.log).toContain('Valid hatch boundary not found.');
    await s.bus.script(['K']);
    expect(s.bus.promptText).toBe('Pick internal point or [Select objects/Undo/seTtings]:');
  });

  it('starts an imperial drawing at a pattern scale of 1/25.4 (the bundled patterns are in mm)', async () => {
    const s = setup(square(0, 0, 10), { header: [['$MEASUREMENT', 0]] });
    await s.bus.script(['HATCH', '5,5', '']);
    expect(s.hatches()[0]!.geom.patternScale).toBeCloseTo(1 / 25.4, 12);
  });

  it('works without a canvas: every object bounds, and only solid and user-defined fills', async () => {
    const s = setup([...square(0, 0, 10), text(4, 4)], { noView: true });
    await s.bus.script(['HATCH', '5,5']);
    // No library places the pattern: nothing previewed, nothing made.
    expect(s.previews.at(-1)).toEqual([]);
    await s.bus.submit('');
    expect(s.hatches()).toHaveLength(0);
    await s.bus.script(['-HATCH', 'P', 'S', '5,5', '']);
    // The text is not measured: no island.
    expect(s.hatches()[0]!.geom.loops).toHaveLength(1);
  });

  it('leaves out invisible objects; Undo with nothing picked does nothing', async () => {
    const s = setup(square(0, 0, 10), { invisible: [0] });
    await s.bus.script(['HATCH', 'U', '5,5']);
    expect(s.log).toContain('Valid hatch boundary not found.');
  });

  it("takes a custom pattern from the user's files, and refuses an empty answer", async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'P', 'EMPTY']);
    expect(s.log).toContain('Pattern "EMPTY" is not in the pattern library.');
    await s.bus.script(['MINE', '0']);
    expect(s.log).toContain('Value must be positive and nonzero.');
    await s.bus.script(['3', '', '5,5', '']);
    expect(s.hatches()[0]!.geom).toMatchObject({
      pattern: 'MINE',
      patternType: 2,
      patternScale: 3,
    });
    // Enter keeps the pattern.
    await s.bus.script(['-HATCH', 'P', '', '5,5', '']);
    expect(s.hatches()[1]!.geom.pattern).toBe('MINE');
  });

  it('shows a user-defined pattern as U, single lines unless doubled', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'P', 'U', '0', '', '', '-HATCH', 'P']);
    expect(s.bus.promptText).toBe('Enter a pattern name or [?/Solid/User defined/Gradient] <U>:');
    await s.bus.script(['', '5,5', '']);
    expect(s.hatches()[0]!.geom.patternLines).toHaveLength(1);
  });

  it('keeps or stores the origin, takes No for associativity, refuses a gap out of range', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'O', '', 'A', 'A', 'N', 'G', '-1']);
    expect(s.log).toContain('Value must be between 0 and 5000.');
    expect(s.log).not.toContain('Triya makes non-associative hatches.');
    await s.bus.script(['', 'O', 'S', '2,2', 'Y', '5,5', '']);
    expect(placements(s.requests).at(-1)!.placements[0]!.origin).toEqual({ x: 2, y: 2 });
    await s.bus.script(['-HATCH', '5,5', '']);
    expect(placements(s.requests).at(-1)!.placements[0]!.origin).toEqual({ x: 2, y: 2 });
  });

  it('goes back to pick points from Select objects', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['HATCH', 'S', 'K', '5,5', '']);
    expect(s.hatches()).toHaveLength(1);
  });
});
