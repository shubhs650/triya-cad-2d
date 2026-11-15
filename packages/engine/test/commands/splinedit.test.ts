// M3-02 part 6: SPLINEDIT on the PromptBus, driven as the command line and the canvas drive it,
// with AutoCAD 2024's prompts (AutoCAD Help, "SPLINEDIT (Command)"). The geometry is
// test/edit/splinedit.test.ts's.
import { describe, expect, it } from 'vitest';
import {
  kinksOf,
  splineCurve,
  splineDomain,
  splinePoint,
  toleranceForSize,
  type EntityGeometry,
  type PolylineGeometry,
  type SplineGeometry,
  type Vec2,
} from '../../src/index';
import { splineOf } from '../../src/commands/draw/spline-shape';
import { r6, setup } from './edit-harness';

const P = (x: number, y: number): Vec2 => ({ x, y });
const S = [P(0, 10), P(10, 20), P(20, 10), P(30, 20)];
const fit = (points = S, closed = false) =>
  splineOf({ method: 'fit', points, knots: 'chord', tolerance: 0, closed })!;
const cv = (points = S, closed = false) => splineOf({ method: 'cv', points, degree: 3, closed })!;
const xy = (pts: readonly Vec2[] | undefined) => (pts ?? []).map((p) => [r6(p.x), r6(p.y)]);
const MAIN =
  'Enter an option [Close/Join/Fit data/Edit vertex/convert to Polyline/Reverse/Undo/eXit] <eXit>:';
const FIT =
  'Enter a fit data option [Add/Close/Delete/Kink/Move/Purge/Tangents/toLerance/eXit] <eXit>:';
const VERTEX = 'Enter a vertex editing option [Add/Delete/Elevate order/Move/Weight/eXit] <eXit>:';
const MOVE = 'Specify new location or [Next/Previous/Select point/eXit] <N>:';

