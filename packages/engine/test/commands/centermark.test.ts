// M4-08 part 1: CENTERMARK and CENTERLINE (AutoCAD 2024 Help, "CENTERMARK (Command)",
// "CENTERLINE (Command)", "CENTEREXE"), associative to the objects they are made on: a mark is an
// INSERT of an anonymous block of lines with a TRIYA_CENTERMARK record in its extension
// dictionary (part 2, DEC-066), drawn again when its objects move.
//
// The drawing adds to the sample (metric, current layer WALLS): 30 a circle r 10 at (50,50),
// 31 an arc r 5 at (100,50), 32 and 33 parallel lines (0,100)-(20,100) and (20,110)-(0,110)
// (drawn the other way), 34 a line (0,200)-(20,200) and 35 a line (0,204)-(20,212); M4-29 adds
// 36 a polyline (0,300)-(20,300), an arc out to (25,305) back to (20,310), then to (0,310).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  applyPoint,
  builtinCommands,
  centerLength,
  centerMarkLines,
  centerMarkOf,
  centerlineOf,
  centerlinePick,
  closestPoint,
  compose,
  insertMatrix,
  isCenterMark,
  matchedCenterMark,
  offsetCurveOf,
  toleranceForSize,
  type BusEvent,
  type CenterMark,
  type DocumentInit,
  type Entity,
  type EntityId,
  type HeaderValue,
  type LinetypeDefinition,
  type Matrix2D,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { IDENTITY } from '../../src/geom/transform';
import {
  LAYER_0,
  LAYER_WALLS,
  MODEL_SPACE,
  blockRecord,
  entityInit,
  lineGeom,
  linetype,
  sampleInit,
} from '../model/fixtures';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
/** A line's ends in order, lower x (then y) first, so lines compare whichever way they run. */
const ordered = ([x1, y1, x2, y2]: number[]): number[] =>
  x1! < x2! || (x1 === x2 && y1! <= y2!) ? [x1!, y1!, x2!, y2!] : [x2!, y2!, x1!, y1!];

function drawing(o: { center2?: boolean; header?: [string, HeaderValue][] } = {}): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    header: new Map([...(base.header ?? []), ...(o.header ?? [])]),
    tables: {
      ...base.tables,
      linetypes: [
        ...(base.tables?.linetypes ?? []),
        ...(o.center2 ? [linetype('15', 'CENTER2')] : []),
      ],
    },
    entities: [
      ...(base.entities ?? []),
      entityInit('30', { kind: 'CIRCLE', center: { x: 50, y: 50 }, radius: 10 }),
      entityInit('31', {
        kind: 'ARC',
        center: { x: 100, y: 50 },
        radius: 5,
        startAngle: 0,
        endAngle: Math.PI / 2,
      }),
      entityInit('32', lineGeom(0, 100, 20, 100)),
      entityInit('33', lineGeom(20, 110, 0, 110)),
      entityInit('34', lineGeom(0, 200, 20, 200)),
      entityInit('35', lineGeom(0, 204, 20, 212)),
      entityInit('36', {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 0, y: 300, bulge: 0 },
          { x: 20, y: 300, bulge: 1 },
          { x: 20, y: 310, bulge: 0 },
          { x: 0, y: 310, bulge: 0 },
        ],
      }),
    ],
  };
}

/** What the app reads for a `linetypeFile` request, by file name (none by default). */
type Files = Record<string, readonly LinetypeDefinition[]>;

function setup(o: Parameters<typeof drawing>[0] & { files?: Files } = {}) {
  const model = DocumentModel.create(drawing(o));
  const asked: string[] = [];
  // A pick takes the nearest object within 0.25: a curve by its distance, a block reference by
  // its insertion point.
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'linetypeFile') {
        asked.push(r.file ?? '');
        const found = o.files?.[r.file ?? ''];
        return Promise.resolve(
          found ? { ok: true, linetypeFile: { name: r.file!, linetypes: found } } : { ok: true },
        );
      }
      if (r.op !== 'pick') return Promise.resolve({ ok: false, message: 'no' });
      const hits: [number, EntityId][] = [];
      for (const e of model.entities()) {
        if (e.owner !== MODEL_SPACE) continue;
        const c = offsetCurveOf(e.geom);
        const d = c
          ? closestPoint(c, r.point, toleranceForSize(100)).distance
          : e.geom.kind === 'INSERT'
            ? Math.hypot(e.geom.position.x - r.point.x, e.geom.position.y - r.point.y)
            : Infinity;
        if (d < 0.25) hits.push([d, e.id]);
      }
      hits.sort((a, b) => a[0] - b[0]);
      return Promise.resolve({ ok: true, ids: hits.map(([, id]) => id) });
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const live = (): Entity[] => model.blockEntities(MODEL_SPACE).map((id) => model.entity(id)!);
  const marks = (): Entity[] => live().filter((e) => e.geom.kind === 'INSERT');
  const record = (e: Entity): CenterMark | undefined => centerMarkOf(model, e);
  const records = (): CenterMark[] => [...model.objects.values()].filter(isCenterMark);
  /** The lines `insert` draws, in the drawing, as sorted [x1, y1, x2, y2]. */
  const lines = (insert: Entity): number[][] => {
    const g = insert.geom;
    if (g.kind !== 'INSERT') return [];
    const m: Matrix2D = compose(insertMatrix(g, model.blocks.get(g.block)!.basePoint), IDENTITY);
    return model
      .blockEntities(g.block)
      .map((id) => model.entity(id)!.geom)
      .flatMap((lg) => {
        if (lg.kind !== 'LINE') return [];
        const a = applyPoint(m, lg.start);
        const b = applyPoint(m, lg.end);
        return [ordered([r4(a.x), r4(a.y), r4(b.x), r4(b.y)])];
      })
      .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]! || a[3]! - b[3]!);
  };
  return { model, bus, log, marks, record, records, lines, asked };
}

