// M3-04: the Fence, WPolygon, CPolygon, Group and Multiple modes of "Select objects", AutoCAD
// 2024's rules (SELECT (Command)): a fence takes what its lines cross, a WPolygon what lies wholly
// inside it, a CPolygon what it holds or crosses; the polygon "cannot cross or touch itself", the
// fence can; Undo takes back the last point and Enter ends it. Group takes a named or unnamed
// group's members in the space; Multiple takes its picks at Enter, each an object the others did
// not take. The canvas is a test double: each object is its line, and a polygon or fence is
// measured against it (the renderer's exact rules are tested in packages/render).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type DocumentInit,
  type EntityId,
  type Vec2,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { entityInit, lineGeom, PAPER_SPACE, sampleInit } from '../model/fixtures';

type Seg = readonly [Vec2, Vec2];

/** Model space: 30 (1,1)-(9,1), 31 (2,8)-(8,8), 32 (4.5,6)-(5.5,6), 33 (5,5)-(5,7); 24 in paper space. */
const DRAWN: Record<string, Seg> = {
  '30': [
    { x: 1, y: 1 },
    { x: 9, y: 1 },
  ],
  '31': [
    { x: 2, y: 8 },
    { x: 8, y: 8 },
  ],
  '32': [
    { x: 4.5, y: 6 },
    { x: 5.5, y: 6 },
  ],
  '33': [
    { x: 5, y: 5 },
    { x: 5, y: 7 },
  ],
};

function init(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    entities: [
      ...Object.entries(DRAWN).map(([h, [a, b]]) => entityInit(h, lineGeom(a.x, a.y, b.x, b.y))),
      entityInit('24', lineGeom(1, 1, 2, 2), { owner: PAPER_SPACE }),
    ],
    objects: [
      ...(base.objects ?? []),
      {
        handle: '40',
        type: 'GROUP',
        owner: 'C',
        name: 'PAIR',
        description: '',
        // Not selectable, so a pick or path takes its members alone (group selection, M3-08,
        // is group.test.ts's); the Group mode takes a group by name either way.
        selectable: false,
        entities: ['30', '31', '24'],
      } as never,
      {
        handle: '41',
        type: 'GROUP',
        owner: 'C',
        name: '*A1',
        description: '',
        selectable: false,
        entities: ['32'],
      } as never,
    ],
  };
}

/** A concave "U" whose notch, between x 4 and 6, reaches down to y 4. */
const U = ['0,0', '10,0', '10,10', '6,10', '6,4', '4,4', '4,10', '0,10'];

function cross(o: Vec2, p: Vec2, q: Vec2): number {
  return (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
}

function meet([a, b]: Seg, [c, d]: Seg): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 <= 0 && d3 * d4 <= 0 && !(d1 === 0 && d2 === 0);
}

function inside(poly: readonly Vec2[], p: Vec2): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}

function setup() {
  const model = DocumentModel.create(init());
  const asked: ViewRequest[] = [];
  const id = (h: string) => model.ids.idOf(h)!;
  const handles = (ids: readonly EntityId[]) => ids.map((i) => model.ids.handleOf(i));
  const answer = (r: ViewRequest): ViewReply => {
    asked.push(r);
    const present = Object.entries(DRAWN).filter(([h]) => model.entityByHandle(h));
    if (r.op === 'pick') {
      const near = ([a, b]: Seg) => {
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const t = Math.max(
          0,
          Math.min(
            1,
            ((r.point.x - a.x) * (b.x - a.x) + (r.point.y - a.y) * (b.y - a.y)) / len ** 2,
          ),
        );
        return (
          Math.hypot(a.x + t * (b.x - a.x) - r.point.x, a.y + t * (b.y - a.y) - r.point.y) < 0.5
        );
      };
      return { ok: true, ids: present.filter(([, s]) => near(s)).map(([h]) => id(h)) };
    }
    if (r.op === 'selectPath') {
      const pts = r.points;
      const sides: Seg[] = pts
        .slice(r.kind === 'fence' ? 1 : 0)
        .map((p, i, all) => (r.kind === 'fence' ? [pts[i]!, p] : [p, all[(i + 1) % all.length]!]));
      const crosses = (s: Seg) => sides.some((side) => meet(side, s));
      const take = ([, s]: [string, Seg]) =>
        r.kind === 'fence'
          ? crosses(s)
          : r.kind === 'window'
            ? inside(pts, s[0]) && inside(pts, s[1]) && !crosses(s)
            : crosses(s) || inside(pts, s[0]);
      return { ok: true, ids: present.filter(take).map(([h]) => id(h)) };
    }
    return { ok: true, view: { center: { x: 0, y: 0 }, height: 10, width: 20, paper: false } };
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: (r) => Promise.resolve(answer(r)) },
  });
  const events: BusEvent[] = [];
  bus.on((e) => events.push(e));
  const selections = () =>
    events.flatMap((e) => (e.type === 'selection' ? [handles(e.ids)] : [])).at(-1) ?? [];
  const log = () => events.flatMap((e) => (e.type === 'log' ? [e.line] : []));
  const results = () => log().filter((l) => /found|removed|total|Invalid|defined|Expects/.test(l));
  const submit = async (...lines: string[]) => {
    for (const l of lines) await bus.submit(l);
  };
  return { bus, model, asked, selections, results, log, submit };
}

