// M4-07 part 4: HATCHEDIT and -HATCHEDIT on the command line, with AutoCAD 2024's prompts
// (AutoCAD 2024 Help, "-HATCHEDIT (Command)"), and separate Hatches on an existing hatch.
import { describe, expect, it } from 'vitest';
import type { EntityGeometry, HatchGeometry } from '../../src/index';
import { LAYER_0, LAYER_WALLS } from '../model/fixtures';
import { circle, line, placements, setup, square } from './hatch-fixtures';

const OPTIONS =
  'Enter hatch option [DIsassociate/Style/Properties/DRaw order/ADd boundaries/' +
  'Remove boundaries/recreate Boundary/ASsociate/separate Hatches/Origin/LAyer/COlor/' +
  'Transparency] <Properties>:';
const DRAW_ORDER =
  'Enter draw order [do Not change/send to Back/bring to Front/send beHind boundary/' +
  'bring in front of bounDary] <do Not change>:';

/** Two squares side by side (and a line apart), hatched as one hatch of two areas. */
async function twoAreas(extra: EntityGeometry[] = []) {
  const s = setup([...square(0, 0, 10), ...square(20, 0, 10), ...extra]);
  await s.bus.script(['HATCH', '5,5', '25,5', '']);
  return s;
}

const only = (s: ReturnType<typeof setup>) => {
  const hs = s.hatches();
  expect(hs).toHaveLength(1);
  return hs[0]!;
};