/** A center mark at (cx, cy) on a circle of radius r: cross ±0.2r·…, extensions to r + e. */
function markLines(cx: number, cy: number, r: number, e: number): number[][] {
  const c = 0.2 * r; // 0.1 × the diameter
  const g = 0.1 * r; // 0.05 × the diameter
  const out = [
    [cx - c, cy, cx + c, cy],
    [cx, cy - c, cx, cy + c],
    [cx - c - g, cy, cx - r - e, cy],
    [cx + c + g, cy, cx + r + e, cy],
    [cx, cy + c + g, cx, cy + r + e],
    [cx, cy - c - g, cx, cy - r - e],
  ];
  return out
    .map((l) => ordered(l.map(r4)))
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]! || a[3]! - b[3]!);
}

describe('centerLength and the mark geometry', () => {
  it('reads a length or a factor of the diameter', () => {
    expect(centerLength('0.1x', 20)).toBeCloseTo(2);
    expect(centerLength('0.05X', 20)).toBeCloseTo(1);
    expect(centerLength('3', 20)).toBe(3);
    expect(centerLength('-1', 20)).toBe(0);
    expect(centerLength('abc', 20)).toBe(0);
  });

  it('leaves out an extension line the cross reaches past, and all of them when hidden', () => {
    const big = { crossSize: '20', crossGap: '1', extensions: [1, 1, 1, 1], showExtensions: true };
    expect(centerMarkLines(10, big)).toHaveLength(2);
    const hidden = { crossSize: '0.1x', crossGap: '0.05x', extensions: [1, 1, 1, 1] };
    expect(centerMarkLines(10, hidden)).toHaveLength(2);
    expect(centerMarkLines(10, { ...hidden, crossSize: '0', showExtensions: true })).toHaveLength(
      4,
    );
  });

  it('puts a centerline midway between parallel lines and on the bisector of others', () => {
    const mid = centerlineOf(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 10, y: 4 },
        { x: 0, y: 4 },
      ],
      [1, 2],
    )!;
    expect(mid.map((p) => [r4(p.x), r4(p.y)])).toEqual([
      [-1, 2],
      [12, 2],
    ]);
    // Lines along +X and +Y from the origin: the bisector at 45°.
    const v = centerlineOf(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
      ],
      [0, 0],
    )!;
    expect(v.map((p) => [r4(p.x), r4(p.y)])).toEqual([
      [0, 0],
      [5, 5],
    ]);
    // End to end along one line: no centerline.
    expect(
      centerlineOf(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        [
          { x: 20, y: 0 },
          { x: 10, y: 0 },
        ],
        [0, 0],
      ),
    ).toBeUndefined();
  });
});

