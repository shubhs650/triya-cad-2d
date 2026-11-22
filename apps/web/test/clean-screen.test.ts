// M7-06: Clean Screen (Ctrl+0, CLEANSCREENON/OFF) hides the palettes with the ribbon and brings
// back only those it hid.
import { describe, expect, it } from 'vitest';
import { CleanScreen } from '../src/clean-screen';
import { PaletteStack } from '../src/palette-stack';

describe('Clean Screen', () => {
  it('hides the palettes and shows them again when turned off', () => {
    const stack = new PaletteStack();
    const clean = new CleanScreen(stack);
    let calls = 0;
    clean.subscribe(() => calls++);
    stack.set('layers');
    clean.toggle();
    expect([clean.on(), stack.get()]).toEqual([true, undefined]);
    clean.set(true);
    clean.toggle();
    expect([clean.on(), stack.get()]).toEqual([false, 'layers']);
    expect(calls).toBe(2);
  });

  it('leaves palettes hidden before it hidden', () => {
    const stack = new PaletteStack();
    const clean = new CleanScreen(stack);
    stack.set('layers');
    stack.show(false);
    clean.set(true);
    clean.set(false);
    expect([stack.get(), stack.hidden()]).toEqual([undefined, true]);
  });

  it('lets a palette opened while it is on show', () => {
    const stack = new PaletteStack();
    const clean = new CleanScreen(stack);
    clean.set(true);
    stack.set('properties');
    expect(stack.get()).toBe('properties');
    clean.set(false);
    expect(stack.get()).toBe('properties');
  });
});
