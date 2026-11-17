// M4-24: a center mark's and a centerline's grips and Properties rows (AutoCAD 2024 Help,
// "CENTERMARK (Command)", "CENTERLINE (Command)", "To Modify Center Marks and Centerlines"):
// the centre grip moves the mark (letting go of its circle when moved on its own, as M4-08
// made a move do), and a grip at the end of each extension line stretches that extension, the
// mark drawn again from its circle (or from its own lines when associated to nothing). Properties
// shows a mark's cross size, cross gap, extension lines and extensions and whether it is
// associative, a centerline's start and end extensions, and edits them as CENTERRESET and
// MATCHPROP's Center object redraw a mark.
//
// The drawing adds to the sample (metric, current layer WALLS): 30 a circle r 10 at (50,50),
// 32 and 33 parallel lines (0,100)-(20,100) and (20,110)-(0,110) (drawn the other way).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  applyPoint,
  builtinCommands,
  centerMarkOf,
  closestPoint,
  dragMotion,
  gripInfoOf,
  gripsOf,
  insertMatrix,
  isCenterMark,
  offsetCurveOf,
  propertySheet,
  toleranceForSize,
  type BusEvent,
  type CenterMark,
  type DocumentInit,
  type Entity,
  type EntityId,
  type PropertyRow,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { MODEL_SPACE, entityInit, lineGeom, sampleInit } from '../model/fixtures';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
type Seg = number[];
/** A line's ends in order, lower x (then y) first, so lines compare whichever way they run. */
const ordered = ([x1, y1, x2, y2]: Seg): Seg =>
  x1! < x2! || (x1 === x2 && y1! <= y2!) ? [x1!, y1!, x2!, y2!] : [x2!, y2!, x1!, y1!];
const sorted = (lines: Seg[]): Seg[] =>
  lines
    .map((l) => ordered(l.map(r4)))
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]! || a[3]! - b[3]!);

function drawing(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    entities: [
      ...(base.entities ?? []),
      entityInit('30', { kind: 'CIRCLE', center: { x: 50, y: 50 }, radius: 10 }),
      entityInit('32', lineGeom(0, 100, 20, 100)),
      entityInit('33', lineGeom(20, 110, 0, 110)),
    ],
  };
}

function setup() {
  const model = DocumentModel.create(drawing());
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
  const mark = (): Entity => marks()[0]!;
  const record = (e: Entity = mark()): CenterMark | undefined => centerMarkOf(model, e);
  const records = (): CenterMark[] => [...model.objects.values()].filter(isCenterMark);
  /** The lines `insert` draws, in the drawing, as sorted [x1, y1, x2, y2]. */
  const lines = (insert: Entity = mark()): Seg[] => {
    const g = insert.geom;
    if (g.kind !== 'INSERT') return [];
    const m = insertMatrix(g, model.blocks.get(g.block)!.basePoint);
    return sorted(
      model.blockEntities(g.block).flatMap((id) => {
        const lg = model.entity(id)!.geom;
        if (lg.kind !== 'LINE') return [];
        const a = applyPoint(m, lg.start);
        const b = applyPoint(m, lg.end);
        return [[a.x, a.y, b.x, b.y]];
      }),
    );
  };
  /** The grips of `insert` as [kind or extension index, x, y]. */
  const grips = (insert: Entity = mark()) =>
    gripsOf(insert.geom, gripInfoOf(model, insert)).map((g) => [
      g.centerMark ?? g.kind,
      r4(g.point.x),
      r4(g.point.y),
    ]);
  /** Selects the object at `at` at `Command:` and clicks its grip at `p`. */
  const hot = async (at: { x: number; y: number }, p: { x: number; y: number }) => {
    await bus.pick(at);
    await bus.pick(p, { grip: 0.01 });
  };
  const sheet = () => propertySheet(model, bus.selection);
  const rowOf = (label: string): PropertyRow => {
    for (const s of sheet().sections) {
      const r = s.rows.find((x) => x.label === label);
      if (r) return r;
    }
    throw new Error(`no row ${label}`);
  };
  return { model, bus, log, marks, mark, record, records, lines, grips, hot, sheet, rowOf };
}