describe('WPolygon and CPolygon', () => {
  it('WP asks for the polygon point by point and takes what lies wholly inside it', async () => {
    const s = setup();
    await s.submit('SELECT', 'WP');
    expect(s.bus.promptText).toBe('First polygon point:');
    await s.submit(U[0]!);
    expect(s.bus.promptText).toBe('Specify endpoint of line or [Undo]:');
    const p = s.bus.prompt;
    expect(p?.kind === 'point' && p.rubberBand).toEqual({
      from: { x: 0, y: 0 },
      selection: 'window',
      path: { points: [{ x: 0, y: 0 }] },
    });
    await s.submit(...U.slice(1), '');
    // 31 crosses the notch and 32 lies in it: only 30 is inside.
    expect(s.results()).toEqual(['Specify endpoint of line or [Undo]: 1 found']);
    expect(s.selections()).toEqual(['30']);
    expect(s.asked.at(-1)).toMatchObject({ op: 'selectPath', kind: 'window' });
    expect(s.bus.promptText).toBe('Select objects:');
    await s.submit('');
    expect(s.bus.command).toBeUndefined();
  });

  it('CP takes what the polygon holds or crosses, drawn as a crossing', async () => {
    const s = setup();
    await s.submit('SELECT', 'CP', ...U.slice(0, 2));
    const p = s.bus.prompt;
    expect(p?.kind === 'point' && p.rubberBand?.selection).toBe('crossing');
    await s.submit(...U.slice(2), '');
    expect(s.results()).toEqual(['Specify endpoint of line or [Undo]: 2 found']);
    expect(s.selections()).toEqual(['30', '31']);
  });

  it('clicked points draw it too; Enter with no point goes back to "Select objects"', async () => {
    const s = setup();
    await s.submit('SELECT', 'WPOLYGON');
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Select objects:');
    expect(s.asked.some((r) => r.op === 'selectPath')).toBe(false);
    await s.submit('WP');
    for (const p of [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 3 },
      { x: 0, y: 3 },
    ]) {
      await s.bus.pick(p);
    }
    await s.bus.answer({ kind: 'enter' });
    expect(s.selections()).toEqual(['30']);
  });

  it('Undo takes back the last point, down to the first', async () => {
    const s = setup();
    await s.submit('SELECT', 'CP', '0,0', '10,0', '10,10', 'U');
    const p = s.bus.prompt;
    expect(p?.kind === 'point' && p.rubberBand?.path?.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(s.log()).toContain('Specify endpoint of line or [Undo]: U');
    await s.submit('UNDO', 'U');
    expect(s.bus.promptText).toBe('First polygon point:');
  });

  it('refuses a point that would make the polygon cross or touch itself', async () => {
    const s = setup();
    await s.submit('SELECT', 'WP', '0,0', '10,10', '10,0', '0,10');
    expect(s.results()).toEqual(['Invalid point, polygon segments cannot intersect.']);
    let p = s.bus.prompt;
    expect(p?.kind === 'point' && p.rubberBand?.path?.points.length).toBe(3);
    // Its closing side, back to 0,0, would cross the side from 10,10 to 10,0.
    await s.submit('12,5');
    expect(s.results()).toHaveLength(2);
    // The same point twice is no side at all.
    await s.submit('10,0');
    expect(s.results()).toHaveLength(3);
    await s.submit('2,1');
    p = s.bus.prompt;
    expect(p?.kind === 'point' && p.rubberBand?.path?.points.length).toBe(4);
  });

  it('in Remove mode the polygon removes', async () => {
    const s = setup();
    await s.submit('SELECT', 'ALL', 'R', 'CP', ...U, '');
    expect(s.results().at(-1)).toBe('Specify endpoint of line or [Undo]: 2 removed, 2 total');
    expect(s.selections()).toEqual(['32', '33']);
  });

  it("a command that selects takes a polygon's objects (ERASE)", async () => {
    const s = setup();
    await s.submit('ERASE', 'CP', ...U, '', '');
    expect(s.model.entityByHandle('30')).toBeUndefined();
    expect(s.model.entityByHandle('31')).toBeUndefined();
    expect(s.model.entityByHandle('32')).toBeDefined();
  });
});

