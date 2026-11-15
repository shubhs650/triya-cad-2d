// M3-11 part 3: array grips. An associative array Triya made shows AutoCAD's multi-functional
// array grips (AutoCAD 2024 Help, "About Editing Associative Arrays", "To Work With Rectangular
// / Polar / Path Arrays"): a square base grip that moves it and triangles that size it, each
// with the functions AutoCAD's hover menu offers, here as the hot grip's options.
//
// The drawing adds to the sample: 30 a circle r 1 at the origin (the source: default spacings
// of 3), 31 a line (0,10)-(20,10), the path, and 33 a line (2,0)-(3,0).
import { describe, expect, it } from 'vitest';
import {
  ARRAY_GRIP_FUNCTIONS,
  DocumentModel,
  PromptBus,
  applyPoint,
  arrayGripEdit,
  arrayGripPreview,
  assocArrayOf,
  builtinCommands,
  compose,
  dragMotion,
  GRIP_CYCLE,
  gripInfoOf,
  gripsOf,
  insertMatrix,
  moveGrip,
  nearestStation,
  arrayPath,
  type AssocArray,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type EntityId,
  type Matrix2D,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { IDENTITY } from '../../src/geom/transform';
import { MODEL_SPACE, entityInit, lineGeom, sampleInit } from '../model/fixtures';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

function drawing(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    // Only the source objects and the path in model space: no other grips in the way.
    entities: [
      ...(base.entities ?? []).filter((e) => e.owner !== MODEL_SPACE),
      entityInit('30', { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 }),
      entityInit('31', lineGeom(0, 10, 20, 10)),
      entityInit('33', lineGeom(2, 0, 3, 0)),
    ],
  };
}

function setup() {
  const model = DocumentModel.create(drawing());
  let picks: EntityId[] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') return Promise.resolve({ ok: true, ids: picks });
      if (r.op === 'sysvar' && r.name === 'ARRAYASSOCIATIVITY') {
        return Promise.resolve({ ok: true, value: 1 });
      }
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const pick = (...handles: string[]) => {
    picks = handles.map((h) => model.entityByHandle(h)!.id);
  };
  const array = (): Entity =>
    model
      .blockEntities(MODEL_SPACE)
      .map((id) => model.entity(id)!)
      .find((e) => assocArrayOf(model.objects.values(), e))!;
  const record = (): AssocArray => assocArrayOf(model.objects.values(), array())!;
  const grips = () =>
    gripsOf(array().geom, gripInfoOf(model, array())).map((g) => [
      g.array ?? g.kind,
      r4(g.point.x),
      r4(g.point.y),
    ]);
  /** Selects the array at `Command:` and clicks its grip at `p`. */
  const hot = async (p: { x: number; y: number }) => {
    pick(array().handle);
    await bus.pick({ x: 1000, y: 1000 });
    await bus.pick(p, { grip: 0.01 });
  };
  /** Every source object as drawn through the array, as sorted [x, y] of its first point. */
  const drawn = (): number[][] => {
    const out: number[][] = [];
    const walk = (ids: readonly EntityId[], m: Matrix2D, inside: boolean) => {
      for (const id of ids) {
        const g = model.entity(id)!.geom;
        if (g.kind === 'INSERT') {
          const base = model.blocks.get(g.block)!.basePoint;
          walk(model.blockEntities(g.block), compose(insertMatrix(g, base), m), true);
        } else if (inside && (g.kind === 'CIRCLE' || g.kind === 'LINE')) {
          const c = applyPoint(m, g.kind === 'CIRCLE' ? g.center : g.start);
          out.push([r4(c.x), r4(c.y)]);
        }
      }
    };
    walk(model.blockEntities(MODEL_SPACE), IDENTITY, false);
    return out.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  };
  return { model, bus, log, pick, array, record, grips, hot, drawn };
}

const grid = (xs: number[], ys: number[]) =>
  xs.flatMap((x) => ys.map((y) => [x, y])).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);

/** A 4 × 3 rectangular array of the circle, 3 apart. */
async function rectangular() {
  const s = setup();
  s.pick('30');
  await s.bus.script(['ARRAYRECT', '0,0', '', '']);
  return s;
}

/** A polar array of four sticks (2,0)-(3,0) round the origin, base (2.5, 0). */
async function polar() {
  const s = setup();
  s.pick('33');
  await s.bus.script(['ARRAYPOLAR', '0,0', '', '0,0', 'I', '4', '']);
  return s;
}