/** A center mark at (cx, cy) on a circle of radius r: cross 0.2r, gap 0.1r, extensions e. */
function markLines(cx: number, cy: number, r: number, e: readonly number[], cross = 0.2 * r) {
  const c = cross;
  const g = 0.1 * r; // 0.05 × the diameter
  const [left, right, top, bottom] = e;
  const out: Seg[] = [
    [cx - c, cy, cx + c, cy],
    [cx, cy - c, cx, cy + c],
  ];
  if (r + left! > c + g) out.push([cx - c - g, cy, cx - r - left!, cy]);
  if (r + right! > c + g) out.push([cx + c + g, cy, cx + r + right!, cy]);
  if (r + top! > c + g) out.push([cx, cy + c + g, cx, cy + r + top!]);
  if (r + bottom! > c + g) out.push([cx, cy - c - g, cx, cy - r - bottom!]);
  return sorted(out);
}

const E = 3.5; // CENTEREXE in a metric drawing without it

describe('center mark grips (M4-24)', () => {
  it('shows the centre and the end of each extension line', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    expect(s.grips()).toEqual([
      ['move', 50, 50],
      [0, 36.5, 50],
      [1, 63.5, 50],
      [2, 50, 63.5],
      [3, 50, 36.5],
    ]);
    // An extension grip is a square, as AutoCAD draws them.
    const info = gripInfoOf(s.model, s.mark());
    expect(gripsOf(s.mark().geom, info).every((g) => g.towards === undefined)).toBe(true);
  });

  it('stretches an extension to where its grip is dragged, along its axis, in one undo step', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.hot({ x: 50, y: 50 }, { x: 63.5, y: 50 });
    expect(s.bus.command).toBe('GRIP');
    expect(s.log).toContain('** STRETCH **');
    // The drag draws the mark as the click would make it, the mark itself faded.
    const drag = s.bus.prompt?.drag;
    expect(drag).toMatchObject({ kind: 'centerMark', id: s.mark().id });
    const motion = dragMotion(drag!, { x: 70, y: 52 });
    expect(motion?.preview?.faded).toEqual([s.mark().id]);
    const shown = sorted(
      (motion?.preview?.shapes ?? []).map(({ geom }) => {
        const g = geom as { start: { x: number; y: number }; end: { x: number; y: number } };
        return [g.start.x, g.start.y, g.end.x, g.end.y];
      }),
    );
    expect(shown).toEqual(markLines(50, 50, 10, [E, 10, E, E]));
    // Only the distance along the axis counts.
    await s.bus.submit('70,52');
    expect(s.bus.command).toBeUndefined();
    expect(s.record()).toMatchObject({ objects: ['30'], extensions: [E, 10, E, E] });
    expect(s.lines()).toEqual(markLines(50, 50, 10, [E, 10, E, E]));
    expect(s.grips()).toContainEqual([1, 70, 50]);
    // The mark stays selected and associative: it follows its circle with its new extension.
    expect(s.bus.selection).toEqual([s.mark().id]);
    await s.bus.clearSelection();
    await s.bus.script(['MOVE', '60,50', '', '0,0', '0,10']);
    expect(s.lines()).toEqual(markLines(50, 60, 10, [E, 10, E, E]));
    await s.bus.script(['U', 'U']);
    expect(s.record()).toMatchObject({ objects: ['30'], extensions: [E, E, E, E] });
    expect(s.lines()).toEqual(markLines(50, 50, 10, [E, E, E, E]));
  });

  it('takes an extension no shorter than nothing, and a base point given first', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.hot({ x: 50, y: 50 }, { x: 36.5, y: 50 });
    await s.bus.submit('45,50');
    expect(s.record()!.extensions).toEqual([0, E, E, E]);
    expect(s.lines()).toEqual(markLines(50, 50, 10, [0, E, E, E]));
    // Base point: the grip moves by the second point less the base point.
    await s.hot({ x: 50, y: 50 }, { x: 50, y: 63.5 });
    await s.bus.script(['B', '0,0', '0,2']);
    expect(s.record()!.extensions).toEqual([0, E, 5.5, E]);
  });

  it('turns with the mark: a turned mark’s grips and extensions are along its own axes', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.bus.script(['ROTATE', '60,50', '50,50', '', '0,0', '90']);
    // Left (its own −X) now points down.
    expect(s.grips()).toEqual([
      ['move', -50, 50],
      [0, -50, 36.5],
      [1, -50, 63.5],
      [2, -63.5, 50],
      [3, -36.5, 50],
    ]);
    await s.bus.clearSelection();
    await s.hot({ x: -50, y: 50 }, { x: -50, y: 36.5 });
    await s.bus.submit('-49,30');
    expect(s.record()).toMatchObject({ objects: [expect.any(String)], extensions: [10, E, E, E] });
  });

  it('moves the mark by its centre grip, letting go of its circle', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.hot({ x: 50, y: 50 }, { x: 50, y: 50 });
    await s.bus.submit('50,80');
    expect(s.mark().geom).toMatchObject({ position: { x: 50, y: 80 } });
    expect(s.record()).toMatchObject({ objects: [] });
    expect(s.records()).toHaveLength(1);
  });

  it('stretches a mark associated to nothing from its own lines', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.bus.script(['MOVE', '50,50', '', '0,0', '0,30']);
    expect(s.record()).toMatchObject({ objects: [] });
    await s.bus.clearSelection();
    await s.hot({ x: 50, y: 80 }, { x: 50, y: 93.5 });
    await s.bus.submit('50,96');
    expect(s.record()).toMatchObject({ objects: [], extensions: [E, E, 6, E] });
    expect(s.lines()).toEqual(markLines(50, 80, 10, [E, E, 6, E]));
  });

  it('shows only the centre grip when the extension lines are hidden', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARKEXE', '0', 'CENTERMARK', '60,50', '']);
    expect(s.grips()).toEqual([['move', 50, 50]]);
  });
});