describe('CENTERMARK', () => {
  it('marks a circle with a cross and extension lines CENTEREXE past it, as one block reference', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    expect(s.bus.command).toBeUndefined();
    const [mark] = s.marks();
    expect(s.marks()).toHaveLength(1);
    // On the current layer, ByLayer without CENTER2 (said once), CENTERLTSCALE 1.
    expect(mark!.layer).toBe(LAYER_WALLS);
    expect(mark!.linetype).toBe('ByLayer');
    expect(mark!.ltScale).toBe(1);
    expect(s.log).toContain('Linetype CENTER2 is not in the drawing: ByLayer is used.');
    expect(mark!.geom).toMatchObject({ kind: 'INSERT', position: { x: 50, y: 50 }, rotation: 0 });
    const g = mark!.geom as { block: string };
    expect(s.model.blocks.get(g.block)!.name).toMatch(/^\*U\d+$/);
    for (const id of s.model.blockEntities(g.block)) {
      const e = s.model.entity(id)!;
      expect(e.layer).toBe(LAYER_0);
      expect(e.color).toEqual({ kind: 'byBlock' });
      expect(e.linetype).toBe('ByBlock');
    }
    // A metric drawing without CENTEREXE: AutoCAD's 3.5.
    expect(s.lines(mark!)).toEqual(markLines(50, 50, 10, 3.5));
    const r = s.record(mark!)!;
    expect(r).toMatchObject({
      kind: 'mark',
      objects: ['30'],
      crossSize: '0.1x',
      crossGap: '0.05x',
      extensions: [3.5, 3.5, 3.5, 3.5],
      showExtensions: true,
    });
    expect(r.owner).toBe(mark!.extDict);
    expect(mark!.extDict).toBeDefined();
  });

  it('marks arcs and circles until Enter, refusing other objects, in the CENTER2 linetype', async () => {
    const s = setup({ center2: true, header: [['CENTEREXE', '5.000000']] });
    await s.bus.script(['CENTERMARK', '105,50', '10,100', '60,50', '']);
    expect(s.log).toContain('Object selected is not a circle or arc.');
    expect(s.log).not.toContain('Linetype CENTER2 is not in the drawing: ByLayer is used.');
    const marks = s.marks();
    expect(marks).toHaveLength(2);
    expect(marks.map((m) => m.linetype)).toEqual(['15', '15']);
    expect(s.lines(marks[0]!)).toEqual(markLines(100, 50, 5, 5));
    expect(s.lines(marks[1]!)).toEqual(markLines(50, 50, 10, 5));
    // One undo step takes both back.
    await s.bus.script(['U']);
    expect(s.marks()).toEqual([]);
    expect(s.records()).toEqual([]);
  });

  it('follows its circle when it moves or changes size, in the same undo step', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.bus.script(['MOVE', '60,50', '', '0,0', '10,5']);
    const [mark] = s.marks();
    expect(mark!.geom).toMatchObject({ position: { x: 60, y: 55 } });
    expect(s.lines(mark!)).toEqual(markLines(60, 55, 10, 3.5));
    await s.bus.script(['SCALE', '70,55', '', '60,55', '2']);
    expect(s.lines(s.marks()[0]!)).toEqual(markLines(60, 55, 20, 3.5));
    await s.bus.script(['U']);
    expect(s.lines(s.marks()[0]!)).toEqual(markLines(60, 55, 10, 3.5));
    await s.bus.script(['U']);
    expect(s.lines(s.marks()[0]!)).toEqual(markLines(50, 50, 10, 3.5));
    expect(s.record(s.marks()[0]!)).toBeDefined();
  });

  it('keeps its rotation when turned with its circle, and moves along when both are moved', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    // The circle (picked on its edge) and the mark (at its centre) turned 90° about (0,0).
    await s.bus.script(['ROTATE', '60,50', '50,50', '', '0,0', '90']);
    const [mark] = s.marks();
    expect(mark!.geom).toMatchObject({ position: { x: -50, y: 50 } });
    expect((mark!.geom as { rotation: number }).rotation).toBeCloseTo(Math.PI / 2);
    expect(s.lines(mark!)).toEqual(markLines(-50, 50, 10, 3.5));
    expect(s.record(mark!)).toBeDefined();
  });

  it('lets go of its circle when moved on its own', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.bus.script(['MOVE', '50,50', '', '0,0', '0,30']);
    const [mark] = s.marks();
    expect(mark!.geom).toMatchObject({ position: { x: 50, y: 80 } });
    // Still a center mark, as AutoCAD's is, associated to nothing (part 3).
    expect(s.record(mark!)).toMatchObject({ kind: 'mark', objects: [] });
    expect(s.records()).toHaveLength(1);
    // The circle moving now leaves it be.
    await s.bus.script(['MOVE', '60,50', '', '0,0', '10,0']);
    expect(s.marks()[0]!.geom).toMatchObject({ position: { x: 50, y: 80 } });
  });

  it('is erased with its circle, and undo brings both back associated', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.bus.script(['ERASE', '60,50', '']);
    expect(s.marks()).toEqual([]);
    expect(s.records()).toEqual([]);
    await s.bus.script(['U']);
    const [mark] = s.marks();
    expect(s.record(mark!)).toBeDefined();
    await s.bus.script(['MOVE', '60,50', '', '0,0', '1,0']);
    expect(s.marks()[0]!.geom).toMatchObject({ position: { x: 51, y: 50 } });
  });

  it('drops its record when it is erased or exploded', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.bus.script(['ERASE', '50,50', '']);
    expect(s.marks()).toEqual([]);
    expect(s.records()).toEqual([]);
    const t = setup();
    await t.bus.script(['CENTERMARK', '60,50', '']);
    await t.bus.script(['EXPLODE', '50,50', '']);
    expect(t.marks()).toEqual([]);
    expect(t.records()).toEqual([]);
  });

  it('copied with its circle, is a mark of the copy; copied alone, a disassociated mark of its own', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.bus.script(['COPY', '60,50', '50,50', '', '0,0', '100,0', '']);
    let marks = s.marks();
    expect(marks).toHaveLength(2);
    const copy = marks.find((m) => (m.geom as { position: { x: number } }).position.x === 150)!;
    const r = s.record(copy)!;
    const circle = s.model.entityByHandle(r.objects[0]!)!;
    expect(circle.geom).toMatchObject({ kind: 'CIRCLE', center: { x: 150, y: 50 } });
    expect((copy.geom as { block: string }).block).not.toBe(
      (marks.find((m) => m !== copy)!.geom as { block: string }).block,
    );
    // Moving the original circle leaves the copy as it is.
    await s.bus.script(['MOVE', '60,50', '', '0,0', '0,10']);
    marks = s.marks();
    expect(s.lines(marks.find((m) => m.handle === copy.handle)!)).toEqual(
      markLines(150, 50, 10, 3.5),
    );
    expect(s.lines(marks.find((m) => m.handle !== copy.handle)!)).toEqual(
      markLines(50, 60, 10, 3.5),
    );
    // The mark alone copied: a mark associated to nothing, and the original's redraw leaves it be.
    const t = setup();
    await t.bus.script(['CENTERMARK', '60,50', '']);
    await t.bus.script(['COPY', '50,50', '', '0,0', '0,-100', '']);
    const alone = t
      .marks()
      .find((m) => (m.geom as { position: { y: number } }).position.y === -50)!;
    expect(t.record(alone)).toMatchObject({ kind: 'mark', objects: [], crossSize: '0.1x' });
    await t.bus.script(['SCALE', '60,50', '', '50,50', '2']);
    expect(t.lines(alone)).toEqual(markLines(50, -50, 10, 3.5));
  });

  it("keeps its record in the mark's own extension dictionary, a copy in the copy's (M4-08 part 2, DEC-066)", async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    const [mark] = s.marks();
    const r = s.record(mark!)!;
    expect(mark!.extDict).toBeDefined();
    expect(r.owner).toBe(mark!.extDict);
    expect(r.insert).toBe(mark!.handle);
    await s.bus.script(['COPY', '60,50', '50,50', '', '0,0', '100,0', '']);
    const copy = s.marks().find((m) => m.handle !== mark!.handle)!;
    expect(copy.extDict).toBeDefined();
    expect(copy.extDict).not.toBe(mark!.extDict);
    expect(s.record(copy)!.owner).toBe(copy.extDict);
    // Copied alone, a mark of its own associated to nothing, in a dictionary of its own.
    await s.bus.script(['COPY', '50,50', '', '0,0', '0,-100', '']);
    const alone = s
      .marks()
      .find((m) => (m.geom as { position: { y: number } }).position.y === -50)!;
    expect(alone.extDict).toBeDefined();
    expect(s.record(alone)).toMatchObject({ objects: [], owner: alone.extDict });
    // Moved on its own it lets go: the record stays in the dictionary, associated to nothing.
    await s.bus.script(['MOVE', '50,50', '', '0,0', '0,30']);
    const moved = s.model.entityByHandle(mark!.handle)!;
    expect(s.record(moved)).toMatchObject({ objects: [] });
    expect(moved.extDict).toBe(mark!.extDict);
  });

  it('follows its circle when the drawing was opened with its record (a reopened save)', async () => {
    const base = drawing();
    const model = DocumentModel.create({
      ...base,
      tables: {
        ...base.tables,
        blockRecords: [...(base.tables?.blockRecords ?? []), blockRecord('50', '*U1')],
      },
      blocks: [
        ...(base.blocks ?? []),
        { handle: '50', name: '*U1', basePoint: { x: 0, y: 0 }, flags: 1 },
      ],
      entities: [
        ...(base.entities ?? []),
        entityInit('51', lineGeom(-2, 0, 2, 0), { owner: '50', layer: LAYER_0 }),
        {
          ...entityInit('52', {
            kind: 'INSERT',
            block: '50',
            position: { x: 50, y: 50 },
            scale: { x: 1, y: 1, z: 1 },
            rotation: 0,
            attributes: [],
          }),
          extDict: '53',
        },
      ],
      objects: [
        ...(base.objects ?? []),
        {
          handle: '54',
          owner: '53',
          type: 'TRIYA_CENTERMARK',
          insert: '52',
          kind: 'mark',
          objects: ['30'],
          crossSize: '0.1x',
          crossGap: '0.05x',
          extensions: [3.5, 3.5, 3.5, 3.5],
          showExtensions: true,
        } as CenterMark,
      ],
    });
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r): Promise<ViewReply> =>
          Promise.resolve(
            r.op === 'pick'
              ? { ok: true, ids: [model.entityByHandle('30')!.id] }
              : { ok: false, message: 'no' },
          ),
      },
    });
    expect(centerMarkOf(model, model.entityByHandle('52'))?.handle).toBe('54');
    await bus.script(['MOVE', '60,50', '', '0,0', '5,0']);
    const mark = model.entityByHandle('52')!;
    expect(mark.geom).toMatchObject({ position: { x: 55, y: 50 } });
    expect(mark.extDict).toBe('53');
    const g = mark.geom as { block: string };
    expect(model.blockEntities(g.block)).toHaveLength(6);
  });

  it('ends at Esc and Enter without a mark', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '']);
    expect(s.marks()).toEqual([]);
    await s.bus.script(['CENTERMARK']);
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
    expect(s.marks()).toEqual([]);
  });
});

