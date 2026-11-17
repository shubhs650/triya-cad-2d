// M5-04 part 3: XCLIP on the PromptBus, with AutoCAD 2024's prompts (AutoCAD Help, "XCLIP
// (Command)"): New boundary (Rectangular, Polygonal, Select polyline), ON, OFF, Delete and
// generate Polyline, the whole command one undo step, filed where the save writes it (io
// export/xclips.ts: the SPATIAL entry of an ACAD_FILTER dictionary in the INSERT's extension
// dictionary).
import { describe, expect, it } from 'vitest';
import {
  clipBoundary,
  type Entity,
  type EntityGeometry,
  type InsertGeometry,
  type SpatialFilter,
  type Vec2,
} from '../../src/index';
import { r6, setup } from './edit-harness';

/** Block "B" (record 50: a line 0,0–1,0 and a circle at 1,0 r 0.5) placed at `at`. */
const ref = (
  at: Vec2,
  o: Partial<Pick<InsertGeometry, 'rotation' | 'array'>> & { scale?: number } = {},
): EntityGeometry => ({
  kind: 'INSERT',
  block: '50',
  position: at,
  scale: { x: o.scale ?? 1, y: o.scale ?? 1, z: o.scale ?? 1 },
  rotation: o.rotation ?? 0,
  attributes: [],
  ...(o.array && { array: o.array }),
});

/**
 * The harness drawing with references 40 at 100,100 (scale 2, turned 90°) and 41 at 200,100,
 * and whatever `extra` adds (handles 42 on).
 */
function drawing(extra: EntityGeometry[] = []) {
  const t = setup([
    ref({ x: 100, y: 100 }, { scale: 2, rotation: Math.PI / 2 }),
    ref({ x: 200, y: 100 }),
    ...extra,
  ]);
  const filters = () =>
    [...t.model.objects.values()].filter((o): o is SpatialFilter => o.type === 'SPATIAL_FILTER');
  const clipOf = (h: string) => filters().find((f) => f.insert === h);
  /** Selects what a window from `a` to `b` holds, at "Select objects", and ends it. */
  const windowSelect = async (a: Vec2, b: Vec2) => {
    await t.bus.pick(a);
    await t.bus.pick(b);
    await t.bus.submit('');
  };
  const ref40 = () => t.byHandle('40')!;
  const ref41 = () => t.byHandle('41')!;
  /** Starts XCLIP on the references in the window around `at`. */
  const xclip = async (...at: Vec2[]) => {
    await t.bus.submit('XCLIP');
    for (const p of at) {
      await t.bus.pick({ x: p.x - 5, y: p.y - 5 });
      await t.bus.pick({ x: p.x + 5, y: p.y + 5 });
    }
    await t.bus.submit('');
  };
  const block = (f: SpatialFilter) => clipBoundary(f)!.map((p) => [r6(p.x), r6(p.y)]);
  return { ...t, filters, clipOf, windowSelect, ref40, ref41, xclip, block };
}

const R40 = { x: 100, y: 100 };
const R41 = { x: 200, y: 100 };