describe('SPLINEDIT', () => {
  it('moves fit points, walking them with Next, Previous and Select point, then undoes', async () => {
    const { bus, byHandle, log } = setup([fit()]);
    const spline = () => byHandle('40')!.geom as SplineGeometry;
    await bus.script(['SPE']);
    expect(bus.promptText).toBe('Select spline:');
    await bus.pick(P(0, 10));
    expect(bus.promptText).toBe(MAIN);
    await bus.script(['F']);
    expect(bus.promptText).toBe(FIT);
    await bus.script(['M']);
    expect(bus.promptText).toBe(MOVE);
    await bus.script(['0,5', '', '10,25', 'P', 'P', 'S']);
    expect(bus.promptText).toBe('Specify existing fit point <exit>:');
    await bus.script(['29,19', '30,30']);
    expect(xy(spline().fitPoints)).toEqual([
      [0, 5],
      [10, 25],
      [20, 10],
      [30, 30],
    ]);
    // The last point of an open spline is as far as Next goes.
    await bus.script(['N', '31,31', 'S', '']);
    expect(xy(spline().fitPoints).at(-1)).toEqual([31, 31]);
    await bus.script(['X']);
    expect(bus.promptText).toBe(FIT);
    await bus.script(['X']);
    expect(bus.promptText).toBe(MAIN);
    await bus.script(['U', 'U', 'U', 'U']);
    expect(xy(spline().fitPoints)).toEqual(xy(S));
    await bus.script(['U']);
    expect(log).toContain('All SPLINEDIT operations have been undone.');
    await bus.script(['']);
    expect(bus.command).toBeUndefined();
  });

  it('adds, deletes and kinks fit points', async () => {
    const { bus, byHandle, log } = setup([fit()]);
    const spline = () => byHandle('40')!.geom as SplineGeometry;
    await bus.script(['SPLINEDIT']);
    await bus.pick(P(0, 10));
    await bus.script(['F', 'A']);
    expect(bus.promptText).toBe('Specify existing fit point <exit>:');
    await bus.script(['10,20']);
    expect(bus.promptText).toBe('Specify new fit point <exit>:');
    // Each new point goes after the last one added.
    await bus.script(['14,20', '16,18', '']);
    expect(xy(spline().fitPoints)).toEqual([
      [0, 10],
      [10, 20],
      [14, 20],
      [16, 18],
      [20, 10],
      [30, 20],
    ]);
    // At an open spline's first point the new one can go before it.
    await bus.script(['0,10']);
    expect(bus.promptText).toBe('Specify new fit point or [After/Before] <exit>:');
    await bus.script(['B', '-10,0', '', '']);
    expect(xy(spline().fitPoints)[0]).toEqual([-10, 0]);
    expect(bus.promptText).toBe(FIT);
    await bus.script(['D', '14,20', '16,18', '-10,0', '']);
    expect(xy(spline().fitPoints)).toEqual(xy(S));
    await bus.script(['K']);
    expect(bus.promptText).toBe('Specify new point on spline <exit>:');
    await bus.script(['20,10', '']);
    expect(kinksOf(spline(), toleranceForSize(100))).toEqual([false, false, true, false]);
    // Down to two fit points, and no further.
    await bus.script(['D', '30,20', '20,10', '10,20']);
    expect(log).toContain('A spline needs at least 2 fit points.');
    await bus.script(['', 'X', 'X']);
    expect(xy(spline().fitPoints)).toEqual([
      [0, 10],
      [10, 20],
    ]);
  });

  it('kinks a new point where the curve is picked', async () => {
    const { bus, byHandle } = setup([fit()]);
    const spline = () => byHandle('40')!.geom as SplineGeometry;
    await bus.script(['SPE']);
    await bus.pick(P(0, 10));
    const c = splineCurve(spline())!;
    const mid = c.controlPoints[2]!;
    await bus.script(['F', 'K', `${mid.x},${mid.y}`, '', 'X', '']);
    const g = spline();
    expect(g.fitPoints).toHaveLength(5);
    expect(kinksOf(g, toleranceForSize(100)).filter(Boolean)).toHaveLength(1);
  });

  it('closes and opens by its fit data, sets tangents and tolerance, and purges', async () => {
    const { bus, byHandle, log } = setup([fit()]);
    const spline = () => byHandle('40')!.geom as SplineGeometry;
    await bus.script(['SPE']);
    await bus.pick(P(0, 10));
    await bus.script(['F', 'T']);
    expect(bus.promptText).toBe('Specify start tangent or [System default]:');
    await bus.script(['0,20']);
    expect(bus.promptText).toBe('Specify end tangent or [System default]:');
    await bus.script(['40,20']);
    expect(spline().startTangent).toEqual(P(0, 1));
    expect(spline().endTangent).toEqual(P(1, 0));
    await bus.script(['T', 'S', '']);
    expect(spline().startTangent).toBeUndefined();
    expect(spline().endTangent).toEqual(P(1, 0));
    // Enter at both keeps them.
    await bus.script(['T', '', '']);
    expect(spline().endTangent).toEqual(P(1, 0));
    await bus.script(['L']);
    expect(bus.promptText).toBe('Enter fit tolerance <0.0000>:');
    await bus.script(['-1']);
    expect(log).toContain('Value must be positive or zero.');
    await bus.script(['0.5']);
    expect(spline().fitTolerance).toBe(0.5);
    await bus.script(['L', '0']);
    expect(spline()).not.toHaveProperty('fitTolerance');
    await bus.script(['C']);
    expect(spline().closed).toBe(true);
    expect(bus.promptText).toBe(
      'Enter a fit data option [Add/Open/Delete/Kink/Move/Purge/Tangents/toLerance/eXit] <eXit>:',
    );
    await bus.script(['T']);
    expect(bus.promptText).toBe('Specify tangent or [System default]:');
    await bus.script(['S', 'O']);
    expect(spline().closed).toBe(false);
    // Next walks round a closed spline.
    await bus.script(['C', 'M', 'P', '30,25', 'X']);
    expect(xy(spline().fitPoints).at(-1)).toEqual([30, 25]);
    await bus.script(['P']);
    expect(spline().fitPoints).toBeUndefined();
    expect(bus.promptText).toBe(
      'Enter an option [Open/Join/Edit vertex/convert to Polyline/Reverse/Undo/eXit] <eXit>:',
    );
    await bus.script(['O']);
    expect(spline().closed).toBe(false);
    await bus.script(['C']);
    expect(spline()).toMatchObject({ closed: true, periodic: true });
    await bus.script(['X']);
    expect(bus.command).toBeUndefined();
  });

  it('edits control vertices: add, delete, elevate order, move and weight', async () => {
    const { bus, byHandle, log } = setup([cv([...S, P(40, 10)])]);
    const spline = () => byHandle('40')!.geom as SplineGeometry;
    await bus.script(['SPE']);
    await bus.pick(P(0, 10));
    expect(bus.promptText).toBe(
      'Enter an option [Close/Join/Edit vertex/convert to Polyline/Reverse/Undo/eXit] <eXit>:',
    );
    await bus.script(['E']);
    expect(bus.promptText).toBe(VERTEX);
    await bus.script(['A']);
    expect(bus.promptText).toBe('Specify a point on the spline <exit>:');
    await bus.script(['20,14', '-20,10']);
    expect(spline().controlPoints).toHaveLength(6);
    expect(log).toContain('A control vertex cannot be added there.');
    await bus.script(['', 'D']);
    expect(bus.promptText).toBe('Specify control point <exit>:');
    await bus.script(['40,10', '30,20']);
    expect(spline().controlPoints).toHaveLength(4);
    await bus.script(['0,10']);
    expect(log).toContain('The spline needs more control points than its order (4).');
    await bus.script(['', 'E']);
    expect(bus.promptText).toBe('Enter new order <4>:');
    await bus.script(['2']);
    expect(log).toContain('Requires an integer between 4 and 26.');
    await bus.script(['6']);
    expect(spline().degree).toBe(5);
    await bus.script(['E', '']);
    expect(spline().degree).toBe(5);
    await bus.script(['M']);
    expect(bus.promptText).toBe(MOVE);
    await bus.script(['-5,10', 'N', 'P', 'N', 'S', '-5,9', '-6,10', 'X']);
    expect(xy(spline().controlPoints)[0]).toEqual([-6, 10]);
    await bus.script(['W']);
    expect(bus.promptText).toBe(
      'Enter new weight (current = 1.0000) or [Next/Previous/Select point/eXit] <N>:',
    );
    await bus.script(['0']);
    expect(log).toContain('Value must be positive.');
    await bus.script(['2']);
    expect(spline().weights?.[0]).toBe(2);
    expect(bus.promptText).toBe(
      'Enter new weight (current = 2.0000) or [Next/Previous/Select point/eXit] <N>:',
    );
    await bus.script(['', 'X', 'X', '']);
    expect(bus.command).toBeUndefined();
  });

  it('joins curves to the source, reverses it and converts it to a polyline', async () => {
    const { bus, byHandle, log, kinds } = setup([
      cv(),
      { kind: 'LINE', start: P(40, 20), end: P(30, 20) },
    ]);
    await bus.script(['SPE']);
    await bus.pick(P(0, 10));
    await bus.script(['J']);
    expect(bus.promptText).toBe('Select any open curves to join to the source:');
    await bus.pick(P(35, 20));
    await bus.script(['']);
    expect(log).toContain('1 object joined to the spline');
    expect(byHandle('41')).toBeUndefined();
    const g = byHandle('40')!.geom as SplineGeometry;
    expect(xy(g.controlPoints).at(-1)).toEqual([40, 20]);
    await bus.script(['J', '']);
    expect(log).toContain('0 objects joined to the spline');
    await bus.script(['R']);
    expect(xy((byHandle('40')!.geom as SplineGeometry).controlPoints)[0]).toEqual([40, 20]);
    await bus.script(['P']);
    expect(bus.promptText).toBe('Specify a precision <10>:');
    await bus.script(['2']);
    expect(kinds()).toContain('LWPOLYLINE');
    expect(kinds()).not.toContain('SPLINE');
    expect(bus.command).toBeUndefined();
  });

  it('closes a fit-only spline by its fit points and keeps a closed one to three', async () => {
    const bare: SplineGeometry = { ...fit(), controlPoints: [], knots: [] };
    const { bus, byHandle, log } = setup([bare]);
    const spline = () => byHandle('40')!.geom as SplineGeometry;
    await bus.script(['SPE', '']);
    expect(bus.command).toBeUndefined();
    await bus.script(['SPE']);
    await bus.pick(P(0, 10));
    await bus.script(['C']);
    expect(spline()).toMatchObject({ closed: true, periodic: false });
    expect(spline().controlPoints.length).toBeGreaterThan(0);
    await bus.script(['F', 'D', '30,20', '20,10']);
    expect(log).toContain('A closed spline needs at least 3 fit points.');
    // A tangent picked on the point itself has no direction: the tangent stays as it was.
    await bus.script(['', 'T', '0,10']);
    expect(spline().startTangent).toBeUndefined();
    expect(bus.promptText).toMatch(/^Enter a fit data option/);
    await bus.script(['']);
    expect(bus.promptText).toMatch(/^Enter an option/);
    await bus.script(['E', '']);
    expect(bus.promptText).toMatch(/^Enter an option/);
    await bus.script(['']);
    expect(bus.command).toBeUndefined();
  });

  it('turns a spline-fit polyline into a spline and refuses other objects', async () => {
    const frame = S.map((p) => ({ x: p.x, y: p.y, bulge: 0 }));
    const poly: PolylineGeometry = {
      kind: 'POLYLINE',
      vertices: frame,
      frame: S,
      fit: 'cubic',
      closed: false,
      is3d: false,
    };
    const { bus, log, kinds } = setup([poly as EntityGeometry]);
    await bus.script(['SPE']);
    await bus.pick(P(5, 0));
    expect(log).toContain('Object selected is not a spline or a spline-fit polyline.');
    expect(bus.promptText).toBe('Select spline:');
    await bus.pick(P(10, 20));
    expect(kinds()).toContain('SPLINE');
    expect(kinds()).not.toContain('POLYLINE');
    await bus.script(['']);
    expect(bus.command).toBeUndefined();
  });

  it('keeps a closed spline closed when its wrapped vertex is moved', async () => {
    const { bus, byHandle } = setup([cv([...S, P(40, 10)], true)]);
    const spline = () => byHandle('40')!.geom as SplineGeometry;
    await bus.script(['SPE']);
    const c = splineCurve(spline())!;
    const { start, end } = splineDomain(c);
    await bus.pick(splinePoint(c, (start + end) / 2));
    await bus.script(['E', 'M', '0,0', 'X', 'X', '']);
    const g = spline();
    expect(g.periodic).toBe(true);
    expect(xy(g.controlPoints)[0]).toEqual([0, 0]);
  });
});
