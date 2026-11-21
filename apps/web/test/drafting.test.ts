// M2-04: the status bar's drafting aids, as AutoCAD toggles them.
import { describe, expect, it } from 'vitest';
import { OSMODE_DEFAULT, OSNAP, OSNAP_OFF } from '@triya/engine';
import { Drafting, INITIAL_DRAFTING } from '../src/drafting';

describe('drafting aids', () => {
  it("start as AutoCAD's: OSNAP (END, CEN, INT, EXT) and POLAR on, ORTHO and SNAP off", () => {
    const d = new Drafting();
    expect(d.get()).toEqual(INITIAL_DRAFTING);
    expect(d.get().osmode).toBe(OSMODE_DEFAULT);
    expect(['osnap', 'polar', 'ortho', 'snap'].map((t) => d.isOn(t as 'osnap'))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('F3 keeps the modes while OSNAP is off', () => {
    const d = new Drafting();
    d.toggle('osnap');
    expect(d.isOn('osnap')).toBe(false);
    expect(d.get().osmode).toBe(OSMODE_DEFAULT | OSNAP_OFF);
    d.toggle('osnap');
    expect(d.get().osmode).toBe(OSMODE_DEFAULT);
  });

  it('ORTHO and POLAR turn each other off', () => {
    const d = new Drafting();
    d.toggle('ortho');
    expect([d.isOn('ortho'), d.isOn('polar')]).toEqual([true, false]);
    d.toggle('polar');
    expect([d.isOn('ortho'), d.isOn('polar')]).toEqual([false, true]);
    d.toggle('polar');
    expect([d.isOn('ortho'), d.isOn('polar')]).toEqual([false, false]);
  });

  it("choosing a mode turns OSNAP on; clearing every mode turns it off; F3 then restores AutoCAD's set", () => {
    const d = new Drafting();
    d.toggle('osnap');
    d.setMode('MID', true);
    expect(d.isOn('osnap')).toBe(true);
    expect(d.get().osmode).toBe(OSMODE_DEFAULT | OSNAP.MID);
    for (const m of ['END', 'CEN', 'INT', 'EXT', 'MID'] as const) d.setMode(m, false);
    expect(d.isOn('osnap')).toBe(false);
    d.toggle('osnap');
    expect(d.get().osmode).toBe(OSMODE_DEFAULT);
  });

  it('notifies listeners', () => {
    const d = new Drafting();
    let n = 0;
    const off = d.subscribe(() => n++);
    d.toggle('snap');
    off();
    d.toggle('snap');
    expect(n).toBe(1);
  });

  it('starts OTRACK and TPY on and GRID off; LWT follows the drawing until toggled (part 2)', () => {
    const d = new Drafting();
    expect(['otrack', 'grid', 'tpy'].map((t) => d.isOn(t as 'otrack'))).toEqual([
      true,
      false,
      true,
    ]);
    // LWT shows the drawing's LWDISPLAY until the drafter turns it; then it stays as set.
    expect(d.isOn('lwt', true)).toBe(true);
    expect(d.isOn('lwt', false)).toBe(false);
    d.toggle('lwt', true);
    expect([d.isOn('lwt', true), d.isOn('lwt', false)]).toEqual([false, false]);
    d.toggle('lwt');
    expect(d.isOn('lwt', false)).toBe(true);
    d.toggle('grid');
    d.toggle('otrack');
    d.toggle('tpy');
    expect(['otrack', 'grid', 'tpy'].map((t) => d.isOn(t as 'otrack'))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('Annotation Visibility turns ANNOALLVISIBLE, AutoScale ANNOAUTOSCALE by its sign (M6-03)', () => {
    const d = new Drafting();
    // AutoCAD's initial ANNOALLVISIBLE 1 (shown: every annotative object) and ANNOAUTOSCALE −4.
    expect([d.isOn('annoVisible'), d.isOn('annoAutoScale')]).toEqual([true, false]);
    expect(d.get().annoAutoScale).toBe(-4);
    d.toggle('annoVisible');
    d.toggle('annoAutoScale');
    expect([d.get().annoAllVisible, d.get().annoAutoScale]).toEqual([false, 4]);
    d.toggle('annoAutoScale');
    expect([d.isOn('annoAutoScale'), d.get().annoAutoScale]).toEqual([false, -4]);
  });

  it('SC (Ctrl+W) turns SELECTIONCYCLING on as 2, off by its sign (M3-04 part 3)', () => {
    const d = new Drafting();
    expect(d.isOn('sc')).toBe(false);
    d.toggle('sc');
    expect([d.isOn('sc'), d.get().selectionCycling]).toEqual([true, 2]);
    d.toggle('sc');
    expect([d.isOn('sc'), d.get().selectionCycling]).toEqual([false, -2]);
    // Off at 1 (the badge only) turns back on at 1.
    d.configure({ selectionCycling: -1 });
    d.toggle('sc');
    expect(d.get().selectionCycling).toBe(1);
  });

  it('Ctrl+Shift+A turns group selection (PICKSTYLE bit 1) off and on, keeping bit 2 (M3-08)', () => {
    const d = new Drafting();
    expect([d.isOn('groups'), d.get().pickStyle]).toEqual([true, 1]);
    d.toggle('groups');
    expect([d.isOn('groups'), d.get().pickStyle]).toEqual([false, 0]);
    d.configure({ pickStyle: 2 });
    d.toggle('groups');
    expect([d.isOn('groups'), d.get().pickStyle]).toEqual([true, 3]);
  });
});

// M6-02 part 19: SNAP and GRID are the viewport worked in's (AutoCAD keeps SNAPMODE and GRIDMODE
// in each viewport): the shown canvas tells them and the toggles turn them there.
describe('SNAP and GRID of the viewport worked in', () => {
  it('shows the viewport’s, and F9, F7 and the Drafting Settings turn them there', () => {
    const d = new Drafting();
    const sent: { snap?: boolean; grid?: boolean }[] = [];
    const set = (p: { snap?: boolean; grid?: boolean }) => sent.push(p);
    let heard = 0;
    d.subscribe(() => heard++);
    d.setViewportModes({ snap: false, grid: true, set });
    expect(d.isOn('grid')).toBe(true);
    expect(d.get()).toMatchObject({ snap: false, grid: true });
    expect(heard).toBe(1);
    d.toggle('grid');
    d.toggle('snap');
    expect(sent).toEqual([{ grid: false }, { snap: true }]);
    // Shown at once, before the drawing's edit comes back.
    expect(d.get()).toMatchObject({ snap: true, grid: false });
    // The Drafting Settings' OK: only what differs is sent, the rest kept as usual.
    d.configure({ snap: true, grid: true, polarAngle: 45 });
    expect(sent.at(-1)).toEqual({ grid: true });
    expect(d.get()).toMatchObject({ grid: true, polarAngle: 45 });
    // The canvas telling the same again changes nothing.
    const before = heard;
    d.setViewportModes({ snap: true, grid: true, set });
    expect(heard).toBe(before);
  });

  it('keeps the session’s own for a drawing with no viewport to keep them in', () => {
    const d = new Drafting();
    d.setViewportModes({ snap: true, grid: true, set: () => {} });
    d.setViewportModes(undefined);
    expect(d.isOn('grid')).toBe(false);
    d.toggle('grid');
    expect(d.isOn('grid')).toBe(true);
    // Another drawing's viewport shows its own; the session's comes back without one.
    d.setViewportModes({ snap: false, grid: false, set: () => {} });
    expect(d.isOn('grid')).toBe(false);
    d.setViewportModes(undefined);
    expect(d.isOn('grid')).toBe(true);
  });
});