describe('CENTERLINE', () => {
  it('draws a centerline midway between parallel lines, CENTEREXE past their ends', async () => {
    const s = setup();
    await s.bus.script(['CENTERLINE', '10,100', '10,110']);
    expect(s.bus.command).toBeUndefined();
    const [line] = s.marks();
    expect(s.lines(line!)).toEqual([[-3.5, 105, 23.5, 105]]);
    expect(s.record(line!)).toMatchObject({
      kind: 'line',
      objects: ['32', '33'],
      extensions: [3.5, 3.5],
    });
    expect(line!.layer).toBe(LAYER_WALLS);
  });

  it('follows its lines', async () => {
    const s = setup();
    await s.bus.script(['CENTERLINE', '10,100', '10,110']);
    await s.bus.script(['MOVE', '10,110', '', '0,0', '0,10']);
    expect(s.lines(s.marks()[0]!)).toEqual([[-3.5, 110, 23.5, 110]]);
  });

  it('runs along the bisector of lines that are not parallel', async () => {
    const s = setup();
    await s.bus.script(['CENTERLINE', '10,200', '10,208']);
    const [[x1, y1, x2, y2]] = s.lines(s.marks()[0]!) as [number[]];
    // The lines cross at (-10, 200), at 0° and atan(0.4); the bisector halves that angle.
    const half = Math.atan(0.4) / 2;
    expect(Math.atan2(y2! - y1!, x2! - x1!)).toBeCloseTo(half, 4);
    expect(y1! - 200).toBeCloseTo((x1! + 10) * Math.tan(half), 3);
  });

  it('refuses what is not a line and the same line twice', async () => {
    const s = setup();
    await s.bus.script(['CENTERLINE', '60,50', '10,100', '10,100', '10,110']);
    expect(s.log).toContain('Object selected is not a line.');
    expect(s.log).toContain('Select a different line.');
    expect(s.marks()).toHaveLength(1);
  });

  it('says when the lines meet end to end', async () => {
    const s = setup();
    await s.bus.script(['LINE', '20,200', '30,200', '']);
    await s.bus.script(['CENTERLINE', '10,200', '25,200']);
    expect(s.log).toContain('The lines meet end to end: there is no centerline between them.');
    expect(s.marks()).toEqual([]);
  });
});