/** A Measure path array of the circle along 31, 3 apart: seven items from (0,10) to (18,10). */
async function path() {
  const s = setup();
  s.pick('30');
  await s.bus.script(['ARRAYPATH', '0,0', '']);
  s.pick('31');
  await s.bus.script(['1,10', 'B', '0,0', '']);
  return s;
}

describe('rectangular array grips', () => {
  it('shows the base grip and the spacing, count and corner triangles', async () => {
    const s = await rectangular();
    expect(s.grips()).toEqual([
      ['move', 0, 0],
      ['columnSpacing', 3, 0],
      ['columnCount', 9, 0],
      ['rowSpacing', 0, 3],
      ['rowCount', 0, 6],
      ['corner', 9, 6],
    ]);
    const triangles = gripsOf(s.array().geom, gripInfoOf(s.model, s.array())).filter(
      (g) => g.array,
    );
    expect(triangles.map((g) => ({ x: r4(g.towards!.x), y: r4(g.towards!.y) }))).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 1 },
      { x: r4(Math.SQRT1_2), y: r4(Math.SQRT1_2) },
    ]);
  });

  it('counts columns to where the count grip is dragged, in one undo step', async () => {
    const s = await rectangular();
    await s.hot({ x: 9, y: 0 });
    expect(s.bus.command).toBe('GRIP');
    expect(s.log).toContain('** COLUMN COUNT **');
    expect(s.bus.promptText).toBe('Specify number of columns or [Total spacing/eXit]:');
    expect(s.bus.prompt).toMatchObject({ rubberBand: { from: { x: 9, y: 0 } } });
    await s.bus.submit('15.4,2');
    expect(s.bus.command).toBeUndefined();
    expect(s.record().params).toMatchObject({ columns: 6, rows: 3, columnSpacing: 3 });
    expect(s.drawn()).toEqual(grid([0, 3, 6, 9, 12, 15], [0, 3, 6]));
    // The array stays selected, its grips moved with it.
    expect(s.bus.selection).toEqual([s.array().id]);
    expect(s.grips()).toContainEqual(['columnCount', 15, 0]);
    await s.bus.script(['U']);
    expect(s.record().params).toMatchObject({ columns: 4 });
  });

  it('takes typed counts and the total spacing from the count grip', async () => {
    const s = await rectangular();
    await s.hot({ x: 9, y: 0 });
    await s.bus.submit('2.5');
    expect(s.log).toContain('Requires a positive whole number.');
    await s.bus.submit('q');
    expect(s.log).toContain('Requires an integer.');
    await s.bus.submit('5');
    expect(s.record().params).toMatchObject({ columns: 5, columnSpacing: 3 });

    await s.hot({ x: 0, y: 6 });
    expect(s.log).toContain('** ROW COUNT **');
    await s.bus.script(['T']);
    expect(s.log).toContain('** TOTAL SPACING **');
    expect(s.bus.promptText).toBe(
      'Specify the distance between first and last rows or [Row count/eXit]:',
    );
    await s.bus.submit('10');
    expect(s.record().params).toMatchObject({ rows: 3, rowSpacing: 5 });
    // Picked: the distance along the rows from the base.
    await s.hot({ x: 0, y: 10 });
    await s.bus.script(['T', '7,4']);
    expect(s.record().params).toMatchObject({ rowSpacing: 2 });
  });

  it('sets the spacing from the second column and row, typed or picked', async () => {
    const s = await rectangular();
    await s.hot({ x: 3, y: 0 });
    expect(s.log).toContain('** COLUMN SPACING **');
    expect(s.bus.promptText).toBe('Specify the distance between columns or [eXit]:');
    await s.bus.submit('4,1');
    expect(s.drawn()).toEqual(grid([0, 4, 8, 12], [0, 3, 6]));
    await s.hot({ x: 0, y: 3 });
    await s.bus.submit('-2');
    expect(s.drawn()).toEqual(grid([0, 4, 8, 12], [-4, -2, 0]));
    // Zero refused; eXit leaves the array be.
    await s.hot({ x: 4, y: 0 });
    await s.bus.submit('0');
    expect(s.log).toContain('Value must be nonzero.');
    await s.bus.script(['X']);
    expect(s.bus.command).toBeUndefined();
    expect(s.record().params).toMatchObject({ columnSpacing: 4, rowSpacing: -2 });
  });

  it('counts rows and columns, or both total spacings, from the corner grip', async () => {
    const s = await rectangular();
    await s.hot({ x: 9, y: 6 });
    expect(s.bus.promptText).toBe('Specify number of rows and columns or [Total spacing/eXit]:');
    await s.bus.submit('2');
    expect(s.log).toContain('Requires a point.');
    await s.bus.submit('12.2,9.1');
    expect(s.record().params).toMatchObject({ columns: 5, rows: 4 });
    await s.hot({ x: 12, y: 9 });
    await s.bus.script(['T', '18,12']);
    expect(s.record().params).toMatchObject({ columnSpacing: 4.5, rowSpacing: 4 });
  });

  it('moves the array by its base grip with the grip modes, and refuses too many items', async () => {
    const s = await rectangular();
    await s.hot({ x: 0, y: 0 });
    expect(s.log).toContain('** STRETCH **');
    await s.bus.submit('5,5');
    expect(s.array().geom).toMatchObject({ position: { x: 5, y: 5 } });
    expect(s.grips()[0]).toEqual(['move', 5, 5]);
    await s.hot({ x: 14, y: 5 });
    await s.bus.submit('100001');
    expect(s.log).toContain('The array cannot have more than 100000 items.');
    expect(s.bus.command).toBe('GRIP');
  });

  it('puts a count grip where the next column or row would stand with only one', async () => {
    const s = setup();
    s.pick('30');
    await s.bus.script(['ARRAYRECT', '0,0', '', 'COU', '1', '1', '']);
    expect(s.grips()).toEqual([
      ['move', 0, 0],
      ['columnCount', 3, 0],
      ['rowCount', 0, 3],
      ['corner', 3, 3],
    ]);
    await s.hot({ x: 3, y: 0 });
    await s.bus.script(['T', '6,0']);
    expect(s.log).toContain('The array has one column.');
    await s.bus.script(['C', '6,0']);
    expect(s.record().params).toMatchObject({ columns: 3 });
    await s.hot({ x: 6, y: 3 });
    await s.bus.script(['T', '6,6']);
    expect(s.log).toContain('The array needs two rows and two columns.');
  });

  it('sizes a turned and scaled array along its own axes', async () => {
    const s = await rectangular();
    s.pick(s.array().handle);
    await s.bus.script(['ROTATE', '0,0', '', '0,0', '90']);
    await s.bus.script(['SCALE', '0,0', '', '0,0', '2']);
    expect(s.grips()).toContainEqual(['columnCount', 0, 18]);
    await s.hot({ x: 0, y: 18 });
    await s.bus.submit('0,30');
    expect(s.record().params).toMatchObject({ columns: 6 });
  });
});

