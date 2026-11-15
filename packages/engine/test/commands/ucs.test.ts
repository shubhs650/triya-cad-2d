// M3-06 part 7: the UCS and UCSICON commands in plan (AutoCAD 2024 Help, "UCS (Command)",
// "UCSICON (Command)") and the UCS's effect on input: coordinates are typed in the current UCS,
// `*` types them in the WCS, angles count from its X axis, ID and DIST report in it, and SETVAR
// reads UCSORG, UCSXDIR, UCSYDIR, UCSNAME (read only, as in AutoCAD) and sets SNAPANG and
// UCSICON in the `*Active` VPORT.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  objectUcs,
  ucsOf,
  type BusEvent,
  type DocumentInit,
  type EntityGeometry,
  type EntityId,
  type HeaderValue,
  type ViewHost,
  type ViewReply,
  type VportRecord,
} from '../../src/index';
import { MODEL_SPACE, PAPER_SPACE, entityInit, sampleInit } from '../model/fixtures';

const VPORT = '29';
const deg = (d: number) => (d * Math.PI) / 180;

function vport(): VportRecord {
  return {
    handle: VPORT,
    name: '*Active',
    center: { x: 0, y: 0 },
    height: 10,
    direction: { x: 0, y: 0, z: 1 },
    target: { x: 0, y: 0, z: 0 },
    lensLength: 50,
    frontClip: 0,
    backClip: 0,
    twist: 0,
    viewMode: 0,
    renderMode: 0,
    lowerLeft: { x: 0, y: 0 },
    upperRight: { x: 1, y: 1 },
    aspectRatio: 1,
    snapBase: { x: 0, y: 0 },
    snapSpacing: { x: 10, y: 10 },
    snapRotation: 0,
    snapOn: false,
    isometricSnap: false,
    isometricPlane: 0,
    gridSpacing: { x: 10, y: 10 },
    gridOn: false,
    gridFlags: 0,
    gridMajor: 5,
    circleZoom: 1000,
    ucsIcon: 1,
    ucs: {
      origin: { x: 0, y: 0, z: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      elevation: 0,
      orthographic: 0,
    },
  } as VportRecord;
}

const extra: [string, EntityGeometry][] = [
  ['30', { kind: 'CIRCLE', center: { x: 50, y: 50 }, radius: 5 }],
  ['31', { kind: 'ARC', center: { x: 0, y: 0 }, radius: 4, startAngle: 0, endAngle: Math.PI / 2 }],
  [
    '32',
    {
      kind: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxis: { x: 3, y: 0 },
      ratio: 0.5,
      startParam: 0,
      endParam: 2 * Math.PI,
    },
  ],
  ['33', { kind: 'RAY', base: { x: 0, y: 0 }, direction: { x: 1, y: 0 } }],
];

function drawing(header: [string, HeaderValue][] = []): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    header: new Map([...(base.header ?? []), ...header]),
    tables: { ...base.tables, vports: [vport()] },
    entities: [...(base.entities ?? []), ...extra.map(([h, g]) => entityInit(h, g))],
  };
}