describe('CENTERLINE on polyline segments (M4-29, DEC-068)', () => {
  it('runs between two straight segments of one polyline, refusing its arc and the same segment twice', async () => {
    const s = setup();
    await s.bus.script(['CENTERLINE', '10,300', '25,305', '10,300', '10,310']);
    expect(s.log).toContain('Polyline segment selected is not straight.');
    expect(s.log).toContain('Select a different line.');
    const [line] = s.marks();
    expect(s.lines(line!)).toEqual([[-3.5, 305, 23.5, 305]]);
    expect(s.record(line!)).toMatchObject({
      kind: 'line',
      objects: ['36', '36'],
      segments: [0, 2],
      extensions: [3.5, 3.5],
    });
  });

  it('runs between a line and a polyline segment; between lines the record has no segments', async () => {
    const s = setup();
    await s.bus.script(['CENTERLINE', '10,100', '10,310']);
    const [line] = s.marks();
    expect(s.lines(line!)).toEqual([[-3.5, 205, 23.5, 205]]);
    expect(s.record(line!)).toMatchObject({ objects: ['32', '36'], segments: [-1, 2] });
    await s.bus.script(['CENTERLINE', '10,100', '10,110']);
    const plain = s.records().find((r) => r.objects[1] === '33');
    expect(plain && 'segments' in plain).toBe(false);
  });

  it('follows its segment when a vertex of the polyline moves, in the same undo step', async () => {
    const s = setup();
    await s.bus.script(['CENTERLINE', '10,300', '10,310']);
    await s.bus.pick({ x: 10, y: 300 });
    await s.bus.pick({ x: 0, y: 310 }, { grip: 0.01 });
    await s.bus.submit('#0,320');
    await s.bus.clearSelection();
    const want = centerlineOf(
      [
        { x: 0, y: 300 },
        { x: 20, y: 300 },
      ],
      [
        { x: 20, y: 310 },
        { x: 0, y: 320 },
      ],
      [3.5, 3.5],
    )!;
    expect(s.lines(s.marks()[0]!)).toEqual([
      ordered([want[0].x, want[0].y, want[1].x, want[1].y].map(r4)),
    ]);
    await s.bus.script(['U']);
    expect(s.lines(s.marks()[0]!)).toEqual([[-3.5, 305, 23.5, 305]]);
  });

  it('goes when its polyline is erased, record and all', async () => {
    const s = setup();
    await s.bus.script(['CENTERLINE', '10,300', '10,310']);
    await s.bus.script(['ERASE', '10,300', '']);
    expect(s.marks()).toEqual([]);
    expect(s.records()).toEqual([]);
  });

  it('CENTERREASSOCIATE moves a centerline onto polyline segments and back onto lines', async () => {
    const s = setup();
    await s.bus.script(['CENTERLINE', '10,100', '10,110']);
    await s.bus.script(['CENTERREASSOCIATE', '10,105', '10,310', '10,300']);
    const [line] = s.marks();
    expect(s.record(line!)).toMatchObject({ objects: ['36', '36'], segments: [2, 0] });
    expect(s.lines(line!)).toEqual([[-3.5, 305, 23.5, 305]]);
    await s.bus.script(['CENTERREASSOCIATE', '10,305', '10,100', '10,110']);
    const r = s.record(s.marks()[0]!)!;
    expect(r.objects).toEqual(['32', '33']);
    expect('segments' in r).toBe(false);
  });

  it('copied with its polyline, is a centerline on the same segments of the copy', async () => {
    const s = setup();
    await s.bus.script(['CENTERLINE', '10,300', '10,310']);
    await s.bus.script(['COPY', '10,300', '10,305', '', '0,0', '100,0']);
    const copy = s.records().find((r) => r.objects[0] !== '36');
    expect(copy).toMatchObject({ kind: 'line', segments: [0, 2] });
    expect(copy!.objects[0]).toBe(copy!.objects[1]);
    const insert = s.marks().find((m) => m.handle === copy!.insert)!;
    expect(s.lines(insert)).toEqual([[96.5, 305, 123.5, 305]]);
  });

  it('takes the first straight segment without a pick, and refuses fit and 3D polylines', () => {
    const pl = (geom: Entity['geom']) =>
      ({ ...entityInit('99', geom), id: 1 }) as unknown as Entity;
    const vertices = [
      { x: 0, y: 0, bulge: 1 },
      { x: 10, y: 0, bulge: 0 },
      { x: 10, y: 10, bulge: 0 },
    ];
    expect(centerlinePick(pl({ kind: 'LWPOLYLINE', closed: false, vertices }), undefined)).toEqual({
      segment: 1,
    });
    const heavy = { kind: 'POLYLINE', closed: false, is3d: false, vertices } as const;
    expect(centerlinePick(pl(heavy), { x: 10, y: 5 })).toEqual({ segment: 1 });
    expect(centerlinePick(pl({ ...heavy, fit: 'curve' }), { x: 10, y: 5 })).toEqual({
      refused: 'not-line',
    });
    expect(centerlinePick(pl({ ...heavy, is3d: true }), { x: 10, y: 5 })).toEqual({
      refused: 'not-line',
    });
    expect(centerlinePick(pl({ ...heavy, closed: true }), { x: 0, y: 5 })).toEqual({
      segment: 2,
    });
  });
});