describe('polar array grips', () => {
  it('shows the centre, base, item angle, last item and row grips', async () => {
    const s = await polar();
    expect(s.grips()).toEqual([
      ['move', 0, 0],
      ['radius', 2.5, 0],
      ['itemAngle', 0, 2.5],
      ['lastItem', 0, -2.5],
      ['rowCount', 4, 0],
    ]);
  });

  it('sets the angle between items, the fill angle and the count', async () => {
    const s = await polar();
    await s.hot({ x: 0, y: 2.5 });
    expect(s.log).toContain('** ITEM ANGLE **');
    expect(s.bus.promptText).toBe('Specify the angle between items or [Count/Fill angle/eXit]:');
    await s.bus.submit('1,1');
    expect(r4((s.record().params as { fillAngle: number }).fillAngle)).toBe(r4((3 * Math.PI) / 4));
    expect(s.drawn()).toHaveLength(4);
    // The last item now stands at 135°: its grip sets the fill angle, typed.
    const last = { x: r4(-2.5 * Math.SQRT1_2), y: r4(2.5 * Math.SQRT1_2) };
    expect(s.grips()).toContainEqual(['lastItem', last.x, last.y]);
    await s.hot(last);
    expect(s.log).toContain('** FILL ANGLE **');
    await s.bus.submit('180');
    // The sticks' first points, 2 from the centre, 60° apart.
    expect(s.drawn()).toEqual([
      [-2, 0],
      [-1, 1.7321],
      [1, 1.7321],
      [2, 0],
    ]);
    // Count keeps the fill angle.
    await s.hot({ x: -2.5, y: 0 });
    await s.bus.script(['C', '3']);
    expect(s.record().params).toMatchObject({ items: 3, fillAngle: Math.PI });
    // A fill of 360 shares the circle; more than that is refused.
    await s.hot({ x: -2.5, y: 0 });
    await s.bus.submit('400');
    expect(s.log).toContain('The fill angle cannot be more than 360 degrees.');
    await s.bus.submit('360');
    expect(s.record().params).toMatchObject({ items: 3, fillAngle: 2 * Math.PI });
  });

  it('turns the angle between items into a full circle when it shares one', async () => {
    const s = await polar();
    await s.hot({ x: 0, y: 2.5 });
    await s.bus.submit('130');
    expect(s.log).toContain('The items would go round more than once.');
    await s.bus.submit('90');
    expect(s.record().params).toMatchObject({ fillAngle: 2 * Math.PI });
    await s.bus.submit('0,2.5');
    await s.hot({ x: 0, y: 2.5 });
    await s.bus.submit('30');
    expect(r4((s.record().params as { fillAngle: number }).fillAngle)).toBe(r4(Math.PI / 2));
    // A dragged count runs the items on at the angle between them, to the cursor.
    expect(s.grips()).toContainEqual(['itemAngle', r4(2.5 * Math.cos(Math.PI / 6)), 1.25]);
    await s.hot({ x: r4(2.5 * Math.cos(Math.PI / 6)), y: 1.25 });
    await s.bus.script(['C', '-2.5,0.01']);
    expect(s.record().params).toMatchObject({ items: 7 });
    expect(r4((s.record().params as { fillAngle: number }).fillAngle)).toBe(r4(Math.PI));
  });

  it('stretches the radius, the first item moving out too', async () => {
    const s = await polar();
    await s.hot({ x: 2.5, y: 0 });
    expect(s.log).toContain('** STRETCH RADIUS **');
    expect(s.bus.promptText).toBe('Specify radius or [eXit]:');
    await s.bus.submit('4,1');
    expect(s.drawn()).toEqual([
      [-3.5, 0],
      [0, -3.5],
      [0, 3.5],
      [3.5, 0],
    ]);
    expect(s.grips()[1]).toEqual(['radius', 4, 0]);
    await s.hot({ x: 4, y: 0 });
    await s.bus.submit('-1');
    expect(s.log).toContain('Value must be positive and nonzero.');
  });

  it('adds rings from the row count grip, and spaces them from the second', async () => {
    const s = await polar();
    await s.hot({ x: 4, y: 0 });
    expect(s.bus.promptText).toBe('Specify number of rows or [Total spacing/eXit]:');
    await s.bus.submit('5.6,0');
    expect(s.record().params).toMatchObject({ rows: 3 });
    expect(s.drawn()).toHaveLength(12);
    expect(s.grips()).toContainEqual(['rowSpacing', 4, 0]);
    await s.hot({ x: 4, y: 0 });
    await s.bus.submit('2');
    expect(s.grips()).toContainEqual(['rowCount', 6.5, 0]);
    await s.hot({ x: 6.5, y: 0 });
    await s.bus.script(['T', '6']);
    expect(s.record().params).toMatchObject({ rows: 3, rowSpacing: 3 });
  });
});

