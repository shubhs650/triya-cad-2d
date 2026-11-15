// M3-04 part 4: FILTER and its Object Selection Filters, as AutoCAD 2024's (AutoCAD Help, "FILTER
// (Command)", "Object Selection Filters Dialog Box", "To Create and Save a Selection Filter"),
// and PICKADD and PICKAUTO at "Select objects" ("PICKADD", "PICKAUTO (System Variable)").
import { describe, expect, it } from 'vitest';
import {
  PromptBus,
  applyFilter,
  builtinCommands,
  filterLine,
  filterNames,
  filterProblem,
  filterTypes,
  objectFilter,
  type DialogRequest,
  type EntityGeometry,
  type FilterItem,
  type ViewReply,
} from '../../src/index';
import { MODEL_SPACE } from '../model/fixtures';
import { host, setup } from './edit-harness';

const circle = (x: number, r: number): EntityGeometry => ({
  kind: 'CIRCLE',
  center: { x, y: 50 },
  radius: r,
});
const text = (value: string, x: number): EntityGeometry => ({
  kind: 'TEXT',
  value,
  style: '17',
  position: { x, y: 20 },
  height: 3.5,
  rotation: Math.PI / 2,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
});
const RED = { color: { kind: 'aci' as const, index: 1 } };

/**
 * 30 a line and 31 a circle of radius 5 at (50,0) on layer 0; on WALLS 40 a red circle of
 * radius 2 at (0,50), 41 a circle of radius 10 at (30,50), 42 a dashed line, 43 text "DOOR 1".
 * PICKADD and PICKAUTO are what `vars` holds, the app's answer to `sysvar`.
 */