/** `markLines` with a cross `cf` and gap `gf` of the diameter, extensions `e` (none when 0 shown). */
function markLinesOf(
  cx: number,
  cy: number,
  r: number,
  e: number | undefined,
  cf = 0.1,
  gf = 0.05,
): number[][] {
  const c = cf * 2 * r;
  const g = gf * 2 * r;
  const out = [
    [cx - c, cy, cx + c, cy],
    [cx, cy - c, cx, cy + c],
  ];
  if (e !== undefined) {
    out.push(
      [cx - c - g, cy, cx - r - e, cy],
      [cx + c + g, cy, cx + r + e, cy],
      [cx, cy + c + g, cx, cy + r + e],
      [cx, cy - c - g, cx, cy - r - e],
    );
  }
  return out
    .map((l) => ordered(l.map(r4)))
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]! || a[3]! - b[3]!);
}

describe('the CENTER* variables (M4-08 part 3)', () => {
  it("start at AutoCAD's initial values, text shown in quotes as SETVAR shows it", async () => {
    const s = setup();
    for (const [name, value] of [
      ['CENTERCROSSSIZE', '"0.1x"'],
      ['CENTERCROSSGAP', '"0.05x"'],
      ['CENTEREXE', '3.5000'],
      ['CENTERMARKEXE', '1'],
      ['CENTERLTYPE', '"CENTER2"'],
      ['CENTERLTSCALE', '1.0000'],
      ['CENTERLAYER', '"."'],
    ]) {
      await s.bus.script(['SETVAR', name!]);
      expect(s.bus.promptText).toBe(`Enter new value for ${name} <${value}>:`);
      await s.bus.script(['']);
    }
    // Metric drawings start CENTEREXE at 3.5, imperial ones at 0.12.
    const imperial = setup({ header: [['$MEASUREMENT', 0]] });
    await imperial.bus.script(['SETVAR', 'CENTEREXE']);
    expect(imperial.bus.promptText).toBe('Enter new value for CENTEREXE <0.1200>:');
  });

  it('give new marks their cross size, gap and extensions; CENTERMARKEXE 0 leaves extensions out', async () => {
    const s = setup();
    await s.bus.script(['SETVAR', 'CENTERCROSSSIZE', '0.2x']);
    await s.bus.script(['SETVAR', 'CENTERCROSSGAP', '1']);
    await s.bus.script(['SETVAR', 'CENTEREXE', '2']);
    await s.bus.script(['CENTERMARK', '60,50', '']);
    const [mark] = s.marks();
    expect(s.record(mark!)).toMatchObject({
      crossSize: '0.2x',
      crossGap: '1',
      extensions: [2, 2, 2, 2],
      showExtensions: true,
    });
    // Arms 4 long (0.2 × 20), a gap of 1, extension lines from 5 to 12.
    expect(s.lines(mark!)).toEqual(markLinesOf(50, 50, 10, 2, 0.2, 0.05));
    await s.bus.script(['SETVAR', 'CENTERMARKEXE', '0']);
    await s.bus.script(['CENTERMARK', '105,50', '']);
    const arc = s.marks().find((m) => m.handle !== mark!.handle)!;
    expect(s.record(arc)!.showExtensions).toBe(false);
    expect(s.lines(arc)).toEqual(markLinesOf(100, 50, 5, undefined, 0.2));
  });

  it('refuse a cross size or gap that is no length or factor', async () => {
    const s = setup();
    await s.bus.script(['SETVAR', 'CENTERCROSSSIZE', 'big', '0.3X']);
    expect(s.log).toContain('Requires a length, or a factor of the diameter followed by x.');
    await s.bus.script(['SETVAR', 'CENTERCROSSSIZE']);
    expect(s.bus.promptText).toBe('Enter new value for CENTERCROSSSIZE <"0.3X">:');
  });

  it('put new marks on CENTERLAYER (made when the drawing lacks it) in CENTERLTYPE at CENTERLTSCALE', async () => {
    const s = setup();
    await s.bus.script(['SETVAR', 'CENTERLAYER', 'Center lines']);
    await s.bus.script(['SETVAR', 'CENTERLTYPE', 'Continuous']);
    await s.bus.script(['SETVAR', 'CENTERLTSCALE', '0.5']);
    await s.bus.script(['CENTERMARK', '60,50', '']);
    const [mark] = s.marks();
    const layer = s.model.tables.layers.get(mark!.layer)!;
    expect(layer.name).toBe('Center lines');
    expect(mark!.linetype).toBe('14');
    expect(mark!.ltScale).toBe(0.5);
    expect(s.log).not.toContain('Linetype CENTER2 is not in the drawing: ByLayer is used.');
    // The layer made once: a second mark goes on it.
    await s.bus.script(['CENTERLINE', '10,100', '10,110']);
    const line = s.marks().find((m) => m.handle !== mark!.handle)!;
    expect(line.layer).toBe(mark!.layer);
    // "." puts them on the current layer in the current linetype.
    await s.bus.script(['SETVAR', 'CENTERLAYER', '.']);
    await s.bus.script(['SETVAR', 'CENTERLTYPE', '.']);
    await s.bus.script(['CENTERMARK', '105,50', '']);
    const third = s.marks().at(-1)!;
    expect(third.layer).toBe(LAYER_WALLS);
    expect(third.linetype).toBe('ByLayer');
  });
});

