// M3-07 part 1: ID, DIST, AREA and MEASUREGEOM (Distance, Radius, Angle, ARea, Volume) on the
// PromptBus, with AutoCAD 2024's prompts and the lines they report (AutoCAD 2024 Help, "ID
// (Command)", "DIST (Command)", "AREA (Command)", "MEASUREGEOM (Command)"), in the drawing's
// units (LUNITS/LUPREC, AUNITS/AUPREC), and the AREA, PERIMETER and DISTANCE variables they set.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  enclosedSpace,
  toleranceForSize,
  type BusEvent,
  type DocumentInit,
  type EntityGeometry,
  type EntityId,
  type HeaderValue,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { SpatialIndex } from '../../src/spatial/index';
import { MODEL_SPACE, entityInit, sampleInit } from '../model/fixtures';

/**
 * A canvas whose picks take `picked()`, and which finds the space a Quick click is in as the
 * app's renderer does (`enclosedSpace` over the drawing's spatial index).
 */
function host(picked: () => EntityId[], model?: () => DocumentModel): ViewHost {
  return {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') return Promise.resolve({ ok: true, ids: picked() });
      if (r.op === 'enclosed' && model) {
        const m = model();
        const tol = toleranceForSize(100);
        const src = { model: m, index: SpatialIndex.build(m, { tol }), block: MODEL_SPACE, tol };
        const view = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
        const enclosed = enclosedSpace(src, r.point, view);
        return Promise.resolve({ ok: true, ...(enclosed && { enclosed }) });
      }
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
}

const square: EntityGeometry = {
  kind: 'LWPOLYLINE',
  closed: true,
  vertices: [
    { x: 0, y: 0, bulge: 0 },
    { x: 10, y: 0, bulge: 0 },
    { x: 10, y: 10, bulge: 0 },
    { x: 0, y: 10, bulge: 0 },
  ],
};

/** The sample drawing with more objects: 30 a square 10×10, 31 an arc, 32 an ellipse, … */
function drawing(header: [string, HeaderValue][] = []): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    header: new Map([...(base.header ?? []), ...header]),
    entities: [
      ...(base.entities ?? []),
      entityInit('30', square),
      entityInit('31', {
        kind: 'ARC',
        center: { x: 0, y: 0 },
        radius: 4,
        startAngle: 0,
        endAngle: Math.PI / 2,
      }),
      entityInit('32', {
        kind: 'ELLIPSE',
        center: { x: 0, y: 0 },
        majorAxis: { x: 3, y: 0 },
        ratio: 0.5,
        startParam: 0,
        endParam: 2 * Math.PI,
      }),
      // An open polyline: three sides of the square, its last bulge ignored by the closing chord.
      entityInit('33', {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 10, y: 0, bulge: 0 },
          { x: 10, y: 10, bulge: 0 },
          { x: 0, y: 10, bulge: 1 },
        ],
      }),
      // A slot: two half circles of radius 1 joined by lines 4 long.
      entityInit('34', {
        kind: 'LWPOLYLINE',
        closed: true,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 4, y: 0, bulge: 1 },
          { x: 4, y: 2, bulge: 0 },
          { x: 0, y: 2, bulge: 1 },
        ],
      }),
      // A closed cubic spline: a rounded square through a periodic-looking control polygon.
      entityInit('35', {
        kind: 'SPLINE',
        degree: 1,
        knots: [0, 0, 1, 2, 3, 4, 4],
        controlPoints: [
          { x: 0, y: 0 },
          { x: 6, y: 0 },
          { x: 6, y: 3 },
          { x: 0, y: 3 },
          { x: 0, y: 0 },
        ],
        closed: true,
        periodic: false,
      }),
      entityInit('36', {
        kind: 'POLYLINE',
        closed: true,
        is3d: false,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 2, y: 0, bulge: 0 },
          { x: 0, y: 2, bulge: 0 },
        ],
      }),
    ],
  };
}

