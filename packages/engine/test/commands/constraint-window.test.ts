// M9-03 part 14: a selection window, crossing window or lasso made at `Command:` selects the
// dimensional constraints drawn in it along with the objects, as a pick selects one (part 10).
// The canvas knows where a constraint is drawn (a dynamic one keeps its size on screen), so the
// bus asks it (`constraintsIn`) with the same window it asked for the objects. AutoCAD 2024
// Help, "To Edit a Dimensional Constraint Using the Properties Palette" ("Select a dimensional
// constraint"), and "About Applying Dimensional Constraints" (an annotational constraint is
// selected as a dimension is) do not say how a window treats a dynamic constraint; ours takes
// both forms, as the canvas draws them, and "Select objects" inside a command takes objects only.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PICKADD,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type ConstraintSolver,
  type DimensionalConstraintObject,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { entityInit, lineGeom, sampleInit } from '../model/fixtures';
import { NO_PARAMETERS } from './solver-stub';

const D1: DimensionalConstraintObject = {
  handle: 'D1',
  type: 'TRIYA_DIMCONSTRAINT',
  owner: 'C',
  dimension: 'aligned',
  refs: [{ entity: '30' }],
  parameter: 'd1',
  expression: '10',
  location: { x: 5, y: 2 },
  form: 'dynamic',
};
const D2: DimensionalConstraintObject = {
  ...D1,
  handle: 'D2',
  dimension: 'angular',
  refs: [{ entity: '30' }, { entity: '31' }],
  parameter: 'ang1',
  expression: '90',
  form: 'annotational',
};

type Area = Extract<ViewRequest, { op: 'constraintsIn' }>['area'];

function setup(pickadd?: number) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    meta: { ...init.meta, rootDictionary: 'C' },
    entities: [entityInit('30', lineGeom(0, 0, 10, 0)), entityInit('31', lineGeom(0, 0, 0, 10))],
    objects: [...(init.objects ?? []), D1, D2],
  });
  const views: ViewRequest[] = [];
  /** What the canvas finds in the next window: constraints and objects. */
  let found: { constraints: string[]; ids: number[] } = { constraints: [], ids: [] };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    ...(pickadd !== undefined && { pickadd }),
    view: {
      request: (r): Promise<ViewReply> => {
        views.push(r);
        if (r.op === 'constraintsIn') {
          return Promise.resolve({ ok: true, constraints: found.constraints });
        }
        if (r.op === 'select' || r.op === 'selectPath') {
          return Promise.resolve({ ok: true, ids: found.ids });
        }
        if (r.op === 'pick') return Promise.resolve({ ok: true, ids: [] });
        return Promise.resolve({ ok: true });
      },
    },
    constraints: () => Promise.resolve({ ...NO_PARAMETERS } as ConstraintSolver),
  });
  const events: BusEvent[] = [];
  bus.on((e) => events.push(e));
  const line = model.entityByHandle('30')!;
  const finds = (constraints: string[], ids: number[] = []) => {
    found = { constraints, ids };
  };
  /** A window from (x1, y1) to (x2, y2): two clicks on nothing. */
  const window = async (x1: number, y1: number, x2: number, y2: number, shift = false) => {
    await bus.pick({ x: x1, y: y1 }, shift ? { shift: true } : {});
    await bus.pick({ x: x2, y: y2 }, shift ? { shift: true } : {});
  };
  const areas = () => views.flatMap((v): Area[] => (v.op === 'constraintsIn' ? [v.area] : []));
  const selections = () =>
    events.flatMap((e) => (e.type === 'selection' ? [e.constraints ?? []] : []));
  return { model, bus, views, line, finds, window, areas, selections };
}

describe('window selection of dimensional constraints', () => {
  it('a window at Command: selects the constraints the canvas finds in it, with the objects', async () => {
    const s = setup();
    s.finds(['D1'], [s.line.id]);
    await s.window(-1, -1, 12, 4);
    // Left to right: a window; the canvas is asked with the corners the objects were.
    expect(s.areas()).toEqual([
      { op: 'select', a: { x: -1, y: -1 }, b: { x: 12, y: 4 }, crossing: false },
    ]);
    expect(s.bus.constraintSelection).toEqual(['D1']);
    expect(s.bus.selection).toEqual([s.line.id]);
    expect(s.selections().at(-1)).toEqual(['D1']);
  });

  it('right to left is a crossing window; PICKADD 2 adds to the constraints picked before', async () => {
    const s = setup();
    s.finds(['D1']);
    await s.window(12, 4, 4, 1);
    s.finds(['D2', 'D1']);
    await s.window(3, 3, -2, -2);
    expect(s.areas().map((a) => a.op === 'select' && a.crossing)).toEqual([true, true]);
    expect(s.bus.constraintSelection).toEqual(['D1', 'D2']);
    expect(s.bus.selection).toEqual([]);
  });

  it('a Shift window removes the constraints in it (PICKADD 2)', async () => {
    const s = setup();
    s.finds(['D1', 'D2']);
    await s.window(-1, -1, 12, 4);
    s.finds(['D2']);
    await s.window(-1, -1, 2, 2, true);
    expect(s.bus.constraintSelection).toEqual(['D1']);
  });

  it('PICKADD 0: a window replaces the constraints selected, Shift toggles them', async () => {
    const s = setup(0);
    s.finds(['D1']);
    await s.window(-1, -1, 12, 4);
    s.finds(['D2']);
    await s.window(-1, -1, 2, 2);
    expect(s.bus.constraintSelection).toEqual(['D2']);
    s.finds(['D1', 'D2']);
    await s.window(-1, -1, 12, 4, true);
    expect(s.bus.constraintSelection).toEqual(['D1']);
    // A window that finds none clears them, as it clears the objects.
    s.finds([]);
    await s.window(20, 20, 30, 30);
    expect(s.bus.constraintSelection).toEqual([]);
  });

  it('PICKADD set while the drawing is open counts from the next window', async () => {
    const s = setup();
    s.finds(['D1']);
    await s.window(-1, -1, 12, 4);
    s.bus.setPickVariable(PICKADD, 0);
    s.finds(['D2']);
    await s.window(-1, -1, 2, 2);
    expect(s.bus.constraintSelection).toEqual(['D2']);
  });

  it('a lasso asks with its path and kind', async () => {
    const s = setup();
    const path = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    s.finds(['D2']);
    await s.bus.pick(path[0]!);
    await s.bus.pick(path.at(-1)!, { release: true, lasso: { kind: 'crossing', points: path } });
    expect(s.areas()).toEqual([{ op: 'selectPath', kind: 'crossing', points: path }]);
    expect(s.bus.constraintSelection).toEqual(['D2']);
  });

  it('"Select objects" inside a command takes objects only', async () => {
    const s = setup();
    await s.bus.submit('MOVE');
    s.finds(['D1'], [s.line.id]);
    await s.window(-1, -1, 12, 4);
    expect(s.areas()).toEqual([]);
    expect(s.bus.constraintSelection).toEqual([]);
  });

  it('ERASE erases the constraints a window selected', async () => {
    const s = setup();
    s.finds(['D1', 'D2']);
    await s.window(-1, -1, 12, 4);
    await s.bus.submit('ERASE');
    expect(s.model.objects.get('D1')).toBeUndefined();
    expect(s.model.objects.get('D2')).toBeUndefined();
    expect(s.bus.constraintSelection).toEqual([]);
  });
});