describe('path array grips', () => {
  it('shows the base, item spacing, item count and row grips along the path', async () => {
    const s = await path();
    expect(s.record().params).toMatchObject({ method: 'measure', spacing: 3, items: 7 });
    const rows = (s.record().params as { rowSpacing: number }).rowSpacing;
    expect(s.grips()).toEqual([
      ['move', 0, 10],
      ['itemSpacing', 3, 10],
      ['itemCount', 18, 10],
      ['rowCount', 0, 10 + rows],
    ]);
  });

  it('spaces the items along the path and counts them to the last item grip', async () => {
    const s = await path();
    await s.hot({ x: 3, y: 10 });
    expect(s.bus.promptText).toBe('Specify the distance between items or [eXit]:');
    // The point nearest the cursor on the path: the items that no longer fit are dropped.
    await s.bus.submit('4,11');
    expect(s.record().params).toMatchObject({ spacing: 4, items: 6 });
    expect(s.drawn()).toEqual(grid([0, 4, 8, 12, 16, 20], [10]));
    await s.hot({ x: 20, y: 10 });
    expect(s.bus.promptText).toBe('Specify number of items or [eXit]:');
    await s.bus.submit('9.5,8');
    expect(s.record().params).toMatchObject({ items: 3 });
    await s.hot({ x: 8, y: 10 });
    await s.bus.submit('7');
    expect(s.log).toContain('Only 6 items fit along the path.');
    await s.bus.submit('-1');
    expect(s.log).toContain('Requires a positive whole number.');
    await s.bus.script(['X']);
    await s.hot({ x: 4, y: 10 });
    await s.bus.submit('0');
    expect(s.log).toContain('Value must be positive and nonzero.');
  });

  it('adds rows to the left of the path', async () => {
    const s = await path();
    const rows = (s.record().params as { rowSpacing: number }).rowSpacing;
    await s.hot({ x: 0, y: 10 + rows });
    await s.bus.submit('0,12');
    expect(s.record().params).toMatchObject({ rows: 2, rowSpacing: rows });
    await s.hot({ x: 0, y: 10 + rows });
    await s.bus.script(['T', '0,11']);
    expect(s.record().params).toMatchObject({ rowSpacing: 1 });
  });

  it('shows only the base grip with Divide, and when the path is gone', async () => {
    const s = await path();
    s.pick(s.array().handle);
    await s.bus.script(['ARRAYEDIT', '0,0', 'M', 'D', 'X']);
    expect(s.grips().map((g) => g[0])).toEqual(['move', 'rowCount']);
    s.pick('31');
    await s.bus.script(['ERASE', '0,0', '']);
    expect(s.grips()).toEqual([['move', 0, 0]]);
    const e = arrayGripEdit(s.model, s.array(), s.record(), 'itemCount', 'Count', {
      value: 2,
    });
    expect(e).toBe("The array's path is gone: its items stay where they are.");
  });
});