function setup(header: [string, HeaderValue][] = []) {
  const model = DocumentModel.create(drawing(header));
  let picks: EntityId[] = [];
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: host(
      () => picks,
      () => model,
    ),
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const pick = (handle: string) => {
    picks = [model.entityByHandle(handle)!.id];
  };
  /** The value SETVAR reports for a variable. */
  const variable = async (name: string): Promise<string> => {
    await bus.script(['SETVAR', name]);
    const line = bus.history.at(-1)!;
    if (bus.command) await bus.cancel();
    return line;
  };
  return { model, bus, log, pick, variable };
}

describe('ID', () => {
  it('reports the point given, and it becomes the last point', async () => {
    const s = setup();
    await s.bus.script(['ID', '3,4']);
    expect(s.bus.command).toBeUndefined();
    expect(s.bus.history.slice(-2)).toEqual([
      'Specify point: 3,4',
      'X = 3.0000     Y = 4.0000     Z = 0.0000',
    ]);
    // @ is relative to LASTPOINT, which ID sets.
    await s.bus.script(['ID', '@1,1']);
    expect(s.log.at(-1)).toBe('X = 4.0000     Y = 5.0000     Z = 0.0000');
  });

  it('shows the coordinates in the drawing units', async () => {
    const s = setup([
      ['$LUNITS', 4],
      ['$LUPREC', 4],
    ]);
    await s.bus.script(['ID', '18,30']);
    expect(s.log.at(-1)).toBe(`X = 1'-6"     Y = 2'-6"     Z = 0'-0"`);
  });
});

describe('DIST', () => {
  it('reports the distance, angles and deltas between two points', async () => {
    const s = setup();
    await s.bus.script(['DI', '0,0']);
    expect(s.bus.promptText).toBe('Specify second point or [Multiple points]:');
    await s.bus.script(['10,10']);
    expect(s.bus.command).toBeUndefined();
    expect(s.log.slice(-2)).toEqual([
      'Distance = 14.1421,  Angle in XY Plane = 45,  Angle from XY Plane = 0',
      'Delta X = 10.0000,  Delta Y = 10.0000,  Delta Z = 0.0000',
    ]);
    expect(await s.variable('DISTANCE')).toBe('DISTANCE = 14.1421 (read only)');
  });

  it('writes lengths and angles in the drawing units', async () => {
    const s = setup([
      ['$LUNITS', 4],
      ['$LUPREC', 3],
      ['$AUNITS', 1],
      ['$AUPREC', 2],
    ]);
    await s.bus.script(['DIST', '0,0', '-12,-6.5']);
    expect(s.log.slice(-2)).toEqual([
      `Distance = 1'-1 5/8",  Angle in XY Plane = 208d27',  Angle from XY Plane = 0d0'`,
      `Delta X = -1'-0",  Delta Y = -0'-6 1/2",  Delta Z = 0'-0"`,
    ]);
  });

  it('adds up several segments with Multiple points, Length and Undo', async () => {
    const s = setup();
    await s.bus.script(['DIST', '0,0', 'M']);
    expect(s.bus.promptText).toBe('Specify next point or [Arc/Length/Undo]:');
    await s.bus.script(['3,4']);
    expect(s.log.at(-1)).toBe('Distance = 5.0000');
    expect(s.bus.promptText).toBe('Specify next point or [Arc/Length/Undo/Total] <Total>:');
    // Length goes on in the last segment's direction.
    await s.bus.script(['L', '10']);
    expect(s.log.at(-1)).toBe('Distance = 15.0000');
    await s.bus.script(['20,20', 'U']);
    expect(s.log.at(-1)).toBe('Distance = 15.0000');
    await s.bus.script(['']);
    expect(s.bus.command).toBeUndefined();
    expect(s.log.at(-1)).toBe('Distance = 15.0000');
    expect(await s.variable('DISTANCE')).toBe('DISTANCE = 15.0000 (read only)');
  });
});

