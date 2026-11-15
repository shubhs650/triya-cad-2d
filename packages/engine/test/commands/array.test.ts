// M3-03: ARRAY, ARRAYRECT, ARRAYPOLAR, ARRAYPATH and -ARRAY on the PromptBus, driven as the
// command line drives them, with AutoCAD 2024's prompts (AutoCAD 2024 Help, "ARRAYRECT
// (Command)", "ARRAYPOLAR (Command)", "ARRAYPATH (Command)", "-ARRAY (Command)").
//
// The drawing adds to the sample: 30 a circle r 1 at the origin (the source: its 2 × 2 extents
// make default spacings of 3), 31 a line (0,10)-(20,10) and 32 a quarter arc r 10 about
// (0,10), the paths. Picks take the handles `pick` names.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type EntityId,
  type HeaderValue,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { MODEL_SPACE, entityInit, lineGeom, sampleInit } from '../model/fixtures';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

function drawing(header: [string, HeaderValue][] = []): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    header: new Map([...(base.header ?? []), ...header]),
    entities: [
      ...(base.entities ?? []),
      entityInit('30', { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 }),
      entityInit('31', lineGeom(0, 10, 20, 10)),
      entityInit('32', {
        kind: 'ARC',
        center: { x: 0, y: 10 },
        radius: 10,
        startAngle: 0,
        endAngle: Math.PI / 2,
      }),
      entityInit('33', lineGeom(2, 0, 3, 0)),
    ],
  };
}

function setup(o: { header?: [string, HeaderValue][]; bounds?: boolean } = {}) {
  const model = DocumentModel.create(drawing(o.header));
  let picks: EntityId[] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') return Promise.resolve({ ok: true, ids: picks });
      if (r.op === 'bounds' && o.bounds) {
        return Promise.resolve({ ok: true, box: { minX: -1, minY: -1, maxX: 3, maxY: 1 } });
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
  const live = (): Entity[] => model.blockEntities(MODEL_SPACE).map((id) => model.entity(id)!);
  /** The centres of the unit circles (the source and its copies), sorted. */
  const rings = (): number[][] =>
    live()
      .filter((e) => e.geom.kind === 'CIRCLE' && e.geom.radius === 1)
      .map((e) => {
        const g = e.geom as { center: { x: number; y: number } };
        return [r4(g.center.x), r4(g.center.y)];
      })
      .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  /** The unit lines (33 and its copies) as [x1, y1, x2, y2], sorted. */
  const sticks = (): number[][] =>
    live()
      .filter(
        (e) =>
          e.geom.kind === 'LINE' && e.handle !== '20' && e.handle !== '23' && e.handle !== '31',
      )
      .map((e) => {
        const g = e.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
        return [g.start.x, g.start.y, g.end.x, g.end.y].map(r4);
      })
      .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  return { model, bus, log, pick, rings, sticks };
}

/** Starts `command` with the source circle 30 selected. */
async function start(s: ReturnType<typeof setup>, command: string, source = '30'): Promise<void> {
  s.pick(source);
  await s.bus.script([command, '0,0', '']);
}

const grid = (xs: number[], ys: number[]) =>
  xs.flatMap((x) => ys.map((y) => [x, y])).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);