describe('CENTERDISASSOCIATE, CENTERREASSOCIATE and CENTERRESET (M4-08 part 3)', () => {
  it('CENTERDISASSOCIATE lets marks go of their objects, staying as drawn; other objects are left be', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.bus.script(['CENTERDISASSOCIATE', '50,50', '60,50', '']);
    expect(s.log).toContain('1 center mark or centerline disassociated.');
    const [mark] = s.marks();
    expect(s.record(mark!)).toMatchObject({ kind: 'mark', objects: [] });
    await s.bus.script(['MOVE', '60,50', '', '0,0', '10,0']);
    expect(s.lines(s.marks()[0]!)).toEqual(markLines(50, 50, 10, 3.5));
    // Undo brings the association back.
    await s.bus.script(['U']);
    await s.bus.script(['U']);
    expect(s.record(s.marks()[0]!)).toMatchObject({ objects: ['30'] });
  });

  it('CENTERREASSOCIATE puts a disassociated mark on another circle or arc, which it then follows', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.bus.script(['CENTERDISASSOCIATE', '50,50', '']);
    await s.bus.script(['CENTERREASSOCIATE']);
    expect(s.bus.promptText).toBe('Select center mark or centerline:');
    await s.bus.script(['50,50']);
    expect(s.bus.promptText).toBe('Select circle or arc:');
    await s.bus.script(['10,100', '105,50']);
    expect(s.log).toContain('Object selected is not a circle or arc.');
    const [mark] = s.marks();
    expect(s.record(mark!)).toMatchObject({ kind: 'mark', objects: ['31'] });
    expect(s.lines(mark!)).toEqual(markLines(100, 50, 5, 3.5));
    await s.bus.script(['MOVE', '105,50', '', '0,0', '0,10']);
    expect(s.lines(s.marks()[0]!)).toEqual(markLines(100, 60, 5, 3.5));
  });

  it('CENTERREASSOCIATE moves an associated centerline to two other lines, and refuses what is no mark', async () => {
    const s = setup();
    await s.bus.script(['CENTERLINE', '10,100', '10,110']);
    await s.bus.script(['CENTERREASSOCIATE', '60,50', '10,105', '10,200', '10,208']);
    expect(s.log).toContain('Object selected is not a center mark or centerline.');
    const [line] = s.marks();
    expect(s.record(line!)).toMatchObject({ kind: 'line', objects: ['34', '35'] });
    const [[x1, y1, x2, y2]] = s.lines(line!) as [number[]];
    expect(Math.atan2(y2! - y1!, x2! - x1!)).toBeCloseTo(Math.atan(0.4) / 2, 4);
    // The first pair moving now leaves it be.
    await s.bus.script(['MOVE', '10,100', '', '0,0', '0,-50']);
    expect(s.lines(s.marks()[0]!)).toEqual([[x1, y1, x2, y2]]);
  });

  it('CENTERRESET gives marks, associated or not, the extensions CENTEREXE states now', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '105,50', '']);
    await s.bus.script(['CENTERLINE', '10,100', '10,110']);
    await s.bus.script(['CENTERDISASSOCIATE', '100,50', '']);
    // The disassociated one moved off its arc on its own.
    await s.bus.script(['MOVE', '100,50', '', '0,0', '0,-100']);
    await s.bus.script(['SETVAR', 'CENTEREXE', '6']);
    await s.bus.script(['CENTERRESET', '50,50', '100,-50', '10,105', '']);
    expect(s.log).toContain('3 center marks or centerlines reset.');
    const [circle, arc, line] = s.marks();
    expect(s.lines(circle!)).toEqual(markLines(50, 50, 10, 6));
    expect(s.record(circle!)!.extensions).toEqual([6, 6, 6, 6]);
    expect(s.lines(arc!)).toEqual(markLines(100, -50, 5, 6));
    expect(s.record(arc!)).toMatchObject({ objects: [], extensions: [6, 6, 6, 6] });
    expect(s.lines(line!)).toEqual([[-6, 105, 26, 105]]);
    // One undo step.
    await s.bus.script(['U']);
    expect(s.lines(s.marks()[1]!)).toEqual(markLines(100, -50, 5, 3.5));
  });
});

