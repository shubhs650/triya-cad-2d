// M3-06 part 1: the Drafting Settings dialog's model (AutoCAD 2024 Help, "Drafting Settings
// Dialog Box": the Polar Tracking, Object Snap and Quick Properties tabs), POLARADDANG's angle
// list, what polar and object snap tracking follow, and the Object Snap tab's mode markers.
import { describe, expect, it } from 'vitest';
import { OSMODE_DEFAULT, OSNAP, OSNAP_MODES, OSNAP_OFF, constrainCursor } from '@triya/engine';
import { markerSvgPath } from '../src/canvas/autosnap';
import {
  INITIAL_DRAFTING,
  additionalAngles,
  angleText,
  gridDisplayOf,
  polarSnapDistance,
  trackingSettings,
  type DraftingState,
} from '../src/drafting';
import {
  DRAFTING_SETTINGS_TABS,
  addAngle,
  draftOf,
  draftPatch,
  draftProblem,
  equalSpacing,
  gridBehavior,
  snapGridOf,
  spacingOf,
  spacingSettings,
  typeSpacing,
} from '../src/drafting-settings';

const state = (patch: Partial<DraftingState> = {}): DraftingState => ({
  ...INITIAL_DRAFTING,
  ...patch,
});

describe('POLARADDANG', () => {
  it('reads up to ten decimal angles separated by semicolons', () => {
    expect(additionalAngles('')).toEqual([]);
    expect(additionalAngles(' 12.5; 80 ;-15 ')).toEqual([12.5, 80, -15]);
    expect(additionalAngles('.5')).toEqual([0.5]);
    expect(additionalAngles('1;2;3;4;5;6;7;8;9;10')).toHaveLength(10);
    expect(additionalAngles('1;2;3;4;5;6;7;8;9;10;11')).toBeUndefined();
    expect(additionalAngles('12;;80')).toBeUndefined();
    expect(additionalAngles('45d')).toBeUndefined();
    expect(additionalAngles(`1${'0'.repeat(25)}`)).toBeUndefined();
    expect(angleText(12.5)).toBe('12.5');
    expect(angleText(1 / 3)).toBe('0.333333');
  });
});

describe('tracking settings', () => {
  const rad = Math.PI / 180;

  it('track POLARANG while POLAR is on, with the additional angles while POLARMODE has 4', () => {
    expect(trackingSettings(state({ polar: false, polarMode: 6 }))).toEqual({});
    expect(trackingSettings(state({ polarAngle: 45 }))).toEqual({
      polar: { increment: 45 * rad },
    });
    // The angles are kept while bit 4 is off, and not tracked.
    expect(trackingSettings(state({ polarAddAngles: '12.5' }))).toEqual({
      polar: { increment: 90 * rad },
    });
    expect(trackingSettings(state({ polarMode: 4, polarAddAngles: '12.5;80' }))).toEqual({
      polar: { increment: 90 * rad, additional: [12.5 * rad, 80 * rad] },
    });
    expect(trackingSettings(state({ polarMode: 2 }))).toEqual({
      polar: { increment: 90 * rad },
      trackPolar: true,
    });
  });

  it('lock the cursor onto an additional angle near it', () => {
    const base = { x: 0, y: 0 };
    const near = { x: Math.cos(12.4 * rad) * 10, y: Math.sin(12.4 * rad) * 10 };
    const off = constrainCursor(near, { base, ...trackingSettings(state()), tolerance: 0.1 });
    expect(off.polar).toBeUndefined();
    const on = constrainCursor(near, {
      base,
      ...trackingSettings(state({ polarMode: 4, polarAddAngles: '12.5' })),
      tolerance: 0.1,
    });
    expect((on.polar!.angle * 180) / Math.PI).toBeCloseTo(12.5, 9);
  });
});

