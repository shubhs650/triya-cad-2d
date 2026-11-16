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
import { ALIAS_FILE_MAX } from '../src/user-aliases';
import { DEFAULT_TOOLTIP } from '../src/tooltip-appearance';

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
      // M2-20 part 2: Automatic, following the background as ACI 7 does.
      crosshair: undefined,
      autosnap: undefined,
      autotrack: undefined,
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
      pdfOsnap: true,
      revcloudGrips: true,
      // QPMODE −1 (off, all objects once on) and QPLOCATION 0 (by the cursor): AutoCAD's initial.
      qpmode: -1,
      qpLocation: 0,
      // AUTOSNAP's bits other than POLAR and OTRACK: marker, SnapTip, magnet and the tracking
      // tooltips, all on (AutoCAD's initial 63); PICKFIRST 1 (M2-59).
      autosnap: 39,
      pickfirst: true,
      // GRIPSIZE 5 (M2-59 part 3).
      gripSize: 5,
      // GRIPCOLOR 150, GRIPHOVER 11, GRIPHOT 12 and GRIPCONTOUR 251, AutoCAD's (M3-05 part 5).
      gripColors: { unselected: 150, hover: 11, selected: 12, contour: 251 },
      // ROLLOVERTIPS 1 (M2-35 part 21).
      rolloverTips: true,
      // ARRAYASSOCIATIVITY 1 (M3-11).
      arrayAssociativity: true,
      // M3-06 part 1: POLARMODE 0 and POLARADDANG "" (AutoCAD's initial values), and the
      // Drafting Settings dialog's Quick Properties tab: top right, 50 pixels, collapsed to 3 rows.
      polarMode: 0,
      polarAddAngles: '',
      // M3-06 part 3: SNAPTYPE 0 (grid snap) and POLARDIST 0, AutoCAD's initial values.
      snapType: 0,
      polarDist: 0,
      gridStyle: 0,
      // M3-06 part 5: TEMPOVERRIDES 1, AutoCAD's.
      tempOverrides: true,
      // M3-06 part 4: DYNMODE 3, DYNPROMPT 1, DYNPICOORDS 0, DYNPIFORMAT 0, AutoCAD's.
      dynBits: 3,
      dynPrompt: true,
      dynPiCoords: 0,
      dynPiFormat: 0,
      // M3-06 part 8: DYNPIVIS 1, DYNDIVIS 1, DYNDIGRIP 31, DYNINFOTIPS 1, AutoCAD's.
      dynPiVis: 1,
      dynDiVis: 1,
      dynDiGrip: 31,
      dynInfoTips: true,
      tooltip: DEFAULT_TOOLTIP,
      // SELECTSIMILARMODE 130 (Layer and Name) and SELECTIONCYCLING 0 (off), AutoCAD's.
      selectSimilarMode: 130,
      selectionCycling: 0,
      // PICKSTYLE 1, group selection (M3-08).
      pickStyle: 1,
      groupDisplayMode: 2,
      // PICKBOX 3, PICKADD 2 and PICKAUTO 5, AutoCAD's initial values (M3-04 part 4).
      pickbox: 3,
      pickadd: 2,
      pickauto: 5,
      selectionPreview: 3,
      previewFilter: 3,
      // SELECTIONPREVIEWLIMIT 20000, AutoCAD 2024's initial value (M3-04 part 6).
      selectionPreviewLimit: 20000,
      // COMMANDPREVIEW 1, AutoCAD 2024's initial value (M3-12 part 6).
      commandPreview: 1,
      qpQuadrant: 'top-right',
      qpDistance: 50,
      qpCollapse: true,
      qpRows: 3,
      // The Selection Cycling tab's list place (M3-04 part 7).
      scLocation: 0,
      scQuadrant: 'top-right',
      scDistance: 25,
      scTitleBar: true,
      // M3-12: the modify commands' options AutoCAD keeps per user, at its initial values.
      modifyOptions: {
        OFFSETERASE: 0,
        OFFSETGAPTYPE: 0,
        TRIMEXTENDMODE: 1,
        EDGEMODE: 0,
        PROJMODE: 1,
        TRIMMODE: 1,
        PEDITACCEPT: 0,
        // M4-09 part 3: TEXTALIGN's Left and Current vertical.
        TEXTALIGNMODE: 9,
        TEXTALIGNSPACING: 2,
        // M4-07 part 5: the hatch dialogs shown while the ribbon is closed.
        HPDLGMODE: 2,
      },
    });
    // No named filters (FILTER, M3-04 part 4).
    expect(DEFAULT_PREFERENCES.filters).toEqual({});
    // No user alias file (M3-10).
    expect(DEFAULT_PREFERENCES.aliasFile).toBe('');
    // AutoCAD's default shortcut keys (M3-10 part 2).
    expect(DEFAULT_PREFERENCES.keys).toEqual({});
  });

  it('keep the user shortcut keys they can use (M3-10 part 2)', () => {
    expect(
      normalizePreferences({ keys: { 'command:LINE': ['ctrl+alt+l'], 'drafting:osnap': [] } }).keys,
    ).toEqual({ 'command:LINE': ['Ctrl+Alt+L'], 'drafting:osnap': [] });
    expect(normalizePreferences({ keys: { 'command:LINE': ['L'] } }).keys).toEqual({
      'command:LINE': [],
    });
    expect(normalizePreferences({ keys: 'F1' }).keys).toEqual({});
  });

  it('keep the user alias file, unless it is not text or too long (M3-10)', () => {
    expect(normalizePreferences({ aliasFile: 'C,*COPY\n' }).aliasFile).toBe('C,*COPY\n');
    expect(normalizePreferences({ aliasFile: 7 }).aliasFile).toBe('');
    expect(normalizePreferences({ aliasFile: 'x'.repeat(ALIAS_FILE_MAX + 1) }).aliasFile).toBe('');
  });

  it('keep the Dynamic Input tab\u2019s part 8 values when valid', () => {
    const tooltip = {
      modelColor: '#102030',
      layoutColor: undefined,
      size: 2,
      transparency: 30,
      all: false,
    };
    expect(
      normalizePreferences({
        drafting: { dynPiVis: 2, dynDiVis: 0, dynDiGrip: 9, dynInfoTips: false, tooltip },
      }).drafting,
    ).toMatchObject({ dynPiVis: 2, dynDiVis: 0, dynDiGrip: 9, dynInfoTips: false, tooltip });
    expect(
      normalizePreferences({
        drafting: { dynPiVis: 3, dynDiVis: -1, dynDiGrip: 32, dynInfoTips: 'no', tooltip: 1 },
      }).drafting,
    ).toMatchObject({
      dynPiVis: 1,
      dynDiVis: 1,
      dynDiGrip: 31,
      dynInfoTips: true,
      tooltip: { size: 0 },
    });
  });

  it('keep the Drafting Settings dialog\u2019s values when valid (M3-06 part 1)', () => {
    const kept = normalizePreferences({
      drafting: {
        polarMode: 6,
        polarAddAngles: '12.5;80',
        snapType: 1,
        polarDist: 2.5,
        gridStyle: 5,
        tempOverrides: false,
        dynBits: 1,
        dynPrompt: false,
        dynPiCoords: 1,
        dynPiFormat: 1,
        selectSimilarMode: 7,
        selectionCycling: -2,
        pickStyle: 3,
        pickbox: 10,
        pickadd: 0,
        pickauto: 7,
        selectionPreview: 1,
        previewFilter: 40,
        selectionPreviewLimit: 500,
        commandPreview: 0,
        qpQuadrant: 'bottom-left',
        qpDistance: 120,
        qpCollapse: false,
        qpRows: 5,
        scLocation: 1,
        scQuadrant: 'bottom-right',
        scDistance: 0,
        scTitleBar: false,
      },
    }).drafting;
    expect(kept).toMatchObject({
      scLocation: 1,
      scQuadrant: 'bottom-right',
      scDistance: 0,
      scTitleBar: false,
      selectSimilarMode: 7,
      selectionCycling: -2,
      pickStyle: 3,
      pickbox: 10,
      pickadd: 0,
      pickauto: 7,
      selectionPreview: 1,
      previewFilter: 40,
      selectionPreviewLimit: 500,
      commandPreview: 0,
      polarMode: 6,
      polarAddAngles: '12.5;80',
      snapType: 1,
      polarDist: 2.5,
      gridStyle: 5,
      tempOverrides: false,
      dynBits: 1,
      dynPrompt: false,
      dynPiCoords: 1,
      dynPiFormat: 1,
      qpQuadrant: 'bottom-left',
      qpDistance: 120,
      qpCollapse: false,
      qpRows: 5,
    });
    const bad = normalizePreferences({
      drafting: {
        polarMode: 16,
        polarAddAngles: 'north',
        snapType: 2,
        polarDist: -1,
        gridStyle: 8,
        tempOverrides: 'off',
        dynBits: 'all',
        dynPrompt: 'yes',
        dynPiCoords: 0.5,
        dynPiFormat: 'polar',
        selectSimilarMode: 256,
        selectionCycling: 3,
        pickStyle: 'groups',
        pickbox: 51,
        pickadd: 4,
        pickauto: -1,
        selectionPreview: 4,
        previewFilter: 64,
        selectionPreviewLimit: 32768,
        commandPreview: 2,
        qpQuadrant: 'middle',
        qpDistance: 'far',
        qpCollapse: 'yes',
        qpRows: 99,
        scLocation: 2,
        scQuadrant: 'left',
        scDistance: 500,
        scTitleBar: 'no',
      },
    }).drafting;
    expect(bad).toMatchObject({
      scLocation: 0,
      scQuadrant: 'top-right',
      scDistance: 400,
      scTitleBar: true,
      selectSimilarMode: 130,
      selectionCycling: 0,
      pickStyle: 1,
      pickbox: 3,
      pickadd: 2,
      pickauto: 5,
      selectionPreview: 3,
      previewFilter: 3,
      selectionPreviewLimit: 20000,
      commandPreview: 1,
      polarMode: 0,
      polarAddAngles: '',
      snapType: 0,
      polarDist: 0,
      gridStyle: 0,
      tempOverrides: true,
      dynBits: 3,
      dynPrompt: true,
      dynPiCoords: 0,
      dynPiFormat: 0,
      qpQuadrant: 'top-right',
      qpDistance: 50,
      qpCollapse: true,
      // Out of range is brought to the nearest end, as the sizes are.
      qpRows: 30,
    });
  });

  it('keep the modify commands\u2019 options when valid (M3-12)', () => {
    const kept = normalizePreferences({
      drafting: { modifyOptions: { OFFSETGAPTYPE: 2, TRIMMODE: 0, PEDITACCEPT: 1, NOSUCH: 4 } },
    }).drafting.modifyOptions;
    expect(kept).toEqual({
      OFFSETERASE: 0,
      OFFSETGAPTYPE: 2,
      TRIMEXTENDMODE: 1,
      EDGEMODE: 0,
      PROJMODE: 1,
      TRIMMODE: 0,
      PEDITACCEPT: 1,
      TEXTALIGNMODE: 9,
      TEXTALIGNSPACING: 2,
      HPDLGMODE: 2,
    });
    const bad = normalizePreferences({
      drafting: { modifyOptions: { OFFSETGAPTYPE: 3, PROJMODE: 'View', EDGEMODE: 0.5 } },
    }).drafting.modifyOptions;
    expect(bad).toMatchObject({ OFFSETGAPTYPE: 0, PROJMODE: 1, EDGEMODE: 0 });
    expect(normalizePreferences({ drafting: { modifyOptions: 7 } }).drafting.modifyOptions).toEqual(
      DEFAULT_PREFERENCES.drafting.modifyOptions,
    );
  });

  it('keep what is valid of a stored record and default the rest', () => {
    const p = normalizePreferences({
      theme: 'dark',
      canvas: {
        model: '#FFFFFF',
        paper: 'red',
        grid: '#00ff00',
        selection: 7,
        crosshair: '#FF0000',
        autosnap: 'yellow',
        autotrack: '#00ffff',
      },
      coordinates: 'hex',
      dynMode: false,
      drafting: {
        osmode: OSNAP.MID,
        polarAngle: 33,
        markerSize: 40,
        aperture: 25,
        gripSize: 300,
        otrack: 'no',
        pdfOsnap: false,
        revcloudGrips: false,
        qpmode: 7,
        qpLocation: 1,
        autosnap: 255,
        pickfirst: false,
        rolloverTips: 0,
      },
      unknown: 1,
    });
    expect(p.theme).toBe('dark');
    expect(p.canvas).toEqual({
      ...DEFAULT_PREFERENCES.canvas,
      model: '#ffffff',
      grid: '#00ff00',
      crosshair: '#ff0000',
      autotrack: '#00ffff',
    });
    expect(p.coordinates).toBe('drawing');
    expect(p.dynMode).toBe(false);
    // POLARANG only from AutoCAD's list; AUTOSNAPSIZE 1–20, APERTURE 1–50 and GRIPSIZE 1–255.
    expect(p.drafting).toEqual({
      ...DEFAULT_PREFERENCES.drafting,
      osmode: OSNAP.MID,
      markerSize: 20,
      aperture: 25,
      gripSize: 255,
      pdfOsnap: false,
      revcloudGrips: false,
      // QPMODE −2 to 2 only; QPLOCATION 0 or 1.
      qpLocation: 1,
      pickfirst: false,
      // ROLLOVERTIPS is a yes or no: anything else keeps the default.
    });
    expect(normalizePreferences({ drafting: { rolloverTips: false } }).drafting.rolloverTips).toBe(
      false,
    );
    // AUTOSNAP keeps its bits 1, 2, 4 and 32 only (8 and 16 are POLAR and OTRACK).
    expect(normalizePreferences({ drafting: { autosnap: 63 } }).drafting.autosnap).toBe(39);
    expect(normalizePreferences({ drafting: { autosnap: 5 } }).drafting.autosnap).toBe(5);
    expect(normalizePreferences({ drafting: { qpmode: 2 } }).drafting.qpmode).toBe(2);
    expect(normalizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences('junk')).toEqual(DEFAULT_PREFERENCES);
  });

  it('keep the grip colours as ACI 1 to 255, each on its own (M3-05 part 5)', () => {
    const colors = (gripColors: unknown) =>
      normalizePreferences({ drafting: { gripColors } }).drafting.gripColors;
    expect(colors({ unselected: 3, hover: 4, selected: 5, contour: 6 })).toEqual({
      unselected: 3,
      hover: 4,
      selected: 5,
      contour: 6,
    });
    // Out of range, not a whole number or missing: that colour's default.
    expect(colors({ unselected: 0, hover: 256, selected: 2.5 })).toEqual(
      DEFAULT_PREFERENCES.drafting.gripColors,
    );
    expect(colors('red')).toEqual(DEFAULT_PREFERENCES.drafting.gripColors);
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
    // PDFOSNAP is AutoCAD's per user too (M2-22).
    drafting.configure({ pdfOsnap: false });
    expect(m.saved.at(-1)?.drafting.pdfOsnap).toBe(false);
    // REVCLOUDGRIPS too, a registry setting in AutoCAD (M2-42).
    drafting.configure({ revcloudGrips: false });
    expect(m.saved.at(-1)?.drafting.revcloudGrips).toBe(false);
    // QPMODE and QPLOCATION are kept in the registry in AutoCAD (M2-35 part 16).
    drafting.toggle('qp');
    expect(m.saved.at(-1)?.drafting.qpmode).toBe(1);
    drafting.configure({ qpLocation: 1 });
    expect(m.saved.at(-1)?.drafting.qpLocation).toBe(1);
    // AUTOSNAP and PICKFIRST are AutoCAD's registry settings too (M2-59).
    drafting.configure({ autosnap: 1 });
    expect(m.saved.at(-1)?.drafting.autosnap).toBe(1);
    drafting.configure({ pickfirst: false });
    expect(m.saved.at(-1)?.drafting.pickfirst).toBe(false);
    // ROLLOVERTIPS is a registry setting too (M2-35 part 21).
    drafting.configure({ rolloverTips: false });
    expect(m.saved.at(-1)?.drafting.rolloverTips).toBe(false);
  });
});
