// M3-02 part 6: OVERKILL and -OVERKILL on the PromptBus, with AutoCAD 2024's prompts and
// Delete Duplicate Objects settings (AutoCAD Help, "Delete Duplicate Objects Dialog Box",
// "-OVERKILL (Command)"), including inch-drawing tolerance cases. The geometry is
// `edit/overkill.ts`'s.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OVERKILL,
  optimizePolyline,
  type ArcGeometry,
  type EntityGeometry,
  type LwPolylineGeometry,
  type OverkillSettings,
} from '../../src/index';
import { r6, setup } from './edit-harness';

const line = (x0: number, y0: number, x1: number, y1: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});
const arc = (cx: number, r: number, a0: number, a1: number): ArcGeometry => ({
  kind: 'ARC',
  center: { x: cx, y: 100 },
  radius: r,
  startAngle: a0,
  endAngle: a1,
});
const lw = (
  pts: [number, number][],
  extra: Partial<LwPolylineGeometry> = {},
): LwPolylineGeometry => ({
  kind: 'LWPOLYLINE',
  vertices: pts.map(([x, y]) => ({ x, y, bulge: 0 })),
  closed: false,
  ...extra,
});
const RED = { color: { kind: 'aci' as const, index: 1 } };

/** OVERKILL on everything with the dialog's settings `s`; the log lines it printed. */
async function overkill(objects: Parameters<typeof setup>[0], s: Partial<OverkillSettings> = {}) {
  const t = setup(objects);
  await t.bus.script(['OVERKILL', 'ALL', '']);
  expect(t.bus.promptText).toBe('Delete Duplicate Objects:');
  await t.bus.answer({ kind: 'dialog', action: 'ok', overkill: { ...DEFAULT_OVERKILL, ...s } });
  expect(t.bus.command).toBeUndefined();
  return t;
}