describe('Fence', () => {
  it('takes what its lines cross; the fence is open and may cross itself', async () => {
    const s = setup();
    await s.submit('SELECT', 'F');
    expect(s.bus.promptText).toBe('Specify first fence point:');
    await s.submit('5,0');
    expect(s.bus.promptText).toBe('Specify next fence point or [Undo]:');
    const p = s.bus.prompt;
    expect(p?.kind === 'point' && p.rubberBand).toEqual({
      from: { x: 5, y: 0 },
      selection: 'crossing',
      path: { points: [{ x: 5, y: 0 }], open: true },
    });
    await s.submit('5,9', '3,9', '7,3', '');
    expect(s.results()).toEqual(['Specify next fence point or [Undo]: 4 found']);
    expect(s.selections()).toEqual(['30', '31', '32', '33']);
  });

  it('a fence of one point takes nothing', async () => {
    const s = setup();
    await s.submit('SELECT', 'FENCE', '5,0', '');
    expect(s.results()).toEqual(['Specify next fence point or [Undo]: 0 found']);
  });
});

describe('Group', () => {
  it('takes the members of a named or unnamed group in the space shown', async () => {
    const s = setup();
    await s.submit('SELECT', 'G');
    expect(s.bus.promptText).toBe('Enter group name:');
    expect(s.bus.prompt?.kind).toBe('string');
    // A click while the name is asked for does nothing.
    await s.bus.pick({ x: 5, y: 1 });
    await s.submit('pair');
    expect(s.results()).toEqual(['Enter group name: pair 2 found']);
    expect(s.selections()).toEqual(['30', '31']);
    await s.submit('GROUP', '*a1');
    expect(s.results().at(-1)).toBe('Enter group name: *a1 1 found, 3 total');
    expect(s.bus.promptText).toBe('Select objects:');
  });

  it('a group that does not exist is said so; Enter goes back', async () => {
    const s = setup();
    await s.submit('SELECT', 'G', 'NOPE');
    expect(s.results()).toEqual(['Group "NOPE" has not been defined.']);
    expect(s.bus.promptText).toBe('Select objects:');
    await s.submit('G', '');
    expect(s.bus.promptText).toBe('Select objects:');
    expect(s.selections()).toEqual([]);
  });
});

describe('Multiple', () => {
  it('collects picks without selecting them, and takes them all at Enter', async () => {
    const s = setup();
    await s.submit('SELECT', 'M');
    expect(s.bus.promptText).toBe('Select objects:');
    await s.bus.pick({ x: 5, y: 1 });
    await s.bus.pick({ x: 5, y: 8 });
    await s.bus.pick({ x: 50, y: 50 });
    expect(s.selections()).toEqual([]);
    expect(s.asked.some((r) => r.op === 'pick')).toBe(false);
    await s.bus.submit('');
    expect(s.results()).toEqual(['Select objects: 2 found']);
    expect(s.selections()).toEqual(['30', '31']);
    expect(s.bus.command).toBe('SELECT');
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
  });

  it('two picks where two objects meet take both', async () => {
    const s = setup();
    await s.submit('SELECT', 'MULTIPLE');
    await s.bus.pick({ x: 5, y: 6 });
    await s.bus.pick({ x: 5, y: 6 });
    await s.bus.pick({ x: 5, y: 6 });
    await s.bus.submit('');
    expect(s.results()).toEqual(['Select objects: 2 found']);
    expect(s.selections()).toEqual(['32', '33']);
  });

  it('a mode typed after the picks takes them first; Enter with no pick does nothing', async () => {
    const s = setup();
    await s.submit('SELECT', 'M');
    await s.bus.pick({ x: 5, y: 1 });
    await s.submit('L');
    expect(s.results()).toEqual(['Select objects: 1 found', 'Select objects: L 1 found, 2 total']);
    await s.submit('M', '');
    expect(s.results()).toHaveLength(2);
    expect(s.bus.command).toBe('SELECT');
  });

  it('in Remove mode the picks remove', async () => {
    const s = setup();
    await s.submit('SELECT', 'ALL', 'R', 'M');
    await s.bus.pick({ x: 5, y: 1 });
    await s.bus.submit('');
    expect(s.results().at(-1)).toBe('Remove objects: 1 removed, 3 total');
  });
});

