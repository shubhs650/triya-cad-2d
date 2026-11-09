// M2-20: the user's settings (UI_SPEC.md §6, ARCHITECTURE.md §13): theme, canvas colours, the
// coordinate display, Dynamic Input and the object snap settings AutoCAD keeps per user, kept
// in IndexedDB between sessions; anything unreadable falls back to the defaults.
import { describe, expect, it } from 'vitest';
import { OSMODE_DEFAULT, OSNAP } from '@triya/engine';
import { Drafting } from '../src/drafting';
import { DynMode } from '../src/dynamic-input';
import {
  DEFAULT_PREFERENCES,
  PreferencesStore,
  bindPreferences,
  normalizePreferences,
  type Preferences,
  type PreferencesPersistence,
} from '../src/preferences';

function memory(initial?: unknown): PreferencesPersistence & { saved: Preferences[] } {
  const saved: Preferences[] = [];
  return {
    saved,
    load: () => Promise.resolve(initial),
    save: (p) => {
      saved.push(p);
      return Promise.resolve();
    },
  };
}

describe('preferences', () => {
  it("start as UI_SPEC's defaults: system theme, the dark model canvas, drawing units", () => {
    expect(DEFAULT_PREFERENCES.theme).toBe('system');
    expect(DEFAULT_PREFERENCES.canvas).toEqual({
      model: '#212830',
      paper: '#ffffff',
      surround: '#8a8f98',
      grid: undefined,
      selection: '#4da3ff',
    });
    expect(DEFAULT_PREFERENCES.coordinates).toBe('drawing');
    expect(DEFAULT_PREFERENCES.dynMode).toBe(true);
    expect(DEFAULT_PREFERENCES.drafting).toEqual({
      osmode: OSMODE_DEFAULT,
      polar: true,
      polarAngle: 90,
      otrack: true,
      markerSize: 5,
      aperture: 10,
    });
  });

  it('keep what is valid of a stored record and default the rest', () => {
    const p = normalizePreferences({
      theme: 'dark',
      canvas: { model: '#FFFFFF', paper: 'red', grid: '#00ff00', selection: 7 },
      coordinates: 'hex',
      dynMode: false,
      drafting: { osmode: OSNAP.MID, polarAngle: 33, markerSize: 40, aperture: 25, otrack: 'no' },
      unknown: 1,
    });
    expect(p.theme).toBe('dark');
    expect(p.canvas).toEqual({ ...DEFAULT_PREFERENCES.canvas, model: '#ffffff', grid: '#00ff00' });
    expect(p.coordinates).toBe('drawing');
    expect(p.dynMode).toBe(false);
    // POLARANG only from AutoCAD's list; AUTOSNAPSIZE 1–20 and APERTURE 1–50.
    expect(p.drafting).toEqual({
      ...DEFAULT_PREFERENCES.drafting,
      osmode: OSNAP.MID,
      markerSize: 20,
      aperture: 25,
    });
    expect(normalizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences('junk')).toEqual(DEFAULT_PREFERENCES);
  });

  it('load the stored record, save each change, and skip a change that changes nothing', async () => {
    const m = memory({ theme: 'light' });
    const s = new PreferencesStore(m);
    let heard = 0;
    s.subscribe(() => heard++);
    await s.load();
    expect(s.get().theme).toBe('light');
    expect(heard).toBe(1);
    s.update({ theme: 'light' });
    expect(m.saved).toHaveLength(0);
    s.update({ canvas: { ...s.get().canvas, model: '#000000' } });
    expect(m.saved.at(-1)?.canvas.model).toBe('#000000');
    s.update({ canvas: { ...s.get().canvas } });
    expect(m.saved).toHaveLength(1);
    expect(heard).toBe(2);
  });

  it('a store that cannot be read or written keeps working for the session', async () => {
    const s = new PreferencesStore({
      load: () => Promise.reject(new Error('IndexedDB is unavailable')),
      save: () => Promise.reject(new Error('IndexedDB is unavailable')),
    });
    await s.load();
    expect(s.get()).toEqual(DEFAULT_PREFERENCES);
    s.update({ theme: 'dark' });
    await Promise.resolve();
    expect(s.get().theme).toBe('dark');
  });

  it('a change made before the stored record arrives wins over it', async () => {
    let release!: (v: unknown) => void;
    const s = new PreferencesStore({
      load: () => new Promise((r) => (release = r)),
      save: () => Promise.resolve(),
    });
    const loading = s.load();
    s.update({ theme: 'dark' });
    release({ theme: 'light', coordinates: 'decimal' });
    await loading;
    expect(s.get().theme).toBe('dark');
    expect(s.get().coordinates).toBe('decimal');
  });

  it('bind Dynamic Input and the object snap settings both ways, leaving the per-drawing toggles', async () => {
    const m = memory({
      dynMode: false,
      drafting: { osmode: OSNAP.MID | OSNAP.NEA, polar: false, polarAngle: 45, markerSize: 9 },
    });
    const s = new PreferencesStore(m);
    const drafting = new Drafting();
    const dyn = new DynMode();
    bindPreferences(s, drafting, dyn);
    await s.load();
    expect(dyn.get()).toBe(false);
    expect(drafting.get()).toMatchObject({
      osmode: OSNAP.MID | OSNAP.NEA,
      polar: false,
      polarAngle: 45,
      markerSize: 9,
      aperture: 10,
    });
    // F12 and F3 are remembered; F8 (ORTHOMODE, a drawing's own in AutoCAD) is not.
    dyn.toggle();
    expect(m.saved.at(-1)?.dynMode).toBe(true);
    drafting.toggle('osnap');
    expect(s.get().drafting.osmode).toBe(drafting.get().osmode);
    const saves = m.saved.length;
    drafting.toggle('ortho');
    expect(m.saved).toHaveLength(saves);
    // The Settings dialog changes the store; the status bar follows.
    s.update({ drafting: { ...s.get().drafting, polarAngle: 15 } });
    expect(drafting.get().polarAngle).toBe(15);
  });
});
