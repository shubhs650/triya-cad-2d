// M3-02 part 5: PEDIT on the PromptBus, driven as the command line and the canvas drive it,
// with AutoCAD 2024's prompts (AutoCAD Help, "PEDIT (Command)", "2D Polyline Selection
// (PEDIT)"). The geometry is test/edit/pedit.test.ts's.
import { describe, expect, it } from 'vitest';
import type { EntityGeometry, LwPolylineGeometry, PolylineGeometry } from '../../src/index';
import { r6, setup } from './edit-harness';

const lw = (pts: [number, number][], closed = false): LwPolylineGeometry => ({
  kind: 'LWPOLYLINE',
  vertices: pts.map(([x, y]) => ({ x, y, bulge: 0 })),
  closed,
});
const xy = (g: EntityGeometry) => (g as LwPolylineGeometry).vertices.map((v) => [r6(v.x), r6(v.y)]);
const OPTIONS =
  'Enter an option [Close/Join/Width/Edit vertex/Fit/Spline/Decurve/Ltype gen/Reverse/Undo]:';

describe('PEDIT', () => {
  it('closes, widens, reverses and undoes one polyline option by option', async () => {
    const { bus, byHandle, log } = setup([
      lw([
        [0, 10],
        [10, 10],
        [10, 20],
      ]),
    ]);
    await bus.script(['PE']);
    expect(bus.promptText).toBe('Select polyline or [Multiple]:');
    await bus.pick({ x: 5, y: 10 });
    expect(bus.promptText).toBe(OPTIONS);
    await bus.script(['C']);
    expect(bus.promptText).toBe(
      'Enter an option [Open/Join/Width/Edit vertex/Fit/Spline/Decurve/Ltype gen/Reverse/Undo]:',
    );
    expect((byHandle('40')!.geom as LwPolylineGeometry).closed).toBe(true);
    await bus.script(['W']);
    expect(bus.promptText).toBe('Specify new width for all segments:');
    await bus.script(['0.5']);
    expect((byHandle('40')!.geom as LwPolylineGeometry).constantWidth).toBe(0.5);
    await bus.script(['R']);
    expect(xy(byHandle('40')!.geom)).toEqual([
      [10, 20],
      [10, 10],
      [0, 10],
    ]);
    await bus.script(['L']);
    expect(bus.promptText).toBe('Enter polyline linetype generation option [ON/OFF] <Off>:');
    await bus.script(['ON']);
    expect((byHandle('40')!.geom as LwPolylineGeometry).plinegen).toBe(true);
    // Undo takes the options back one at a time, then says there is nothing left.
    await bus.script(['U', 'U', 'U']);
    expect(byHandle('40')!.geom).toMatchObject({ closed: true });
    expect((byHandle('40')!.geom as LwPolylineGeometry).constantWidth).toBeUndefined();
    await bus.script(['U', 'U']);
    expect(log).toContain('All PEDIT operations have been undone.');
    expect(byHandle('40')!.geom).toEqual(
      lw([
        [0, 10],
        [10, 10],
        [10, 20],
      ]),
    );
    await bus.script(['']);
    expect(bus.command).toBeUndefined();
  });

  it('turns a line into a polyline and joins what touches its ends', async () => {
    const { bus, log, space, kinds } = setup([
      { kind: 'ARC', center: { x: 10, y: 5 }, radius: 5, startAngle: -Math.PI / 2, endAngle: 0 },
    ]);
    await bus.script(['PEDIT']);
    await bus.pick({ x: 5, y: 0 });
    expect(log).toContain('Object selected is not a polyline');
    expect(bus.promptText).toBe('Do you want to turn it into one? [Yes/No] <Y>:');
    await bus.script(['']);
    expect(kinds()).not.toContain('LINE');
    expect(bus.promptText).toBe(OPTIONS);
    await bus.script(['J']);
    expect(bus.promptText).toBe('Select objects:');
    await bus.pick({ x: 15, y: 5 });
    await bus.script(['', '']);
    expect(log).toContain('1 segments added to polyline');
    const polys = space().filter((e) => e.geom.kind === 'LWPOLYLINE');
    expect(polys).toHaveLength(1);
    expect(xy(polys[0]!.geom)).toEqual([
      [0, 0],
      [10, 0],
      [15, 5],
    ]);
    expect(kinds()).not.toContain('ARC');
  });

  it('says No leaves a line alone and asks again; a circle cannot be turned', async () => {
    const { bus, kinds, log } = setup();
    await bus.script(['PEDIT']);
    await bus.pick({ x: 5, y: 0 });
    await bus.script(['N']);
    expect(bus.promptText).toBe('Select polyline or [Multiple]:');
    await bus.pick({ x: 55, y: 0 });
    expect(log.filter((l) => l === 'Object selected is not a polyline')).toHaveLength(2);
    expect(bus.promptText).toBe('Select polyline or [Multiple]:');
    expect(kinds()).toContain('LINE');
  });

  it('fits, splines and decurves, making the polyline heavyweight', async () => {
    const { bus, space } = setup([
      lw([
        [0, 10],
        [10, 20],
        [20, 10],
        [30, 20],
      ]),
    ]);
    const poly = () =>
      space().find((e) => e.geom.kind === 'POLYLINE' || e.geom.kind === 'LWPOLYLINE')!;
    await bus.script(['PEDIT']);
    await bus.pick({ x: 0, y: 10 });
    await bus.script(['F']);
    let g = poly().geom as PolylineGeometry;
    expect(g.kind).toBe('POLYLINE');
    expect(g.fit).toBe('curve');
    expect(g.vertices).toHaveLength(7);
    await bus.script(['S']);
    g = poly().geom as PolylineGeometry;
    expect(g.fit).toBe('cubic');
    expect(g.frame).toHaveLength(4);
    expect(g.vertices).toHaveLength(25);
    await bus.script(['D']);
    g = poly().geom as PolylineGeometry;
    expect(g.fit).toBeUndefined();
    expect(xy(g)).toEqual([
      [0, 10],
      [10, 20],
      [20, 10],
      [30, 20],
    ]);
    await bus.script(['']);
  });

  it('reads SPLINETYPE and SPLINESEGS from the drawing', async () => {
    const s = setup([
      lw([
        [0, 10],
        [10, 20],
        [20, 10],
      ]),
    ]);
    s.model.apply({
      header: [
        { name: '$SPLINETYPE', before: undefined, after: 5 },
        { name: '$SPLINESEGS', before: undefined, after: 2 },
      ],
    } as never);
    await s.bus.script(['PEDIT']);
    await s.bus.pick({ x: 0, y: 10 });
    await s.bus.script(['S', '']);
    const g = s.space().find((e) => e.geom.kind === 'POLYLINE')!.geom as PolylineGeometry;
    expect(g.fit).toBe('quadratic');
    expect(g.vertices).toHaveLength(5);
  });
});