function drawing(vars: Record<string, number> = {}) {
  const t = setup([
    [circle(0, 2), RED],
    circle(30, 10),
    [{ kind: 'LINE', start: { x: 0, y: 70 }, end: { x: 9, y: 70 } }, { linetype: '15' }],
    text('DOOR 1', 20),
  ]);
  const canvas = host(() => t.model);
  const asked: string[] = [];
  const bus = new PromptBus({
    model: t.model,
    registry: builtinCommands(),
    pickadd: vars['PICKADD'] ?? 2,
    pickauto: vars['PICKAUTO'] ?? 5,
    view: {
      request: (r): Promise<ViewReply> => {
        if (r.op !== 'sysvar') return canvas.request(r);
        asked.push(r.name);
        const v = vars[r.name];
        return Promise.resolve(
          v === undefined ? { ok: false, message: 'no' } : { ok: true, value: v },
        );
      },
    },
  });
  const log: string[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  const id = (h: string) => t.model.ids.idOf(h)!;
  const handles = () => bus.selection.map((i) => String(t.model.ids.handleOf(i))).sort();
  const dialog = () => {
    const p = bus.prompt;
    return p?.kind === 'dialog'
      ? (p.dialog as Extract<DialogRequest, { type: 'filter' }>)
      : undefined;
  };
  const apply = (list: FilterItem[], action: 'apply' | 'select' = 'apply') =>
    bus.answer({ kind: 'dialog', action, filter: { list, name: '*unnamed' } });
  return { ...t, bus, log, id, handles, dialog, apply, asked };
}

const all = (m: ReturnType<typeof drawing>['model']) => m.blockEntities(MODEL_SPACE);
const handlesOf = (t: ReturnType<typeof drawing>, ids: readonly number[]) =>
  ids.map((i) => String(t.model.ids.handleOf(i as never))).sort();

describe('selection filters', () => {
  it('ANDs the list: object type, names with wildcards, numbers with relational operators', () => {
    const t = drawing();
    const take = (list: FilterItem[]) => handlesOf(t, applyFilter(t.model, all(t.model), list));
    expect(take([{ key: 'Object', op: '=', value: 'CIRCLE' }])).toEqual(['31', '40', '41']);
    expect(take([{ key: 'Object', op: '!=', value: 'CIRCLE' }])).toEqual(['30', '42', '43']);
    expect(
      take([
        { key: 'Object', op: '=', value: 'CIRCLE' },
        { key: 'Layer', op: '=', value: 'w*' },
      ]),
    ).toEqual(['40', '41']);
    expect(take([{ key: 'Circle Radius', op: '>=', value: 5 }])).toEqual(['31', '41']);
    expect(take([{ key: 'Circle Radius', op: '<', value: 5 }])).toEqual(['40']);
    expect(take([{ key: 'Circle Radius', op: '<=', value: 5 }])).toEqual(['31', '40']);
    expect(take([{ key: 'Circle Radius', op: '>', value: 5 }])).toEqual(['41']);
    expect(take([{ key: 'Circle Radius', op: '!=', value: 5 }])).toEqual(['40', '41']);
    expect(take([{ key: 'Circle Radius', op: '*', value: 0 }])).toEqual(['31', '40', '41']);
    expect(take([{ key: 'Color', op: '=', value: 1 }])).toEqual(['40']);
    expect(take([{ key: 'Color', op: '=', value: 256 }])).toEqual(['30', '31', '41', '42', '43']);
    expect(take([{ key: 'Linetype', op: '=', value: 'DASHED' }])).toEqual(['42']);
    expect(take([{ key: 'Linetype', op: '!=', value: 'ByLayer' }])).toEqual(['42']);
    expect(take([{ key: 'Text Value', op: '=', value: 'DOOR*' }])).toEqual(['43']);
    expect(take([{ key: 'Text Style', op: '=', value: 'notes' }])).toEqual(['43']);
    expect(take([{ key: 'Text Height', op: '=', value: 3.5 }])).toEqual(['43']);
    expect(take([{ key: 'Text Rotation', op: '=', value: 90 }])).toEqual(['43']);
    expect(take([{ key: 'Text Position', x: { op: '=', value: 20 } }])).toEqual(['43']);
    expect(take([{ key: 'Lineweight', op: '=', value: -1 }])).toHaveLength(6);
    expect(take([{ key: 'Linetype Scale', op: '=', value: 1 }])).toHaveLength(6);
    expect(take([{ key: 'Thickness', op: '=', value: 0 }])).toHaveLength(6);
    expect(take([{ key: 'Elevation', op: '=', value: 0 }])).toHaveLength(6);
    expect(take([{ key: 'Block Name', op: '=', value: '*' }])).toEqual([]);
    expect(take([{ key: 'Dimension Style', op: '=', value: '*' }])).toEqual([]);
  });

  it("tests each of a point's X, Y and Z, any left out taking every value", () => {
    const t = drawing();
    const take = (list: FilterItem[]) => handlesOf(t, applyFilter(t.model, all(t.model), list));
    // AutoCAD's example: circles with centres at or beyond 1,1,0 and radii of at least 1.
    expect(
      take([
        { key: 'Object', op: '=', value: 'CIRCLE' },
        {
          key: 'Circle Center',
          x: { op: '>=', value: 1 },
          y: { op: '>=', value: 1 },
          z: { op: '>=', value: 0 },
        },
        { key: 'Circle Radius', op: '>=', value: 1 },
      ]),
    ).toEqual(['41']);
    expect(take([{ key: 'Line Start', y: { op: '=', value: 70 } }])).toEqual(['42']);
    expect(take([{ key: 'Line End', x: { op: '>', value: 9.5 } }])).toEqual(['30']);
    expect(take([{ key: 'Arc Center' }, { key: 'Point Position' }])).toEqual([]);
    expect(take([{ key: 'Block Position', x: { op: '*', value: 0 } }])).toEqual([]);
  });

  it('groups with AND, OR, XOR and NOT', () => {
    const t = drawing();
    const take = (list: FilterItem[]) => handlesOf(t, applyFilter(t.model, all(t.model), list));
    // AutoCAD's example: every circle but those with a radius of 1 or more.
    expect(
      take([
        { key: 'Object', op: '=', value: 'CIRCLE' },
        { key: 'Begin', logic: 'NOT' },
        { key: 'Circle Radius', op: '>=', value: 5 },
        { key: 'End', logic: 'NOT' },
      ]),
    ).toEqual(['40']);
    expect(
      take([
        { key: 'Begin', logic: 'OR' },
        { key: 'Object', op: '=', value: 'LINE' },
        { key: 'Color', op: '=', value: 1 },
        { key: 'End', logic: 'OR' },
      ]),
    ).toEqual(['30', '40', '42']);
    expect(
      take([
        { key: 'Begin', logic: 'XOR' },
        { key: 'Object', op: '=', value: 'CIRCLE' },
        { key: 'Layer', op: '=', value: 'WALLS' },
        { key: 'End', logic: 'XOR' },
      ]),
    ).toEqual(['31', '42', '43']);
    expect(
      take([
        { key: 'Begin', logic: 'AND' },
        { key: 'Object', op: '=', value: 'CIRCLE' },
        { key: 'Layer', op: '=', value: '0' },
        { key: 'End', logic: 'AND' },
      ]),
    ).toEqual(['31']);
  });

  it('refuses operators that are not paired and balanced', () => {
    const line: FilterItem = { key: 'Object', op: '=', value: 'LINE' };
    expect(filterProblem([line])).toBeUndefined();
    expect(filterProblem([{ key: 'Begin', logic: 'NOT' }, line])).toBe(
      '**Begin NOT has no **End NOT.',
    );
    expect(filterProblem([line, { key: 'End', logic: 'OR' }])).toBe('**End OR has no **Begin OR.');
    expect(
      filterProblem([{ key: 'Begin', logic: 'XOR' }, line, { key: 'End', logic: 'XOR' }]),
    ).toBe('**Begin XOR encloses two operands.');
    expect(
      filterProblem([{ key: 'Begin', logic: 'NOT' }, line, line, { key: 'End', logic: 'NOT' }]),
    ).toBe('**Begin NOT encloses one operand.');
    expect(
      filterProblem([
        { key: 'Begin', logic: 'AND' },
        { key: 'End', logic: 'AND' },
      ]),
    ).toBe('**Begin AND encloses one or more operands.');
    expect(filterProblem([{ key: 'Begin', logic: 'AND' }, line, { key: 'End', logic: 'OR' }])).toBe(
      '**End OR has no **Begin OR.',
    );
    const t = drawing();
    expect(applyFilter(t.model, all(t.model), [{ key: 'Begin', logic: 'OR' }])).toEqual([]);
  });

  it('shows each line as the dialog lists it', () => {
    expect(filterLine({ key: 'Object', op: '=', value: 'CIRCLE' })).toBe('Object = Circle');
    expect(filterLine({ key: 'Object', op: '!=', value: 'LINE' })).toBe('Object != Line');
    expect(filterLine({ key: 'Circle Radius', op: '>=', value: 1 })).toBe(
      'Circle Radius >= 1.0000',
    );
    expect(filterLine({ key: 'Color', op: '=', value: 1 })).toBe('Color = 1');
    expect(filterLine({ key: 'Color', op: '*', value: 0 })).toBe('Color *');
    expect(filterLine({ key: 'Layer', op: '!=', value: 'WALLS' })).toBe('Layer != WALLS');
    expect(
      filterLine({ key: 'Circle Center', x: { op: '>=', value: 1 }, z: { op: '*', value: 0 } }),
    ).toBe('Circle Center X >= 1.0000 Z *');
    expect(filterLine({ key: 'Begin', logic: 'NOT' })).toBe('**Begin NOT');
  });

  it("adds a selected object's type, own properties and geometry", () => {
    const t = drawing();
    const e = (h: string) => t.model.entity(t.id(h))!;
    expect(objectFilter(t.model, e('40'))).toEqual([
      { key: 'Object', op: '=', value: 'CIRCLE' },
      { key: 'Layer', op: '=', value: 'WALLS' },
      { key: 'Color', op: '=', value: 1 },
      {
        key: 'Circle Center',
        x: { op: '=', value: 0 },
        y: { op: '=', value: 50 },
        z: { op: '=', value: 0 },
      },
      { key: 'Circle Radius', op: '=', value: 2 },
    ]);
    expect(objectFilter(t.model, e('42'))).toContainEqual({
      key: 'Linetype',
      op: '=',
      value: 'DASHED',
    });
    expect(objectFilter(t.model, e('43')).map((i) => i.key)).toEqual([
      'Object',
      'Layer',
      'Text Position',
      'Text Height',
      'Text Rotation',
      'Text Style',
      'Text Value',
    ]);
    // A filter made from an object takes it.
    expect(
      handlesOf(t, applyFilter(t.model, all(t.model), objectFilter(t.model, e('41')))),
    ).toEqual(['41']);
  });

  it("lists the drawing's names and object types for the dialog", () => {
    const t = drawing();
    const names = filterNames(t.model);
    expect(names.Layer).toEqual(['0', 'WALLS']);
    expect(names.Linetype).toContain('DASHED');
    expect(names.Linetype.slice(0, 2)).toEqual(['ByLayer', 'ByBlock']);
    expect(names['Block Name']).toEqual(['B']);
    expect(names['Text Style']).toEqual(['Standard', 'NOTES']);
    const types = filterTypes(t.model, MODEL_SPACE).map((x) => x.label);
    expect(types).toContain('Circle');
    expect(types).toContain('Polyline');
    expect(types).toEqual([...types].sort((a, b) => a.localeCompare(b)));
    expect(filterTypes(t.model, 'FFFF').length).toBeGreaterThan(0);
  });
});

describe('FILTER', () => {
  it('applies the filter to the objects selected, which become the Previous set and stay selected', async () => {
    const t = drawing({ PICKADD: 2 });
    await t.bus.submit('FI');
    expect(t.bus.promptText).toBe('Object Selection Filters:');
    const d = t.dialog()!;
    expect(d.list).toBeUndefined();
    expect(d.names.Layer).toEqual(['0', 'WALLS']);
    await t.apply([{ key: 'Object', op: '=', value: 'CIRCLE' }]);
    expect(t.log).toContain('Applying filter to selection.');
    expect(t.bus.promptText).toBe('Select objects:');
    await t.bus.submit('ALL');
    await t.bus.submit('');
    expect(t.log.slice(-2)).toEqual(['Exiting filtered selection.', '3 found']);
    expect(t.bus.command).toBeUndefined();
    expect(t.handles()).toEqual(['31', '40', '41']);
    await t.bus.submit('ERASE');
    expect(t.bus.command).toBeUndefined();
    expect(t.model.entity(t.id('41'))).toBeUndefined();
  });

  it('leaves them unselected with another PICKADD, Previous taking them', async () => {
    const t = drawing({ PICKADD: 1 });
    await t.bus.submit('FILTER');
    await t.apply([{ key: 'Color', op: '=', value: 1 }]);
    await t.bus.submit('ALL');
    await t.bus.submit('');
    expect(t.handles()).toEqual([]);
    await t.bus.submit('ERASE');
    await t.bus.submit('P');
    await t.bus.submit('');
    expect(t.model.entity(t.id('40'))).toBeUndefined();
    expect(t.model.entity(t.id('41'))).toBeDefined();
  });

  it('adds a selected object to the list and opens again on it', async () => {
    const t = drawing();
    await t.bus.submit('FILTER');
    await t.apply([{ key: 'Layer', op: '=', value: 'WALLS' }], 'select');
    expect(t.bus.promptText).toBe('Select object:');
    await t.bus.pick({ x: 40, y: 50 }); // circle 41
    const d = t.dialog()!;
    expect(d.name).toBe('*unnamed');
    expect(d.list?.map(filterLine)).toEqual([
      'Layer = WALLS',
      'Object = Circle',
      'Layer = WALLS',
      'Circle Center X = 30.0000 Y = 50.0000 Z = 0.0000',
      'Circle Radius = 10.0000',
    ]);
    // Nothing picked (Enter): the dialog comes back on the list as it was.
    await t.bus.answer({ kind: 'dialog', action: 'select', filter: { list: d.list!, name: 'X' } });
    await t.bus.submit('');
    expect(t.dialog()?.list).toHaveLength(5);
    expect(t.dialog()?.name).toBe('X');
  });

  it('refuses an unbalanced list at Apply', async () => {
    const t = drawing();
    await t.bus.submit('FILTER');
    await t.apply([{ key: 'Begin', logic: 'NOT' }]);
    expect(t.log.at(-1)).toBe('**Begin NOT has no **End NOT.');
    expect(t.bus.command).toBeUndefined();
  });

  it("joins the selection 'FILTER is typed at, then that prompt goes on", async () => {
    const t = drawing();
    const shown: number[][] = [];
    t.bus.on((e) => {
      if (e.type === 'selection') shown.push([...e.ids]);
    });
    await t.bus.submit('ERASE');
    await t.bus.pick({ x: 5, y: 0 }); // line 30
    await t.bus.submit("'FILTER");
    expect(t.bus.command).toBe('FILTER');
    await t.apply([{ key: 'Object', op: '=', value: 'CIRCLE' }]);
    expect(t.bus.promptText).toBe('>>Select objects:');
    await t.bus.submit('C');
    await t.bus.submit('-10,-10');
    await t.bus.submit('60,60');
    await t.bus.submit('');
    expect(t.bus.command).toBe('ERASE');
    expect(t.log).toContain('Exiting filtered selection.');
    expect(t.log).toContain('Resuming ERASE command.');
    expect(t.handles()).toEqual(['30', '31', '40', '41']);
    // The canvas is told the joined selection.
    expect(shown.at(-1)).toHaveLength(4);
    expect(t.bus.promptText).toBe('Select objects:');
    await t.bus.submit('');
    expect(t.model.entity(t.id('42'))).toBeDefined();
    expect(t.model.entity(t.id('41'))).toBeUndefined();
  });

  it('transparently at another prompt it makes the Previous set only', async () => {
    const t = drawing({ PICKADD: 2 });
    await t.bus.submit('LINE');
    await t.bus.submit("'FILTER");
    await t.apply([{ key: 'Object', op: '=', value: 'LINE' }]);
    await t.bus.submit('ALL');
    await t.bus.submit('');
    expect(t.bus.command).toBe('LINE');
    expect(t.log).toContain('2 found');
    expect(t.handles()).toEqual([]);
  });
});

describe('PICKADD', () => {
  it('2 and 1: each step adds, Shift removes; SELECT leaves its set selected only at 2', async () => {
    const t = drawing({ PICKADD: 2 });
    await t.bus.submit('SELECT');
    await t.bus.pick({ x: 5, y: 0 });
    await t.bus.pick({ x: 55, y: 0 });
    await t.bus.pick({ x: 55, y: 0 }, { shift: true });
    expect(t.handles()).toEqual(['30']);
    await t.bus.submit('');
    expect(t.handles()).toEqual(['30']);
    const u = drawing({ PICKADD: 1 });
    await u.bus.submit('SELECT');
    await u.bus.pick({ x: 5, y: 0 });
    await u.bus.pick({ x: 55, y: 0 });
    expect(u.handles()).toEqual(['30', '31']);
    await u.bus.submit('');
    expect(u.handles()).toEqual([]);
    expect(u.asked).toContain('PICKADD');
  });

  it('0: each step replaces the set, Shift toggles, a Shift step finding nothing empties it', async () => {
    const t = drawing({ PICKADD: 0 });
    await t.bus.submit('SELECT');
    await t.bus.pick({ x: 5, y: 0 });
    await t.bus.pick({ x: 55, y: 0 });
    expect(t.handles()).toEqual(['31']);
    expect(t.log.at(-1)).toBe('Select objects: 1 found');
    await t.bus.pick({ x: 5, y: 0 }, { shift: true });
    expect(t.handles()).toEqual(['30', '31']);
    expect(t.log.at(-1)).toBe('Select objects: 1 found, 2 total');
    await t.bus.pick({ x: 55, y: 0 }, { shift: true });
    expect(t.handles()).toEqual(['30']);
    expect(t.log.at(-1)).toBe('Select objects: 1 removed, 1 total');
    // A window: replaces too.
    await t.bus.submit('W');
    await t.bus.submit('-5,45');
    await t.bus.submit('5,55');
    expect(t.handles()).toEqual(['40']);
    await t.bus.submit('U');
    expect(t.handles()).toEqual(['30']);
    // Shift and a window around nothing: the set empties.
    await t.bus.pick({ x: 100, y: 100 }, { shift: true });
    await t.bus.pick({ x: 110, y: 110 }, { shift: true });
    expect(t.handles()).toEqual([]);
    // ALL replaces as well; Remove still removes.
    await t.bus.submit('ALL');
    expect(t.handles()).toHaveLength(6);
    await t.bus.submit('R');
    await t.bus.pick({ x: 5, y: 0 });
    expect(t.handles()).toHaveLength(5);
  });

  it('3: as 0, but a Shift step finding nothing keeps the set', async () => {
    const t = drawing({ PICKADD: 3 });
    await t.bus.pick({ x: 5, y: 0 });
    await t.bus.pick({ x: 55, y: 0 });
    expect(t.handles()).toEqual(['31']);
    await t.bus.pick({ x: 100, y: 100 }, { shift: true });
    await t.bus.pick({ x: 110, y: 110 }, { shift: true });
    expect(t.handles()).toEqual(['31']);
  });

  it('is set on an open drawing through the bus, from the next step', async () => {
    const t = drawing();
    await t.bus.pick({ x: 5, y: 0 });
    t.bus.setPickVariable('PICKADD', 0);
    expect(t.bus.pickadd).toBe(0);
    await t.bus.pick({ x: 55, y: 0 });
    expect(t.handles()).toEqual(['31']);
  });
});

describe('PICKAUTO', () => {
  it('without bit 1 a pick on nothing at "Select objects" starts no window; at Command: it does', async () => {
    const t = drawing({ PICKAUTO: 4 });
    await t.bus.submit('ERASE');
    await t.bus.pick({ x: 100, y: 100 });
    expect(t.bus.promptText).toBe('Select objects:');
    await t.bus.cancel();
    await t.bus.pick({ x: 100, y: 100 });
    expect(t.bus.promptText).toBe('Specify opposite corner:');
    const u = drawing({ PICKAUTO: 1 });
    await u.bus.submit('ERASE');
    await u.bus.pick({ x: 100, y: 100 });
    expect(u.bus.promptText).toBe('Specify opposite corner:');
    u.bus.setPickVariable('PICKAUTO', 0);
    await u.bus.submit('-1,-1');
    await u.bus.pick({ x: 100, y: 100 });
    expect(u.bus.promptText).toBe('Select objects:');
  });

  // M3-04 part 6 (AutoCAD 2024 Help, "PICKAUTO (System Variable)"): bit 2 "begins a window or
  // crossing selection even if the cursor is directly over an object. This option applies only
  // when you select objects before you start a command using the click, drag, and release
  // method." The press picks as a click would; once dragged, that pick is taken back and the
  // press is a window's first corner, a rectangle (a lasso starts only where nothing is).
  it('bit 2: a press on an object at Command: dragged is a window from it, not a pick', async () => {
    const t = drawing({ PICKAUTO: 7 });
    // On 41's right-hand quadrant: picked as the button goes down.
    await t.bus.pick({ x: 40, y: 50 });
    expect(t.handles()).toEqual(['41']);
    await t.bus.pick({ x: 40, y: 50 }, { dragged: true });
    expect(t.handles()).toEqual([]);
    expect(t.bus.promptText).toBe('Specify opposite corner:');
    const p = t.bus.prompt;
    expect(p?.kind === 'point' && p.rubberBand).toMatchObject({
      from: { x: 40, y: 50 },
      box: true,
      selection: 'auto',
      lasso: false,
    });
    // Released to the left: a crossing window, which crosses 40 and 41.
    await t.bus.pick({ x: -5, y: 45 }, { release: true });
    expect(t.handles()).toEqual(['40', '41']);
    expect(t.bus.promptText).toBe('Command:');
  });

  it('bit 2 keeps what was selected before the press', async () => {
    const t = drawing({ PICKAUTO: 7 });
    await t.bus.pick({ x: 0, y: 70 });
    expect(t.handles()).toEqual(['42']);
    await t.bus.pick({ x: 40, y: 50 });
    expect(t.handles()).toEqual(['41', '42']);
    await t.bus.pick({ x: 40, y: 50 }, { dragged: true });
    expect(t.handles()).toEqual(['42']);
    // Left to right: a window, holding none of the circles wholly.
    await t.bus.pick({ x: 45, y: 45 }, { release: true });
    expect(t.handles()).toEqual(['42']);
  });

  it('without bit 2, or inside a command, a drag from an object is the pick alone', async () => {
    const t = drawing({ PICKAUTO: 5 });
    await t.bus.pick({ x: 40, y: 50 });
    await t.bus.pick({ x: 40, y: 50 }, { dragged: true });
    expect(t.handles()).toEqual(['41']);
    expect(t.bus.promptText).toBe('Command:');
    const u = drawing({ PICKAUTO: 7 });
    await u.bus.submit('ERASE');
    await u.bus.pick({ x: 40, y: 50 });
    await u.bus.pick({ x: 40, y: 50 }, { dragged: true });
    expect(u.bus.promptText).toBe('Select objects:');
    await u.bus.submit('');
    expect(u.model.entityByHandle('41')).toBeUndefined();
    // A press that found nothing already started its window: the drag changes nothing.
    const v = drawing({ PICKAUTO: 7 });
    await v.bus.pick({ x: 100, y: 100 });
    await v.bus.pick({ x: 100, y: 100 }, { dragged: true });
    const q = v.bus.prompt;
    expect(q?.kind === 'point' && q.rubberBand?.lasso).toBeUndefined();
  });
});
