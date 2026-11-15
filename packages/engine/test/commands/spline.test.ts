// M3-01 part 5: SPLINE, DIVIDE and MEASURE scripted on the PromptBus (AutoCAD 2024 Help,
// "SPLINE (Command)", "DIVIDE (Command)", "MEASURE (Command)"): Fit and CV splines with
// Knots, Degree, start and end Tangency, toLerance, Undo and Close, dragged as they grow, and
// spline-fit polylines converted (Object); DIVIDE and MEASURE marking objects with POINTs or a
// block's references, aligned or not.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  dragMotion,
  fitSpline,
  splineDomain,
  splinePoint,
  type Entity,
  type EntityGeometry,
  type HeaderValue,
  type InsertGeometry,
  type PointGeometry,
  type Prompt,
  type SplineGeometry,
  type ViewHost,
} from '../../src/index';
import { LAYER_WALLS, MODEL_SPACE, blockRecord, entityInit, sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const xy = (p: { x: number; y: number }) => [r6(p.x), r6(p.y)];

/** A view host whose picks take the objects passing within 0.5 of the point (lines, circles). */
function pickHost(model: DocumentModel): ViewHost {
  const near = (g: EntityGeometry, p: { x: number; y: number }): boolean => {
    if (g.kind === 'LINE') {
      const dx = g.end.x - g.start.x;
      const dy = g.end.y - g.start.y;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - g.start.x) * dx + (p.y - g.start.y) * dy) / (dx * dx + dy * dy)),
      );
      return Math.hypot(p.x - g.start.x - t * dx, p.y - g.start.y - t * dy) <= 0.5;
    }
    if (g.kind === 'CIRCLE' || g.kind === 'ARC') {
      return Math.abs(Math.hypot(p.x - g.center.x, p.y - g.center.y) - g.radius) <= 0.5;
    }
    if (g.kind === 'POLYLINE' || g.kind === 'XLINE') return Math.hypot(p.x, p.y - 20) <= 0.5;
    return false;
  };
  return {
    request: (r) =>
      Promise.resolve(
        r.op === 'pick'
          ? {
              ok: true,
              ids: [...model.entities()].filter((e) => near(e.geom, r.point)).map((e) => e.id),
            }
          : { ok: false, message: 'not drawn' },
      ),
  } as ViewHost;
}

function setup(extra: EntityGeometry[] = [], header: [string, HeaderValue][] = []) {
  const init = sampleInit();
  for (const [k, v] of header) (init.header as Map<string, HeaderValue>).set(k, v);
  (init.tables!.blockRecords as unknown[]).push(blockRecord('30', 'Tick'));
  (init.blocks as unknown[]).push({ handle: '30', name: 'Tick', basePoint: { x: 0, y: 0 } });
  extra.forEach((g, i) =>
    (init.entities as unknown[]).push(entityInit((0x31 + i).toString(16), g)),
  );
  const model = DocumentModel.create(init);
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({ model, registry: builtinCommands(), view: pickHost(model) });
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  const spline = (i = 0): SplineGeometry => {
    const e = added()[i];
    expect(e?.type).toBe('SPLINE');
    return e!.geom as SplineGeometry;
  };
  return { model, bus, added, spline };
}

const dragged = (p: Prompt | undefined, x: number, y: number) =>
  p?.drag && (dragMotion(p.drag, { x, y })?.adding?.geom as SplineGeometry | undefined);

const ends = (g: SplineGeometry) => {
  const d = splineDomain(g);
  return [xy(splinePoint(g, d.start)), xy(splinePoint(g, d.end))];
};