describe('PEDIT Edit vertex', () => {
  it('walks the marker, moves, inserts, widens and straightens', async () => {
    const { bus, byHandle } = setup([
      {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 0, y: 10, bulge: 0.5 },
          { x: 10, y: 10, bulge: 0 },
          { x: 20, y: 10, bulge: 0 },
          { x: 30, y: 10, bulge: 0 },
        ],
      },
    ]);
    const g = () => byHandle('40')!.geom as LwPolylineGeometry;
    await bus.script(['PEDIT']);
    await bus.pick({ x: 20, y: 10 });
    await bus.script(['E']);
    expect(bus.promptText).toBe(
      'Enter a vertex editing option [Next/Previous/Break/Insert/Move/Regen/Straighten/Tangent/Width/eXit] <N>:',
    );
    // Enter is Next; Previous at the first vertex stays there.
    await bus.script(['', 'P', 'P', 'N']);
    await bus.script(['M']);
    expect(bus.promptText).toBe('Specify new location for marked vertex:');
    await bus.script(['10,12']);
    expect(xy(g())[1]).toEqual([10, 12]);
    await bus.script(['I']);
    expect(bus.promptText).toBe('Specify location for new vertex:');
    await bus.script(['15,12']);
    expect(xy(g())).toHaveLength(5);
    expect(xy(g())[2]).toEqual([15, 12]);
    await bus.script(['W']);
    expect(bus.promptText).toBe('Specify starting width for next segment <0.0000>:');
    await bus.script(['1']);
    expect(bus.promptText).toBe('Specify ending width for next segment <1.0000>:');
    await bus.script(['2']);
    expect(g().vertices[1]).toMatchObject({ startWidth: 1, endWidth: 2 });
    // Back to the first vertex and straighten its arc segment.
    await bus.script(['P', 'S']);
    expect(bus.promptText).toBe('Enter an option [Next/Previous/Go/eXit] <N>:');
    await bus.script(['G']);
    expect(g().vertices[0]!.bulge).toBe(0);
    await bus.script(['X', '']);
    expect(bus.command).toBeUndefined();
  });

  it('breaks an open polyline in two between marked vertices', async () => {
    const { bus, space } = setup([
      lw([
        [0, 10],
        [10, 10],
        [20, 10],
        [30, 10],
      ]),
    ]);
    await bus.script(['PEDIT']);
    await bus.pick({ x: 30, y: 10 });
    await bus.script(['E', 'N', 'B', 'N', 'G']);
    const polys = space().filter((e) => e.geom.kind === 'LWPOLYLINE');
    expect(polys.map((p) => xy(p.geom))).toEqual([
      [
        [0, 10],
        [10, 10],
      ],
      [
        [20, 10],
        [30, 10],
      ],
    ]);
    // At an end with one vertex there is nothing to break.
    await bus.script(['B', 'G']);
    expect(bus.promptText).toContain('Enter a vertex editing option');
    await bus.script(['X', 'U', '']);
    expect(space().filter((e) => e.geom.kind === 'LWPOLYLINE')).toHaveLength(1);
  });

  it('uses a tangent given to a vertex when fitting', async () => {
    const a = setup([
      lw([
        [0, 10],
        [10, 10],
      ]),
    ]);
    await a.bus.script(['PEDIT']);
    await a.bus.pick({ x: 5, y: 10 });
    await a.bus.script(['E', 'T']);
    expect(a.bus.promptText).toBe('Specify direction of vertex tangent:');
    await a.bus.script(['90', 'X', 'F', '']);
    const g = a.space().find((e) => e.geom.kind === 'POLYLINE')!.geom as PolylineGeometry;
    expect(g.vertices[0]!.bulge).toBeLessThan(0);
  });

  // M3-16 part 2: the tangent is the vertex's own (VERTEX flag 2, DXF 50), so it is saved and
  // a later PEDIT's Fit uses it too. An LWPOLYLINE has nowhere to keep one, so the polyline
  // becomes a heavyweight 2D one, as Fit makes it.
  it('stores a vertex tangent on the polyline, for Fit now and later, and Undo takes it back', async () => {
    const { bus, space, byHandle, log } = setup([
      lw([
        [0, 10],
        [10, 10],
        [20, 10],
      ]),
    ]);
    const poly = () => space().find((e) => e.geom.kind.endsWith('POLYLINE'))!;
    await bus.script(['PEDIT']);
    await bus.pick({ x: 5, y: 10 });
    await bus.script(['E', 'N', 'T', '45']);
    const g = poly().geom as PolylineGeometry;
    expect(g).toMatchObject({ kind: 'POLYLINE', is3d: false });
    expect(g.vertices.map((v) => v.tangent)).toEqual([undefined, Math.PI / 4, undefined]);
    expect(g.fit).toBeUndefined();
    // Moving along keeps the tangent; Width keeps it too.
    await bus.script(['P', 'N', 'W', '1', '1', 'X']);
    expect((poly().geom as PolylineGeometry).vertices[1]!.tangent).toBe(Math.PI / 4);
    await bus.script(['F']);
    const fit = poly().geom as PolylineGeometry;
    expect(fit.fit).toBe('curve');
    // The original vertex keeps its tangent beside the extra vertices Fit adds.
    expect(fit.vertices[2]).toMatchObject({ x: 10, y: 10, tangent: Math.PI / 4 });
    // Decurve and Fit again in another PEDIT: the tangent is still there.
    await bus.script(['D', '']);
    expect((poly().geom as PolylineGeometry).vertices[1]!.tangent).toBe(Math.PI / 4);
    await bus.script(['PEDIT']);
    await bus.pick({ x: 5, y: 10 });
    await bus.script(['F']);
    expect(poly().geom).toEqual(fit);
    // Reverse turns it round with the polyline.
    await bus.script(['R']);
    const back = (poly().geom as PolylineGeometry).vertices.find((v) => v.tangent !== undefined)!;
    expect(back.tangent).toBeCloseTo((-3 * Math.PI) / 4, 12);
    // Undo takes back this PEDIT's Reverse and Fit, then has nothing left.
    await bus.script(['U', 'U', 'U']);
    expect(log).toContain('All PEDIT operations have been undone.');
    expect(byHandle('40')).toBeUndefined();
    expect((poly().geom as PolylineGeometry).fit).toBeUndefined();
    await bus.script(['']);
    expect(bus.command).toBeUndefined();
  });

  it('undoes a tangent given in Edit vertex step by step, back to the lightweight polyline', async () => {
    const { bus, space } = setup([
      lw([
        [0, 10],
        [10, 10],
      ]),
    ]);
    await bus.script(['PEDIT']);
    await bus.pick({ x: 5, y: 10 });
    await bus.script(['E', 'T', '90', 'T', '0', 'X']);
    const g = space().find((e) => e.geom.kind === 'POLYLINE')!.geom as PolylineGeometry;
    expect(g.vertices[0]!.tangent).toBe(0);
    await bus.script(['U']);
    expect(
      (space().find((e) => e.geom.kind === 'POLYLINE')!.geom as PolylineGeometry).vertices[0]!
        .tangent,
    ).toBe(Math.PI / 2);
    await bus.script(['U', '']);
    expect(space().map((e) => e.geom.kind)).toEqual(['LINE', 'CIRCLE', 'LWPOLYLINE']);
  });
});