describe('array grip helpers', () => {
  it('offers each grip’s functions, a drag first', () => {
    expect(ARRAY_GRIP_FUNCTIONS.corner).toEqual(['Row and column count', 'Total spacing']);
  });

  it('finds the nearest station on a path', () => {
    const p = arrayPath(lineGeom(0, 0, 10, 0) as never, false, false);
    expect(r4(nearestStation(p, { x: 3.3, y: 5 }))).toBe(3.3);
    expect(r4(nearestStation(p, { x: -4, y: 0 }))).toBe(0);
    const back = arrayPath(lineGeom(0, 0, 10, 0) as never, false, true);
    expect(r4(nearestStation(back, { x: 7, y: 1 }))).toBe(3);
  });

  it('lets the standard modes have an array grip do nothing to the geometry', async () => {
    const s = await rectangular();
    const r = moveGrip(
      s.array().geom,
      { x: 9, y: 0 },
      { x: 12, y: 0 },
      gripInfoOf(s.model, s.array()),
    );
    expect(r).toEqual({ kind: 'none' });
  });

  it('reads typed lengths and angles in the drawing’s units, and ends on Enter', async () => {
    const s = await polar();
    await s.hot({ x: 2.5, y: 0 });
    await s.bus.submit('far');
    expect(s.log).toContain('Invalid input.');
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    await s.hot({ x: 0, y: 2.5 });
    await s.bus.submit('wide');
    expect(s.log).toContain('Invalid input.');
    await s.bus.submit('0');
    expect(s.log).toContain('Value must be nonzero.');
    await s.bus.script(['F', '0']);
    expect(s.log.filter((l) => l === 'Value must be nonzero.')).toHaveLength(2);
    await s.bus.submit('1.5r');
    expect(r4((s.record().params as { fillAngle: number }).fillAngle)).toBe(1.5);
  });

  it('edits the array whose grip is hot when other objects are selected too', async () => {
    const s = await rectangular();
    s.pick('31');
    await s.bus.pick({ x: 1000, y: 1000 });
    s.pick(s.array().handle);
    await s.bus.pick({ x: 1000, y: 1000 });
    expect(s.bus.selection).toHaveLength(2);
    await s.bus.pick({ x: 9, y: 0 }, { grip: 0.01 });
    await s.bus.submit('5');
    expect(s.record().params).toMatchObject({ columns: 5 });
    expect(s.model.entityByHandle('31')!.geom).toMatchObject({ start: { x: 0, y: 10 } });
  });

  it('refuses array grips while one of its items is being edited', async () => {
    const s = await rectangular();
    s.pick(s.array().handle);
    await s.bus.script(['ARRAYEDIT', '0,0', 'S', '0,0']);
    await s.hot({ x: 9, y: 0 });
    expect(s.log).toContain(
      'An array is being edited: save or discard its changes with ARRAYCLOSE first.',
    );
    expect(s.bus.command).toBeUndefined();
  });
});