describe('Arc option of the next-point prompts', () => {
  it('adds arc segments to DIST, tangent to the path, and goes back to lines', async () => {
    const s = setup();
    await s.bus.script(['DIST', '0,0', 'M', '10,0', 'A']);
    expect(s.bus.promptText).toBe(
      'Specify endpoint of arc or [Angle/CEnter/CLose/Direction/Line/Radius/Second pt/Undo/Total] <Total>:',
    );
    // On east from (10,0) to (10,10): a half circle of radius 5.
    await s.bus.script(['10,10']);
    expect(s.log.at(-1)).toBe(`Distance = ${(10 + 5 * Math.PI).toFixed(4)}`);
    // Line, then Length on along the arc's end tangent (west).
    await s.bus.script(['L']);
    expect(s.bus.promptText).toBe('Specify next point or [Arc/Length/Undo/Total] <Total>:');
    await s.bus.script(['L', '3']);
    expect(s.log.at(-1)).toBe(`Distance = ${(13 + 5 * Math.PI).toFixed(4)}`);
    // Undo takes the last segment off, whichever kind it is.
    await s.bus.script(['U', 'U']);
    expect(s.log.at(-1)).toBe('Distance = 10.0000');
    await s.bus.script(['A', 'S', '15,5', '10,10', '']);
    expect(s.bus.command).toBeUndefined();
    expect(s.log.at(-1)).toBe(`Distance = ${(10 + 5 * Math.PI).toFixed(4)}`);
    expect(await s.variable('DISTANCE')).toBe(
      `DISTANCE = ${(10 + 5 * Math.PI).toFixed(4)} (read only)`,
    );
  });

  it('measures an area bounded by arcs, closed by a line or by CLose', async () => {
    const s = setup();
    // A 10×10 square with its right side bulged out into a half circle.
    await s.bus.script(['AREA', '0,0', '10,0', 'A']);
    expect(s.bus.promptText).toBe(
      'Specify endpoint of arc or [Angle/CEnter/CLose/Direction/Line/Radius/Second pt/Undo]:',
    );
    await s.bus.script(['10,10']);
    // An arc and the closing chord enclose an area already.
    expect(s.bus.promptText).toBe(
      'Specify endpoint of arc or [Angle/CEnter/CLose/Direction/Line/Radius/Second pt/Undo/Total] <Total>:',
    );
    await s.bus.script(['L', '0,10', '']);
    expect(s.log.at(-1)).toBe(
      `Area = ${(100 + 12.5 * Math.PI).toFixed(4)}, Perimeter = ${(30 + 5 * Math.PI).toFixed(4)}`,
    );
    // CLose: an arc from the last point back to the first, tangent to the last segment. From
    // (10,10) heading north to (0,0): 270° about (0,10), radius 10.
    await s.bus.script(['AREA', '0,0', '10,0', '10,10', 'A', 'CL']);
    expect(s.bus.command).toBeUndefined();
    const segment = 50 * (1.5 * Math.PI + 1);
    expect(s.log.at(-1)).toBe(
      `Area = ${(50 + segment).toFixed(4)}, Perimeter = ${(20 + 15 * Math.PI).toFixed(4)}`,
    );
  });

  it('asks the arc prompts with the Add or Subtract mode in front', async () => {
    const s = setup();
    await s.bus.script(['AREA', 'A', '0,0', '2,0', 'A']);
    expect(s.bus.promptText).toBe(
      '(ADD mode) Specify endpoint of arc or [Angle/CEnter/CLose/Direction/Line/Radius/Second pt/Undo]:',
    );
    await s.bus.script(['R']);
    expect(s.bus.promptText).toBe('(ADD mode) Specify radius of arc:');
    await s.bus.script(['1', '2,2', '']);
    // The triangle (0,0) (2,0) (2,2) with a half disc of radius 1 on its right side.
    const area = (2 + Math.PI / 2).toFixed(4);
    expect(s.log.slice(-2)).toEqual([
      `Area = ${area}, Perimeter = ${(2 + Math.PI + 2 * Math.SQRT2).toFixed(4)}`,
      `Total area = ${area}`,
    ]);
  });
});