// AutoCAD 2024 Help, "3D Polyline Selection (PEDIT)": Edit Vertex offers Next, Previous, Break,
// Insert, Move, Regen, Straighten and eXit. A point picked in Triya's plan view has no height
// (AutoCAD would take the current elevation; DEC-062 never edits a height): Move keeps the
// vertex's, and Insert gives the new vertex the height of the 3D segment under it.
describe('PEDIT Edit vertex on a 3D polyline', () => {
  const p3z: PolylineGeometry = {
    kind: 'POLYLINE',
    is3d: true,
    closed: false,
    vertices: [
      { x: 0, y: 30, bulge: 0, z: 2 },
      { x: 10, y: 30, bulge: 0, z: 6 },
      { x: 20, y: 30, bulge: 0 },
      { x: 30, y: 40, bulge: 0, z: -4 },
    ],
  };

  it('inserts at the segment’s height, moves keeping the height, straightens and breaks', async () => {
    const { bus, byHandle, space } = setup([p3z]);
    const g = () => byHandle('40')!.geom as PolylineGeometry;
    await bus.script(['PEDIT', 'L']);
    await bus.script(['E', 'I', '2.5,31']);
    expect(g().vertices[1]).toEqual({ x: 2.5, y: 31, bulge: 0, z: 3 });
    await bus.script(['N', 'M', '11,35']);
    expect(g().vertices[1]).toEqual({ x: 11, y: 35, bulge: 0, z: 3 });
    // Straighten from the moved vertex to the last: the two between go, heights stay.
    await bus.script(['S', 'N', 'N', 'N', 'G']);
    expect(g().vertices).toEqual([
      { x: 0, y: 30, bulge: 0, z: 2 },
      { x: 11, y: 35, bulge: 0, z: 3 },
      { x: 30, y: 40, bulge: 0, z: -4 },
    ]);
    await bus.script(['B', 'G']);
    const pieces = space().filter((e) => e.geom.kind === 'POLYLINE');
    expect(pieces.map((p) => (p.geom as PolylineGeometry).vertices.map((v) => v.z))).toEqual([
      [2, 3],
      [3, -4],
    ]);
    expect(pieces.every((p) => (p.geom as PolylineGeometry).is3d)).toBe(true);
    await bus.script(['X', 'U', 'U', 'U', 'U', '']);
    expect(byHandle('40')!.geom).toEqual(p3z);
  });

  it('fits a spline through the heights and takes them back with Decurve', async () => {
    const { bus, byHandle } = setup([p3z]);
    const g = () => byHandle('40')!.geom as PolylineGeometry;
    await bus.script(['PEDIT', 'L']);
    await bus.script(['S']);
    expect(g().frame).toEqual(p3z.vertices.map(({ bulge: _b, ...p }) => p));
    // A clamped spline starts and ends at its frame's ends, heights too.
    expect(g().vertices[0]!.z).toBe(2);
    expect(g().vertices.at(-1)!.z).toBe(-4);
    // Edit vertex walks the frame; a frame point inserted takes its segment's height.
    await bus.script(['E', 'I', '5,30', 'X']);
    expect(g().frame![1]).toEqual({ x: 5, y: 30, z: 4 });
    await bus.script(['D']);
    expect(g().vertices.map((v) => v.z)).toEqual([2, 4, 6, undefined, -4]);
    await bus.script(['']);
  });
});