describe('ARRAYRECT', () => {
  it('makes 4 columns by 3 rows at once, spaced 1.5 × the selection, and Enter keeps them', async () => {
    const s = setup();
    await start(s, 'ARRAYRECT');
    expect(s.log).toContain('Type = Rectangular  Associative = No');
    expect(s.bus.promptText).toBe(
      'Select grip to edit array or [ASsociative/Base point/COUnt/Spacing/COLumns/Rows/eXit] <eXit>:',
    );
    expect(s.rings()).toEqual(grid([0, 3, 6, 9], [0, 3, 6]));
    await s.bus.script(['']);
    expect(s.bus.command).toBeUndefined();
    expect(s.rings()).toHaveLength(12);
    // The source stays where it was as the first item, and the whole array is one undo step.
    expect(s.model.entityByHandle('30')).toBeDefined();
    await s.bus.script(['U']);
    expect(s.rings()).toEqual([[0, 0]]);
  });

  it('measures the selection as the renderer does when it can', async () => {
    const s = setup({ bounds: true });
    await start(s, 'AR');
    await s.bus.script(['R', 'X']);
    // A 4 × 2 box: columns 6 apart, rows 3.
    expect(s.rings()).toEqual(grid([0, 6, 12, 18], [0, 3, 6]));
  });

  it('spaces rows of a flat selection by its width', async () => {
    const s = setup();
    s.pick('33');
    await s.bus.script(['ARRAYRECT', '2,0', '', 'COU', '2', '2', '']);
    // The stick is 1 long and has no height: rows are 1.5 apart, as its columns are.
    expect(s.sticks()).toEqual([
      [2, 0, 3, 0],
      [2, 1.5, 3, 1.5],
      [3.5, 0, 4.5, 0],
      [3.5, 1.5, 4.5, 1.5],
    ]);
  });

  it('remakes the array as COUnt and Spacing change it', async () => {
    const s = setup();
    await start(s, 'ARRAYRECT');
    await s.bus.script(['COU']);
    expect(s.bus.promptText).toBe('Enter number of columns <4>:');
    await s.bus.script(['2']);
    expect(s.bus.promptText).toBe('Enter number of rows <3>:');
    await s.bus.script(['2', 'S']);
    expect(s.bus.promptText).toBe('Specify the distance between columns or [Unit cell] <3.0000>:');
    await s.bus.script(['5', '4']);
    expect(s.rings()).toEqual(grid([0, 5], [0, 4]));
    await s.bus.script(['S', 'U', '0,0', '2,-3']);
    expect(s.rings()).toEqual(grid([0, 2], [-3, 0]));
    await s.bus.script(['X']);
    expect(s.rings()).toHaveLength(4);
  });

  it('takes COLumns and Rows with their spacing or the Total', async () => {
    const s = setup();
    await start(s, 'ARRAYRECT');
    await s.bus.script(['COL', '3']);
    expect(s.bus.promptText).toBe('Specify the distance between columns or [Total] <3.0000>:');
    await s.bus.script(['T']);
    expect(s.bus.promptText).toBe(
      'Specify the total distance between first and last columns <6.0000>:',
    );
    await s.bus.script(['10', 'R', '2', '-2', '']);
    expect(s.rings()).toEqual(grid([0, 5, 10], [-2, 0]));
  });

  it('refuses counts below 1, zero spacings and arrays over 100,000 items', async () => {
    const s = setup();
    await start(s, 'ARRAYRECT');
    await s.bus.script(['COU', '0']);
    expect(s.log.at(-1)).toBe('Value must be positive and nonzero.');
    await s.bus.script(['1000', '1000']);
    expect(s.log.at(-1)).toBe('The array cannot have more than 100000 items.');
    await s.bus.script(['COL', '2', '0']);
    expect(s.log.at(-1)).toBe('Value must be positive and nonzero.');
    await s.bus.script(['4', 'S', 'U', '0,0', '5,0']);
    expect(s.log.at(-1)).toBe('Value must be positive and nonzero.');
    await s.bus.script(['']);
    expect(s.rings()).toEqual(grid([0, 4], [0, 3, 6]));
  });

  it('says it makes separate objects when asked for an associative array, and Esc keeps the array', async () => {
    const s = setup();
    await start(s, 'ARRAYRECT');
    await s.bus.script(['AS']);
    expect(s.bus.promptText).toBe('Create associative array [Yes/No] <No>:');
    await s.bus.script(['Y']);
    expect(s.log.at(-1)).toBe(
      'Triya does not make associative arrays yet: the items are separate objects.',
    );
    await s.bus.script(['B']);
    expect(s.bus.promptText).toBe('Specify base point <centroid>:');
    await s.bus.script(['']);
    await s.bus.cancel();
    expect(s.rings()).toHaveLength(12);
  });
});

