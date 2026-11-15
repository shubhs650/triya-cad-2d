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
