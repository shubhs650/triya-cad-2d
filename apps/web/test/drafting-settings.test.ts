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
  trackingSettings,
  type DraftingState,
} from '../src/drafting';
import { addAngle, draftOf, draftPatch, draftProblem } from '../src/drafting-settings';

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
      polar: true,
      polarAngle: 90,
      additional: true,
      angles: [12.5, 80],
      trackPolar: true,
      osnap: false,
      modes: 5,
      otrack: true,
      qp: false,
      qpMode: 2,
      qpLocation: 0,
      quadrant: 'top-right',
      distance: '50',
      collapse: true,
      rows: '3',
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
      polar: false,
      polarAngle: 30,
      polarMode: 15,
      polarAddAngles: '12.5;80',
      osmode: OSNAP.END | OSNAP.MID | OSNAP_OFF,
      otrack: false,
      qpmode: 2,
      qpLocation: 1,
      qpQuadrant: 'bottom-left',
      qpDistance: 120,
      qpCollapse: false,
      qpRows: 5,
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

describe('the Object Snap tab’s markers', () => {
  it('draws each mode as AutoSnap does, y down, circles as two half arcs', () => {
    expect(markerSvgPath('END', 5)).toBe('M-5 5L5 5L5 -5L-5 -5Z');
    expect(markerSvgPath('CEN', 5)).toBe('M5 0M5 0A5 5 0 1 0 -5 0A5 5 0 1 0 5 0');
    for (const { mode } of OSNAP_MODES) expect(markerSvgPath(mode, 5)).toMatch(/^M/);
  });
});