describe('PEDIT Multiple', () => {
  it('converts lines, then joins within the fuzz distance by Jointype', async () => {
    const { bus, log, space } = setup([
      { kind: 'LINE', start: { x: 10, y: 1 }, end: { x: 10, y: 10 } },
      lw([
        [0, 20],
        [5, 20],
      ]),
    ]);
    await bus.script(['PEDIT', 'M', 'W', '-1,-1', '11,21', '']);
    expect(bus.promptText).toBe('Convert Lines, Arcs and Splines to polylines [Yes/No] <Y>:');
    await bus.script(['Y']);
    expect(bus.promptText).toBe(
      'Enter an option [Close/Open/Join/Width/Fit/Spline/Decurve/Ltype gen/Reverse/Undo]:',
    );
    await bus.script(['J']);
    expect(bus.promptText).toBe('Enter fuzz distance or [Jointype] <0.0000>:');
    await bus.script(['J']);
    expect(bus.promptText).toBe('Enter Join Type [Extend/Add/Both] <Extend>:');
    await bus.script(['E', '2']);
    expect(log).toContain('1 segments added to polyline');
    const polys = space().filter((e) => e.geom.kind === 'LWPOLYLINE');
    // Line 30 (0,0)-(10,0) met (10,1)-(10,10): extended to their corner.
    expect(polys.map((p) => xy(p.geom))).toContainEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    await bus.script(['W', '0.25', 'C']);
    expect(
      space()
        .filter((e) => e.geom.kind === 'LWPOLYLINE')
        .every((e) => (e.geom as LwPolylineGeometry).closed),
    ).toBe(true);
    await bus.script(['U', 'U', 'U', '']);
    // The lines stay polylines: turning them was not one of the options.
    expect(space().filter((e) => e.geom.kind === 'LWPOLYLINE')).toHaveLength(3);
  });

  it('turns every polyline chosen into a spline, fit or back', async () => {
    const { bus, space } = setup([
      lw([
        [0, 10],
        [10, 20],
        [20, 10],
      ]),
      lw([
        [0, 30],
        [10, 40],
        [20, 30],
      ]),
    ]);
    await bus.script(['PEDIT', 'M', 'C', '-1,9', '21,41', '', 'S']);
    expect(space().filter((e) => e.geom.kind === 'POLYLINE')).toHaveLength(2);
    await bus.script(['D', 'F', 'R', 'L', 'ON', 'O', '']);
    const fit = space().filter((e) => (e.geom as PolylineGeometry).fit === 'curve');
    expect(fit).toHaveLength(2);
    expect(fit.every((e) => (e.geom as PolylineGeometry).plinegen)).toBe(true);
  });
});