function setup(header: [string, HeaderValue][] = [], space = MODEL_SPACE) {
  const model = DocumentModel.create(drawing(header));
  let picks: EntityId[] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> =>
      Promise.resolve(r.op === 'pick' ? { ok: true, ids: picks } : { ok: false, message: 'no' }),
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view, space: () => space });
  const events: BusEvent[] = [];
  bus.on((e: BusEvent) => events.push(e));
  const pick = (handle: string) => {
    picks = [model.entityByHandle(handle)!.id];
  };
  const added = () =>
    [...model.entities()].filter((e) => Number.parseInt(e.handle, 16) >= 0x40).map((e) => e.geom);
  const last = () => added().at(-1)!;
  const ucs = (paper = false) => ucsOf(model.header, paper);
  const vp = () => model.tables.vports.get(VPORT)!;
  return { model, bus, events, pick, added, last, ucs, vp };
}

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe('UCS', () => {
  it('asks AutoCAD’s 2D options and sets the origin and X axis, typed input following them', async () => {
    const s = setup();
    await s.bus.submit('UCS');
    expect(s.bus.history.at(-1)).toBe('Current ucs name:  *WORLD*');
    expect(s.bus.promptText).toBe(
      'Specify origin of UCS or [NAmed/OBject/Previous/View/World/Z] <World>:',
    );
    await s.bus.submit('100,50');
    expect(s.bus.promptText).toBe('Specify point on X-axis or <Accept>:');
    await s.bus.submit('100,60');
    expect(s.bus.promptText).toBe('Specify point on the XY plane or <Accept>:');
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    expect(s.ucs()).toEqual({ origin: { x: 100, y: 50 }, angle: Math.PI / 2 });
    expect(s.model.header.get('$UCSORG')).toEqual({ x: 100, y: 50, z: 0 });
    expect(s.model.header.get('$UCSXDIR')).toEqual({ x: 0, y: 1, z: 0 });
    expect(s.model.header.get('$UCSYDIR')).toEqual({ x: -1, y: 0, z: 0 });
    expect(s.model.header.get('$UCSNAME')).toBe('');
    expect(s.vp().ucs).toMatchObject({
      origin: { x: 100, y: 50, z: 0 },
      xAxis: { x: 0, y: 1, z: 0 },
    });

    // A line typed 0,0 to 10,0 runs from the origin along the UCS's X axis (world +Y).
    await s.bus.script(['LINE', '0,0', '10,0', '@0,5', '@5<90', '*0,0', '']);
    const lines = s.added();
    expect(lines).toHaveLength(4);
    close((lines[0] as { start: { x: number; y: number } }).start, { x: 100, y: 50 });
    close((lines[0] as { end: { x: number; y: number } }).end, { x: 100, y: 60 });
    // @0,5 runs along the UCS Y axis (world −X); @5<90 at 90° from the UCS's X axis (world −X).
    close((lines[1] as { end: { x: number; y: number } }).end, { x: 95, y: 60 });
    close((lines[2] as { end: { x: number; y: number } }).end, { x: 90, y: 60 });
    // *0,0 is the world origin.
    close((lines[3] as { end: { x: number; y: number } }).end, { x: 0, y: 0 });
  });

  it('says the UCS is unnamed, World returns to the WCS, and U takes a change back', async () => {
    const s = setup();
    await s.bus.script(['UCS', '5,5', '']);
    expect(s.ucs()).toEqual({ origin: { x: 5, y: 5 }, angle: 0 });
    await s.bus.submit('UCS');
    expect(s.bus.history.at(-1)).toBe('Current ucs name:  *NO NAME*');
    await s.bus.submit('W');
    expect(s.ucs()).toEqual({ origin: { x: 0, y: 0 }, angle: 0 });
    await s.bus.submit('U');
    expect(s.ucs()).toEqual({ origin: { x: 5, y: 5 }, angle: 0 });
    // Enter at the first prompt is World.
    await s.bus.script(['UCS', '']);
    expect(s.ucs().origin).toEqual({ x: 0, y: 0 });
  });

  it('turns about Z, typed angles counting from the new X axis; Previous goes back', async () => {
    const s = setup();
    await s.bus.submit('UCS');
    await s.bus.submit('Z');
    expect(s.bus.promptText).toBe('Specify rotation angle about Z axis <90>:');
    await s.bus.submit('30');
    expect(s.ucs().angle).toBeCloseTo(deg(30), 12);
    await s.bus.script(['UCS', 'Z', '']);
    expect(s.ucs().angle).toBeCloseTo(deg(120), 12);
    // An XLINE at angle 0 runs along the UCS's X axis.
    await s.bus.script(['XLINE', 'A', '0', '0,0', '']);
    const x = s.last() as { direction: { x: number; y: number } };
    close(x.direction, { x: Math.cos(deg(120)), y: Math.sin(deg(120)) });
    await s.bus.script(['UCS', 'P']);
    expect(s.ucs().angle).toBeCloseTo(deg(30), 12);
    await s.bus.script(['UCS', 'P']);
    expect(s.ucs().angle).toBe(0);
    await s.bus.script(['UCS', 'P']);
    expect(s.bus.history.at(-1)).toBe('There is no previous UCS.');
  });

  it('keeps the Z axis up: a point on the XY plane below the X axis is refused', async () => {
    const s = setup();
    await s.bus.script(['UCS', '0,0', '10,0', '5,-5']);
    expect(s.bus.history.at(-1)).toMatch(/positive Y side/);
    expect(s.bus.promptText).toBe('Specify point on the XY plane or <Accept>:');
    await s.bus.submit('5,5');
    expect(s.bus.command).toBeUndefined();
    expect(s.ucs()).toEqual({ origin: { x: 0, y: 0 }, angle: 0 });
    // Accept at the X axis keeps the axes and moves the origin.
    await s.bus.script(['UCS', 'Z', '45']);
    await s.bus.script(['UCS', '*3,4', '']);
    expect(s.ucs().origin).toEqual({ x: 3, y: 4 });
    expect(s.ucs().angle).toBeCloseTo(deg(45), 12);
  });

  it('aligns to an object', async () => {
    const s = setup();
    // The line from 0,0 to 10,0 (handle 20), picked nearer its end: origin there, X back along it.
    s.pick('20');
    await s.bus.script(['UCS', 'OB', '9,0']);
    expect(s.ucs()).toEqual({ origin: { x: 10, y: 0 }, angle: Math.PI });
    s.pick('30');
    await s.bus.script(['UCS', 'OB', '*50,55']);
    expect(s.ucs()).toEqual({ origin: { x: 50, y: 50 }, angle: Math.PI / 2 });
    // An ellipse at its centre along its major axis (M3-06 part 8); a ray aligns nothing.
    s.pick('32');
    await s.bus.script(['UCS', 'OB', '*3,0']);
    expect(s.ucs()).toEqual({ origin: { x: 0, y: 0 }, angle: 0 });
    s.pick('33');
    await s.bus.submit('UCS');
    await s.bus.submit('OB');
    await s.bus.submit('*3,0');
    expect(s.bus.history.at(-1)).toBe('Cannot align UCS to that object.');
    expect(s.bus.promptText).toBe('Select object to align UCS:');
  });

  it('aligns arcs, polylines, points, solids, text and block references by AutoCAD’s rules', () => {
    const pick = { x: 0, y: 4 };
    const arc: EntityGeometry = {
      kind: 'ARC',
      center: { x: 0, y: 0 },
      radius: 4,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    expect(objectUcs(arc, pick)).toEqual({ origin: { x: 0, y: 0 }, angle: Math.PI / 2 });
    expect(
      objectUcs(
        {
          kind: 'LWPOLYLINE',
          closed: false,
          vertices: [
            { x: 1, y: 1, bulge: 0 },
            { x: 1, y: 5, bulge: 0 },
          ],
        },
        pick,
      ),
    ).toEqual({ origin: { x: 1, y: 1 }, angle: Math.PI / 2 });
    expect(objectUcs({ kind: 'POINT', position: { x: 2, y: 3 } }, pick)).toEqual({
      origin: { x: 2, y: 3 },
      angle: 0,
    });
    expect(
      objectUcs(
        {
          kind: 'SOLID',
          corners: [
            { x: 0, y: 0 },
            { x: -1, y: 0 },
            { x: 0, y: 1 },
            { x: -1, y: 1 },
          ],
        },
        pick,
      ),
    ).toEqual({ origin: { x: 0, y: 0 }, angle: Math.PI });
    const insert = {
      kind: 'INSERT',
      block: '1F',
      position: { x: 7, y: 8 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: deg(45),
    } as EntityGeometry;
    expect(objectUcs(insert, pick)).toEqual({ origin: { x: 7, y: 8 }, angle: deg(45) });
    expect(
      objectUcs({ kind: 'RAY', base: { x: 0, y: 0 }, direction: { x: 1, y: 0 } }, pick),
    ).toBeUndefined();
  });

  it('saves, restores, lists and deletes named UCSs in the UCS table', async () => {
    const s = setup();
    await s.bus.script(['UCS', '10,0', '10,10', '']);
    await s.bus.script(['UCS', 'NA', 'S', 'Rotated']);
    const saved = [...s.model.tables.ucs.values()];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: 'Rotated',
      origin: { x: 10, y: 0, z: 0 },
      xAxis: { x: 0, y: 1, z: 0 },
      yAxis: { x: -1, y: 0, z: 0 },
    });
    expect(s.model.header.get('$UCSNAME')).toBe('Rotated');
    await s.bus.script(['UCS', 'W']);
    expect(s.model.header.get('$UCSNAME')).toBe('');
    await s.bus.script(['UCS', 'NA', 'R', 'rotated']);
    expect(s.ucs()).toEqual({ origin: { x: 10, y: 0 }, angle: Math.PI / 2 });
    expect(s.model.header.get('$UCSNAME')).toBe('Rotated');
    await s.bus.submit('UCS');
    expect(s.bus.history.at(-1)).toBe('Current ucs name:  Rotated');
    await s.bus.cancel();

    await s.bus.script(['UCS', 'NA', 'R', 'Nothing']);
    expect(s.bus.history.at(-1)).toBe('Cannot find UCS named "Nothing".');
    await s.bus.cancel();

    await s.bus.script(['UCS', 'NA', '?', '']);
    expect(s.bus.history.slice(-4)).toEqual([
      'Saved coordinate systems:',
      'Rotated',
      '  Origin = <10.0000,0.0000,0.0000>, X Axis = <0.0000,1.0000,0.0000>',
      '  Y Axis = <-1.0000,0.0000,0.0000>',
    ]);

    // Saving under a name that exists asks before replacing it.
    await s.bus.script(['UCS', 'W']);
    await s.bus.script(['UCS', 'NA', 'S', 'ROTATED']);
    expect(s.bus.promptText).toBe('UCS "Rotated" already exists. Replace it? [Yes/No] <No>:');
    await s.bus.submit('Y');
    expect([...s.model.tables.ucs.values()][0]).toMatchObject({
      name: 'Rotated',
      origin: { x: 0, y: 0, z: 0 },
    });

    await s.bus.script(['UCS', 'NA', 'D', 'rot*']);
    expect(s.model.tables.ucs.size).toBe(0);
    // The current UCS keeps its axes, unnamed.
    expect(s.model.header.get('$UCSNAME')).toBe('');
    await s.bus.script(['UCS', 'NA', 'S', '*bad']);
    expect(s.bus.history.at(-1)).toBe('Invalid UCS name.');
  });

  it('keeps paper space’s UCS in the $PUCS variables', async () => {
    const s = setup([], PAPER_SPACE);
    await s.bus.script(['UCS', '1,2', '']);
    expect(s.ucs(true)).toEqual({ origin: { x: 1, y: 2 }, angle: 0 });
    expect(s.ucs()).toEqual({ origin: { x: 0, y: 0 }, angle: 0 });
    expect(s.model.header.get('$PUCSORG')).toEqual({ x: 1, y: 2, z: 0 });
    expect(s.vp().ucs.origin).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('reads a UCS that does not lie in the world XY plane as the WCS', async () => {
    const s = setup([
      ['$UCSORG', { x: 5, y: 5, z: 0 }],
      ['$UCSXDIR', { x: 1, y: 0, z: 0 }],
      ['$UCSYDIR', { x: 0, y: 0, z: 1 }],
    ]);
    expect(s.ucs()).toEqual({ origin: { x: 0, y: 0 }, angle: 0 });
    await s.bus.script(['ID', '1,1']);
    expect(s.bus.history.at(-1)).toBe('X = 1.0000     Y = 1.0000     Z = 0.0000');
  });

  it('gives the prompt’s UCS to the front-end with angles counting from its X axis', async () => {
    const s = setup();
    await s.bus.script(['UCS', 'Z', '90']);
    await s.bus.submit('LINE');
    const prompt = s.events.filter((e) => e.type === 'prompt').at(-1);
    expect(prompt).toMatchObject({ ucs: { origin: { x: 0, y: 0 }, angle: Math.PI / 2 } });
    expect(prompt?.type === 'prompt' && prompt.angles.base).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('input in a UCS', () => {
  it('ID and DIST report along the UCS’s axes', async () => {
    const s = setup();
    await s.bus.script(['UCS', '10,10', '10,20', '']);
    await s.bus.script(['ID', '*10,13']);
    expect(s.bus.history.at(-1)).toBe('X = 3.0000     Y = 0.0000     Z = 0.0000');
    await s.bus.script(['DIST', '0,0', '3,4']);
    expect(s.bus.history.slice(-2)).toEqual([
      'Distance = 5.0000,  Angle in XY Plane = 53,  Angle from XY Plane = 0',
      'Delta X = 3.0000,  Delta Y = 4.0000,  Delta Z = 0.0000',
    ]);
  });

  it('turns rotations and included angles by what is typed, not by the UCS', async () => {
    const s = setup();
    await s.bus.script(['UCS', 'Z', '30']);
    // The line 0,0–10,0 (world) rotated 90° about the world origin.
    s.pick('20');
    await s.bus.script(['ROTATE', '*5,0', '', '*0,0', '90']);
    const line = s.model.entityByHandle('20')!.geom as {
      start: { x: number; y: number };
      end: { x: number; y: number };
    };
    close(line.start, { x: 0, y: 0 });
    close(line.end, { x: 0, y: 10 });
  });

  it('takes point filters’ coordinates along the UCS’s axes', async () => {
    const s = setup();
    await s.bus.script(['UCS', 'Z', '90']);
    // .X of UCS 3,0 (world 0,3) with Y of UCS 0,7 (world −7,0): UCS 3,7 is world −7,3.
    await s.bus.script(['ID', '.X', '3,0', '0,7']);
    expect(s.bus.history.at(-1)).toBe('X = 3.0000     Y = 7.0000     Z = 0.0000');
    expect(s.bus.lastPoint).toEqual({ x: -7, y: 3 });
  });
});

describe('UCSICON and the viewport variables', () => {
  it('turns the icon on and off and puts it at the origin', async () => {
    const s = setup();
    await s.bus.submit('UCSICON');
    expect(s.bus.promptText).toBe('Enter an option [ON/OFF/Noorigin/ORigin] <ON>:');
    await s.bus.submit('OR');
    expect(s.vp().ucsIcon).toBe(3);
    await s.bus.script(['UCSICON', 'OFF']);
    expect(s.vp().ucsIcon).toBe(2);
    await s.bus.script(['UCSICON', 'N']);
    expect(s.vp().ucsIcon).toBe(0);
    await s.bus.script(['UCSICON', 'ON']);
    expect(s.vp().ucsIcon).toBe(1);
    await s.bus.submit('U');
    expect(s.vp().ucsIcon).toBe(0);
  });

  it('sets SNAPANG and UCSICON through SETVAR and shows the UCS variables read only', async () => {
    const s = setup();
    await s.bus.script(['SETVAR', 'SNAPANG', '30']);
    expect(s.vp().snapRotation).toBeCloseTo(deg(30), 12);
    await s.bus.script(['SNAPANG', '']);
    expect(s.bus.history.at(-1)).toBe('Enter new value for SNAPANG <30>:');
    await s.bus.script(['SETVAR', 'UCSICON', '2']);
    expect(s.vp().ucsIcon).toBe(2);
    await s.bus.script(['SETVAR', 'UCSICON', '4']);
    expect(s.vp().ucsIcon).toBe(2);
    await s.bus.cancel();
    await s.bus.script(['UCS', '1,2', '']);
    await s.bus.script(['SETVAR', 'UCSORG']);
    expect(s.bus.history.at(-1)).toMatch(/^UCSORG = 1\.0000,2\.0000,0\.0000 \(read only\)$/);
  });
});

describe('the UCS, part 8', () => {
  it('measures picked rotation angles from the UCS’s X axis, as typed ones turn', async () => {
    const s = setup();
    await s.bus.script(['UCS', 'Z', '30']);
    expect(s.bus.prompt).toBeUndefined();
    // The line 0,0–10,0 (world) rotated about the world origin by a point picked at world
    // 120°: 90° from the UCS's X axis, so a quarter turn.
    s.pick('20');
    await s.bus.script(['ROTATE', '*5,0', '', '*0,0']);
    expect(s.bus.prompt).toMatchObject({
      drag: { kind: 'rotate', reference: expect.closeTo(deg(30), 12) },
    });
    await s.bus.pick({ x: Math.cos(deg(120)), y: Math.sin(deg(120)) });
    const line = s.model.entityByHandle('20')!.geom as {
      end: { x: number; y: number };
    };
    close(line.end, { x: 0, y: 10 });
  });

  it('measures an arc’s picked included angle from the UCS’s X axis, as its sketch does', async () => {
    const s = setup();
    await s.bus.script(['UCS', 'Z', '90']);
    await s.bus.script(['ARC', '*10,0', 'C', '*0,0', 'A']);
    expect(s.bus.prompt).toMatchObject({
      drag: { kind: 'sketch', sketch: { shape: 'arcSC', turn: expect.closeTo(deg(90), 12) } },
    });
    // Picked at world 180°: 90° from the UCS's X axis, a quarter of a circle.
    await s.bus.pick({ x: -5, y: 0 });
    expect(s.last()).toMatchObject({
      kind: 'ARC',
      startAngle: 0,
      endAngle: expect.closeTo(deg(90), 9),
    });
  });

  it('reads surveyor’s bearings from the UCS’s Y axis as north', async () => {
    const s = setup([['$AUNITS', 4]]);
    await s.bus.script(['UCS', 'Z', '90']);
    await s.bus.script(['LINE', '*0,0', '@10<N', '@10<N90dE', '']);
    const [a, b] = s.added() as { end: { x: number; y: number } }[];
    // UCS north is world −X; east, the UCS's X axis, world +Y.
    close(a!.end, { x: -10, y: 0 });
    close(b!.end, { x: -10, y: 10 });
  });

  it('aligns to dimensions, ellipses and hatches', () => {
    const pick = { x: 9, y: 1 };
    const dim = {
      kind: 'DIMENSION',
      dimType: 'linear',
      definitionPoint: { x: 0, y: 5 },
      textPosition: { x: 5, y: 6 },
      horizontalDirection: -deg(30),
      first: { x: 0, y: 0 },
      second: { x: 10, y: 0 },
    } as EntityGeometry;
    // The text's middle; X as the UCS's when it was drawn (DXF 51 is minus its angle).
    expect(objectUcs(dim, pick)).toEqual({
      origin: { x: 5, y: 6 },
      angle: expect.closeTo(deg(30), 12),
    });
    const ellipse = extra[2]![1];
    expect(objectUcs({ ...ellipse, majorAxis: { x: 0, y: 3 } } as EntityGeometry, pick)).toEqual({
      origin: { x: 0, y: 0 },
      angle: deg(90),
    });
    const hatch = {
      kind: 'HATCH',
      loops: [
        {
          flags: 1,
          polyline: {
            closed: true,
            vertices: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        },
      ],
    } as unknown as EntityGeometry;
    // The boundary's corner nearest the pick, X along the edge on from it.
    expect(objectUcs(hatch, pick)).toEqual({ origin: { x: 10, y: 0 }, angle: deg(90) });
  });
});
