// M3-10 part 2: the shortcut keys run the action the keyboard map gives them, by its owner's
// handler, and follow the user's keys.
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyKeyOverrides,
  focusOf,
  keymap,
  keymapVersion,
  onShortcuts,
  overrideKey,
  releaseShortcut,
  runAction,
  runShortcut,
} from '../src/shortcuts';
import { heldOverrides } from '../src/temp-overrides';

const key = (k: string, o: { ctrl?: boolean; shift?: boolean; code?: string } = {}) => ({
  key: k,
  ...(o.code !== undefined && { code: o.code }),
  ctrlKey: o.ctrl === true,
  metaKey: false,
  shiftKey: o.shift === true,
  altKey: false,
  target: null,
});

afterEach(() => {
  applyKeyOverrides({});
  heldOverrides.clear();
});

describe('runShortcut', () => {
  it("runs the action's handler, commands by the command handler", () => {
    const ran: string[] = [];
    const off = onShortcuts({
      'drafting:osnap': (id) => (ran.push(id), true),
      'command:': (id) => (ran.push(id), true),
    });
    expect(runShortcut(key('F3'))).toBe(true);
    expect(runShortcut(key('f', { ctrl: true }))).toBe(true);
    expect(runShortcut(key('p', { ctrl: true }))).toBe(true);
    // No action, or an action nobody handles.
    expect(runShortcut(key('F1'))).toBe(false);
    expect(runShortcut(key('F8'))).toBe(false);
    expect(runShortcut(key('Shift', { shift: true }))).toBe(false);
    expect(ran).toEqual(['drafting:osnap', 'drafting:osnap', 'command:PLOT']);
    off();
    expect(runShortcut(key('F3'))).toBe(false);
  });

  it("follows the user's keys", () => {
    const ran: string[] = [];
    const off = onShortcuts({
      'command:': (id) => (ran.push(id), true),
      'drafting:ortho': (id) => (ran.push(id), true),
    });
    let heard = 0;
    const stop = keymapVersion.subscribe(() => heard++);
    const before = keymapVersion.get();
    expect(applyKeyOverrides(keymap().assign('command:LINE', 'Ctrl+L'))).toBe(true);
    expect(applyKeyOverrides({ 'command:LINE': ['Ctrl+L'], 'drafting:ortho': ['F8'] })).toBe(false);
    expect(keymapVersion.get()).toBe(before + 1);
    expect(heard).toBe(1);
    runShortcut(key('l', { ctrl: true }));
    runShortcut(key('F8'));
    expect(ran).toEqual(['command:LINE', 'drafting:ortho']);
    stop();
    off();
  });

  it('leaves a handler that declines the key to the browser', () => {
    const off = onShortcuts({ enter: () => false });
    expect(runShortcut(key('j', { ctrl: true }))).toBe(false);
    off();
  });

  it('keeps an unregistered handler of another owner', () => {
    const a = () => true;
    const b = () => true;
    const offA = onShortcuts({ history: a });
    const offB = onShortcuts({ history: b });
    offA();
    expect(runShortcut(key('F2'))).toBe(true);
    offB();
    expect(runShortcut(key('F2'))).toBe(false);
  });
});

// M7-06 part 2: the Ctrl+K palette runs an action as its key would, with no field focused.
describe('runAction', () => {
  it('runs a registered action, or a command by the command handler', () => {
    const ran: string[] = [];
    const off = onShortcuts({
      cleanscreen: (id, focus) => (ran.push(`${id} ${focus.kind}`), true),
      'command:': (id) => (ran.push(id), true),
    });
    expect(runAction('cleanscreen')).toBe(true);
    expect(runAction('command:QUIT')).toBe(true);
    expect(runAction('palettes')).toBe(false);
    expect(ran).toEqual(['cleanscreen none', 'command:QUIT']);
    off();
  });
});

// M3-06 part 5: the temporary override keys are held: the override lasts until the key is let
// go, and only while their owner takes them (a prompt for a point, nothing typed).
describe('held override keys', () => {
  it('holds an override while its key is down, Shift alone staying the browser\u2019s', () => {
    let takes = true;
    const asked: string[] = [];
    const off = onShortcuts({ 'override:': (id) => (asked.push(id), takes) });
    // Shift alone: ORTHO's override, held but not taken from the browser (Shift+click).
    expect(runShortcut(key('Shift', { shift: true, code: 'ShiftLeft' }))).toBe(false);
    expect(heldOverrides.active()).toEqual(['ortho']);
    // Shift+E: Endpoint, and Shift alone stands aside while it is held.
    expect(runShortcut(key('E', { shift: true, code: 'KeyE' }))).toBe(true);
    expect(heldOverrides.active()).toEqual(['END']);
    // A key repeat changes nothing.
    expect(runShortcut(key('E', { shift: true, code: 'KeyE' }))).toBe(true);
    releaseShortcut(key('E', { shift: true, code: 'KeyE' }));
    expect(heldOverrides.active()).toEqual(['ortho']);
    expect(runShortcut(key('>', { shift: true, code: 'Period' }))).toBe(true);
    expect(heldOverrides.active()).toEqual(['polar']);
    // Shift let go lets every override go.
    releaseShortcut(key('Shift', { code: 'ShiftLeft' }));
    expect(heldOverrides.active()).toEqual([]);
    expect(asked).toEqual(['override:ortho', 'override:END', 'override:END', 'override:polar']);
    // Declined (no point asked for, or text typed): the key types.
    takes = false;
    expect(runShortcut(key('E', { shift: true, code: 'KeyE' }))).toBe(false);
    expect(heldOverrides.active()).toEqual([]);
    off();
    takes = true;
    expect(runShortcut(key('E', { shift: true, code: 'KeyE' }))).toBe(false);
  });

  it('tells Dynamic Input which keys are override keys', () => {
    expect(overrideKey(key('M', { shift: true, code: 'KeyM' }))).toBe(true);
    expect(overrideKey(key('m', { code: 'KeyM' }))).toBe(false);
    expect(overrideKey(key('Shift', { shift: true, code: 'ShiftLeft' }))).toBe(false);
    expect(overrideKey(key('F3'))).toBe(false);
  });

  it("follows the user's override keys", () => {
    const off = onShortcuts({ 'override:': () => true });
    applyKeyOverrides({ 'override:ortho': ['Shift+O'] });
    expect(runShortcut(key('Shift', { shift: true, code: 'ShiftLeft' }))).toBe(false);
    expect(heldOverrides.active()).toEqual([]);
    expect(runShortcut(key('O', { shift: true, code: 'KeyO' }))).toBe(true);
    expect(heldOverrides.active()).toEqual(['ortho']);
    off();
  });
});

describe('focusOf', () => {
  it('has no focus without an element', () => {
    expect(focusOf(null, null)).toEqual({ kind: 'none', empty: true });
  });
});
