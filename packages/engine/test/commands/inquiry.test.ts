// M3-07 part 1: ID, DIST, AREA and MEASUREGEOM (Distance, Radius, Angle, ARea, Volume) on the
// PromptBus, with AutoCAD 2024's prompts and the lines they report (AutoCAD 2024 Help, "ID
// (Command)", "DIST (Command)", "AREA (Command)", "MEASUREGEOM (Command)"), in the drawing's
// units (LUNITS/LUPREC, AUNITS/AUPREC), and the AREA, PERIMETER and DISTANCE variables they set.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type DocumentInit,
  type EntityGeometry,
  type EntityId,
  type HeaderValue,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { entityInit, sampleInit } from '../model/fixtures';

/** A canvas whose picks take `picked()`. */
function host(picked: () => EntityId[]): ViewHost {
  return {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') return Promise.resolve({ ok: true, ids: picked() });
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
    view: host(() => picks),
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
    expect(s.bus.promptText).toBe('Specify next point or [Length/Undo]:');
    await s.bus.script(['3,4']);
    expect(s.log.at(-1)).toBe('Distance = 5.0000');
    expect(s.bus.promptText).toBe('Specify next point or [Length/Undo/Total] <Total>:');
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

describe('AREA', () => {
  it('measures the polygon through the points given, closing it', async () => {
    const s = setup();
    await s.bus.script(['AA']);
    expect(s.bus.promptText).toBe(
      'Specify first corner point or [Object/Add area/Subtract area] <Object>:',
    );
    await s.bus.script(['0,0']);
    expect(s.bus.promptText).toBe('Specify next point or [Length/Undo]:');
    await s.bus.script(['10,0', '10,5']);
    expect(s.bus.promptText).toBe('Specify next point or [Length/Undo/Total] <Total>:');
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
    expect(s.bus.promptText).toBe('(SUBTRACT mode) Specify next point or [Length/Undo]:');
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
    expect(s.bus.promptText).toBe(
      'Enter an option [Distance/Radius/Angle/ARea/Volume] <Distance>:',
    );
    await s.bus.script(['', '0,0', '3,4']);
    expect(s.log.slice(-2)).toEqual([
      'Distance = 5.0000,  Angle in XY Plane = 53,  Angle from XY Plane = 0',
      'Delta X = 3.0000,  Delta Y = 4.0000,  Delta Z = 0.0000',
    ]);
    expect(s.bus.promptText).toBe(
      'Enter an option [Distance/Radius/Angle/ARea/Volume/eXit] <eXit>:',
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
      'Enter an option [Distance/Radius/Angle/ARea/Volume/eXit] <eXit>:',
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
});
