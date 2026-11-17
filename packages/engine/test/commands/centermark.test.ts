// M4-08 part 1: CENTERMARK and CENTERLINE (AutoCAD 2024 Help, "CENTERMARK (Command)",
// "CENTERLINE (Command)", "CENTEREXE"), associative to the objects they are made on: a mark is an
// INSERT of an anonymous block of lines with a TRIYA_CENTERMARK record in its extension
// dictionary (part 2, DEC-066), drawn again when its objects move.
//
// The drawing adds to the sample (metric, current layer WALLS): 30 a circle r 10 at (50,50),
// 31 an arc r 5 at (100,50), 32 and 33 parallel lines (0,100)-(20,100) and (20,110)-(0,110)
// (drawn the other way), 34 a line (0,200)-(20,200) and 35 a line (0,204)-(20,212).
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
  closestPoint,
  compose,
  insertMatrix,
  isCenterMark,
  offsetCurveOf,
  toleranceForSize,
  type BusEvent,
  type CenterMark,
  type DocumentInit,
  type Entity,
  type EntityId,
  type HeaderValue,
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
    ],
  };
}

function setup(o: Parameters<typeof drawing>[0] = {}) {
  const model = DocumentModel.create(drawing(o));
  // A pick takes the nearest object within 0.25: a curve by its distance, a block reference by
  // its insertion point.
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
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
  return { model, bus, log, marks, record, records, lines };
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
    expect(s.record(mark!)).toBeUndefined();
    expect(s.records()).toEqual([]);
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

  it('copied with its circle, is a mark of the copy; copied alone, a plain block of its own', async () => {
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
    // The mark alone copied: no record, and the original's redraw leaves it be.
    const t = setup();
    await t.bus.script(['CENTERMARK', '60,50', '']);
    await t.bus.script(['COPY', '50,50', '', '0,0', '0,-100', '']);
    const alone = t
      .marks()
      .find((m) => (m.geom as { position: { y: number } }).position.y === -50)!;
    expect(t.record(alone)).toBeUndefined();
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
    // Copied alone, a plain block reference: no dictionary.
    await s.bus.script(['COPY', '50,50', '', '0,0', '0,-100', '']);
    const alone = s
      .marks()
      .find((m) => (m.geom as { position: { y: number } }).position.y === -50)!;
    expect(alone.extDict).toBeUndefined();
    // Moved on its own it lets go: the record leaves the dictionary, which stays.
    await s.bus.script(['MOVE', '50,50', '', '0,0', '0,30']);
    const moved = s.model.entityByHandle(mark!.handle)!;
    expect(s.record(moved)).toBeUndefined();
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