describe('PEDIT edge cases', () => {
  const p3: PolylineGeometry = {
    kind: 'POLYLINE',
    is3d: true,
    closed: false,
    vertices: [
      { x: 0, y: 30, bulge: 0 },
      { x: 10, y: 40, bulge: 0 },
      { x: 20, y: 30, bulge: 0 },
      { x: 30, y: 40, bulge: 0 },
    ],
  };
  const spline: EntityGeometry = {
    kind: 'SPLINE',
    degree: 3,
    knots: [0, 0, 0, 0, 1, 2, 2, 2, 2],
    controlPoints: [
      { x: 0, y: 60 },
      { x: 1, y: 62 },
      { x: 3, y: 62 },
      { x: 4, y: 60 },
      { x: 6, y: 60 },
    ],
    closed: false,
    periodic: false,
  } as EntityGeometry;

  it('offers a 3D polyline its own options and vertex options', async () => {
    const { bus, byHandle } = setup([p3]);
    await bus.script(['PEDIT', 'L']);
    expect(bus.promptText).toBe(
      'Enter an option [Close/Edit vertex/Spline curve/Decurve/Reverse/Undo]:',
    );
    await bus.script(['S']);
    expect(byHandle('40')!.geom).toMatchObject({ fit: 'cubic', is3d: true });
    await bus.script(['D', 'C']);
    expect(bus.promptText).toBe(
      'Enter an option [Open/Edit vertex/Spline curve/Decurve/Reverse/Undo]:',
    );
    await bus.script(['E']);
    expect(bus.promptText).toBe(
      'Enter a vertex editing option [Next/Previous/Break/Insert/Move/Regen/Straighten/eXit] <N>:',
    );
    await bus.script(['R', 'X', 'O', '']);
    expect(byHandle('40')!.geom).toMatchObject({ closed: false, is3d: true });
  });

  it('asks a spline’s precision again until it is 0 to 99', async () => {
    const { bus, log, kinds } = setup([spline]);
    await bus.script(['PEDIT', 'L', 'Y']);
    expect(bus.promptText).toBe('Specify a precision <10>:');
    await bus.script(['100']);
    expect(log).toContain('Requires an integer between 0 and 99.');
    await bus.script(['4', '']);
    expect(kinds()).toContain('LWPOLYLINE');
    expect(kinds()).not.toContain('SPLINE');
  });

  it('adds nothing to a closed polyline and keeps Ltype gen when unchanged', async () => {
    const { bus, byHandle, log } = setup([
      lw(
        [
          [0, 10],
          [10, 10],
          [10, 20],
        ],
        true,
      ),
    ]);
    await bus.script(['PEDIT']);
    await bus.pick({ x: 5, y: 10 });
    await bus.script(['J']);
    await bus.pick({ x: 5, y: 0 });
    await bus.script(['']);
    expect(log).toContain('0 segments added to polyline');
    await bus.script(['L', '', 'L', 'OFF']);
    expect((byHandle('40')!.geom as LwPolylineGeometry).plinegen).toBeUndefined();
    await bus.script(['L', 'ON', 'L', 'OFF']);
    expect((byHandle('40')!.geom as LwPolylineGeometry).plinegen).toBeUndefined();
    await bus.script(['']);
  });

  it('walks Break and Straighten back, regenerates and ignores a spline’s tangent', async () => {
    const { bus, byHandle, log, space } = setup([
      lw([
        [0, 10],
        [10, 10],
        [10, 20],
        [20, 20],
      ]),
    ]);
    await bus.script(['PEDIT']);
    await bus.pick({ x: 5, y: 10 });
    await bus.script(['E', 'B', 'N', 'P', 'X']);
    expect(bus.promptText).toBe(
      'Enter a vertex editing option [Next/Previous/Break/Insert/Move/Regen/Straighten/Tangent/Width/eXit] <N>:',
    );
    // A break between a vertex and itself is no break.
    await bus.script(['B', 'G']);
    expect(log).toContain('*Invalid*');
    // Straighten between neighbours changes nothing.
    await bus.script(['S', 'N', 'G', 'RE', 'X']);
    expect(xy(byHandle('40')!.geom)).toHaveLength(4);
    await bus.script(['S']);
    const splined = space().find((e) => e.geom.kind === 'POLYLINE')!;
    await bus.script(['E', 'T', '45', 'X', 'F', '']);
    // Fit after Spline fits the frame again.
    const fitted = space().find((e) => e.geom.kind === 'POLYLINE')!;
    expect(fitted.geom).toMatchObject({ fit: 'curve' });
    expect(splined.geom).toMatchObject({ fit: 'cubic' });
  });

  it('leaves out what is not converted, and Multiple asks a spline’s precision', async () => {
    const a = setup();
    await a.bus.script(['PEDIT', 'M', 'ALL', '', 'N']);
    expect(a.bus.command).toBeUndefined();
    const b = setup([spline, p3]);
    await b.bus.script(['PEDIT', 'M', 'ALL', '', 'Y']);
    expect(b.bus.promptText).toBe('Specify a precision for spline conversion <10>:');
    await b.bus.script(['4']);
    expect(b.kinds().filter((k) => k === 'LWPOLYLINE')).toHaveLength(2);
    // Width and Ltype gen leave the 3D polyline alone.
    await b.bus.script(['W', '1', 'L', 'ON']);
    expect(b.byHandle('41')!.geom).toEqual(p3);
    await b.bus.script(['L', '', 'O', 'J', 'J', 'B', 'J', '', '', '']);
    expect(b.bus.command).toBeUndefined();
  });
});

