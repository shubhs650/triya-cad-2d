// M7-06 part 3: Ctrl+9, COMMANDLINE and COMMANDLINEHIDE show and hide the command line.
import { describe, expect, it, vi } from 'vitest';
import { CommandLineWindow, showsInputRow } from '../src/command-line-window';

describe('the command line shown or hidden', () => {
  it('is shown at first; set and toggle tell their listeners once per change', () => {
    const w = new CommandLineWindow();
    const heard = vi.fn();
    w.subscribe(heard);
    expect(w.shown()).toBe(true);
    w.set(true);
    expect(heard).not.toHaveBeenCalled();
    w.toggle();
    expect(w.shown()).toBe(false);
    w.set(false);
    expect(heard).toHaveBeenCalledTimes(1);
    w.toggle();
    expect(w.shown()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('stops telling a listener that unsubscribed', () => {
    const w = new CommandLineWindow();
    const heard = vi.fn();
    w.subscribe(heard)();
    w.toggle();
    expect(heard).not.toHaveBeenCalled();
  });

  it('hidden, shows its input row only while typed in or prompting', () => {
    expect(showsInputRow({ shown: true, text: '', prompting: false })).toBe(true);
    expect(showsInputRow({ shown: false, text: '', prompting: false })).toBe(false);
    expect(showsInputRow({ shown: false, text: 'L', prompting: false })).toBe(true);
    expect(showsInputRow({ shown: false, text: '', prompting: true })).toBe(true);
  });
});