describe('centerline grips (M4-24)', () => {
  it('shows its ends and its middle, and stretches each end’s extension', async () => {
    const s = setup();
    await s.bus.script(['CENTERLINE', '10,100', '10,110']);
    expect(s.lines()).toEqual([[-E, 105, 20 + E, 105]]);
    expect(s.grips()).toEqual([
      [0, -E, 105],
      ['move', 10, 105],
      [1, 20 + E, 105],
    ]);
    await s.hot({ x: 10, y: 105 }, { x: 20 + E, y: 105 });
    const motion = dragMotion(s.bus.prompt!.drag!, { x: 30, y: 107 });
    expect(motion?.preview?.shapes.map((x) => x.geom)).toEqual([
      { kind: 'LINE', start: { x: -E, y: 105 }, end: { x: 30, y: 105 } },
    ]);
    await s.bus.submit('30,107');
    expect(s.record()).toMatchObject({ kind: 'line', extensions: [E, 10] });
    expect(s.lines()).toEqual([[-E, 105, 30, 105]]);
    await s.bus.clearSelection();
    // Its middle grip is the middle of the line as it is now.
    expect(s.grips()[1]).toEqual(['move', 13.25, 105]);
    await s.hot({ x: 13.25, y: 105 }, { x: -E, y: 105 });
    await s.bus.submit('-1,100');
    expect(s.record()!.extensions).toEqual([1, 10]);
    expect(s.lines()).toEqual([[-1, 105, 30, 105]]);
  });
});