describe('-HATCHEDIT (M4-07 part 4)', () => {
  it('asks for a hatch, refusing other objects, then for an option', async () => {
    const s = await twoAreas([line(50, 50, 60, 60)]);
    await s.bus.script(['-HATCHEDIT']);
    expect(s.bus.promptText).toBe('Select hatch object:');
    await s.bus.pick({ x: 55, y: 55 });
    expect(s.log).toContain('Object selected is not a hatch.');
    expect(s.bus.promptText).toBe('Select hatch object:');
    await s.bus.script(['L']);
    expect(s.bus.promptText).toBe(OPTIONS);
    await s.bus.script(['ASsociate']);
    expect(s.log).toContain('Triya makes non-associative hatches.');
    expect(s.bus.command).toBeUndefined();
  });

  it('ends at once when no hatch is selected; HATCHEDIT asks the same', async () => {
    const s = await twoAreas();
    await s.bus.script(['-HATCHEDIT', '']);
    expect(s.bus.command).toBeUndefined();
    await s.bus.script(['HATCHEDIT', 'L']);
    expect(s.bus.promptText).toBe(OPTIONS);
  });

  it('separates a hatch of two areas into two, the copy just above it, as one undo step', async () => {
    const s = await twoAreas();
    const before = only(s);
    expect(before.geom.loops).toHaveLength(2);
    await s.bus.script(['-HATCHEDIT', 'L', 'H']);
    const [a, b] = s.hatches();
    expect(a!.id).toBe(before.id);
    expect(a!.geom.loops).toEqual([before.geom.loops[0]]);
    expect(b!.geom.loops).toEqual([before.geom.loops[1]]);
    expect(a!.geom.seedPoints).toEqual([{ x: 5, y: 5 }]);
    expect(b!.geom.seedPoints).toEqual([{ x: 25, y: 5 }]);
    expect(b!.geom.patternLines).toEqual(before.geom.patternLines);
    const order = s.order();
    expect(order.indexOf(s.handleOf(b!))).toBe(order.indexOf(s.handleOf(a!)) + 1);
    await s.bus.script(['U']);
    expect(only(s).geom.loops).toHaveLength(2);
  });

  it('says so when a hatch has one area to separate', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['HATCH', '5,5', '', '-HATCHEDIT', 'L', 'H']);
    expect(s.log).toContain('The hatch has only one area.');
    expect(s.hatches()).toHaveLength(1);
  });

  it('changes the island detection style (Style)', async () => {
    const s = await twoAreas();
    await s.bus.script(['-HATCHEDIT', 'L', 'S']);
    expect(s.bus.promptText).toBe('Enter hatching style [Ignore/Outer/Normal] <Normal>:');
    await s.bus.script(['O']);
    expect(only(s).geom.style).toBe(1);
    await s.bus.script(['-HATCHEDIT', 'L', 'S', '']);
    expect(only(s).geom.style).toBe(1);
  });

  it('turns and scales the lines it stores for the same pattern (Properties)', async () => {
    const s = await twoAreas();
    const was = only(s).geom.patternLines[0]!;
    await s.bus.script(['-HATCHEDIT', 'L', '']);
    expect(s.bus.promptText).toBe(
      'Enter a pattern name or [?/Solid/User defined/Gradient] <TRIYA_LINES45>:',
    );
    // Asked only whether the library knows the name (at scale 1), not to place it again.
    const asked = placements(s.requests).length;
    await s.bus.script(['TRIYA_LINES45', '2', '90']);
    const g = only(s).geom;
    expect(placements(s.requests)).toHaveLength(asked + 1);
    expect(placements(s.requests).at(-1)!.placements[0]!.scale).toBe(1);
    expect(g.patternScale).toBe(2);
    expect(g.patternAngle).toBeCloseTo(Math.PI / 2);
    expect(Math.hypot(g.patternLines[0]!.offset.x, g.patternLines[0]!.offset.y)).toBeCloseTo(
      2 * Math.hypot(was.offset.x, was.offset.y),
    );
    expect(g.patternLines[0]!.angle).toBeCloseTo(was.angle + Math.PI / 2);
  });

  it('gives a hatch another pattern from the library, Solid or user-defined lines', async () => {
    const s = await twoAreas();
    await s.bus.script(['-HATCHEDIT', 'L', 'P', 'MINE', '3', '0']);
    let g = only(s).geom;
    expect(g.pattern).toBe('MINE');
    expect(g.patternType).toBe(2);
    expect(placements(s.requests).at(-1)!.placements).toEqual([
      { angle: 0, scale: 3, origin: { x: 0, y: 0 } },
    ]);
    await s.bus.script(['-HATCHEDIT', 'L', 'P', 'U', '0', '2', 'Y']);
    g = only(s).geom;
    expect(g.patternType).toBe(0);
    expect(g.patternScale).toBe(2);
    expect(g.double).toBe(true);
    expect(g.patternLines).toHaveLength(2);
    await s.bus.script(['-HATCHEDIT', 'L', 'P', 'S']);
    g = only(s).geom;
    expect(g.solid).toBe(true);
    expect(g.patternLines).toEqual([]);
    // A colour change leaves the fill as it is.
    await s.bus.script(['-HATCHEDIT', 'L', 'CO', '1', '']);
    expect(only(s).geom).toBe(g);
  });

  it('leaves the hatch alone when the library has no pattern of the name', async () => {
    const s = await twoAreas();
    const g = only(s).geom;
    await s.bus.script(['-HATCHEDIT', 'L', 'P', 'NOPE']);
    // Properties asks again until a pattern is found; Enter keeps it.
    await s.bus.script(['']);
    await s.bus.script(['1', '0']);
    expect(only(s).geom).toEqual(g);
  });

  it('moves the pattern to a new origin, kept as HATCH’s when stored (Origin)', async () => {
    const s = await twoAreas();
    await s.bus.script(['-HATCHEDIT', 'L', 'O', 'S', '3,4', 'N']);
    expect(only(s).geom.patternLines[0]!.base).toEqual({ x: 3, y: 4 });
    await s.bus.script(['-HATCHEDIT', 'L', 'O', '']);
    expect(only(s).geom.patternLines[0]!.base).toEqual({ x: 3, y: 4 });
    await s.bus.script(['-HATCHEDIT', 'L', 'O', 'S', '1,1', 'Y']);
    await s.bus.script(['HATCH', '5,5', '']);
    expect(placements(s.requests).at(-1)!.placements[0]!.origin).toEqual({ x: 1, y: 1 });
  });

  it('changes the colour and background colour, and takes the background off again', async () => {
    const s = await twoAreas();
    await s.bus.script(['-HATCHEDIT', 'L', 'CO']);
    expect(s.bus.promptText).toBe(
      'Enter new color for hatch or [. (use current)/Truecolor/COlorbook] <BYLAYER>:',
    );
    await s.bus.script(['1', '5']);
    let h = only(s);
    expect(h.color).toEqual({ kind: 'aci', index: 1 });
    expect(h.geom.background).toEqual({ kind: 'aci', index: 5 });
    expect(h.xdata).toHaveLength(1);
    await s.bus.script(['-HATCHEDIT', 'L', 'CO', '.', '.']);
    h = only(s);
    expect(h.color).toEqual({ kind: 'byLayer' });
    expect(h.geom.background).toBeUndefined();
    expect(h.xdata).toBeUndefined();
  });

  it('changes a gradient’s colours', async () => {
    const s = await twoAreas();
    await s.bus.script(['GRADIENT', '5,5', '']);
    await s.bus.script(['-HATCHEDIT', 'L', 'CO', '1', 'O', '0.5']);
    const g = s.hatches().at(-1)!.geom;
    expect(g.gradient!.colors[0]!.color).toEqual({ kind: 'aci', index: 1 });
    expect(g.gradient!.singleColor).toBe(true);
    expect(g.gradient!.tint).toBe(0.5);
    expect(g.gradient!.name).toBe('LINEAR');
  });

  it('moves the hatch to a layer, made when missing, or the current one (LAyer)', async () => {
    const s = await twoAreas();
    await s.bus.script(['-HATCHEDIT', 'L', 'LA']);
    // The hatch is on the current layer, WALLS.
    expect(s.bus.promptText).toBe('Enter layer name for hatch or [. (use current)] <WALLS>:');
    await s.bus.script(['HATCHING']);
    const layer = s.model.tables.layers.get(only(s).layer)!;
    expect(layer.name).toBe('HATCHING');
    await s.bus.script(['-HATCHEDIT', 'L', 'LA', '0']);
    expect(only(s).layer).toBe(LAYER_0);
    await s.bus.script(['-HATCHEDIT', 'L', 'LA', '']);
    expect(only(s).layer).toBe(LAYER_0);
    await s.bus.script(['-HATCHEDIT', 'L', 'LA', '.']);
    expect(only(s).layer).toBe(LAYER_WALLS);
  });

  it('changes the transparency', async () => {
    const s = await twoAreas();
    await s.bus.script(['-HATCHEDIT', 'L', 'T']);
    expect(s.bus.promptText).toBe(
      'Enter transparency value for hatch or [ByLayer/ByBlock/. (use current)] <ByLayer>:',
    );
    await s.bus.script(['50']);
    expect(only(s).transparency).toEqual({ alpha: 128 });
    await s.bus.script(['-HATCHEDIT', 'L', 'T', '']);
    expect(only(s).transparency).toEqual({ alpha: 128 });
    await s.bus.script(['-HATCHEDIT', 'L', 'T', 'BYBLOCK']);
    expect(only(s).transparency).toBe('ByBlock');
    await s.bus.script(['-HATCHEDIT', 'L', 'T', '.']);
    expect(only(s).transparency).toBe('ByLayer');
  });

  it('moves the hatch in the draw order, by its boundary when asked (DRaw order)', async () => {
    const s = await twoAreas([line(40, 0, 50, 0)]);
    const h = () => s.handleOf(only(s));
    await s.bus.script(['-HATCHEDIT', 'L', 'DR']);
    expect(s.bus.promptText).toBe(DRAW_ORDER);
    await s.bus.script(['F']);
    expect(s.order().at(-1)).toBe(h());
    await s.bus.script(['-HATCHEDIT', 'L', 'DR', 'D']);
    // Just above the boundary's topmost object (the second square), under the line.
    expect(s.order().indexOf(h())).toBe(8);
    await s.bus.script(['-HATCHEDIT', 'L', 'DR', 'H']);
    expect(s.order()[0]).toBe(h());
    await s.bus.script(['-HATCHEDIT', 'L', 'DR', 'F', '-HATCHEDIT', 'L', 'DR', 'B']);
    expect(s.order()[0]).toBe(h());
    await s.bus.script(['-HATCHEDIT', 'L', 'DR', '']);
    expect(s.order()[0]).toBe(h());
  });

  it('says so when a hatch has no boundary objects to go behind', async () => {
    const s = setup([line(40, 0, 50, 0)]);
    await s.bus.script(['-HATCH', 'W', 'N', '0,0', '10,0', '10,10', '', '']);
    await s.bus.script(['-HATCHEDIT', 'L', 'DR', 'H']);
    expect(s.log).toContain('The hatch has no boundary objects.');
  });

  it('adds areas picked or selected to the hatch (ADd boundaries)', async () => {
    const s = await twoAreas([...square(40, 0, 10), circle(70, 5, 5)]);
    await s.bus.script(['-HATCHEDIT', 'L', 'AD']);
    expect(s.bus.promptText).toBe('Pick internal point or [Select objects]:');
    await s.bus.script(['45,5']);
    expect(s.previews.at(-1)).toHaveLength(1);
    await s.bus.script(['S']);
    expect(s.bus.promptText).toBe('Select objects or [picK internal point]:');
    await s.bus.pick({ x: 75, y: 5 });
    await s.bus.script(['', 'K', '']);
    const g = only(s).geom;
    expect(g.loops).toHaveLength(4);
    expect(g.seedPoints).toEqual([
      { x: 5, y: 5 },
      { x: 25, y: 5 },
      { x: 45, y: 5 },
    ]);
    await s.bus.script(['U']);
    expect(only(s).geom.loops).toHaveLength(2);
    await s.bus.script(['-HATCHEDIT', 'L', 'AD', '']);
    expect(only(s).geom.loops).toHaveLength(2);
  });

  it('takes out the loops the objects selected lie along (Remove boundaries)', async () => {
    const s = setup([...square(0, 0, 30), ...square(10, 10, 10), line(50, 0, 60, 0)]);
    await s.bus.script(['HATCH', '5,5', '']);
    expect(only(s).geom.loops).toHaveLength(2);
    await s.bus.script(['-HATCHEDIT', 'L', 'R']);
    expect(s.bus.promptText).toBe('Select Objects:');
    await s.bus.pick({ x: 55, y: 0 });
    await s.bus.script(['']);
    expect(only(s).geom.loops).toHaveLength(2);
    await s.bus.script(['-HATCHEDIT', 'L', 'R', 'ALL', '']);
    expect(s.log).toContain('A hatch keeps at least one boundary.');
    await s.bus.script(['-HATCHEDIT', 'L', 'R']);
    await s.bus.pick({ x: 15, y: 10 });
    await s.bus.script(['']);
    const g = only(s).geom;
    expect(g.loops).toHaveLength(1);
    expect(g.loops[0]!.flags & 1).toBe(1);
    await s.bus.script(['-HATCHEDIT', 'L', 'R', '']);
    expect(only(s).geom.loops).toHaveLength(1);
  });

  it('keeps each loop as a polyline on the current layer (recreate Boundary)', async () => {
    const s = await twoAreas();
    const polylines = () => [...s.model.entities()].filter((e) => e.geom.kind === 'LWPOLYLINE');
    await s.bus.script(['-HATCHEDIT', 'L', 'B']);
    expect(s.bus.promptText).toBe('Enter type of boundary object [Region/Polyline] <Polyline>:');
    await s.bus.script(['R']);
    expect(s.log).toContain('Triya cannot make regions.');
    expect(polylines()).toHaveLength(0);
    await s.bus.script(['-HATCHEDIT', 'L', 'B', '', 'Y']);
    expect(s.log).toContain('Triya makes non-associative hatches.');
    expect(polylines()).toHaveLength(2);
    expect(polylines().every((p) => p.layer === LAYER_WALLS)).toBe(true);
  });
});