describe('the Drafting Settings dialog', () => {
  it('opens on the drafting aids as they are', () => {
    const d = draftOf(
      state({ polarMode: 6, polarAddAngles: '12.5;80', qpmode: -2, osmode: 5 | OSNAP_OFF }),
    );
    expect(d).toEqual({
      snap: false,
      grid: false,
      polar: true,
      polarAngle: 90,
      additional: true,
      angles: [12.5, 80],
      trackPolar: true,
      relative: false,
      snapType: 0,
      gridStyle: 0,
      polarDist: '0',
      osnap: false,
      modes: 5,
      otrack: true,
      dynPointer: true,
      dynDimension: true,
      dynPrompt: true,
      dynAbsolute: false,
      dynCartesian: false,
      qp: false,
      qpMode: 2,
      qpLocation: 0,
      quadrant: 'top-right',
      distance: '50',
      collapse: true,
      rows: '3',
      sc: false,
      scList: true,
      scLocation: 0,
      scQuadrant: 'top-right',
      scDistance: '25',
      scTitleBar: true,
    });
    // QPMODE 0 keeps no mode: turned on, it is for all objects. Object snap with no modes is off.
    expect(draftOf(state({ qpmode: 0, osmode: 0 }))).toMatchObject({ qpMode: 1, osnap: false });
  });

  it('gives OK what it shows, keeping POLARMODE’s other bits and the snap modes F3 turns back on', () => {
    const s = state({ polarMode: 9, osmode: OSMODE_DEFAULT });
    const d = {
      ...draftOf(s),
      polar: false,
      polarAngle: 30,
      additional: true,
      angles: [12.5, 80],
      trackPolar: true,
      osnap: false,
      modes: OSNAP.END | OSNAP.MID,
      otrack: false,
      qp: true,
      qpMode: 2 as const,
      qpLocation: 1 as const,
      quadrant: 'bottom-left' as const,
      distance: ' 120 ',
      collapse: false,
      rows: '5',
    };
    expect(draftPatch(d, s)).toEqual({
      snap: false,
      grid: false,
      polar: false,
      polarAngle: 30,
      polarMode: 15,
      polarAddAngles: '12.5;80',
      snapType: 0,
      gridStyle: 0,
      polarDist: 0,
      osmode: OSNAP.END | OSNAP.MID | OSNAP_OFF,
      otrack: false,
      dynBits: 3,
      dynPrompt: true,
      dynPiCoords: 0,
      dynPiFormat: 0,
      qpmode: 2,
      qpLocation: 1,
      qpQuadrant: 'bottom-left',
      qpDistance: 120,
      qpCollapse: false,
      qpRows: 5,
      selectionCycling: 0,
      scLocation: 0,
      scQuadrant: 'top-right',
      scDistance: 25,
      scTitleBar: true,
    });
    const back = draftPatch(
      { ...d, additional: false, trackPolar: false, osnap: true, qp: false },
      s,
    );
    expect(back).toMatchObject({ polarMode: 9, osmode: OSNAP.END | OSNAP.MID, qpmode: -2 });
  });

  it('refuses a distance or row count out of range, and OK then sets nothing', () => {
    const d = draftOf(state());
    expect(draftProblem(d)).toBeUndefined();
    expect(draftProblem({ ...d, distance: '401' })).toBe(
      'Distance in pixels must be a whole number from 0 to 400.',
    );
    expect(draftProblem({ ...d, distance: '2.5' })).toBeDefined();
    expect(draftProblem({ ...d, rows: '0' })).toBe(
      'Minimum number of rows must be a whole number from 1 to 30.',
    );
    expect(draftPatch({ ...d, rows: '' }, state())).toEqual({});
  });

  it('adds an angle New was typed after, up to ten, each once', () => {
    expect(addAngle([12.5], ' 80 ')).toEqual({ angles: [12.5, 80] });
    expect(addAngle([12.5], '12.50')).toEqual({ problem: '12.5 is listed already.' });
    expect(addAngle([], 'north')).toEqual({ problem: 'Enter an angle in degrees.' });
    expect(addAngle([], '1;2')).toEqual({ problem: 'Enter an angle in degrees.' });
    expect(addAngle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '11')).toEqual({
      problem: 'Up to 10 additional angles.',
    });
  });
});

