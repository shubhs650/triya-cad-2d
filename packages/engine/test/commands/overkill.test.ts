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
    const { log, byHandle } = await overkill([
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
    expect(log).toContain('3 overlapping object(s) or segment(s) deleted');
    expect((byHandle('40')!.geom as LwPolylineGeometry).vertices.map((v) => [v.x, v.y])).toEqual([
      [0, 20],
      [10, 20],
      [10, 30],
    ]);
    expect(byHandle('41')).toBeUndefined();
    // Only partly on the polyline: kept (the polyline is never broken or stretched).
    expect(byHandle('42')).toBeDefined();
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