describe('OVERKILL', () => {
  it('deletes duplicates, either way round, keeping the first drawn', async () => {
    const { log, byHandle, space } = await overkill([
      line(0, 10, 10, 10),
      line(10, 10, 0, 10),
      line(0, 10, 10, 10 + 1e-7),
      [line(0, 10, 10, 10), RED],
      { kind: 'CIRCLE', center: { x: 50, y: 0 }, radius: 5 },
      lw([
        [0, 20],
        [10, 20],
        [10, 30],
      ]),
      lw([
        [10, 30],
        [10, 20],
        [0, 20],
      ]),
    ]);
    expect(log).toContain('3 duplicate(s) deleted');
    expect(log).toContain('0 overlapping object(s) or segment(s) deleted');
    expect(byHandle('40')).toBeDefined();
    expect(byHandle('41')).toBeUndefined();
    expect(byHandle('42')).toBeUndefined();
    // Another colour is another object; the circle on another layer too (WALLS against 0).
    expect(byHandle('43')).toBeDefined();
    expect(byHandle('44')).toBeDefined();
    expect(byHandle('45')).toBeDefined();
    expect(byHandle('46')).toBeUndefined();
    expect(space()).toHaveLength(6);
  });

  it('ignores the properties it is told to, and holds numbers to the tolerance', async () => {
    const ignoring = await overkill(
      [line(0, 10, 10, 10), [line(0, 10, 10, 10), RED], line(0, 10, 10, 10.01)],
      { ignore: ['color'] },
    );
    expect(ignoring.log).toContain('1 duplicate(s) deleted');
    const loose = await overkill([line(0, 10, 10, 10), line(0, 10, 10, 10.01)], {
      tolerance: 0.1,
    });
    expect(loose.log).toContain('1 duplicate(s) deleted');
    const exact = await overkill([line(0, 10, 10, 10), line(0, 10, 10, 10 + 1e-9)], {
      tolerance: 0,
    });
    expect(exact.log).toContain('0 duplicate(s) deleted');
  });

  it('combines collinear lines: contained, partly overlapping, end to end', async () => {
    const { log, byHandle, ends } = await overkill([
      line(0, 10, 10, 10),
      line(2, 10, 5, 10),
      line(8, 10, 15, 10),
      line(15, 10, 20, 10),
      line(0, 12, 10, 12),
      line(10, 12, 20, 12),
    ]);
    // Contained and partly overlapping go; end to end stays apart by default.
    expect(log).toContain('2 overlapping object(s) or segment(s) deleted');
    expect(ends(byHandle('40')!)).toEqual([0, 10, 15, 10]);
    expect(byHandle('41')).toBeUndefined();
    expect(byHandle('42')).toBeUndefined();
    expect(ends(byHandle('43')!)).toEqual([15, 10, 20, 10]);
    const joined = await overkill(
      [line(0, 12, 10, 12), line(20, 12, 10, 12), line(5, 14, 10, 14), line(9, 14, 0, 14)],
      { combineEndToEnd: true, combinePartial: false },
    );
    expect(joined.log).toContain('1 overlapping object(s) or segment(s) deleted');
    expect(joined.ends(joined.byHandle('40')!)).toEqual([0, 12, 20, 12]);
    // Partial overlap off: the two at y 14 stay as they are.
    expect(joined.byHandle('43')).toBeDefined();
    // A line kept its own way round.
    const back = await overkill([line(10, 16, 0, 16), line(8, 16, 15, 16)]);
    expect(back.ends(back.byHandle('40')!)).toEqual([15, 16, 0, 16]);
    expect(back.byHandle('41')).toBeUndefined();
  });

  it('optimizes polyline segments and deletes lines lying on them', async () => {
    const { log, byHandle, ends } = await overkill([
      lw([
        [0, 20],
        [0, 20],
        [5, 20],
        [10, 20],
        [10, 30],
      ]),
      line(2, 20, 8, 20),
      line(10, 25, 10, 35),
    ]);
    expect(log).toContain('4 overlapping object(s) or segment(s) deleted');
    expect((byHandle('40')!.geom as LwPolylineGeometry).vertices.map((v) => [v.x, v.y])).toEqual([
      [0, 20],
      [10, 20],
      [10, 30],
    ]);
    expect(byHandle('41')).toBeUndefined();
    // Only partly on the polyline: cut back to what lies off it (M3-16).
    expect(ends(byHandle('42')!)).toEqual([10, 30, 10, 35]);
    const off = await overkill(
      [
        lw([
          [0, 20],
          [5, 20],
          [10, 20],
        ]),
        line(2, 20, 8, 20),
      ],
      {
        optimizePolylines: false,
      },
    );
    expect(off.log).toContain('0 overlapping object(s) or segment(s) deleted');
  });

  it('keeps vertices between segments of other widths unless told to ignore widths', () => {
    const tapered = lw([
      [0, 0],
      [5, 0],
      [10, 0],
    ]);
    const widths: LwPolylineGeometry = {
      ...tapered,
      vertices: [
        { x: 0, y: 0, bulge: 0, startWidth: 1, endWidth: 1 },
        { x: 5, y: 0, bulge: 0, startWidth: 2, endWidth: 2 },
        { x: 10, y: 0, bulge: 0 },
      ],
    };
    expect(optimizePolyline(widths, 1e-6, false)).toBeUndefined();
    const r = optimizePolyline(widths, 1e-6, true)!;
    expect((r.geom as LwPolylineGeometry).vertices).toHaveLength(2);
    // Going back on itself is not going on.
    expect(
      optimizePolyline(
        lw([
          [0, 0],
          [10, 0],
          [5, 0],
        ]),
        1e-6,
        false,
      ),
    ).toBeUndefined();
    // A zero-length last segment.
    const last = optimizePolyline(
      lw([
        [0, 0],
        [10, 0],
        [10, 0],
      ]),
      1e-6,
      false,
    )!;
    expect((last.geom as LwPolylineGeometry).vertices.map((v) => [v.x, v.y])).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(optimizePolyline(line(0, 0, 1, 0), 1e-6, false)).toBeUndefined();
  });

  it('combines arcs of one circle, round to a circle, and deletes arcs on a circle', async () => {
    const q = Math.PI / 2;
    const { log, byHandle, space } = await overkill([
      arc(0, 5, 0, 2 * q),
      arc(0, 5, q, 3 * q),
      arc(0, 5, 3 * q - 0.1, 0.1),
      arc(30, 5, 0, q),
      { kind: 'CIRCLE', center: { x: 30, y: 100 }, radius: 5 },
      arc(60, 5, 0, q),
      arc(60, 5, 0.2, 0.4),
    ]);
    expect(log).toContain('4 overlapping object(s) or segment(s) deleted');
    const kinds = space().map((e) => e.geom.kind);
    // The three arcs at x 0 came round to one circle.
    expect(kinds.filter((k) => k === 'CIRCLE')).toHaveLength(3);
    expect(byHandle('43')).toBeUndefined();
    expect(byHandle('46')).toBeUndefined();
    const g = byHandle('45')!.geom as ArcGeometry;
    expect([r6(g.startAngle), r6(g.endAngle)]).toEqual([0, r6(q)]);
    const ends = await overkill([arc(0, 5, 0, q), arc(0, 5, q, 2 * q)], { combineEndToEnd: true });
    const a = ends.byHandle('40')!.geom as ArcGeometry;
    expect([r6(a.startAngle), r6(a.endAngle)]).toEqual([0, r6(2 * q)]);
    const apart = await overkill([arc(0, 5, 0, q), arc(0, 5, q, 2 * q)]);
    expect(apart.log).toContain('0 overlapping object(s) or segment(s) deleted');
  });

  // M3-16: "If a polyline segment duplicates a line or arc object, one of them is deleted";
  // "Do not break polylines: polyline objects are unchanged" (AutoCAD Help, "Delete Duplicate
  // Objects Dialog Box"). Which one goes is not documented: the one drawn later, as for
  // duplicates, and a segment lying within a longer object; a polyline loses the segment by
  // breaking there.
  it('breaks a polyline at a segment a line or another polyline duplicates', async () => {
    const pts = (e: { geom: unknown }) =>
      (e.geom as LwPolylineGeometry).vertices.map((v) => [r6(v.x), r6(v.y)]);
    // The polyline drawn first keeps its segment; the line goes.
    const first = await overkill([
      lw([
        [0, 0],
        [10, 0],
        [10, 10],
      ]),
      line(0, 0, 10, 0),
    ]);
    expect(first.log).toContain('1 overlapping object(s) or segment(s) deleted');
    expect(first.byHandle('41')).toBeUndefined();
    expect(pts(first.byHandle('40')!)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    // Drawn after the line: the polyline loses its segment.
    const later = await overkill([
      line(10, 0, 0, 0),
      lw([
        [0, 0],
        [10, 0],
        [10, 10],
      ]),
    ]);
    expect(later.log).toContain('1 overlapping object(s) or segment(s) deleted');
    expect(later.ends(later.byHandle('40')!)).toEqual([10, 0, 0, 0]);
    expect(pts(later.byHandle('41')!)).toEqual([
      [10, 0],
      [10, 10],
    ]);
    // A segment within a longer line goes, whichever came first, and splits its polyline in two.
    const split = await overkill([
      lw([
        [5, 10],
        [5, 0],
        [10, 0],
        [10, 10],
      ]),
      line(0, 0, 20, 0),
    ]);
    expect(split.log).toContain('1 overlapping object(s) or segment(s) deleted');
    const polylines = split.space().filter((e) => e.geom.kind === 'LWPOLYLINE');
    expect(polylines.map(pts)).toEqual([
      [
        [5, 10],
        [5, 0],
      ],
      [
        [10, 0],
        [10, 10],
      ],
    ]);
    expect(polylines[1]!.layer).toBe(polylines[0]!.layer);
    expect(split.ends(split.byHandle('41')!)).toEqual([0, 0, 20, 0]);
    // A closed polyline opens where its closing segment went.
    const closed = await overkill([
      line(0, 0, 0, 10),
      lw(
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        { closed: true },
      ),
    ]);
    const g = closed.byHandle('41')!.geom as LwPolylineGeometry;
    expect(g.closed).toBe(false);
    expect(pts(closed.byHandle('41')!)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    // Of two polylines on one segment, the later one breaks.
    const two = await overkill([
      lw([
        [0, 0],
        [10, 0],
      ]),
      lw([
        [0, 5],
        [0, 0],
        [10, 0],
        [10, 5],
      ]),
    ]);
    expect(two.log).toContain('1 overlapping object(s) or segment(s) deleted');
    expect(
      two
        .space()
        .filter((e) => e.geom.kind === 'LWPOLYLINE')
        .map(pts),
    ).toEqual([
      [
        [0, 0],
        [10, 0],
      ],
      [
        [0, 5],
        [0, 0],
      ],
      [
        [10, 0],
        [10, 5],
      ],
    ]);
    // A polyline wholly duplicated goes.
    const whole = await overkill([
      line(0, 0, 10, 0),
      lw([
        [0, 0],
        [10, 0],
      ]),
    ]);
    expect(whole.byHandle('41')).toBeUndefined();
    expect(whole.byHandle('40')).toBeDefined();
  });

  it('leaves polylines whole with Do not break polylines, and wide segments unless widths are ignored', async () => {
    const objects: Parameters<typeof setup>[0] = [
      line(0, 0, 10, 0),
      lw([
        [0, 0],
        [10, 0],
        [10, 10],
      ]),
    ];
    const kept = await overkill(objects, { keepPolylines: true });
    // The line goes instead.
    expect(kept.byHandle('40')).toBeUndefined();
    expect((kept.byHandle('41')!.geom as LwPolylineGeometry).vertices).toHaveLength(3);
    const wide: Parameters<typeof setup>[0] = [
      line(0, 0, 10, 0),
      lw(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        { constantWidth: 1 },
      ),
    ];
    const w = await overkill(wide);
    expect((w.byHandle('41')!.geom as LwPolylineGeometry).vertices).toHaveLength(3);
    expect(w.byHandle('40')).toBeUndefined();
    const ignored = await overkill(wide, { ignoreWidths: true });
    expect((ignored.byHandle('41')!.geom as LwPolylineGeometry).vertices).toHaveLength(2);
    expect(ignored.byHandle('40')).toBeDefined();
  });

  it('cuts lines back where they partly overlap polyline segments', async () => {
    // Running past both ends of a segment: the segment within the line goes, or, with
    // Do not break polylines, the line is cut in two.
    const objects: Parameters<typeof setup>[0] = [
      lw([
        [0, 0],
        [10, 0],
        [10, 5],
      ]),
      line(-5, 0, 15, 0),
    ];
    const broken = await overkill(objects);
    expect((broken.byHandle('40')!.geom as LwPolylineGeometry).vertices).toHaveLength(2);
    expect(broken.ends(broken.byHandle('41')!)).toEqual([-5, 0, 15, 0]);
    const cut = await overkill(objects, { keepPolylines: true });
    expect(cut.log).toContain('1 overlapping object(s) or segment(s) deleted');
    const lines = cut.space().filter((e) => e.geom.kind === 'LINE' && e.handle !== '30');
    expect(lines.map(cut.ends)).toEqual([
      [-5, 0, 0, 0],
      [10, 0, 15, 0],
    ]);
    // Partly on one segment: cut back to what lies off it, its own way round.
    const part = await overkill([
      lw([
        [0, 0],
        [10, 0],
      ]),
      line(15, 0, 5, 0),
    ]);
    expect(part.log).toContain('1 overlapping object(s) or segment(s) deleted');
    expect(part.ends(part.byHandle('41')!)).toEqual([15, 0, 10, 0]);
    // On two polylines' segments end to end: nothing of it is left.
    const covered = await overkill([
      lw([
        [0, 5],
        [0, 0],
        [5, 0],
      ]),
      lw([
        [5, 0],
        [10, 0],
        [10, 5],
      ]),
      line(2, 0, 8, 0),
    ]);
    expect(covered.byHandle('42')).toBeUndefined();
    expect(covered.log).toContain('1 overlapping object(s) or segment(s) deleted');
    // Combine partial overlaps off: the line stays as it is.
    const off = await overkill(
      [
        lw([
          [0, 0],
          [10, 0],
        ]),
        line(5, 0, 15, 0),
      ],
      { combinePartial: false },
    );
    expect(off.ends(off.byHandle('41')!)).toEqual([5, 0, 15, 0]);
  });

  it('compares polyline arc segments with arcs and circles', async () => {
    const q = Math.PI / 2;
    // A half circle at (0,100) r 10, then a straight piece down.
    const half = (cx: number): LwPolylineGeometry => ({
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: cx + 10, y: 100, bulge: 1 },
        { x: cx - 10, y: 100, bulge: 0 },
        { x: cx - 10, y: 90, bulge: 0 },
      ],
    });
    const on = await overkill([half(0), arc(0, 10, q / 2, q), arc(0, 10, q, 3 * q)]);
    expect(on.log).toContain('2 overlapping object(s) or segment(s) deleted');
    // Within the segment: deleted.
    expect(on.byHandle('41')).toBeUndefined();
    // Partly on it: cut back to the part off it.
    const g = on.byHandle('42')!.geom as ArcGeometry;
    expect([r6(g.startAngle), r6(g.endAngle)]).toEqual([r6(2 * q), r6(3 * q)]);
    expect((on.byHandle('40')!.geom as LwPolylineGeometry).vertices).toHaveLength(3);
    // A clockwise segment (negative bulge) is the same arc.
    const cw: LwPolylineGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: -10, y: 100, bulge: -1 },
        { x: 10, y: 100, bulge: 0 },
      ],
    };
    const back = await overkill([cw, arc(0, 10, q / 2, q)]);
    expect(back.byHandle('41')).toBeUndefined();
    // An arc drawn first, or a circle: the polyline's segment goes.
    const before = await overkill([arc(0, 10, 0, 2 * q), half(0)]);
    expect(before.log).toContain('1 overlapping object(s) or segment(s) deleted');
    expect(
      (before.byHandle('41')!.geom as LwPolylineGeometry).vertices.map((v) => [v.x, v.y]),
    ).toEqual([
      [-10, 100],
      [-10, 90],
    ]);
    const circle = await overkill([
      { kind: 'CIRCLE', center: { x: 0, y: 100 }, radius: 10 },
      half(0),
    ]);
    expect((circle.byHandle('41')!.geom as LwPolylineGeometry).vertices).toHaveLength(2);
    const kept = await overkill(
      [{ kind: 'CIRCLE', center: { x: 0, y: 100 }, radius: 10 }, half(0)],
      {
        keepPolylines: true,
      },
    );
    expect((kept.byHandle('41')!.geom as LwPolylineGeometry).vertices).toHaveLength(3);
    expect(kept.log).toContain('0 overlapping object(s) or segment(s) deleted');
  });

  it('works within an inch drawing’s tolerance', async () => {
    const far = 1e5;
    const { log } = await overkill([
      line(far, far, far + 10, far),
      line(far, far + 5e-7, far + 10, far + 5e-7),
      line(far, far + 1e-4, far + 10, far + 1e-4),
    ]);
    expect(log).toContain('1 duplicate(s) deleted');
  });

  it('leaves associative objects alone when told to', async () => {
    const hatch = { kind: 'HATCH', loops: [], associative: true } as never as EntityGeometry;
    const objects: Parameters<typeof setup>[0] = [
      [line(0, 10, 10, 10), { reactors: ['42'] }],
      line(0, 10, 10, 10),
      hatch,
    ];
    const kept = await overkill(objects);
    // The associated line (40) is skipped; its duplicate stays, there being no other.
    expect(kept.log).toContain('0 duplicate(s) deleted');
    const not = await overkill(objects, { keepAssociative: false });
    expect(not.log).toContain('1 duplicate(s) deleted');
  });

  it('ends at Cancel and with nothing selected', async () => {
    const t = setup([line(0, 10, 10, 10), line(0, 10, 10, 10)]);
    await t.bus.script(['OVERKILL', 'ALL', '']);
    t.bus.cancel();
    expect(t.space()).toHaveLength(4);
    await t.bus.script(['OVERKILL', '']);
    expect(t.bus.command).toBeUndefined();
  });
});

