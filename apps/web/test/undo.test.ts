// M2-23: undo in the app. Ctrl+Z runs U and Ctrl+Y REDO; the Quick Access Undo and Redo
// buttons take their state and tooltips from each drawing's undo history, and an undo or a
// redo shows a toast with what it did and how many steps are left.
import { describe, expect, it } from 'vitest';
import type { UndoState } from '@triya/engine';
import { UndoStates, undoButtons, undoKeyCommand, undoToast } from '../src/undo';

const state = (o: Partial<UndoState> = {}): UndoState => ({
  undoable: 0,
  redoable: 0,
  grouping: false,
  control: 'all',
  ...o,
});

describe('undoKeyCommand', () => {
  const press = (key: string, o: { shift?: boolean; meta?: boolean; alt?: boolean } = {}) =>
    undoKeyCommand({
      key,
      ctrlKey: !o.meta,
      metaKey: o.meta === true,
      shiftKey: o.shift === true,
      altKey: o.alt === true,
    });

  it('binds Ctrl+Z to U and Ctrl+Y to REDO, as AutoCAD does (Cmd on a Mac)', () => {
    expect(press('z')).toBe('U');
    expect(press('Z')).toBe('U');
    expect(press('y')).toBe('REDO');
    expect(press('z', { meta: true })).toBe('U');
    // Cmd+Shift+Z is the Mac's redo key (AutoCAD for Mac binds it).
    expect(press('Z', { shift: true, meta: true })).toBe('REDO');
  });

  it('leaves other keys alone', () => {
    expect(press('z', { alt: true })).toBeUndefined();
    expect(press('y', { shift: true })).toBeUndefined();
    expect(press('x')).toBeUndefined();
    expect(
      undoKeyCommand({ key: 'z', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }),
    ).toBeUndefined();
  });
});

describe('undoButtons', () => {
  it('names the step each button would undo or redo, with its key', () => {
    const b = undoButtons(state({ undoable: 2, redoable: 1, nextUndo: 'LINE', nextRedo: 'LAYER' }));
    expect(b.undo).toEqual({ enabled: true, title: 'Undo LINE (Ctrl+Z)' });
    expect(b.redo).toEqual({ enabled: true, title: 'Redo LAYER (Ctrl+Y)' });
  });

  it('turns a button off when there is nothing to undo or redo, or no drawing', () => {
    expect(undoButtons(state())).toEqual({
      undo: { enabled: false, title: 'Nothing to undo' },
      redo: { enabled: false, title: 'Nothing to redo' },
    });
    expect(undoButtons(undefined).undo.enabled).toBe(false);
    // UNDO Control None turns undo off.
    expect(undoButtons(state({ control: 'none' })).undo.title).toBe('Undo is turned off');
  });
});

describe('undoToast', () => {
  it('says what one undo did and how many steps are left', () => {
    expect(undoToast({ kind: 'undo', labels: ['LINE'] }, state({ undoable: 3, redoable: 1 }))).toBe(
      'Undone: LINE · 3 more to undo',
    );
    expect(undoToast({ kind: 'undo', labels: ['LINE'] }, state({ redoable: 1 }))).toBe(
      'Undone: LINE · nothing more to undo',
    );
  });

  it('counts the steps of an UNDO n or a REDO of one', () => {
    expect(
      undoToast({ kind: 'undo', labels: ['LINE', 'LAYER', 'MOVE'] }, state({ undoable: 1 })),
    ).toBe('Undone: 3 steps · 1 more to undo');
    expect(undoToast({ kind: 'redo', labels: ['LINE'] }, state({ undoable: 1, redoable: 2 }))).toBe(
      'Redone: LINE · 2 more to redo',
    );
    expect(undoToast({ kind: 'redo', labels: ['A', 'B'] }, state({ undoable: 2 }))).toBe(
      'Redone: 2 steps',
    );
  });

  it('says nothing for an undo that undid nothing', () => {
    expect(undoToast({ kind: 'undo', labels: [] }, state())).toBeUndefined();
  });
});

describe('UndoStates', () => {
  it('keeps each drawing its own history state and its last toast', () => {
    const s = new UndoStates();
    let heard = 0;
    s.subscribe(() => (heard += 1));
    s.set(1, state({ undoable: 1, nextUndo: 'LINE' }));
    s.set(2, state({ redoable: 1, nextRedo: 'LINE' }), { kind: 'undo', labels: ['LINE'] });
    expect(s.get(1)?.undoable).toBe(1);
    expect(s.get(2)?.redoable).toBe(1);
    expect(s.toast).toMatchObject({ doc: 2, text: 'Undone: LINE · nothing more to undo' });
    const first = s.toast!.id;
    s.set(2, state(), { kind: 'redo', labels: ['LINE'] });
    expect(s.toast!.id).toBeGreaterThan(first);
    s.dismiss(s.toast!.id);
    expect(s.toast).toBeUndefined();
    s.forget(1);
    expect(s.get(1)).toBeUndefined();
    expect(heard).toBe(5);
  });

  it('keeps a toast only for its drawing', () => {
    const s = new UndoStates();
    s.set(2, state(), { kind: 'undo', labels: ['LINE'] });
    s.forget(2);
    expect(s.toast).toBeUndefined();
  });
});