describe('ARRAYPOLAR', () => {
  it('asks for the centre, then makes 6 items round the full circle', async () => {
    const s = setup();
    await start(s, 'ARRAYPOLAR');
    expect(s.log).toContain('Type = Polar  Associative = No');
    expect(s.bus.promptText).toBe('Specify center point of array or [Base point]:');
    await s.bus.script(['0,-10']);
    expect(s.bus.promptText).toBe(
      'Select grip to edit array or [ASsociative/Base point/Items/Angle between/Fill angle/ROWs/ROTate items/eXit] <eXit>:',
    );
    const ring = [0, 60, 120, 180, 240, 300].map((a) => {
      const t = ((a + 90) * Math.PI) / 180;
      return [r4(10 * Math.cos(t)), r4(-10 + 10 * Math.sin(t))];
    });
    expect(s.rings()).toEqual(ring.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!));
  });

  it('fills a part circle with Items, Fill angle and Angle between', async () => {
    const s = setup();
    await start(s, 'ARRAYPOLAR');
    await s.bus.script(['-10,0', 'I', '3', 'F']);
    expect(s.bus.promptText).toBe('Specify the angle to fill (+=ccw, -=cw) <360>:');
    await s.bus.script(['90']);
    // 3 items from the source over a quarter turn counterclockwise about (-10, 0).
    expect(s.rings()).toEqual([
      [-10, 10],
      [-2.9289, 7.0711],
      [0, 0],
    ]);
    await s.bus.script(['A']);
    expect(s.bus.promptText).toBe('Specify angle between items <45>:');
    await s.bus.script(['-90']);
    expect(s.rings()).toEqual([
      [-20, 0],
      [-10, -10],
      [0, 0],
    ]);
    // An angle between that closes the circle fills it.
    await s.bus.script(['I', '4', 'A', '90', 'F']);
    expect(s.bus.promptText).toBe('Specify the angle to fill (+=ccw, -=cw) <360>:');
    await s.bus.script(['0']);
    expect(s.log.at(-1)).toBe('Value must be positive and nonzero.');
    await s.bus.script(['F', '400']);
    expect(s.log.at(-1)).toBe('The fill angle cannot exceed 360 degrees.');
    await s.bus.script(['A', '200']);
    expect(s.log.at(-1)).toBe('The fill angle cannot exceed 360 degrees.');
    await s.bus.script(['']);
    expect(s.rings()).toHaveLength(4);
  });

  it('keeps items upright with ROTate items No, from the base point, and adds rings with ROWs', async () => {
    const s = setup();
    await start(s, 'ARRAYPOLAR', '33');
    await s.bus.script(['B', '2,0', '0,0', 'I', '4', 'ROT']);
    expect(s.bus.promptText).toBe('Rotate arrayed items? [Yes/No] <Yes>:');
    await s.bus.script(['N']);
    expect(s.sticks()).toEqual([
      [-2, 0, -1, 0],
      [0, -2, 1, -2],
      [0, 2, 1, 2],
      [2, 0, 3, 0],
    ]);
    await s.bus.script(['ROT', 'Y', 'ROW', '2', '3', '']);
    expect(s.sticks()).toHaveLength(8);
    expect(s.sticks()).toContainEqual([5, 0, 6, 0]);
    expect(s.sticks()).toContainEqual([0, 5, 0, 6]);
  });
});