describe("MATCHPROP's Center object (M4-08 part 3)", () => {
  it('gives a mark the source mark’s cross size, gap and extensions', async () => {
    const s = setup();
    await s.bus.script(['SETVAR', 'CENTERCROSSSIZE', '0.2x']);
    await s.bus.script(['SETVAR', 'CENTEREXE', '5']);
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.bus.script(['SETVAR', 'CENTERCROSSSIZE', '0.1x']);
    await s.bus.script(['SETVAR', 'CENTEREXE', '1']);
    await s.bus.script(['CENTERMARK', '105,50', '']);
    await s.bus.script(['CENTERLINE', '10,100', '10,110']);
    await s.bus.script(['MATCHPROP', '50,50', '100,50', '10,105', '']);
    expect(s.log).toContain(
      'Current active settings:  Color Layer Ltype Ltscale Lineweight Transparency Thickness PlotStyle Dim Text Hatch Polyline Viewport Table Material Multileader Center object',
    );
    const [, arc, line] = s.marks();
    expect(s.record(arc!)).toMatchObject({ crossSize: '0.2x', extensions: [5, 5, 5, 5] });
    expect(s.lines(arc!)).toEqual(markLinesOf(100, 50, 5, 5, 0.2));
    // A centerline takes the extension.
    expect(s.lines(line!)).toEqual([[-5, 105, 25, 105]]);
  });

  it('leaves marks be with Center object off', () => {
    const source = { crossSize: '0.2x', crossGap: '1', extensions: [5, 5, 5, 5] };
    const target: CenterMark = {
      handle: 'A0',
      owner: 'A1',
      type: 'TRIYA_CENTERMARK',
      insert: 'A2',
      kind: 'mark',
      objects: [],
      crossSize: '0.1x',
      crossGap: '0.05x',
      extensions: [1, 1, 1, 1],
      showExtensions: true,
    };
    expect(matchedCenterMark({ ...target, ...source }, target, true)).toMatchObject(source);
    expect(matchedCenterMark({ ...target, ...source }, target, false)).toBeUndefined();
    expect(matchedCenterMark(target, target, true)).toBeUndefined();
  });
});

describe('CENTERLTYPE loaded from the bundled drafting linetypes (M5-08 part 2)', () => {
  const center2 = (k: number): LinetypeDefinition => ({
    name: 'CENTER2',
    description: 'Center line (half size)',
    elements: [0.625, -0.0625, 0.125, -0.0625].map((length) => ({ length: length * k })),
  });
  const files: Files = {
    'triya-drafting.lin': [center2(1)],
    'triya-drafting-iso.lin': [center2(25.4)],
  };
  const center2Of = (m: DocumentModel) =>
    [...m.tables.linetypes.values()].find((l) => l.name === 'CENTER2');

  it('a metric drawing loads CENTER2 in millimetres once, in the marks’ undo step', async () => {
    const s = setup({ files });
    await s.bus.script(['CENTERMARK', '60,50', '105,50', '']);
    const lt = center2Of(s.model)!;
    expect(lt.elements.map((e) => e.length)).toEqual([15.875, -1.5875, 3.175, -1.5875]);
    expect(s.marks().map((m) => m.linetype)).toEqual([lt.handle, lt.handle]);
    expect(s.asked).toEqual(['triya-drafting-iso.lin']);
    expect(s.log).not.toContain('Linetype CENTER2 is not in the drawing: ByLayer is used.');
    await s.bus.script(['U']);
    expect(s.marks()).toHaveLength(0);
    expect(center2Of(s.model)).toBeUndefined();
  });

  it('an imperial drawing loads it in inches; CENTERLINE loads it too', async () => {
    const s = setup({ files, header: [['$MEASUREMENT', 0]] });
    await s.bus.script(['CENTERLINE', '10,100', '10,110']);
    const lt = center2Of(s.model)!;
    expect(lt.elements.map((e) => e.length)).toEqual([0.625, -0.0625, 0.125, -0.0625]);
    expect(s.marks()[0]!.linetype).toBe(lt.handle);
    expect(s.asked).toEqual(['triya-drafting.lin']);
  });

  it('a drawing with CENTER2 reads no file; a file without it leaves the mark ByLayer', async () => {
    const has = setup({ files, center2: true });
    await has.bus.script(['CENTERMARK', '60,50', '']);
    expect(has.asked).toEqual([]);
    expect(has.marks()[0]!.linetype).toBe('15');
    const lacks = setup({ files: { 'triya-drafting-iso.lin': [] } });
    await lacks.bus.script(['CENTERMARK', '60,50', '']);
    expect(lacks.marks()[0]!.linetype).toBe('ByLayer');
    expect(lacks.log).toContain('Linetype CENTER2 is not in the drawing: ByLayer is used.');
  });
});