describe('XCLIP New boundary', () => {
  it('clips a reference to a rectangle: the boundary in the drawing, the inverse insert taking it into the block', async () => {
    const t = drawing();
    await t.xclip(R40);
    expect(t.bus.promptText).toBe(
      'Enter clipping option [ON/OFF/Delete/generate Polyline/New boundary] <New>:',
    );
    await t.bus.submit('');
    expect(t.log).toContain('Outside mode - Objects outside boundary will be hidden.');
    expect(t.bus.promptText).toBe(
      'Specify clipping boundary [Select polyline/Polygonal/Rectangular] <Rectangular>:',
    );
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Specify first corner:');
    await t.bus.submit('99,101');
    expect(t.bus.promptText).toBe('Specify opposite corner:');
    await t.bus.submit('101,102');
    expect(t.bus.command).toBeUndefined();

    const f = t.clipOf('40')!;
    const e: Entity = t.ref40();
    expect(e.extDict).toBeDefined();
    expect(f).toMatchObject({
      enabled: true,
      boundary: [
        { x: 99, y: 101 },
        { x: 101, y: 102 },
      ],
      reactors: [f.owner],
      normal: { x: 0, y: 0, z: 1 },
      origin: { x: 0, y: 0, z: 0 },
    });
    expect(f.owner).not.toBe(e.extDict);
    // At 100,100, scale 2, turned 90°: the block's x runs up the drawing, its y to the left.
    expect(f.inverseInsert.map(r6)).toEqual([0, 0.5, 0, -50, -0.5, 0, 0, 50, 0, 0, 0.5, 0]);
    expect(t.block(f)).toEqual([
      [0.5, 0.5],
      [0.5, -0.5],
      [1, -0.5],
      [1, 0.5],
    ]);
    // The other reference is left alone.
    expect(t.clipOf('41')).toBeUndefined();
    expect(t.ref41().extDict).toBeUndefined();
  });

  it('is one undo step: U takes the clip and the extension dictionary away', async () => {
    const t = drawing();
    await t.xclip(R41);
    await t.bus.script(['N', 'R', '199,99', '201,101']);
    expect(t.clipOf('41')).toBeDefined();
    await t.bus.script(['U']);
    expect(t.clipOf('41')).toBeUndefined();
    expect(t.ref41().extDict).toBeUndefined();
  });

  it('clips every reference selected with the one boundary', async () => {
    const t = drawing();
    await t.xclip(R40, R41);
    await t.bus.script(['', 'R', '0,0', '300,300']);
    expect(t.clipOf('40')).toBeDefined();
    expect(t.clipOf('41')!.boundary).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 300 },
    ]);
  });

  it('takes a polygon point by point, Undo dropping the last, Enter closing it', async () => {
    const t = drawing();
    await t.xclip(R41);
    await t.bus.script(['', 'P']);
    expect(t.bus.promptText).toBe('Specify first point:');
    await t.bus.submit('199,99');
    expect(t.bus.promptText).toBe('Specify next point:');
    await t.bus.submit('203,99');
    expect(t.bus.promptText).toBe('Specify next point or [Undo]:');
    await t.bus.submit('250,250');
    await t.bus.submit('U');
    await t.bus.submit('201,102');
    await t.bus.submit('');
    expect(t.bus.command).toBeUndefined();
    expect(t.block(t.clipOf('41')!)).toEqual([
      [-1, -1],
      [3, -1],
      [1, 2],
    ]);
  });

  it('refuses a polygon that crosses itself or encloses nothing, and asks again', async () => {
    const t = drawing();
    await t.xclip(R41);
    await t.bus.script(['', 'P', '0,0', '10,10', '10,0', '0,20', '']);
    expect(t.log).toContain('The clipping boundary cannot intersect itself.');
    expect(t.bus.promptText).toBe('Specify next point or [Undo]:');
    await t.bus.script(['U', 'U', '']);
    expect(t.log).toContain('The clipping boundary must enclose an area.');
    expect(t.clipOf('41')).toBeUndefined();
    await t.bus.script(['5,-5', '']);
    expect(t.bus.command).toBeUndefined();
    expect(t.clipOf('41')!.boundary).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 5, y: -5 },
    ]);
  });

  it('refuses a rectangle without area', async () => {
    const t = drawing();
    await t.xclip(R41);
    await t.bus.script(['', 'R', '1,1', '1,5']);
    expect(t.log).toContain('The clipping boundary must enclose an area.');
    expect(t.bus.promptText).toBe('Specify first corner:');
  });

  it('follows a selected polyline, closing an open one and following its arcs with chords', async () => {
    const t = drawing([
      {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 190, y: 90, bulge: 0 },
          { x: 210, y: 90, bulge: 1 },
          { x: 210, y: 110, bulge: 0 },
        ],
      },
    ]);
    await t.xclip(R41);
    await t.bus.script(['', 'S']);
    expect(t.bus.promptText).toBe('Select polyline:');
    // The circle of the harness drawing is not a polyline.
    await t.bus.pick({ x: 55, y: 0 });
    expect(t.log).toContain('Object is not a 2D polyline.');
    await t.bus.pick({ x: 200, y: 90 });
    expect(t.bus.command).toBeUndefined();
    const boundary = t.clipOf('41')!.boundary;
    expect(boundary[0]).toEqual({ x: 190, y: 90 });
    expect(boundary[1]).toEqual({ x: 210, y: 90 });
    // The half circle bulges out to x 220.
    expect(Math.max(...boundary.map((p) => p.x))).toBeCloseTo(220, 1);
    expect([r6(boundary.at(-1)!.x), r6(boundary.at(-1)!.y)]).toEqual([210, 110]);
    // The polyline stays.
    expect(t.byHandle('42')).toBeDefined();
  });

  it('asks before replacing a clip, and No leaves it', async () => {
    const t = drawing();
    await t.xclip(R41);
    await t.bus.script(['', '', '199,99', '201,101']);
    const was = t.clipOf('41')!;
    await t.xclip(R41);
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Delete old boundary(s)? [Yes/No] <Yes>:');
    await t.bus.submit('N');
    expect(t.bus.command).toBeUndefined();
    expect(t.clipOf('41')).toBe(was);
  });

  it('replaces a clip in the dictionary it was in, after the reference moved', async () => {
    const t = drawing();
    await t.xclip(R41);
    await t.bus.script(['', '', '199,99', '201,101']);
    const was = t.clipOf('41')!;
    const xdict = t.ref41().extDict;
    await t.bus.script(['MOVE', 'L', '', '0,0', '10,0']);
    expect((t.ref41().geom as InsertGeometry).position).toEqual({ x: 210, y: 100 });
    await t.xclip({ x: 210, y: 100 });
    await t.bus.script(['', '', '', '208,98', '212,102']);
    const now = t.clipOf('41')!;
    expect(t.filters()).toHaveLength(1);
    expect(now.handle).not.toBe(was.handle);
    expect(now.owner).toBe(was.owner);
    expect(t.ref41().extDict).toBe(xdict);
    // The new boundary is taken into the block where the reference stands now.
    expect(t.block(now)).toEqual([
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ]);
  });

  it('lays a rectangle along the current UCS', async () => {
    const t = drawing();
    await t.bus.script(['UCS', 'Z', '45']);
    await t.xclip(R41);
    await t.bus.script(['', 'R']);
    await t.bus.pick({ x: 200, y: 98 });
    await t.bus.pick({ x: 200, y: 102 });
    const b = t.clipOf('41')!.boundary.map((p) => [r6(p.x), r6(p.y)]);
    expect(b).toEqual([
      [200, 98],
      [202, 100],
      [200, 102],
      [198, 100],
    ]);
  });
});