describe('ARRAYPATH', () => {
  it('fills the path from the end nearer the pick, spaced 1.5 × the selection', async () => {
    const s = setup();
    await start(s, 'ARRAYPATH');
    expect(s.log).toContain('Type = Path  Associative = No');
    expect(s.bus.promptText).toBe('Select path curve:');
    s.pick('31');
    await s.bus.script(['1,10']);
    expect(s.bus.promptText).toBe(
      'Select grip to edit array or [ASsociative/Method/Base point/Tangent direction/Items/Rows/Align items/eXit] <eXit>:',
    );
    // From (0,10): the source (base point the path's start) is moved along +X by 3s.
    expect(s.rings()).toEqual(grid([0, 3, 6, 9, 12, 15, 18], [0]));
    await s.bus.script(['']);
  });

  it('runs back from the far end when it is picked nearer, and refuses what is not a path', async () => {
    const s = setup();
    await start(s, 'ARRAYPATH');
    s.pick('30');
    await s.bus.script(['0,0']);
    expect(s.log.at(-1)).toBe('The object selected is not a valid path curve.');
    s.pick('31');
    await s.bus.script(['19,10']);
    expect(s.rings()).toEqual(grid([-18, -15, -12, -9, -6, -3, 0], [0]));
  });

  it('divides the path or measures it, with the most items it holds', async () => {
    const s = setup();
    await start(s, 'ARRAYPATH');
    s.pick('31');
    await s.bus.script(['1,10', 'M']);
    expect(s.bus.promptText).toBe('Enter path method [Divide/Measure] <Measure>:');
    await s.bus.script(['D', 'I']);
    expect(s.bus.promptText).toBe('Enter number of items along path <7>:');
    await s.bus.script(['5']);
    expect(s.rings()).toEqual(grid([0, 5, 10, 15, 20], [0]));
    await s.bus.script(['M', 'M', 'I']);
    expect(s.bus.promptText).toBe('Specify the distance between items along path <3.0000>:');
    await s.bus.script(['4']);
    expect(s.log.at(-1)).toBe('Maximum items = 6');
    expect(s.bus.promptText).toBe('Specify number of items or [Fill entire path] <6>:');
    await s.bus.script(['9']);
    expect(s.log.at(-1)).toBe('Value must be between 1 and 6.');
    await s.bus.script(['I', '4', 'F']);
    expect(s.rings()).toEqual(grid([0, 4, 8, 12, 16, 20], [0]));
    await s.bus.script(['I', '4', '2', 'ROWS', '2', '-1', '']);
    expect(s.rings()).toEqual(grid([0, 4], [-1, 0]));
  });

  it('turns items with the path, or by the tangent vector, unless Align items is No', async () => {
    const s = setup();
    await start(s, 'ARRAYPATH', '33');
    s.pick('32');
    // The arc from (10,10) counterclockwise; the stick is carried from the path start.
    await s.bus.script(['10,11', 'B', '2,0', 'M', 'D', 'I', '2']);
    // Until the array is done the source stays in its place beside the items.
    const source = [2, 0, 3, 0];
    expect(s.sticks()).toEqual([[0, 20, 0, 21], source, [10, 10, 11, 10]]);
    // The source's direction along the path is +X: the start item turns a quarter, too.
    await s.bus.script(['T', '0,0', '1,0']);
    expect(s.sticks()).toEqual([[0, 20, -1, 20], source, [10, 10, 10, 11]]);
    await s.bus.script(['A', 'N', '']);
    expect(s.sticks()).toEqual([
      [0, 20, 1, 20],
      [10, 10, 11, 10],
    ]);
    // Item 0 was off the source's place: the source itself moved there, keeping its handle.
    const g = s.model.entityByHandle('33')!.geom as { start: { x: number; y: number } };
    expect([g.start.x, g.start.y].map(r4)).toEqual([10, 10]);
  });
});