describe('SPLINE Fit', () => {
  it('draws through the fit points with AutoCAD 2024 prompts, ended by Enter', async () => {
    const { bus, added, spline } = setup();
    await bus.submit('SPL');
    expect(bus.history).toContain('Current settings: Method=Fit   Knots=Chord');
    expect(bus.promptText).toBe('Specify first point or [Method/Knots/Object]:');
    await bus.submit('0,0');
    expect(bus.promptText).toBe('Enter next point or [start Tangency/toLerance]:');
    // The spline follows the cursor as its next point.
    expect(ends(dragged(bus.prompt, 10, 0)!)).toEqual([
      [0, 0],
      [10, 0],
    ]);
    await bus.submit('10,5');
    expect(bus.promptText).toBe('Enter next point or [end Tangency/toLerance/Undo]:');
    await bus.submit('20,0');
    expect(bus.promptText).toBe('Enter next point or [end Tangency/toLerance/Undo/Close]:');
    expect(added()).toHaveLength(0);
    await bus.submit('');
    expect(bus.promptText).toBe('Command:');
    expect(added()[0]).toMatchObject({ type: 'SPLINE', layer: LAYER_WALLS, owner: MODEL_SPACE });
    const g = spline();
    const fit = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ];
    expect(g).toMatchObject({ degree: 3, fitPoints: fit, closed: false, periodic: false });
    expect(g.knotParameterization).toBeUndefined();
    expect(g.fitTolerance).toBeUndefined();
    // The NURBS stored beside the fit points is AutoCAD's interpolation of them.
    const want = fitSpline({ fitPoints: fit })!;
    expect(g.knots).toEqual(want.knots);
    expect(g.controlPoints).toEqual(want.controlPoints);
    expect(xy(splinePoint(g, g.knots[4]!))).toEqual([10, 5]);
  });

  it('takes Undo, start and end tangents, a tolerance and the knots, kept for next time', async () => {
    const { bus, spline } = setup();
    await bus.script(['SPLINE', 'K']);
    expect(bus.promptText).toBe('Enter knot parameterization [Chord/Square root/Uniform] <Chord>:');
    await bus.submit('S');
    expect(bus.promptText).toBe('Specify first point or [Method/Knots/Object]:');
    await bus.script(['0,0', 'T']);
    expect(bus.promptText).toBe('Specify start tangent:');
    // The tangent is dragged.
    const leaving = dragged(bus.prompt, 0, 10);
    expect(leaving).toBeUndefined(); // one point and a tangent make no curve yet
    await bus.submit('0,10');
    expect(bus.promptText).toBe('Enter next point or [start Tangency/toLerance]:');
    await bus.script(['L']);
    expect(bus.promptText).toBe('Specify a fit tolerance <0.0000>:');
    await bus.submit('-1');
    expect(bus.history).toContain('Value must be positive or zero.');
    await bus.submit('0.5');
    await bus.script(['5,5', '7,7', 'U']);
    expect(bus.promptText).toBe('Enter next point or [end Tangency/toLerance/Undo]:');
    await bus.script(['10,0', 'T']);
    expect(bus.promptText).toBe('Specify end tangent:');
    const arriving = dragged(bus.prompt, 10, -10)!;
    expect(arriving.endTangent).toEqual({ x: 0, y: -1 });
    await bus.submit('20,0');
    expect(bus.promptText).toBe('Command:');
    const g = spline();
    expect(g).toMatchObject({
      fitPoints: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 0 },
      ],
      startTangent: { x: 0, y: 1 },
      endTangent: { x: 1, y: 0 },
      knotParameterization: 'sqrt',
      fitTolerance: 0.5,
    });
    const want = fitSpline({
      fitPoints: g.fitPoints!,
      startTangent: { x: 0, y: 1 },
      endTangent: { x: 1, y: 0 },
      parameterization: 'sqrt',
    })!;
    expect(g.controlPoints).toEqual(want.controlPoints);
    // The knots stay the drawing's next default; Uniform by its letter.
    await bus.submit('SPLINE');
    expect(bus.history).toContain('Current settings: Method=Fit   Knots=Square root');
    await bus.script(['K', 'U', 'K']);
    expect(bus.promptText).toBe(
      'Enter knot parameterization [Chord/Square root/Uniform] <Uniform>:',
    );
    await bus.script(['', '0,0', '10,0', '']);
    expect(spline(1)).toMatchObject({ knotParameterization: 'uniform' });
    expect(spline(1).fitPoints).toHaveLength(2);
  });

  it('closes, and draws nothing for Esc or a single point', async () => {
    const { bus, added, spline } = setup();
    await bus.script(['SPLINE', '0,0', '10,0', '10,10']);
    bus.cancel();
    await bus.script(['SPLINE', '0,0', '']);
    expect(added()).toHaveLength(0);
    await bus.script(['SPLINE', '0,0', '10,0', '10,10', 'C']);
    expect(bus.promptText).toBe('Command:');
    const g = spline();
    expect(g).toMatchObject({ closed: true, degree: 3 });
    expect(g.fitPoints).toHaveLength(3);
    const [a, b] = ends(g);
    expect(a).toEqual([0, 0]);
    expect(b).toEqual([0, 0]);
    // A zero tangent (the first point again) is no tangent.
    await bus.script(['SPLINE', '0,0', 'T', '0,0', '5,0', '']);
    expect(spline(1).startTangent).toBeUndefined();
  });
});