describe('XCLIP ON, OFF, Delete and generate Polyline', () => {
  async function clippedDrawing() {
    const t = drawing();
    await t.xclip(R41);
    await t.bus.script(['', '', '199,99', '201,101']);
    return t;
  }

  it('turns a clip off and on again', async () => {
    const t = await clippedDrawing();
    await t.xclip(R41);
    await t.bus.submit('OFF');
    expect(t.clipOf('41')!.enabled).toBe(false);
    await t.xclip(R41);
    await t.bus.submit('ON');
    expect(t.clipOf('41')!.enabled).toBe(true);
  });

  it('deletes a clip, and says so when there is none', async () => {
    const t = await clippedDrawing();
    await t.xclip(R40);
    await t.bus.submit('D');
    expect(t.log).toContain('No clipping boundary found.');
    await t.xclip(R41);
    await t.bus.submit('D');
    expect(t.clipOf('41')).toBeUndefined();
    // The extension dictionary stays (the save keeps the emptied ACAD_FILTER dictionary in it).
    expect(t.ref41().extDict).toBeDefined();
    await t.bus.script(['U']);
    expect(t.clipOf('41')).toBeDefined();
  });

  it('draws a polyline along the clip where the reference stands now, with the current properties', async () => {
    const t = await clippedDrawing();
    await t.bus.script(['MOVE', 'L', '', '0,0', '0,10']);
    const before = t.space().length;
    await t.xclip({ x: 200, y: 110 });
    await t.bus.submit('P');
    expect(t.space()).toHaveLength(before + 1);
    const pl = t.space().at(-1)!;
    expect(pl.geom).toMatchObject({ kind: 'LWPOLYLINE', closed: true });
    const g = pl.geom as unknown as { vertices: { x: number; y: number; bulge: number }[] };
    expect(g.vertices.map((v) => [r6(v.x), r6(v.y), v.bulge])).toEqual([
      [199, 109, 0],
      [201, 109, 0],
      [201, 111, 0],
      [199, 111, 0],
    ]);
  });
});