describe('-OVERKILL', () => {
  const OPTIONS =
    'Enter an option to change [Done/Ignore/tOlerance/optimize Plines/combine parTial overlap/combine Endtoend/Associativity] <done>:';

  it('changes the settings at the command line and keeps them for the next', async () => {
    const t = setup([
      line(0, 10, 10, 10),
      [line(0, 10, 10, 10), RED],
      line(10, 10, 20, 10),
      lw([
        [0, 20],
        [5, 20],
        [10, 20],
      ]),
    ]);
    await t.bus.script(['-OVERKILL', 'ALL', '']);
    expect(t.bus.promptText).toBe(OPTIONS);
    await t.bus.script(['I']);
    expect(t.bus.promptText).toBe(
      'Ignore property [None/All/Color/LAyer/Ltype/Ltscale/LWeight/Thickness/TRansparency/plotStyle/Material] <None>:',
    );
    await t.bus.script(['C', 'I']);
    expect(t.bus.promptText).toMatch(/<Color>:$/);
    await t.bus.script(['LA', 'I', 'LA', 'O']);
    expect(t.bus.promptText).toBe('Specify Tolerance <0.0000>:');
    await t.bus.script(['-1']);
    expect(t.log).toContain('Value must be positive or zero.');
    await t.bus.script(['0.001', 'P']);
    expect(t.bus.promptText).toBe('Optimize segments within polylines? [Yes/No] <Yes>:');
    await t.bus.script(['N', 'T']);
    expect(t.bus.promptText).toBe(
      'Combine co-linear objects that partially overlap? [Yes/No] <Yes>:',
    );
    await t.bus.script(['', 'E']);
    expect(t.bus.promptText).toBe(
      'Combine co-linear objects when aligned end to end? [Yes/No] <No>:',
    );
    await t.bus.script(['Y', 'A']);
    expect(t.bus.promptText).toBe('Maintain associative objects? [Yes/No] <Yes>:');
    await t.bus.script(['Y', '']);
    expect(t.log).toContain('1 duplicate(s) deleted');
    expect(t.log).toContain('1 overlapping object(s) or segment(s) deleted');
    expect(t.ends(t.byHandle('40')!)).toEqual([0, 10, 20, 10]);
    // The polyline was left whole (optimize off).
    expect((t.byHandle('43')!.geom as LwPolylineGeometry).vertices).toHaveLength(3);
    // The next OVERKILL opens with them.
    await t.bus.script(['OVERKILL', 'ALL', '']);
    const p = t.bus.prompt as { dialog?: { settings: OverkillSettings } };
    expect(p.dialog?.settings).toMatchObject({
      ignore: ['color'],
      tolerance: 0.001,
      optimizePolylines: false,
      combineEndToEnd: true,
    });
    // OK without settings keeps them.
    await t.bus.answer({ kind: 'dialog', action: 'ok' });
    expect(t.log.at(-2)).toBe('0 duplicate(s) deleted');
    await t.bus.script([
      '-OVERKILL',
      'ALL',
      '',
      'I',
      '',
      'I',
      'A',
      'P',
      'Y',
      'Y',
      'N',
      'I',
      'N',
      '',
    ]);
    expect(t.bus.command).toBeUndefined();
  });
});