describe('AREA', () => {
  it('measures the polygon through the points given, closing it', async () => {
    const s = setup();
    await s.bus.script(['AA']);
    expect(s.bus.promptText).toBe(
      'Specify first corner point or [Object/Add area/Subtract area] <Object>:',
    );
    await s.bus.script(['0,0']);
    expect(s.bus.promptText).toBe('Specify next point or [Arc/Length/Undo]:');
    await s.bus.script(['10,0', '10,5']);
    expect(s.bus.promptText).toBe('Specify next point or [Arc/Length/Undo/Total] <Total>:');
    await s.bus.script(['0,5', '']);
    expect(s.bus.command).toBeUndefined();
    expect(s.log.at(-1)).toBe('Area = 50.0000, Perimeter = 30.0000');
    expect(await s.variable('AREA')).toBe('AREA = 50.0000 (read only)');
    expect(await s.variable('PERIMETER')).toBe('PERIMETER = 30.0000 (read only)');
  });

  it('measures an object picked: Object is the default', async () => {
    const s = setup();
    s.pick('21');
    await s.bus.script(['AREA', '']);
    expect(s.bus.promptText).toBe('Select objects:');
    await s.bus.script(['5,7']);
    expect(s.bus.command).toBeUndefined();
    expect(s.log.at(-1)).toBe('Area = 12.5664, Circumference = 12.5664');
  });

  it.each([
    ['30', 'a closed polyline', 'Area = 100.0000, Perimeter = 40.0000'],
    ['33', 'an open polyline (closed by a straight segment)', 'Area = 100.0000, Length = 30.0000'],
    [
      '34',
      'a polyline with arcs',
      `Area = ${(8 + Math.PI).toFixed(4)}, Perimeter = ${(8 + 2 * Math.PI).toFixed(4)}`,
    ],
    ['32', 'an ellipse', `Area = ${(1.5 * 3 * Math.PI).toFixed(4)}, Perimeter = 14.5327`],
    ['35', 'a spline', 'Area = 18.0000, Perimeter = 18.0000'],
    ['36', 'a heavy polyline', `Area = 2.0000, Perimeter = ${(4 + 2 * Math.SQRT2).toFixed(4)}`],
  ])('measures %s, %s', async (handle, _what, line) => {
    const s = setup();
    s.pick(handle);
    await s.bus.script(['AREA', 'O', '1,1']);
    expect(s.log.at(-1)).toBe(line);
  });

  it('refuses an object without an area and asks again', async () => {
    const s = setup();
    s.pick('20');
    await s.bus.script(['AREA', 'O', '5,0']);
    expect(s.log.at(-1)).toBe('Selected object does not have an area.');
    expect(s.bus.promptText).toBe('Select objects:');
    s.pick('30');
    await s.bus.script(['1,1']);
    expect(s.log.at(-1)).toBe('Area = 100.0000, Perimeter = 40.0000');
  });

  it('keeps a running total in Add and Subtract modes', async () => {
    const s = setup();
    await s.bus.script(['AREA', 'A']);
    expect(s.bus.promptText).toBe('Specify first corner point or [Object/Subtract area/eXit]:');
    s.pick('30');
    await s.bus.script(['O']);
    expect(s.bus.promptText).toBe('(ADD mode) Select objects:');
    await s.bus.script(['1,1']);
    expect(s.log.slice(-2)).toEqual([
      'Area = 100.0000, Perimeter = 40.0000',
      'Total area = 100.0000',
    ]);
    await s.bus.script(['']);
    expect(s.bus.promptText).toBe('Specify first corner point or [Object/Subtract area/eXit]:');
    await s.bus.script(['S', '0,0']);
    expect(s.bus.promptText).toBe('(SUBTRACT mode) Specify next point or [Arc/Length/Undo]:');
    await s.bus.script(['2,0', '2,2', '0,2', '']);
    expect(s.log.slice(-2)).toEqual(['Area = 4.0000, Perimeter = 8.0000', 'Total area = 96.0000']);
    expect(s.bus.promptText).toBe('Specify first corner point or [Object/Add area/eXit]:');
    await s.bus.script(['X']);
    expect(s.bus.command).toBeUndefined();
    expect(await s.variable('AREA')).toBe('AREA = 96.0000 (read only)');
  });

  it('writes areas of feet-and-inch drawings in square inches and feet', async () => {
    const s = setup([['$LUNITS', 4]]);
    await s.bus.script(['AREA', '0,0', '24,0', '24,12', '0,12', '']);
    expect(s.log.at(-1)).toBe(`Area = 288.0000 square in. (2.0000 square ft.), Perimeter = 6'-0"`);
  });
});

