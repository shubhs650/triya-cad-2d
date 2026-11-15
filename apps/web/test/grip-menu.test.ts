// M3-05 part 2: a grip's hover menu (AutoCAD 2024, GRIPMULTIFUNCTIONAL 3: "Access
// multi-functional grip options with Ctrl-cycling and the hover grip menu"). The cursor resting
// on a grip of the selection at `Command:` asks the drawing's engine for the grip's functions;
// a grip with several shows them in a menu beside the cursor, which stays while the cursor goes
// to it, and a function chosen there makes the grip hot in that function.
import { describe, expect, it, vi } from 'vitest';
import { GRIP_MENU_LINGER_MS, GRIP_MENU_OFFSET, GripMenus } from '../src/grip-menu';

const at = { world: { x: 10, y: 0 }, clientX: 300, clientY: 200 };

function setup(idle = true) {
  const menus = new GripMenus();
  const asked: { point: { x: number; y: number }; within: number }[] = [];
  const deps = {
    idle: () => idle,
    reach: () => 0.25,
    ask: (point: { x: number; y: number }, within: number) => asked.push({ point, within }),
  };
  return { menus, asked, deps };
}

describe('GripMenus', () => {
  it('asks the engine at a rest and shows the functions it answers beside the cursor', () => {
    const { menus, asked, deps } = setup();
    menus.rest(1, at, deps);
    expect(asked).toEqual([{ point: { x: 10, y: 0 }, within: 0.25 }]);
    expect(menus.get()).toBeUndefined();
    menus.answer(1, { x: 10, y: 0 }, { x: 10, y: 0 }, ['Stretch Vertex', 'Add Vertex']);
    expect(menus.get()).toEqual({
      doc: 1,
      grip: { x: 10, y: 0 },
      within: 0.25,
      items: ['Stretch Vertex', 'Add Vertex'],
      left: 300 + GRIP_MENU_OFFSET.x,
      top: 200 + GRIP_MENU_OFFSET.y,
    });
  });

  it('shows nothing for a grip with one function, an answer it did not ask, or when busy', () => {
    const { menus, asked, deps } = setup();
    menus.rest(1, at, deps);
    menus.answer(1, { x: 10, y: 0 }, { x: 10, y: 0 }, []);
    expect(menus.get()).toBeUndefined();
    menus.answer(1, { x: 10, y: 0 }, { x: 10, y: 0 }, ['Stretch', 'Lengthen']);
    expect(menus.get()).toBeUndefined();
    menus.rest(1, at, deps);
    menus.answer(2, { x: 10, y: 0 }, { x: 10, y: 0 }, ['Stretch', 'Lengthen']);
    menus.answer(1, { x: 9, y: 0 }, { x: 10, y: 0 }, ['Stretch', 'Lengthen']);
    expect(menus.get()).toBeUndefined();
    const busy = setup(false);
    busy.menus.rest(1, at, busy.deps);
    expect(busy.asked).toEqual([]);
    expect(asked).toHaveLength(2);
  });

  it('lingers as the cursor leaves the grip, and stays while the cursor is on it', () => {
    vi.useFakeTimers();
    const { menus, deps } = setup();
    menus.rest(1, at, deps);
    menus.answer(1, { x: 10, y: 0 }, { x: 10, y: 0 }, ['Stretch', 'Lengthen']);
    menus.rest(1, undefined, deps);
    vi.advanceTimersByTime(GRIP_MENU_LINGER_MS - 1);
    expect(menus.get()).toBeDefined();
    menus.enter();
    vi.advanceTimersByTime(GRIP_MENU_LINGER_MS);
    expect(menus.get()).toBeDefined();
    menus.leave();
    vi.advanceTimersByTime(GRIP_MENU_LINGER_MS);
    expect(menus.get()).toBeUndefined();
    vi.useRealTimers();
  });

  it('goes when the cursor rests elsewhere, a command starts or the grips change', () => {
    const { menus, deps } = setup();
    const show = () => {
      menus.rest(1, at, deps);
      menus.answer(1, { x: 10, y: 0 }, { x: 10, y: 0 }, ['Stretch', 'Lengthen']);
      expect(menus.get()).toBeDefined();
    };
    show();
    menus.rest(1, { ...at, world: { x: 20, y: 0 } }, deps);
    expect(menus.get()).toBeUndefined();
    show();
    menus.close(2);
    expect(menus.get()).toBeDefined();
    menus.close(1);
    expect(menus.get()).toBeUndefined();
  });

  it('tells its listeners each change', () => {
    const { menus, deps } = setup();
    const heard = vi.fn();
    const stop = menus.subscribe(heard);
    menus.rest(1, at, deps);
    menus.answer(1, { x: 10, y: 0 }, { x: 10, y: 0 }, ['Stretch', 'Lengthen']);
    menus.close(1);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });
});