it('lists the new modes when a word is no mode', async () => {
  const s = setup();
  await s.submit('SELECT', 'XYZ');
  expect(s.results().at(-1)).toBe(
    'Expects a point or Window/Last/Crossing/BOX/ALL/Fence/WPolygon/CPolygon/Group/Add/Remove/Multiple/Previous/Undo/AUto/SIngle',
  );
});

// Lasso (M3-04 part 2; AutoCAD 2024 Help, "To Select Objects": "To create a lasso selection,
// click, drag, and release the mouse button"; dragged right a window lasso, left a crossing
// lasso, and Spacebar cycles Window, Crossing and Fence). The canvas sends the lasso's path with
// the release that ends the drag; the press found nothing and started the window.
describe('Lasso', () => {
  const points = (...xy: string[]) =>
    xy.map((p) => {
      const [x, y] = p.split(',').map(Number) as [number, number];
      return { x, y };
    });

  it('a window lasso takes what lies wholly inside the path dragged', async () => {
    const s = setup();
    await s.submit('SELECT');
    const path = points(...U);
    await s.bus.pick(path[0]!);
    expect(s.bus.promptText).toBe('Specify opposite corner:');
    await s.bus.pick(path.at(-1)!, { release: true, lasso: { kind: 'window', points: path } });
    expect(s.asked.at(-1)).toEqual({ op: 'selectPath', kind: 'window', points: path });
    expect(s.results()).toEqual(['Window Lasso  Press Spacebar to cycle options: 1 found']);
    expect(s.selections()).toEqual(['30']);
    expect(s.bus.promptText).toBe('Select objects:');
  });

  it('a crossing lasso at `Command:` is the pre-selection, picked silently', async () => {
    const s = setup();
    const path = points(...U);
    await s.bus.pick(path[0]!);
    await s.bus.pick(path.at(-1)!, { release: true, lasso: { kind: 'crossing', points: path } });
    expect(s.selections()).toEqual(['30', '31']);
    expect(s.log()).toEqual([]);
    await s.submit('ERASE');
    expect(s.model.entityByHandle('31')).toBeUndefined();
  });

  it('a fence lasso takes what its open path crosses', async () => {
    const s = setup();
    await s.submit('SELECT');
    const path = points('4,6.5', '6,6.5', '6,6.8');
    await s.bus.pick(path[0]!);
    await s.bus.pick(path.at(-1)!, { release: true, lasso: { kind: 'fence', points: path } });
    expect(s.asked.at(-1)).toMatchObject({ op: 'selectPath', kind: 'fence' });
    expect(s.results()).toEqual(['Fence Lasso  Press Spacebar to cycle options: 1 found']);
    expect(s.selections()).toEqual(['33']);
  });

  it('a Shift press lassos to remove; Undo takes the step back', async () => {
    const s = setup();
    await s.submit('SELECT', 'ALL');
    const path = points(...U);
    await s.bus.pick(path[0]!, { shift: true });
    await s.bus.pick(path.at(-1)!, {
      release: true,
      lasso: { kind: 'crossing', points: path },
    });
    expect(s.results().at(-1)).toBe(
      'Crossing Lasso  Press Spacebar to cycle options: 2 removed, 2 total',
    );
    expect(s.selections()).toEqual(['32', '33']);
    await s.submit('U');
    expect(s.selections()).toEqual(['30', '31', '32', '33']);
  });

  it('a path too short to enclose anything ends as the window it started', async () => {
    const s = setup();
    await s.submit('SELECT');
    const path = points('0,0', '10,10');
    await s.bus.pick(path[0]!);
    await s.bus.pick(path[1]!, { release: true, lasso: { kind: 'window', points: path } });
    expect(s.asked.at(-1)).toMatchObject({ op: 'select', crossing: false });
    expect(s.asked.some((r) => r.op === 'selectPath')).toBe(false);
  });
});