describe('MEASUREGEOM', () => {
  it('measures a distance and asks for the next option, eXit by default', async () => {
    const s = setup();
    await s.bus.script(['MEA']);
    // Quick first (Mode's default).
    expect(s.bus.promptText).toBe(
      'Move cursor or [Distance/Radius/Angle/ARea/Volume/Quick/Mode/eXit] <eXit>:',
    );
    await s.bus.script(['D', '0,0', '3,4']);
    expect(s.log.slice(-2)).toEqual([
      'Distance = 5.0000,  Angle in XY Plane = 53,  Angle from XY Plane = 0',
      'Delta X = 3.0000,  Delta Y = 4.0000,  Delta Z = 0.0000',
    ]);
    expect(s.bus.promptText).toBe(
      'Enter an option [Distance/Radius/Angle/ARea/Volume/Quick/Mode/eXit] <eXit>:',
    );
    await s.bus.script(['']);
    expect(s.bus.command).toBeUndefined();
  });

  it('gives the radius and diameter of a circle, an arc or a polyline arc', async () => {
    const s = setup();
    s.pick('21');
    await s.bus.script(['MEASUREGEOM', 'R']);
    expect(s.bus.promptText).toBe('Select arc or circle:');
    await s.bus.script(['5,7']);
    expect(s.log.slice(-2)).toEqual(['Radius = 2.0000', 'Diameter = 4.0000']);
    s.pick('34');
    await s.bus.script(['R', '5,1']);
    expect(s.log.slice(-2)).toEqual(['Radius = 1.0000', 'Diameter = 2.0000']);
    s.pick('20');
    await s.bus.script(['R', '5,0']);
    expect(s.log.at(-1)).toBe('Select an arc or a circle.');
    expect(s.bus.promptText).toBe('Select arc or circle:');
  });

  it("measures an arc's angle, two lines' and three points'", async () => {
    const s = setup();
    s.pick('31');
    await s.bus.script(['MEASUREGEOM', 'A']);
    expect(s.bus.promptText).toBe('Select arc, circle, line, or <Specify vertex>:');
    await s.bus.script(['2.83,2.83']);
    expect(s.log.at(-1)).toBe('Angle = 90°');
    // The two sample lines meet at the origin.
    s.pick('20');
    await s.bus.script(['A', '5,0']);
    expect(s.bus.promptText).toBe('Select second line:');
    s.pick('23');
    await s.bus.script(['0,5']);
    expect(s.log.at(-1)).toBe('Angle = 90°');
    await s.bus.script(['A', '']);
    expect(s.bus.promptText).toBe('Specify angle vertex:');
    await s.bus.script(['0,0', '1,0']);
    expect(s.bus.promptText).toBe('Specify second angle endpoint:');
    await s.bus.script(['-1,1']);
    expect(s.log.at(-1)).toBe('Angle = 135°');
  });

  it('measures the angle at a circle between the point picked on it and another', async () => {
    const s = setup();
    s.pick('21');
    await s.bus.script(['MEASUREGEOM', 'A', '7,5']);
    expect(s.bus.promptText).toBe('Specify second angle endpoint:');
    await s.bus.script(['5,9']);
    expect(s.log.at(-1)).toBe('Angle = 90°');
  });

  it('measures areas with eXit offered, and volumes from an area and a height', async () => {
    const s = setup();
    await s.bus.script(['MEASUREGEOM', 'AR']);
    expect(s.bus.promptText).toBe(
      'Specify first corner point or [Object/Add area/Subtract area/eXit] <Object>:',
    );
    await s.bus.script(['0,0', '4,0', '4,4', '']);
    expect(s.log.at(-1)).toBe('Area = 8.0000, Perimeter = ' + (8 + 4 * Math.SQRT2).toFixed(4));
    expect(s.bus.promptText).toBe(
      'Enter an option [Distance/Radius/Angle/ARea/Volume/Quick/Mode/eXit] <eXit>:',
    );
    s.pick('30');
    await s.bus.script(['V']);
    expect(s.bus.promptText).toBe(
      'Specify first corner point or [Object/Add volume/Subtract volume/eXit] <Object>:',
    );
    await s.bus.script(['O', '1,1']);
    expect(s.bus.promptText).toBe('Specify height:');
    await s.bus.script(['2.5']);
    expect(s.log.at(-1)).toBe('Volume = 250.0000');
    await s.bus.script(['X']);
    expect(s.bus.command).toBeUndefined();
  });

  it('starts in Quick: a click measures the space it is in, Shift-clicks add up', async () => {
    const s = setup();
    await s.bus.script(['MEASUREGEOM']);
    expect(s.bus.prompt).toMatchObject({ kind: 'point', pickbox: true, quick: { loops: [] } });
    // Inside the 10×10 square (30), outside the sample's circle of radius 2 at (5,5) (21) and
    // the other objects drawn over it: the slot (34), the spline (35), the heavy polyline (36).
    await s.bus.pick({ x: 9.5, y: 9.5 });
    const square = s.log.at(-1)!;
    expect(square).toMatch(/^Area = [0-9.]+, Perimeter = [0-9.]+$/);
    expect(s.bus.prompt).toMatchObject({ quick: { loops: expect.any(Array) } });
    const loops = (s.bus.prompt as unknown as { quick: { loops: unknown[] } }).quick.loops;
    expect(loops.length).toBeGreaterThan(0);
    // The circle: a click inside it, then the same with Shift adds nothing new.
    await s.bus.pick({ x: 5, y: 6.5 });
    expect(s.log.at(-1)).toBe(
      `Area = ${(4 * Math.PI).toFixed(4)}, Perimeter = ${(4 * Math.PI).toFixed(4)}`,
    );
    await s.bus.pick({ x: 9.5, y: 9.5 }, { shift: true });
    expect(s.log.at(-1)).toMatch(/^Total area = [0-9.]+, Total perimeter = [0-9.]+$/);
    // Shift on a space already picked takes it away again.
    await s.bus.pick({ x: 9.5, y: 9.5 }, { shift: true });
    expect(s.log.at(-1)).toBe(
      `Area = ${(4 * Math.PI).toFixed(4)}, Perimeter = ${(4 * Math.PI).toFixed(4)}`,
    );
    await s.bus.script(['']);
    expect(s.bus.command).toBeUndefined();
    expect(await s.variable('AREA')).toBe(`AREA = ${(4 * Math.PI).toFixed(4)} (read only)`);
  });

  it('goes from Quick to another option and back, and Enter exits', async () => {
    const s = setup();
    await s.bus.script(['MEASUREGEOM', 'R']);
    expect(s.bus.promptText).toBe('Select arc or circle:');
    s.pick('21');
    await s.bus.script(['7,5', 'Q']);
    expect(s.bus.promptText).toBe(
      'Move cursor or [Distance/Radius/Angle/ARea/Volume/Quick/Mode/eXit] <eXit>:',
    );
    await s.bus.script(['']);
    expect(s.bus.command).toBeUndefined();
  });

  it('starts at the option used last when Mode says so', async () => {
    const s = setup();
    await s.bus.script(['MEASUREGEOM', 'M']);
    expect(s.bus.promptText).toBe('Enter default option [Quick/Last used] <Quick>:');
    await s.bus.script(['L']);
    expect(s.bus.promptText).toBe(
      'Enter an option [Distance/Radius/Angle/ARea/Volume/Quick/Mode/eXit] <eXit>:',
    );
    await s.bus.script(['AR', 'X', '']);
    expect(s.bus.command).toBeUndefined();
    await s.bus.script(['MEASUREGEOM']);
    expect(s.bus.promptText).toBe(
      'Enter an option [Distance/Radius/Angle/ARea/Volume/Quick/Mode] <ARea>:',
    );
    await s.bus.script(['M', 'Q']);
    expect(s.bus.promptText).toBe(
      'Enter an option [Distance/Radius/Angle/ARea/Volume/Quick/Mode/eXit] <eXit>:',
    );
    await s.bus.script(['']);
    await s.bus.script(['MEASUREGEOM']);
    expect(s.bus.promptText).toBe(
      'Move cursor or [Distance/Radius/Angle/ARea/Volume/Quick/Mode/eXit] <eXit>:',
    );
  });
});
