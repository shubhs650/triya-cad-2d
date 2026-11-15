// M3-05 part 5: the grip modes' right-click menu. AutoCAD 2024 Help, "To Use Grips to Stretch,
// Move, Rotate, Scale or Mirror Objects": with a grip hot, "right-click to display a shortcut
// menu of grip options". Its items are Enter, the five modes, Base Point, Copy, Reference,
// Undo, Properties and Exit; a multi-functional grip's menu lists its functions too. Each item
// answers the prompt as the keyword typed would, so the prompt carries the menu
// (`shortcutMenu`) and the front-end only draws it.
//
// The drawing: model space holds 40 an open polyline (0,0) (10,0) (10,10) and 41 a line
// (20,0)-(30,0).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type DocumentInit,
  type ShortcutMenuItem,
  type ViewRequest,
} from '../../src/index';
import { MODEL_SPACE, entityInit, lineGeom, sampleInit } from '../model/fixtures';

function drawing(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    entities: [
      ...(base.entities ?? []).filter((e) => e.owner !== MODEL_SPACE),
      entityInit('40', {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 10, y: 0, bulge: 0 },
          { x: 10, y: 10, bulge: 0 },
        ],
      }),
      entityInit('41', lineGeom(20, 0, 30, 0)),
    ],
  };
}

function setup() {
  const model = DocumentModel.create(drawing());
  const requests: ViewRequest[] = [];
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r) => {
        requests.push(r);
        return Promise.resolve({ ok: true });
      },
    },
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const hot = async (x: number, y: number) => {
    await bus.selectAll();
    await bus.pick({ x, y }, { grip: 0.25 });
    expect(bus.command).toBe('GRIP');
  };
  const menu = (): readonly ShortcutMenuItem[] => bus.prompt?.shortcutMenu ?? [];
  /** The item labelled `label` chosen: the answer the front-end sends for it. */
  const choose = async (label: string) => {
    const item = menu().find((i) => i.label === label);
    expect(item, label).toBeDefined();
    expect(item!.disabled).toBeUndefined();
    await bus.answer(
      item!.keyword === undefined ? { kind: 'enter' } : { kind: 'keyword', keyword: item!.keyword },
    );
  };
  const labels = () => menu().map((i) => (i.disabled ? `(${i.label})` : i.label));
  return { model, bus, log, requests, hot, menu, choose, labels };
}

/** The grip menu's items in AutoCAD's order; Reference greyed outside ROTATE and SCALE. */
const STRETCH_MENU = [
  'Enter',
  'Move',
  'Mirror',
  'Rotate',
  'Scale',
  'Stretch',
  'Base Point',
  'Copy',
  '(Reference)',
  'Undo',
  'Properties',
  'Exit',
];

describe('the grip shortcut menu', () => {
  it('every grip mode prompt carries it, Reference taken in ROTATE and SCALE only', async () => {
    const s = setup();
    await s.hot(25, 0);
    expect(s.log.at(-1)).toBe('** STRETCH **');
    expect(s.labels()).toEqual(STRETCH_MENU);
    // Separators part Enter, the modes, the options, Properties and Exit.
    expect(
      s
        .menu()
        .filter((i) => i.separatorBefore)
        .map((i) => i.label),
    ).toEqual(['Move', 'Base Point', 'Properties', 'Exit']);
    await s.choose('Rotate');
    expect(s.log.at(-1)).toBe('** ROTATE **');
    expect(s.labels()).toContain('Reference');
    await s.choose('Scale');
    expect(s.log.at(-1)).toBe('** SCALE **');
    expect(s.labels()).toContain('Reference');
    await s.choose('Mirror');
    expect(s.log.at(-1)).toBe('** MIRROR **');
    expect(s.labels()).toEqual(STRETCH_MENU);
    await s.choose('Move');
    expect(s.log.at(-1)).toBe('** MOVE **');
    await s.choose('Stretch');
    expect(s.log.at(-1)).toBe('** STRETCH **');
  });

  it('Enter goes on to the next mode, as Enter typed does', async () => {
    const s = setup();
    await s.hot(25, 0);
    await s.choose('Enter');
    expect(s.log.at(-1)).toBe('** MOVE **');
    expect(s.bus.promptText).toBe('Specify move point or [Base point/Copy/Undo/eXit]:');
  });

  it('Copy, Base Point and Undo act as typed, Exit ends with the objects still selected', async () => {
    const s = setup();
    await s.hot(25, 0);
    await s.choose('Move');
    await s.choose('Base Point');
    expect(s.bus.promptText).toBe('Specify base point:');
    await s.bus.submit('20,0');
    await s.choose('Copy');
    expect(s.log.at(-1)).toBe('** MOVE (multiple) **');
    await s.bus.submit('20,5');
    const count = () => [...s.model.entities()].length;
    const before = count();
    await s.choose('Undo');
    expect(count()).toBe(before - 2);
    await s.choose('Exit');
    expect(s.bus.command).toBeUndefined();
    expect(s.bus.selection).toHaveLength(2);
  });

  it('Properties ends grip editing and opens the Properties palette on the selection', async () => {
    const s = setup();
    await s.hot(25, 0);
    await s.choose('Properties');
    expect(s.bus.command).toBeUndefined();
    expect(s.requests).toEqual([{ op: 'palette', palette: 'properties', open: true }]);
    expect(s.bus.selection).toHaveLength(2);
    // Typed, too, as the menu's keyword.
    await s.hot(25, 0);
    await s.bus.submit('PR');
    expect(s.bus.command).toBeUndefined();
    expect(s.requests).toHaveLength(2);
  });

  it('a multi-functional grip lists its functions after Enter, Stretch being the mode', async () => {
    const s = setup();
    await s.hot(10, 0);
    expect(s.labels()).toEqual(['Enter', 'Add Vertex', 'Remove Vertex', ...STRETCH_MENU.slice(1)]);
    expect(s.menu()[1]).toMatchObject({ separatorBefore: true });
    await s.choose('Add Vertex');
    expect(s.log.at(-1)).toBe('** ADD VERTEX **');
    // A function's prompt takes the modes, functions, Properties and Exit; not the options.
    expect(s.labels()).toEqual([
      'Enter',
      'Add Vertex',
      'Remove Vertex',
      'Move',
      'Mirror',
      'Rotate',
      'Scale',
      'Stretch',
      '(Base Point)',
      '(Copy)',
      '(Reference)',
      '(Undo)',
      'Properties',
      'Exit',
    ]);
    await s.choose('Stretch');
    expect(s.log.at(-1)).toBe('** STRETCH **');
    await s.choose('Remove Vertex');
    expect(s.bus.command).toBeUndefined();
    expect(s.model.entityByHandle('40')!.geom).toMatchObject({
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    });
  });
});