describe('center mark Properties rows (M4-24)', () => {
  it('shows a center mark’s rows under its own type name', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.bus.pick({ x: 50, y: 50 });
    expect(s.sheet().types).toEqual([{ type: 'INSERT', label: 'Center Mark', count: 1 }]);
    expect(
      s
        .sheet()
        .sections.slice(1)
        .map((x) => [x.title, x.rows.map((r) => r.label)]),
    ).toEqual([
      ['Geometry', ['Position X', 'Position Y', 'Rotation']],
      [
        'Center Mark',
        [
          'Cross size',
          'Cross gap',
          'Show extensions',
          'Left extension',
          'Right extension',
          'Top extension',
          'Bottom extension',
          'Associative',
        ],
      ],
    ]);
    expect(s.rowOf('Cross size')).toMatchObject({ kind: 'text', value: '0.1x' });
    expect(s.rowOf('Cross gap')).toMatchObject({ kind: 'text', value: '0.05x' });
    expect(s.rowOf('Show extensions')).toMatchObject({ kind: 'choice', value: 'yes' });
    expect(s.rowOf('Left extension')).toMatchObject({ kind: 'distance', value: E });
    expect(s.rowOf('Associative')).toMatchObject({ value: 'yes', readOnly: true });
  });

  it('draws the mark again with an edited cross size, gap, extension or extension lines', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.bus.pick({ x: 50, y: 50 });
    await s.bus.setProperty({ key: 'centerExtension:1', value: '6' });
    expect(s.record()).toMatchObject({ objects: ['30'], extensions: [E, 6, E, E] });
    expect(s.lines()).toEqual(markLines(50, 50, 10, [E, 6, E, E]));
    await s.bus.setProperty({ key: 'centerCrossSize', value: '4' });
    expect(s.record()!.crossSize).toBe('4');
    expect(s.lines()).toEqual(
      sorted([
        [46, 50, 54, 50],
        [50, 46, 50, 54],
        [45, 50, 50 - 10 - E, 50],
        [55, 50, 50 + 16, 50],
        [50, 55, 50, 50 + 10 + E],
        [50, 45, 50, 50 - 10 - E],
      ]),
    );
    await s.bus.setProperty({ key: 'centerCrossGap', value: '0.1x' });
    expect(s.record()!.crossGap).toBe('0.1x');
    expect(s.lines()).toContainEqual([50 + 6, 50, 66, 50]);
    await s.bus.setProperty({ key: 'centerShowExtensions', value: 'no' });
    expect(s.record()!.showExtensions).toBe(false);
    expect(s.lines()).toEqual(
      sorted([
        [46, 50, 54, 50],
        [50, 46, 50, 54],
      ]),
    );
    // It still follows its circle, and each edit is one undo step.
    await s.bus.script(['U']);
    expect(s.record()!.showExtensions).toBe(true);
    await s.bus.script(['U', 'U', 'U']);
    expect(s.record()).toMatchObject({ crossSize: '0.1x', extensions: [E, E, E, E] });
    expect(s.lines()).toEqual(markLines(50, 50, 10, [E, E, E, E]));
  });

  it('refuses a cross size that is no length or factor and a negative extension', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.bus.pick({ x: 50, y: 50 });
    await s.bus.setProperty({ key: 'centerCrossSize', value: 'big' });
    await s.bus.setProperty({ key: 'centerExtension:0', value: '-1' });
    expect(s.log.filter((l) => l === 'Invalid input.')).toHaveLength(2);
    expect(s.record()).toMatchObject({ crossSize: '0.1x', extensions: [E, E, E, E] });
  });

  it('shows what marks share, *VARIES* else, and edits a mark associated to nothing', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '']);
    await s.bus.script(['COPY', '50,50', '', '0,0', '0,40', '']);
    expect(s.marks()).toHaveLength(2);
    await s.bus.pick({ x: 50, y: 90 });
    await s.bus.setProperty({ key: 'centerExtension:2', value: '5' });
    const copy = s.marks()[1]!;
    expect(s.record(copy)).toMatchObject({ objects: [], extensions: [E, E, 5, E] });
    expect(s.lines(copy)).toEqual(markLines(50, 90, 10, [E, E, 5, E]));
    await s.bus.pick({ x: 50, y: 50 });
    expect(s.bus.selection).toHaveLength(2);
    expect(s.rowOf('Top extension')).toMatchObject({ varies: true });
    expect(s.rowOf('Left extension')).toMatchObject({ value: E });
    expect(s.rowOf('Associative')).toMatchObject({ varies: true });
  });

  it('shows a centerline’s start and end extensions', async () => {
    const s = setup();
    await s.bus.script(['CENTERLINE', '10,100', '10,110']);
    await s.bus.pick({ x: 10, y: 105 });
    expect(s.sheet().types).toEqual([{ type: 'INSERT', label: 'Centerline', count: 1 }]);
    expect(
      s
        .sheet()
        .sections.slice(1)
        .map((x) => [x.title, x.rows.map((r) => r.label)]),
    ).toEqual([
      ['Geometry', ['Position X', 'Position Y']],
      ['Centerline', ['Start extension', 'End extension', 'Associative']],
    ]);
    await s.bus.setProperty({ key: 'centerExtension:1', value: '10' });
    expect(s.record()).toMatchObject({ kind: 'line', extensions: [E, 10] });
    expect(s.lines()).toEqual([[-E, 105, 30, 105]]);
  });

  it('shows a block reference’s rows for marks and other block references together', async () => {
    const s = setup();
    await s.bus.script(['CENTERMARK', '60,50', '', 'CENTERLINE', '10,100', '10,110']);
    await s.bus.pick({ x: 50, y: 50 });
    await s.bus.pick({ x: 10, y: 105 });
    // A mark and a centerline: what both have.
    expect(s.sheet().types).toEqual([{ type: 'INSERT', label: 'Center Mark', count: 2 }]);
    expect(
      s
        .sheet()
        .sections.slice(1)
        .map((x) => [x.title, x.rows.map((r) => r.label)]),
    ).toEqual([
      ['Geometry', ['Position X', 'Position Y']],
      ['Center Mark', ['Associative']],
    ]);
  });
});