describe('PolarSnap and relative polar angles (M3-06 part 3)', () => {
  const rad = Math.PI / 180;

  it('snap by POLARDIST, or the snap X spacing while it is 0, only with SNAP on and SNAPTYPE 1', () => {
    expect(polarSnapDistance(state({ snap: true, snapType: 1, polarDist: 2.5 }), 10)).toBe(2.5);
    expect(polarSnapDistance(state({ snap: true, snapType: 1 }), 10)).toBe(10);
    expect(polarSnapDistance(state({ snap: false, snapType: 1, polarDist: 2.5 }), 10)).toBe(
      undefined,
    );
    expect(polarSnapDistance(state({ snap: true, snapType: 0, polarDist: 2.5 }), 10)).toBe(
      undefined,
    );
  });

  it('count the polar angles from the last segment with POLARMODE 1 and a last segment', () => {
    expect(trackingSettings(state({ polarMode: 1 }), { x: 0, y: 2 })).toEqual({
      polar: { increment: 90 * rad, relative: 90 * rad },
    });
    // No last segment, a zero one, or bit 1 off: absolute.
    expect(trackingSettings(state({ polarMode: 1 }))).toEqual({ polar: { increment: 90 * rad } });
    expect(trackingSettings(state({ polarMode: 1 }), { x: 0, y: 0 })).toEqual({
      polar: { increment: 90 * rad },
    });
    expect(trackingSettings(state(), { x: 0, y: 2 })).toEqual({ polar: { increment: 90 * rad } });
  });

  it('are the dialog’s Snap type, Polar distance and Polar Angle measurement', () => {
    const s = state({ snapType: 1, polarDist: 2.5, polarMode: 1 });
    const d = draftOf(s);
    expect(d).toMatchObject({ snapType: 1, polarDist: '2.5', relative: true });
    expect(draftPatch({ ...d, snapType: 0, polarDist: ' 4 ', relative: false }, s)).toMatchObject({
      snapType: 0,
      polarDist: 4,
      polarMode: 0,
    });
    expect(draftPatch({ ...d, relative: true }, state({ polarMode: 8 }))).toMatchObject({
      polarMode: 9,
    });
    expect(draftProblem({ ...d, polarDist: '-1' })).toBe(
      'Polar distance must be a number, 0 or more.',
    );
    expect(draftProblem({ ...d, polarDist: 'far' })).toBeDefined();
    expect(draftPatch({ ...d, polarDist: '' }, s)).toEqual({});
  });
});

describe('the Snap and Grid tab', () => {
  const drawing = { snapSpacing: { x: 0.5, y: 0.5 }, gridSpacing: { x: 0, y: 0 }, gridMajor: 5 };

  it('comes first, as AutoCAD’s does, with SNAP, GRID and the drawing’s spacing', () => {
    expect(DRAFTING_SETTINGS_TABS.map((t) => t.label)).toEqual([
      'Snap and Grid',
      'Polar Tracking',
      'Object Snap',
      'Dynamic Input',
      'Quick Properties',
      'Selection Cycling',
    ]);
    const d = draftOf(state({ snap: true, grid: true }), drawing);
    expect(d).toMatchObject({
      snap: true,
      grid: true,
      spacing: { snapX: '0.5', snapY: '0.5', gridX: '0', gridY: '0', equal: true, major: '5' },
    });
    expect(spacingOf({ ...drawing, snapSpacing: { x: 1, y: 2 } }).equal).toBe(false);
    // A drawing without an *Active VPORT has no spacing to show, and OK sets none.
    const none = draftOf(state());
    expect(none.spacing).toBeUndefined();
    expect(snapGridOf(none)).toBeUndefined();
    expect(draftPatch({ ...none, snap: true, grid: true }, state())).toMatchObject({
      snap: true,
      grid: true,
    });
  });

  it('gives OK the spacing typed, X and Y following each other with Equal X and Y spacing', () => {
    const g = spacingOf(drawing);
    const typed = typeSpacing(typeSpacing(g, 'snapX', '2'), 'gridY', '10');
    expect(typed).toMatchObject({ snapX: '2', snapY: '2', gridX: '10', gridY: '10' });
    const apart = typeSpacing(equalSpacing(typed, false), 'snapY', '3');
    expect(apart).toMatchObject({ snapX: '2', snapY: '3', equal: false });
    expect(equalSpacing({ ...apart, gridX: '4' }, true)).toMatchObject({
      snapY: '2',
      gridY: '4',
      equal: true,
    });
    expect(spacingSettings({ ...apart, major: ' 10 ' })).toEqual({
      snapSpacing: { x: 2, y: 3 },
      gridSpacing: { x: 10, y: 10 },
      gridMajor: 10,
    });
    const d = { ...draftOf(state(), drawing), spacing: { ...apart, snapX: '.25', gridY: '1e1' } };
    expect(snapGridOf(d)).toEqual({
      snapSpacing: { x: 0.25, y: 3 },
      gridSpacing: { x: 10, y: 10 },
      gridMajor: 5,
    });
  });

  it('refuses spacing that is not a number, snap spacing of 0 and a major line out of range', () => {
    const d = draftOf(state(), drawing);
    const g = d.spacing!;
    const problem = (patch: Partial<typeof g>) =>
      draftProblem({ ...d, spacing: { ...g, ...patch } });
    expect(draftProblem(d)).toBeUndefined();
    expect(problem({ snapX: '0' })).toBe('Snap X spacing must be a number more than 0.');
    expect(problem({ snapY: 'ten' })).toBe('Snap Y spacing must be a number more than 0.');
    expect(problem({ gridX: '-1' })).toBe('Grid X spacing must be a number, 0 or more.');
    expect(problem({ gridY: '' })).toBe('Grid Y spacing must be a number, 0 or more.');
    expect(problem({ major: '0' })).toBe('Major line every must be a whole number from 1 to 100.');
    expect(problem({ major: '101' })).toBeDefined();
    expect(problem({ snapX: '1e999' })).toBeDefined();
    expect(snapGridOf({ ...d, spacing: { ...g, major: 'x' } })).toBeUndefined();
    expect(draftPatch({ ...d, spacing: { ...g, snapX: '' } }, state())).toEqual({});
  });
});

