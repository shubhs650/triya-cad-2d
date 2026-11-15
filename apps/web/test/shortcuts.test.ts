// M3-10 part 2: the shortcut keys run the action the keyboard map gives them, by its owner's
// handler, and follow the user's keys.
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyKeyOverrides,
  focusOf,
  keymap,
  keymapVersion,
  onShortcuts,
  runShortcut,
} from '../src/shortcuts';

const key = (k: string, o: { ctrl?: boolean; shift?: boolean } = {}) => ({
  key: k,
  ctrlKey: o.ctrl === true,
  metaKey: false,
  shiftKey: o.shift === true,
  altKey: false,
  target: null,
});

afterEach(() => {
  applyKeyOverrides({});
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

describe('focusOf', () => {
  it('has no focus without an element', () => {
    expect(focusOf(null, null)).toEqual({ kind: 'none', empty: true });
  });
});