describe('SPLINE CV', () => {
  it('draws by control vertices with the degree, kept as the next default', async () => {
    const { bus, spline } = setup();
    await bus.script(['SPLINE', 'M']);
    expect(bus.promptText).toBe('Enter spline creation method [Fit/CV] <Fit>:');
    await bus.submit('CV');
    expect(bus.promptText).toBe('Specify first point or [Method/Degree/Object]:');
    await bus.submit('D');
    expect(bus.promptText).toBe('Enter degree of spline <3>:');
    await bus.submit('11');
    expect(bus.history).toContain('Requires an integer between 1 and 10.');
    await bus.script(['2', '0,0']);
    expect(bus.promptText).toBe('Enter next point:');
    await bus.submit('5,10');
    expect(bus.promptText).toBe('Enter next point or [Undo]:');
    // The curve is dragged: a parabola on three vertices.
    expect(dragged(bus.prompt, 10, 0)?.degree).toBe(2);
    await bus.submit('10,0');
    expect(bus.promptText).toBe('Enter next point or [Close/Undo]:');
    await bus.script(['20,20', 'U', '']);
    const g = spline();
    expect(g).toMatchObject({
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 5, y: 10 },
        { x: 10, y: 0 },
      ],
      closed: false,
      periodic: false,
    });
    expect(g.fitPoints).toBeUndefined();
    await bus.submit('SPLINE');
    expect(bus.history).toContain('Current settings: Method=CV   Degree=2');
  });

  it('closes periodically, and is cancelled by Esc', async () => {
    const { bus, added, spline } = setup();
    await bus.script(['SPLINE', 'M', 'CV', '0,0', '10,0']);
    bus.cancel();
    expect(added()).toHaveLength(0);
    await bus.script(['SPLINE', '0,0', '10,0', '10,10', '0,10', 'C']);
    const g = spline();
    expect(g).toMatchObject({ degree: 3, closed: true, periodic: true });
    expect(g.controlPoints).toHaveLength(7);
    const [a, b] = ends(g);
    expect(a).toEqual(b);
    // Method keeps CV; Enter at the method prompt keeps it too.
    await bus.script(['SPLINE', 'M', '', 'M', 'Fit']);
    expect(bus.promptText).toBe('Specify first point or [Method/Knots/Object]:');
  });
});

describe('SPLINE Object', () => {
  const fitPolyline = (fit: 'cubic' | 'quadratic' | undefined, closed = false): EntityGeometry => ({
    kind: 'POLYLINE',
    is3d: false,
    closed,
    vertices: [
      { x: 0, y: 20, bulge: 0 },
      { x: 30, y: 20, bulge: 0 },
    ],
    ...(fit && { fit }),
    frame: [
      { x: 0, y: 20 },
      { x: 10, y: 30 },
      { x: 20, y: 10 },
      { x: 30, y: 20 },
    ],
  });

  it('converts a spline-fit polyline to the spline on its frame, erasing it', async () => {
    const { bus, model, added, spline } = setup([fitPolyline('cubic')]);
    const id = [...model.entities()].find((e) => e.type === 'POLYLINE')!.id;
    await bus.script(['SPLINE', 'O']);
    expect(bus.promptText).toBe('Select objects to convert to splines:');
    await bus.script(['0,20', '']);
    expect(bus.promptText).toBe('Command:');
    expect(model.entity(id)).toBeUndefined();
    expect(added()).toHaveLength(1);
    expect(spline()).toMatchObject({ degree: 3, knots: [0, 0, 0, 0, 1, 1, 1, 1], closed: false });
    expect(ends(spline())).toEqual([
      [0, 20],
      [30, 20],
    ]);
  });

  it('leaves other objects alone', async () => {
    const { bus, model, added } = setup([fitPolyline(undefined)]);
    await bus.script(['SPLINE', 'O', '0,20', '']);
    expect(added()).toHaveLength(0);
    expect([...model.entities()].some((e) => e.type === 'POLYLINE')).toBe(true);
  });

  it('closes a closed quadratic one periodically', async () => {
    const { bus, spline } = setup([fitPolyline('quadratic', true)]);
    await bus.script(['SPLINE', 'O', '0,20', '']);
    expect(spline()).toMatchObject({ degree: 2, closed: true, periodic: true });
  });
});