describe('the Object Snap tab’s markers', () => {
  it('draws each mode as AutoSnap does, y down, circles as two half arcs', () => {
    expect(markerSvgPath('END', 5)).toBe('M-5 5L5 5L5 -5L-5 -5Z');
    expect(markerSvgPath('CEN', 5)).toBe('M5 0M5 0A5 5 0 1 0 -5 0A5 5 0 1 0 5 0');
    for (const { mode } of OSNAP_MODES) expect(markerSvgPath(mode, 5)).toMatch(/^M/);
  });
});

describe('the Dynamic Input tab (M3-06 part 4)', () => {
  it('comes before Quick Properties, as AutoCAD’s does', () => {
    const tabs = DRAFTING_SETTINGS_TABS.map((t) => t.label);
    expect(tabs.indexOf('Dynamic Input')).toBe(tabs.indexOf('Quick Properties') - 1);
  });

  it('shows DYNMODE’s bits, DYNPROMPT, DYNPICOORDS and DYNPIFORMAT, and OK sets them', () => {
    const d = draftOf(state());
    expect(d).toMatchObject({
      dynPointer: true,
      dynDimension: true,
      dynPrompt: true,
      dynAbsolute: false,
      dynCartesian: false,
    });
    const set = draftPatch(
      { ...d, dynPointer: false, dynPrompt: false, dynAbsolute: true, dynCartesian: true },
      state(),
    );
    expect(set).toMatchObject({ dynBits: 2, dynPrompt: false, dynPiCoords: 1, dynPiFormat: 1 });
    expect(draftOf(state({ dynBits: 1, dynPiFormat: 1 }))).toMatchObject({
      dynPointer: true,
      dynDimension: false,
      dynCartesian: true,
    });
  });
});

// M3-04 part 7: the Selection Cycling tab (AutoCAD 2024 Help, "Selection Cycling Tab (Drafting
// Settings Dialog Box)"): Allow selection cycling and Display selection cycling list box are
// SELECTIONCYCLING (off keeps its mode negative, as Ctrl+W does); Display location (Cursor
// dependent, its Quadrant and Distance in pixels, or Static) and Show title bar are per user.
describe('the Selection Cycling tab (M3-04 part 7)', () => {
  it('comes last, after Quick Properties, as AutoCAD’s does', () => {
    expect(DRAFTING_SETTINGS_TABS.at(-1)).toEqual({ tab: 'sc', label: 'Selection Cycling' });
  });

  it('shows SELECTIONCYCLING and the list’s place, and OK sets them', () => {
    const d = draftOf(state());
    expect(d).toMatchObject({
      sc: false,
      // Off with no mode kept: allowing it shows the list, as Ctrl+W turns on 2.
      scList: true,
      scLocation: 0,
      scQuadrant: 'top-right',
      scDistance: '25',
      scTitleBar: true,
    });
    expect(draftOf(state({ selectionCycling: 1 }))).toMatchObject({ sc: true, scList: false });
    expect(draftOf(state({ selectionCycling: -1 }))).toMatchObject({ sc: false, scList: false });
    expect(draftOf(state({ selectionCycling: 2 }))).toMatchObject({ sc: true, scList: true });
    const on = draftPatch(
      {
        ...d,
        sc: true,
        scList: false,
        scLocation: 1,
        scQuadrant: 'bottom-left',
        scDistance: '60',
        scTitleBar: false,
      },
      state(),
    );
    expect(on).toMatchObject({
      selectionCycling: 1,
      scLocation: 1,
      scQuadrant: 'bottom-left',
      scDistance: 60,
      scTitleBar: false,
    });
    // Off keeps the mode for Ctrl+W, or none as it was.
    expect(draftPatch({ ...d, sc: false, scList: true }, state())).toMatchObject({
      selectionCycling: 0,
    });
    const was = state({ selectionCycling: 2 });
    expect(draftPatch({ ...draftOf(was), sc: false }, was)).toMatchObject({
      selectionCycling: -2,
    });
    expect(draftPatch({ ...d, sc: false, scList: false }, state())).toMatchObject({
      selectionCycling: -1,
    });
  });

  it('refuses a distance out of range', () => {
    const d = draftOf(state());
    expect(draftProblem({ ...d, scDistance: '401' })).toBe(
      'Distance in pixels must be a whole number from 0 to 400.',
    );
    expect(draftPatch({ ...d, scDistance: 'x' }, state())).toEqual({});
  });
});