// M3-05 part 7: AutoCAD redraws the array as a triangle grip is dragged. The prompt says what
// is dragged (`drag` kind `array`), `dragMotion` passes the cursor on, and `arrayGripPreview`
// gives each item of the array the click would make: its block and where it goes.
describe('the array redrawn as its grip is dragged', () => {
  /** Where each preview item puts its block's objects' first points, sorted. */
  function previewed(
    s: ReturnType<typeof setup>,
    role: Parameters<typeof arrayGripPreview>[3],
    fn: string,
    to: { x: number; y: number },
  ): number[][] | undefined {
    const items = arrayGripPreview(s.model, s.array(), s.record(), role, fn, to);
    if (!items) return undefined;
    const out: number[][] = [];
    for (const { block, m } of items) {
      for (const id of s.model.blockEntities(block)) {
        const g = s.model.entity(id)!.geom;
        if (g.kind !== 'CIRCLE' && g.kind !== 'LINE') continue;
        const p = applyPoint(m, g.kind === 'CIRCLE' ? g.center : g.start);
        out.push([r4(p.x), r4(p.y)]);
      }
    }
    return out.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  }

  it('a count grip drags the array its click would make', async () => {
    const s = await rectangular();
    await s.hot({ x: 9, y: 0 });
    const drag = s.bus.prompt!.drag!;
    expect(drag).toEqual({
      kind: 'array',
      id: s.array().id,
      role: 'columnCount',
      fn: 'Column count',
    });
    expect(dragMotion(drag, { x: 15.4, y: 2 })).toEqual({
      ids: [],
      m: IDENTITY,
      array: { id: s.array().id, role: 'columnCount', fn: 'Column count', to: { x: 15.4, y: 2 } },
    });
    expect(previewed(s, 'columnCount', 'Column count', { x: 15.4, y: 2 })).toEqual(
      grid([0, 3, 6, 9, 12, 15], [0, 3, 6]),
    );
    // What the click makes is what was drawn.
    await s.bus.submit('15.4,2');
    expect(s.drawn()).toEqual(grid([0, 3, 6, 9, 12, 15], [0, 3, 6]));
  });

  it('follows the function Ctrl or an option goes on to', async () => {
    const s = await rectangular();
    await s.hot({ x: 9, y: 0 });
    await s.bus.answer({ kind: 'keyword', keyword: GRIP_CYCLE });
    expect(s.bus.prompt!.drag).toMatchObject({ kind: 'array', fn: 'Total spacing' });
    // Four columns spread over 12.
    expect(previewed(s, 'columnCount', 'Total spacing', { x: 12, y: 0 })).toEqual(
      grid([0, 4, 8, 12], [0, 3, 6]),
    );
  });

  it('a polar array: the item angle, and the radius stretched with its objects shifted', async () => {
    const s = await polar();
    expect(previewed(s, 'itemAngle', 'Item angle', { x: 1, y: 1 })).toHaveLength(4);
    // The base grip at (2.5, 0) dragged to (5, 0): the sticks 2.5 further out.
    const out = previewed(s, 'radius', 'Stretch radius', { x: 5, y: 0 })!;
    expect(out).toEqual([
      [-4.5, 0],
      [0, -4.5],
      [0, 4.5],
      [4.5, 0],
    ]);
  });

  it('a path array along its path', async () => {
    const s = await path();
    const out = previewed(s, 'lastItem', 'Count', { x: 9.2, y: 10 })!;
    expect(out).toEqual([
      [0, 10],
      [3, 10],
      [6, 10],
      [9, 10],
    ]);
  });

  it('draws nothing where the point makes no array', async () => {
    const s = await rectangular();
    expect(previewed(s, 'columnSpacing', 'Column spacing', { x: 0, y: 0 })).toBeUndefined();
  });
});