describe('XCLIP selection', () => {
  it('leaves out what is not a block reference, and a MINSERT', async () => {
    const t = drawing([
      ref({ x: 300, y: 100 }, { array: { columns: 2, rows: 1, columnSpacing: 5, rowSpacing: 0 } }),
    ]);
    await t.bus.submit('XCLIP');
    await t.bus.pick({ x: -5, y: -5 });
    await t.bus.pick({ x: 12, y: 5 });
    await t.bus.pick({ x: 295, y: 95 });
    await t.bus.pick({ x: 305, y: 105 });
    await t.bus.submit('');
    expect(t.log).toContain('2 objects are not a block reference or xref.');
    expect(t.bus.command).toBeUndefined();
  });
});

describe('XCLIP edge cases', () => {
  it('ends quietly at Esc on any prompt', async () => {
    for (const steps of [
      [],
      [''],
      ['', 'R'],
      ['', 'R', '1,1'],
      ['', 'P'],
      ['', 'P', '1,1'],
      ['', 'S'],
    ]) {
      const t = drawing();
      await t.xclip(R41);
      await t.bus.script(steps);
      expect(t.bus.command).toBe('XCLIP');
      await t.bus.cancel();
      expect(t.bus.command).toBeUndefined();
      expect(t.filters()).toHaveLength(0);
    }
  });

  it('ends without a polygon when Enter comes at the second point', async () => {
    const t = drawing();
    await t.xclip(R41);
    await t.bus.script(['', 'P', '1,1', '']);
    expect(t.log).toContain('The clipping boundary must enclose an area.');
    expect(t.bus.command).toBeUndefined();
    expect(t.filters()).toHaveLength(0);
  });

  it('ends at once when nothing is selected', async () => {
    const t = drawing();
    await t.bus.script(['XCLIP', '']);
    expect(t.bus.command).toBeUndefined();
  });

  it('takes a 2D POLYLINE and refuses a polyline that crosses itself', async () => {
    const vertices = (pts: [number, number][]) => pts.map(([x, y]) => ({ x, y, bulge: 0 }));
    const t = drawing([
      {
        kind: 'LWPOLYLINE',
        closed: true,
        vertices: vertices([
          [190, 20],
          [210, 40],
          [210, 20],
          [190, 50],
        ]),
      },
      {
        kind: 'POLYLINE',
        closed: true,
        is3d: false,
        vertices: vertices([
          [190, 0],
          [210, 0],
          [200, 10],
        ]),
      },
    ]);
    await t.xclip(R41);
    await t.bus.script(['', 'S']);
    await t.bus.pick({ x: 210, y: 30 });
    expect(t.log).toContain('The clipping boundary cannot intersect itself.');
    await t.bus.pick({ x: 200, y: 0 });
    expect(t.bus.command).toBeUndefined();
    expect(t.clipOf('41')!.boundary).toEqual([
      { x: 190, y: 0 },
      { x: 210, y: 0 },
      { x: 200, y: 10 },
    ]);
  });

  it('refuses a polygon whose edges touch end to side', async () => {
    const t = drawing();
    await t.xclip(R41);
    // The last edge runs back along the first one's line through 5,0.
    await t.bus.script(['', 'P', '0,0', '10,0', '10,10', '5,0', '']);
    expect(t.log).toContain('The clipping boundary cannot intersect itself.');
  });

  it('says why a reference scaled to nothing cannot be clipped', async () => {
    const t = drawing([ref({ x: 300, y: 100 }, { scale: 0 })]);
    await t.xclip({ x: 300, y: 100 });
    await t.bus.script(['', '', '299,99', '301,101']);
    expect(t.log).toContain('Block reference 42 has a zero scale and cannot be clipped.');
    expect(t.clipOf('42')).toBeUndefined();
  });

  it('turns nothing on and draws nothing for references without a clip', async () => {
    const t = drawing();
    const before = t.space().length;
    for (const option of ['ON', 'OFF', 'P']) {
      await t.xclip(R41);
      await t.bus.submit(option);
    }
    expect(t.log.filter((l) => l === 'No clipping boundary found.')).toHaveLength(3);
    expect(t.space()).toHaveLength(before);
  });
});