// M3-06 part 6: the Snap and Grid tab's Grid style (GRIDSTYLE, per user) and Grid behavior
// (GRIDDISPLAY, the drawing's `*Active` VPORT), AutoCAD 2024 Help, "Snap and Grid Tab (Drafting
// Settings Dialog Box)".
describe('Grid style and Grid behavior (M3-06 part 6)', () => {
  const drawing = {
    snapSpacing: { x: 1, y: 1 },
    gridSpacing: { x: 10, y: 10 },
    gridMajor: 5,
    gridDisplay: 3,
  };

  it('show GRIDDISPLAY’s bits and GRIDSTYLE, and OK sets both', () => {
    const d = draftOf(state({ gridStyle: 4 }), drawing);
    expect(d.gridStyle).toBe(4);
    expect(gridBehavior(d.spacing!)).toEqual({
      adaptive: true,
      subdivide: false,
      beyondLimits: true,
      follow: false,
    });
    const g = { ...d.spacing!, gridDisplay: 2 | 4 | 8 };
    expect(gridBehavior(g)).toEqual({
      adaptive: true,
      subdivide: true,
      beyondLimits: false,
      follow: true,
    });
    const ok = { ...d, gridStyle: 1, spacing: g };
    expect(snapGridOf(ok)).toMatchObject({ gridDisplay: 14 });
    expect(draftPatch(ok, state())).toMatchObject({ gridStyle: 1 });
    // A drawing without the bits (an older answer) sets none.
    const { gridDisplay: _, ...older } = drawing;
    expect(snapGridOf(draftOf(state(), older))).not.toHaveProperty('gridDisplay');
  });
});

describe('the grid the canvas draws (M3-06 part 6)', () => {
  const limits = { minX: 0, minY: 0, maxX: 420, maxY: 297 };

  it('follows GRIDDISPLAY in model space, adaptive and beyond the limits without a viewport', () => {
    expect(gridDisplayOf({ flags: 3, limits, layout: false, gridStyle: 0 })).toEqual({
      adaptive: true,
      subdivide: false,
      dots: false,
    });
    expect(gridDisplayOf({ flags: 4, limits, layout: false, gridStyle: 0 })).toEqual({
      adaptive: false,
      subdivide: false,
      limits,
      dots: false,
    });
    expect(gridDisplayOf({ flags: 6, limits: undefined, layout: false, gridStyle: 0 })).toEqual({
      adaptive: true,
      subdivide: true,
      dots: false,
    });
    expect(gridDisplayOf({ flags: undefined, limits, layout: true, gridStyle: 0 })).toEqual({
      adaptive: true,
      subdivide: false,
      dots: false,
    });
  });

  it('is dotted by GRIDSTYLE: bit 1 in model space, bit 4 on a layout', () => {
    const dots = (gridStyle: number, layout: boolean) =>
      gridDisplayOf({ flags: 3, limits, layout, gridStyle }).dots;
    expect([dots(1, false), dots(1, true), dots(4, false), dots(4, true)]).toEqual([
      true,
      false,
      false,
      true,
    ]);
    expect(dots(2, false)).toBe(false);
  });
});