describe('DIVIDE', () => {
  const marks = (added: () => Entity[]) =>
    added().map((e) => {
      const g = e.geom as PointGeometry | InsertGeometry;
      return g.kind === 'POINT' ? xy(g.position) : [...xy(g.position), r6(g.rotation)];
    });

  it('puts n − 1 points on a line, n on a circle, on the current layer', async () => {
    const { bus, added } = setup();
    await bus.submit('DIV');
    expect(bus.promptText).toBe('Select object to divide:');
    await bus.submit('3,0');
    expect(bus.promptText).toBe('Enter the number of segments or [Block]:');
    await bus.submit('1');
    expect(bus.history).toContain('Requires an integer between 2 and 32767.');
    await bus.submit('4');
    expect(bus.promptText).toBe('Command:');
    expect(marks(added)).toEqual([
      [2.5, 0],
      [5, 0],
      [7.5, 0],
    ]);
    expect(added()[0]).toMatchObject({ type: 'POINT', layer: LAYER_WALLS, owner: MODEL_SPACE });
    // The circle at (5,5) radius 2, from angle 0 counter-clockwise.
    await bus.script(['DIVIDE', '7,5', '4']);
    expect(marks(added).slice(3)).toEqual([
      [7, 5],
      [5, 7],
      [3, 5],
      [5, 3],
    ]);
  });

  it('places a block, aligned or not, refusing names the drawing lacks', async () => {
    const { bus, added } = setup();
    await bus.script(['DIVIDE', '0,5', 'B']);
    expect(bus.promptText).toBe('Enter name of block to insert:');
    await bus.submit('Nope');
    expect(bus.history).toContain('Block "Nope" cannot be found.');
    await bus.submit('tick');
    expect(bus.promptText).toBe('Align block with object? [Yes/No] <Y>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Enter the number of segments:');
    await bus.submit('2');
    // The line from (0,0) to (0,10) runs up: the block is turned a quarter.
    expect(marks(added)).toEqual([[0, 5, r6(Math.PI / 2)]]);
    expect(added()[0]?.geom).toMatchObject({
      kind: 'INSERT',
      block: '30',
      scale: { x: 1, y: 1, z: 1 },
      attributes: [],
    });
    await bus.script(['DIVIDE', '0,5', 'B', 'Tick', 'N', '2']);
    expect(marks(added)[1]).toEqual([0, 5, 0]);
  });

  it('refuses objects it cannot divide, and ends on Enter', async () => {
    const xline: EntityGeometry = {
      kind: 'XLINE',
      base: { x: 0, y: 20 },
      direction: { x: 1, y: 0 },
    } as EntityGeometry;
    const { bus, added } = setup([xline]);
    await bus.script(['DIVIDE', '0,20']);
    expect(bus.history).toContain('Cannot divide that object.');
    expect(bus.promptText).toBe('Select object to divide:');
    await bus.submit('');
    expect(bus.promptText).toBe('Command:');
    await bus.script(['DIVIDE', '3,0', '']);
    await bus.script(['DIVIDE', '3,0', 'B', '']);
    expect(added()).toHaveLength(0);
  });
});

describe('MEASURE', () => {
  const positions = (added: () => Entity[]) =>
    added().map((e) => xy((e.geom as PointGeometry | InsertGeometry).position));

  it('marks every segment length from the end nearer the pick, not the end itself', async () => {
    const { bus, added } = setup();
    await bus.submit('ME');
    expect(bus.promptText).toBe('Select object to measure:');
    await bus.submit('2,0');
    expect(bus.promptText).toBe('Specify length of segment or [Block]:');
    await bus.submit('0');
    expect(bus.history).toContain('Value must be positive and nonzero.');
    await bus.submit('3');
    expect(positions(added)).toEqual([
      [3, 0],
      [6, 0],
      [9, 0],
    ]);
    // Picked near (10,0): from that end; 2.5 divides 10 exactly, so 3 marks, none on the end.
    await bus.script(['MEASURE', '9,0', '2.5']);
    expect(positions(added).slice(3)).toEqual([
      [7.5, 0],
      [5, 0],
      [2.5, 0],
    ]);
  });

  it('places aligned blocks, and marks nothing for a length past the end', async () => {
    const { bus, added } = setup();
    await bus.script(['MEASURE', '0,9', 'B', 'Tick', 'Y']);
    expect(bus.promptText).toBe('Specify length of segment:');
    await bus.submit('4');
    // Picked near the top: measured downwards, the blocks turned to point down.
    expect(
      added().map((e) => {
        const g = e.geom as InsertGeometry;
        return [...xy(g.position), r6(g.rotation)];
      }),
    ).toEqual([
      [0, 6, r6((3 * Math.PI) / 2)],
      [0, 2, r6((3 * Math.PI) / 2)],
    ]);
    await bus.script(['MEASURE', '3,0', '20']);
    expect(added()).toHaveLength(2);
    expect(bus.promptText).toBe('Command:');
  });

  it('refuses more marks than DIVIDE allows, and ends on Esc', async () => {
    const { bus, added } = setup();
    await bus.script(['MEASURE', '3,0', '0.0001']);
    expect(bus.history).toContain('Requires fewer than 32768 segments.');
    bus.cancel();
    await bus.script(['MEASURE', '3,0', 'B', 'Tick']);
    bus.cancel();
    expect(added()).toHaveLength(0);
  });
});