/** An associative hatch of the square 100–103, as a file brings one. */
function associative() {
  const hatch: HatchGeometry = {
    kind: 'HATCH',
    pattern: 'SOLID',
    solid: true,
    associative: true,
    style: 0,
    patternType: 1,
    patternAngle: 0,
    patternScale: 0,
    double: false,
    loops: [
      {
        flags: 1,
        edges: [
          { type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
          { type: 'line', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
          { type: 'line', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
          { type: 'line', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
        ],
        sources: ['100', '101', '102', '103'],
      },
    ],
    patternLines: [],
    seedPoints: [],
  };
  return setup([...square(0, 0, 10), ...square(20, 0, 10), hatch]);
}

describe('-HATCHEDIT on an associative hatch (DEC-015)', () => {
  it('goes behind the objects it names (DRaw order)', async () => {
    const s = associative();
    await s.bus.script(['-HATCHEDIT', 'L', 'DR', 'H']);
    expect(s.order()[0]).toBe('108');
  });

  it('lets go of its boundary (DIsassociate), and before its loops change', async () => {
    let s = associative();
    await s.bus.script(['-HATCHEDIT', 'L', 'DI']);
    expect(only(s).geom.associative).toBe(false);
    expect(only(s).geom.loops[0]!.sources).toBeUndefined();
    await s.bus.script(['-HATCHEDIT', 'L', 'DI']);
    expect(only(s).geom.associative).toBe(false);
    s = associative();
    await s.bus.script(['-HATCHEDIT', 'L', 'AD', '25,5', '']);
    expect(only(s).geom.associative).toBe(false);
    expect(only(s).geom.loops).toHaveLength(2);
  });
});