describe('PEDIT Undo and Ltype gen in Multiple', () => {
  it('says when nothing is left to undo, keeps the join type on Enter and Ltype gen as it is', async () => {
    const { bus, log, space } = setup([
      lw([
        [0, 10],
        [10, 10],
        [10, 20],
      ]),
    ]);
    await bus.script(['PEDIT', 'M', 'ALL', '', 'Y', 'U', 'J', 'J', '', '0']);
    expect(log).toContain('All PEDIT operations have been undone.');
    expect(log).toContain('0 segments added to polyline');
    // The second ON changes nothing, so Undo takes back nothing: line 30 (converted) and the
    // polyline keep it.
    await bus.script(['L', 'ON', 'L', 'ON', 'U', '']);
    expect(space().filter((e) => (e.geom as LwPolylineGeometry).plinegen)).toHaveLength(2);
  });

  it('counts the segments of a polyline Join closes', async () => {
    const { bus, log, byHandle } = setup([
      lw([
        [0, 10],
        [10, 10],
        [10, 20],
      ]),
      { kind: 'LINE', start: { x: 10, y: 20 }, end: { x: 0, y: 10 } },
    ]);
    await bus.script(['PEDIT']);
    await bus.pick({ x: 5, y: 10 });
    await bus.script(['J']);
    await bus.pick({ x: 5, y: 15 });
    await bus.script(['', '']);
    expect(log).toContain('1 segments added to polyline');
    expect(byHandle('40')!.geom).toMatchObject({ closed: true });
  });
});