describe('ARRAY', () => {
  it('asks for the type and remembers it', async () => {
    const s = setup();
    s.pick('30');
    await s.bus.script(['ARRAY', '0,0', '']);
    expect(s.bus.promptText).toBe('Enter array type [Rectangular/PAth/POlar] <Rectangular>:');
    await s.bus.script(['PO', '0,-10', '']);
    expect(s.rings()).toHaveLength(6);
    await s.bus.script(['ARRAY', '0,0', '']);
    expect(s.bus.promptText).toBe('Enter array type [Rectangular/PAth/POlar] <POlar>:');
    await s.bus.script(['PA']);
    expect(s.bus.promptText).toBe('Select path curve:');
    await s.bus.cancel();
  });

  it('ends without a word when nothing is selected', async () => {
    const s = setup();
    for (const name of ['ARRAY', 'ARRAYRECT', '-ARRAY']) {
      s.pick();
      await s.bus.script([name, '']);
      expect(s.bus.command).toBeUndefined();
    }
    expect(s.rings()).toEqual([[0, 0]]);
  });
});

describe('-ARRAY', () => {
  it('makes a classic rectangular array from rows, columns and their distances', async () => {
    const s = setup();
    await start(s, '-ARRAY');
    expect(s.bus.promptText).toBe('Enter the type of array [Rectangular/Polar] <Rectangular>:');
    await s.bus.script(['R']);
    expect(s.bus.promptText).toBe('Enter the number of rows (---) <1>:');
    await s.bus.script(['2', '3']);
    expect(s.bus.promptText).toBe('Enter the distance between rows or specify unit cell (---):');
    await s.bus.script(['4', '5']);
    expect(s.bus.command).toBeUndefined();
    expect(s.rings()).toEqual(grid([0, 5, 10], [0, 4]));
  });

  it('takes a unit cell, a single row, and says when one item is nothing to do', async () => {
    const s = setup();
    await start(s, '-ARRAY');
    await s.bus.script(['', '2', '2', '0,0', '3,-2']);
    expect(s.rings()).toEqual(grid([0, 3], [-2, 0]));
    await start(s, '-ARRAY');
    await s.bus.script(['', '1', '3']);
    expect(s.bus.promptText).toBe('Specify the distance between columns (|||):');
    await s.bus.script(['-4']);
    expect(s.rings()).toContainEqual([-8, 0]);
    await start(s, '-ARRAY');
    await s.bus.script(['', '1', '1']);
    expect(s.log.at(-1)).toBe('One-element array, nothing to do.');
  });

  it('makes a classic polar array', async () => {
    const s = setup();
    await start(s, '-ARRAY', '33');
    await s.bus.script(['P']);
    expect(s.bus.promptText).toBe('Specify center point of array or [Base]:');
    await s.bus.script(['B', '2,0', '0,0']);
    expect(s.bus.promptText).toBe('Enter the number of items in the array <4>:');
    await s.bus.script(['1']);
    expect(s.log.at(-1)).toBe('Value must be an integer greater than 1.');
    await s.bus.script(['2', '0']);
    expect(s.log.at(-1)).toBe('Value must be positive and nonzero.');
    await s.bus.script(['-180']);
    expect(s.bus.promptText).toBe('Rotate arrayed objects? [Yes/No] <Yes>:');
    await s.bus.script(['N']);
    expect(s.sticks()).toEqual([
      [-2, 0, -1, 0],
      [2, 0, 3, 0],
    ]);
    // The polar type is remembered; Enter fills the circle, rotating the items.
    await start(s, '-ARRAY', '33');
    await s.bus.script(['', '0,0', '', '', '']);
    expect(s.sticks()).toContainEqual([-2, 0, -3, 0]);
  });

  it('reads fill angles past ANGBASE and ANGDIR as turns', async () => {
    const s = setup({
      header: [
        ['$ANGBASE', Math.PI / 2],
        ['$ANGDIR', 1],
      ],
    });
    await start(s, '-ARRAY', '33');
    await s.bus.script(['P', '0,0', '2', '90', 'N']);
    // +90 is counterclockwise whatever the drawing measures angles from: the stick's centre
    // (2.5, 0), its default base point, goes a quarter turn round to (0, 2.5).
    expect(s.sticks()).toContainEqual([-0.5, 2.5, 0.5, 2.5]);
  });
});
