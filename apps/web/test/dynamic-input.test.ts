// M2-02 part 2: Dynamic Input's fields turn what is typed at the cursor into the text the command
// line would send (AutoCAD 2024, DYNMODE 3, DYNPICOORDS 0).
import { DECIMAL_UNITS, parseAngle, parseCoordinate, prompts, type Prompt } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  dynBackspace,
  dynCurrent,
  dynFor,
  dynLive,
  dynAhead,
  dynEnds,
  dynRelativeTo,
  dynReplay,
  dynTab,
  dynText,
  dynType,
  dynTyped,
  dynSettings,
  dynShows,
  dynVisible,
  DYN_SETTINGS,
  type DynSettings,
  type DynState,
} from '../src/dynamic-input';
import { INITIAL_DRAFTING } from '../src/drafting';

const first = prompts.point({ message: 'Specify first point' });
const next = prompts.point({
  message: 'Specify next point or',
  rubberBand: { from: { x: 10, y: 10 } },
});
const corner = prompts.point({
  message: 'Specify opposite corner',
  rubberBand: { from: { x: 10, y: 10 }, box: true },
});
const cursor = { x: 13, y: 14 };

const typing = (p: Prompt, keys: string, s: DynState = dynFor(p)): DynState => {
  for (const k of keys)
    s = k === '\t' ? dynTab(s) : k === '\b' ? dynBackspace(s, p) : dynType(s, k);
  return s;
};
const sent = (p: Prompt, keys: string) => dynText(typing(p, keys), p, cursor);

describe('Dynamic Input fields', () => {
  it('keeps feet, inches and fractions in their fields (M2-35 part 7)', () => {
    expect(sent(first, `5'6",1'-6 1/2"`.replace(' ', '-'))).toBe(`5'6",1'-6-1/2"`);
    expect(typing(first, `5'6"`).raw).toBe(false);
    expect(sent(next, `1'6"<90`)).toBe(`@1'6"<90`);
    expect(sent(next, `3/4"`)).toBe(`3/4"`);
    // A quote first is a transparent command, typed as it is.
    expect(typing(first, `'Z`).raw).toBe(true);
  });

  it('shows X and Y at a first point, Distance and Angle with a rubber band', () => {
    expect(dynFor(first).fields.map((f) => f.label)).toEqual(['X', 'Y']);
    expect(dynFor(next).fields.map((f) => f.label)).toEqual(['Distance', 'Angle']);
    expect(dynFor(corner).kind).toBe('pointer');
    expect(dynFor(prompts.distance({ message: 'Specify radius' })).fields[0]!.label).toBe(
      'Distance',
    );
    expect(dynFor(prompts.angle({ message: 'Specify angle' })).fields[0]!.label).toBe('Angle');
    // SCALE's factor (M2-06): the dragged objects' scale, the cursor's distance from the base.
    const factor = prompts.distance({
      message: 'Specify scale factor or',
      base: { x: 0, y: 0 },
      drag: { kind: 'scale', ids: [], base: { x: 0, y: 0 }, reference: 1 },
    });
    expect(dynFor(factor).fields[0]!.label).toBe('Scale');
    expect(dynLive(dynFor(factor), factor, { x: 3, y: 4 })).toEqual(['5.0000']);
    expect(dynFor(prompts.keyword({ message: 'Enter an option', options: ['A'] })).kind).toBe(
      'single',
    );
  });

  it('first point: absolute x,y; a comma moves to Y', () => {
    const s = typing(first, '0,5');
    expect(s.active).toBe(1);
    expect(s.fields.map((f) => f.text)).toEqual(['0', '5']);
    expect(dynText(s, first, cursor)).toBe('0,5');
    expect(sent(first, '7')).toBe('7,14.0000');
    expect(sent(first, '@2,3')).toBe('@2,3');
  });

  it('next points: relative unless typed with #; the other field takes the cursor', () => {
    expect(sent(corner, '5,5')).toBe('@5,5');
    expect(sent(corner, '#5,5')).toBe('#5,5');
    expect(sent(corner, '\t4')).toBe('@3.0000,4');
  });

  it('dimension input: distance alone is direct distance; < or Tab moves to the angle', () => {
    expect(sent(next, '100')).toBe('100');
    expect(sent(next, '100<45')).toBe('@100<45');
    const tabbed = typing(next, '100\t45');
    expect(tabbed.fields[0]).toMatchObject({ text: '100', locked: true });
    expect(dynText(tabbed, next, cursor)).toBe('@100<45');
    expect(sent(next, '\t90')).toBe('@5.0000<90');
  });

  it('dimension input: a comma switches to pointer input, relative to the last point (M2-71)', () => {
    const s = typing(next, '10,0');
    expect(s).toMatchObject({ kind: 'pointer', active: 1, raw: false });
    expect(s.fields.map((f) => [f.label, f.text])).toEqual([
      ['X', '10'],
      ['Y', '0'],
    ]);
    expect(dynText(s, next, cursor)).toBe('@10,0');
    expect(sent(next, '10,')).toBe('@10,4.0000');
    expect(sent(next, '#10,0')).toBe('#10,0');
    // Backspace past Y goes back to X; a comma with nothing before it is no number.
    expect(typing(next, '10,\b').active).toBe(0);
    expect(typing(next, ',').raw).toBe(true);
  });

  it('takes anything that is not a number as typed', () => {
    expect(sent(next, '@100<45')).toBe('@100<45');
    expect(sent(next, 'C')).toBe('C');
    expect(sent(first, "'Z")).toBe("'Z");
    expect(sent(first, '1,b')).toBe('1,b');
    expect(sent(next, '10<x')).toBe('10<x');
    expect(sent(first, '1.5e')).toBe('1.5e');
  });

  it('sends Enter with nothing typed', () => {
    expect(sent(first, '')).toBe('');
    expect(sent(next, '')).toBe('');
    expect(dynTyped(dynFor(first))).toBe(false);
  });

  it('Backspace deletes, unlocks an emptied field and goes back from an empty one', () => {
    let s = typing(next, '12\t');
    expect(s.active).toBe(1);
    s = dynBackspace(s, next);
    expect(s.active).toBe(0);
    s = typing(next, '\b\b', s);
    expect(s.fields[0]).toEqual({ label: 'Distance', text: '', locked: false });
    expect(typing(next, 'Cx\b').fields[0]!.text).toBe('C');
    expect(typing(next, 'C\b')).toEqual(dynFor(next));
    expect(dynTab(typing(next, 'C')).active).toBe(0);
  });

  // AutoCAD's defaults (LUNITS 2 at LUPREC 4, AUNITS 0 at AUPREC 0) when no units are given.
  it("shows the cursor's coordinates, distance and angle while nothing is typed", () => {
    expect(dynLive(dynFor(first), first, cursor)).toEqual(['13.0000', '14.0000']);
    expect(dynLive(dynFor(corner), corner, cursor)).toEqual(['3.0000', '4.0000']);
    expect(dynLive(dynFor(next), next, cursor)).toEqual(['5.0000', '53']);
    expect(dynLive(dynFor(next), next, { x: 10, y: 5 })).toEqual(['5.0000', '270']);
    const radius = prompts.distance({ message: 'Specify radius', base: { x: 0, y: 0 } });
    expect(dynLive(dynFor(radius), radius, { x: 3, y: 4 })).toEqual(['5.0000']);
    const angle = prompts.angle({ message: 'Specify angle', base: { x: 0, y: 0 } });
    expect(dynLive(dynFor(angle), angle, { x: 0, y: 4 })).toEqual(['90']);
    expect(dynLive(dynFor(angle), prompts.angle({ message: 'a' }), cursor)).toEqual(['']);
    expect(dynLive(dynFor(first), first, undefined)).toEqual(['', '']);
  });

  // M2-35 part 20: the fields show what the status bar and the command line show, in the
  // drawing's units (AutoCAD 2024 Help, "About Dynamic Input": its tooltips follow UNITS).
  it("shows the cursor's values in the drawing's units", () => {
    const arch = { units: { ...DECIMAL_UNITS, lunits: 4, luprec: 4, aunits: 1, auprec: 2 } };
    const at = { x: 30.25, y: 6.5 };
    expect(dynLive(dynFor(first), first, at, arch)).toEqual([`2'-6 1/4"`, `0'-6 1/2"`]);
    // Relative to the last point: below and left of it the coordinates are negative.
    expect(dynLive(dynFor(corner), corner, { x: 4, y: 10 }, arch)).toEqual([`-0'-6"`, `0'-0"`]);
    expect(dynLive(dynFor(next), next, { x: 22, y: 22 }, arch)).toEqual([`1'-5"`, `45d0'`]);
    const radius = prompts.distance({ message: 'Specify radius', base: { x: 0, y: 0 } });
    expect(dynLive(dynFor(radius), radius, { x: 18, y: 0 }, arch)).toEqual([`1'-6"`]);
    // A scale factor is a plain number, not a length.
    const factor = prompts.distance({
      message: 'Specify scale factor or',
      base: { x: 0, y: 0 },
      drag: { kind: 'scale', ids: [], base: { x: 0, y: 0 }, reference: 1 },
    });
    expect(dynLive(dynFor(factor), factor, { x: 18, y: 0 }, arch)).toEqual(['18.0000']);
    const units = (u: Partial<typeof DECIMAL_UNITS>) => ({ units: { ...DECIMAL_UNITS, ...u } });
    const live = (u: Partial<typeof DECIMAL_UNITS>) =>
      dynLive(dynFor(next), next, { x: 10, y: 22 }, units(u));
    expect(live({ lunits: 1, luprec: 2, aunits: 2, auprec: 1 })).toEqual(['1.20E+01', '100.0g']);
    expect(live({ lunits: 3, luprec: 1, aunits: 3, auprec: 4 })).toEqual([`1'-0.0"`, '1.5708r']);
    expect(live({ lunits: 5, luprec: 2, aunits: 4 })).toEqual(['12', 'N']);
    expect(dynLive(dynFor(next), next, { x: 22, y: 22 }, units({ aunits: 4, auprec: 2 }))).toEqual([
      '16.9706',
      "N 45d0' E",
    ]);
  });

  // The angle shown is the one that, typed, goes where the cursor is: ANGBASE and ANGDIR turn
  // typed angles (`parseAngle`), so they turn the shown one back. A bearing names a direction
  // from north whatever they say (M2-35 part 18), so it shows the world direction.
  it('shows angles as they would be typed under ANGBASE and ANGDIR', () => {
    const north = { units: DECIMAL_UNITS, angles: { base: Math.PI / 2, clockwise: true } };
    // From (10,10) to (22,22) is world 45°: 45° clockwise from north.
    expect(dynLive(dynFor(next), next, { x: 22, y: 22 }, north)[1]).toBe('45');
    expect(dynLive(dynFor(next), next, { x: -2, y: 22 }, north)[1]).toBe('315');
    const angle = prompts.angle({ message: 'Specify angle', base: { x: 0, y: 0 } });
    expect(dynLive(dynFor(angle), angle, { x: 4, y: 0 }, north)).toEqual(['90']);
    const bearings = { ...north, units: { ...DECIMAL_UNITS, aunits: 4 } };
    expect(dynLive(dynFor(next), next, { x: 22, y: 22 }, bearings)[1]).toBe('N 45d E');
  });

  // An untyped field beside a typed one sends its value as the field shows it, which the
  // command engine reads back in every LUNITS (`parseDistance`).
  it('sends an untyped field as it shows it, in the drawing units', () => {
    const arch = { units: { ...DECIMAL_UNITS, lunits: 4, luprec: 4 } };
    const s = typing(first, '24');
    expect(dynText(s, first, { x: 30, y: 6.5 }, arch)).toBe(`24,0'-6 1/2"`);
    const angled = typing(next, '\t30');
    expect(dynText(angled, next, { x: 22, y: 10 }, arch)).toBe(`@1'-0"<30`);
  });

  it('sends values the command engine reads back in every LUNITS and AUNITS', () => {
    const at = { x: -7.25, y: 3.5 };
    for (const lunits of [1, 2, 3, 4, 5]) {
      for (const aunits of [0, 1, 2, 3, 4]) {
        const u = { units: { ...DECIMAL_UNITS, lunits, luprec: 4, aunits, auprec: 4 } };
        // X typed, Y the cursor's as shown.
        const p = parseCoordinate(dynText(typing(first, '1'), first, at, u), { lunits });
        expect(p).toEqual({ x: 1, y: 3.5 });
        // The cursor's own coordinates read back from the fields as shown.
        const [x, y] = dynLive(dynFor(first), first, at, u);
        expect(parseCoordinate(`${x},${y}`, { lunits })).toEqual(at);
        // An angle shown reads back as the direction (a bearing to the minute, 4 decimals else).
        const shown = dynLive(dynFor(next), next, { x: 13, y: 14 }, u)[1]!;
        const radians = parseAngle(shown.replace(/\s+/g, ''))!;
        expect(Math.abs(radians - Math.atan2(4, 3))).toBeLessThan(aunits === 4 ? 3e-4 : 1e-4);
      }
    }
  });

  it('carries keys typed ahead of a prompt over to it', () => {
    const s = dynReplay(next, ['1', '0', 'Tab', '4', '5', 'Backspace']);
    expect(s.fields.map((f) => [f.text, f.locked])).toEqual([
      ['10', true],
      ['4', false],
    ]);
    expect(dynReplay(first, [])).toEqual(dynFor(first));
  });
});

// M3-06 part 7: X and Y are the current UCS's coordinates, and the angle counts from its X axis
// (the bus folds the UCS into `angles.base`), so what the fields show types back to the cursor.
describe('Dynamic Input in a UCS', () => {
  const ucs = { origin: { x: 10, y: 10 }, angle: Math.PI / 2 };
  const u = { units: DECIMAL_UNITS, angles: { base: Math.PI / 2, clockwise: false }, ucs };
  it("shows the cursor's UCS coordinates and the angle from the UCS's X axis", () => {
    // World 13,14 is UCS 4,-3; from the base 10,10 it is 4 along X and 3 against Y.
    expect(dynLive(dynFor(first), first, cursor, u)).toEqual(['4.0000', '-3.0000']);
    expect(dynLive(dynFor(corner), corner, cursor, u)).toEqual(['4.0000', '-3.0000']);
    expect(dynLive(dynFor(next), next, { x: 10, y: 15 }, u)).toEqual(['5.0000', '0']);
    const text = dynText(typing(first, '2,'), first, cursor, u);
    expect(text).toBe('2,-3.0000');
    expect(parseCoordinate(text, { ucs, angles: u.angles })).toEqual({ x: 13, y: 12 });
  });
});

describe('what a relative point counts from (M2-71)', () => {
  it("is the rubber band's base, which the fields measure from", () => {
    expect(dynRelativeTo('@10,0', next)).toEqual({ x: 10, y: 10 });
    expect(dynRelativeTo('@3<45', corner)).toEqual({ x: 10, y: 10 });
    // Absolute, typed as is, or with no rubber band: the bus decides.
    expect(dynRelativeTo('#10,0', next)).toBeUndefined();
    expect(dynRelativeTo('10', next)).toBeUndefined();
    expect(dynRelativeTo('@10,0', first)).toBeUndefined();
    const radius = prompts.distance({ message: 'Specify radius', base: { x: 0, y: 0 } });
    expect(dynRelativeTo('@1,1', radius)).toBeUndefined();
  });
});

describe('keys typed ahead of their prompt (M2-71)', () => {
  const option = prompts.keyword({ message: 'Enter an option', options: ['Save'] });
  const name = prompts.string({ message: 'Enter view name to save', spaces: true });

  it('end the input at Enter, or at a space unless a name is being typed', () => {
    expect(dynEnds(dynFor(first), first, 'Enter')).toBe(true);
    expect(dynEnds(dynFor(first), first, ' ')).toBe(true);
    expect(dynEnds(typing(option, 'S'), option, ' ')).toBe(true);
    expect(dynEnds(typing(name, 'Two'), name, ' ')).toBe(false);
    expect(dynEnds(typing(name, 'Two'), name, 'Enter')).toBe(true);
    expect(dynEnds(dynFor(first), first, '5')).toBe(false);
  });

  it('go into the fields of the prompt they reach, a second point relative', () => {
    const r = dynAhead(dynFor(next), next, ['1', '0', ',', '0', 'Enter', '7', 'Enter']);
    expect(r).toMatchObject({ ends: true, typed: ['1', '0', ',', '0'], rest: ['7', 'Enter'] });
    expect(dynText(r.state, next, cursor)).toBe('@10,0');
    // The same keys at the first point are absolute.
    const f = dynAhead(dynFor(first), first, ['5', ',', '5', 'Enter']);
    expect(dynText(f.state, first, cursor)).toBe('5,5');
  });

  it("keep a name's spaces and leave the rest typed when nothing ends the input", () => {
    const r = dynAhead(typing(name, 'Two'), name, [' ', 'w', 'o', 'r', 'd', 's', 'Enter']);
    expect(r.ends).toBe(true);
    expect(dynText(r.state, name, cursor)).toBe('Two words');
    const open = dynAhead(dynFor(next), next, ['1', '0', 'Tab', '4', '5']);
    expect(open).toMatchObject({ ends: false, typed: ['1', '0', 'Tab', '4', '5'], rest: [] });
    expect(dynText(open.state, next, cursor)).toBe('@10<45');
  });

  it('stop at Esc, which the command line cancels with', () => {
    const r = dynAhead(dynFor(next), next, ['1', 'Escape', '2', 'Enter']);
    expect(r).toMatchObject({ ends: false, typed: ['1'], rest: ['Escape', '2', 'Enter'] });
  });
});

describe('a key typed as a new prompt arrives (M2-34)', () => {
  const base = prompts.point({ message: 'Specify base point' });
  const angle = prompts.angle({
    message: 'Specify rotation angle or',
    options: ['Copy', 'Reference'],
    base: { x: 80, y: 30 },
  });

  it('goes to the new prompt, not the fields last set for the one before', () => {
    // The base point's fields, emptied by its Enter; then the angle prompt arrives and 9, 0
    // and Enter are typed before the fields are set for it. ROTATE once got `90,<cursor Y>`,
    // the 90 typed into the base point's X field (CI, #245).
    const latest = { prompt: base, state: dynFor(base) };
    let s = dynCurrent(latest, angle, [])!;
    expect(s.fields.map((f) => f.label)).toEqual(['Angle']);
    s = dynType(dynType(s, '9'), '0');
    expect(dynText(s, angle, cursor)).toBe('90');
  });

  it('keeps the fields already set for the prompt, and replays keys typed ahead of it', () => {
    const typed = dynType(dynFor(angle), '4');
    expect(dynCurrent({ prompt: angle, state: typed }, angle, ['4'])).toBe(typed);
    expect(
      dynText(dynCurrent({ prompt: base, state: dynFor(base) }, angle, ['4', '5'])!, angle, cursor),
    ).toBe('45');
    expect(dynCurrent({ prompt: base, state: dynFor(base) }, undefined, [])).toBeUndefined();
  });
});

describe('the Dynamic Input tab (M3-06 part 4)', () => {
  const radius = prompts.distance({ message: 'Specify radius', base: { x: 10, y: 10 } });
  const options = prompts.keyword({ message: 'Enter an option', options: ['A'] });
  const labels = (p: Prompt, o: DynSettings) => dynFor(p, o).fields.map((f) => f.label);
  const typed = (p: Prompt, keys: string, o: DynSettings) => {
    let s = dynFor(p, o);
    for (const k of keys) s = k === '\b' ? dynBackspace(s, p, o) : dynType(s, k);
    return dynText(s, p, cursor);
  };

  it('reads DYNMODE, DYNPROMPT, DYNPICOORDS and DYNPIFORMAT from the drafting aids', () => {
    expect(dynSettings(INITIAL_DRAFTING)).toEqual(DYN_SETTINGS);
    expect(DYN_SETTINGS).toEqual({
      pointer: true,
      dimension: true,
      prompt: true,
      absolute: false,
      cartesian: false,
      pointerVisibility: 1,
      dimensionVisibility: 1,
      gripFields: 31,
      infoTips: true,
    });
    expect(
      dynSettings({
        ...INITIAL_DRAFTING,
        dynBits: 1,
        dynPrompt: false,
        dynPiCoords: 1,
        dynPiFormat: 1,
      }),
    ).toMatchObject({
      pointer: true,
      dimension: false,
      prompt: false,
      absolute: true,
      cartesian: true,
    });
  });

  it('Enable Dimension Input off: next points take pointer input, polar or Cartesian', () => {
    const polar = { ...DYN_SETTINGS, dimension: false };
    expect(labels(next, polar)).toEqual(['Distance', 'Angle']);
    expect(typed(next, '5<30', polar)).toBe('@5<30');
    const cartesian = { ...polar, cartesian: true };
    expect(labels(next, cartesian)).toEqual(['X', 'Y']);
    expect(typed(next, '5,2', cartesian)).toBe('@5,2');
    // Distance and angle prompts are dimension input: without it, only what is typed.
    expect(labels(radius, polar)).toEqual(['']);
    expect(labels(radius, DYN_SETTINGS)).toEqual(['Distance']);
  });

  it('Absolute coordinates (DYNPICOORDS 1): next points are absolute unless typed with @', () => {
    const absolute = { ...DYN_SETTINGS, absolute: true, cartesian: true, dimension: false };
    expect(typed(next, '5,2', absolute)).toBe('5,2');
    expect(typed(next, '@5,2', absolute)).toBe('@5,2');
    expect(dynLive(dynFor(next, absolute), next, cursor)).toEqual(['13.0000', '14.0000']);
    // Dimension input's comma switches to pointer input as DYNPICOORDS says.
    expect(typed(next, '5,2', { ...DYN_SETTINGS, absolute: true })).toBe('5,2');
    expect(typed(next, '5,2', DYN_SETTINGS)).toBe('@5,2');
  });

  it('Enable Pointer Input off: points take what is typed, sent as typed', () => {
    const none = { ...DYN_SETTINGS, pointer: false };
    expect(labels(first, none)).toEqual(['']);
    expect(typed(first, '5,2', none)).toBe('5,2');
    expect(labels(next, none)).toEqual(['Distance', 'Angle']);
    const neither = { ...none, dimension: false };
    expect(labels(next, neither)).toEqual(['']);
    // Backspace that empties typed text starts the fields afresh, with the same settings.
    expect(typed(first, '5\b', neither)).toBe('');
  });

  it('shows the tooltip for its fields, or for the prompt while DYNPROMPT is 1', () => {
    const quiet = { ...DYN_SETTINGS, prompt: false };
    expect(dynShows(dynFor(first, quiet), quiet)).toBe(true);
    expect(dynShows(dynFor(options, quiet), quiet)).toBe(false);
    expect(dynShows(dynFor(options, DYN_SETTINGS), DYN_SETTINGS)).toBe(true);
    const off = { ...quiet, pointer: false, dimension: false };
    expect(dynShows(dynFor(first, off), off)).toBe(false);
    expect(dynShows(dynFor(radius, off), off)).toBe(false);
    // Held keys replay with the settings too.
    expect(dynReplay(next, ['5', ','], off).fields.map((f) => f.label)).toEqual(['']);
    expect(dynAhead(dynFor(first, off), first, ['5', 'Enter'], off).ends).toBe(true);
    expect(dynCurrent({ prompt: first, state: undefined }, next, [], off)?.kind).toBe('single');
  });
});

describe('grip stretching’s dimension input (M3-06 part 8, DYNDIVIS, DYNDIGRIP)', () => {
  // A line from 0,0 whose end grip at 10,0 is dragged to 6,8 (length 10, at 53.13°).
  const line = prompts.point({
    message: 'Specify stretch point or',
    rubberBand: { from: { x: 10, y: 0 } },
    gripDimensions: { grip: { x: 10, y: 0 }, anchor: { x: 0, y: 0 } },
  });
  const circle = prompts.point({
    message: 'Specify stretch point or',
    rubberBand: { from: { x: 7, y: 5 } },
    gripDimensions: { grip: { x: 7, y: 5 }, center: { x: 5, y: 5 } },
  });
  const at = { x: 6, y: 8 };
  const labels = (s: DynState) => dynVisible(s).map((i) => s.fields[i]!.label);
  const enter = (p: Prompt, keys: string, o: DynSettings = DYN_SETTINGS) => {
    let s = dynFor(p, o);
    for (const k of keys) s = k === '\t' ? dynTab(s) : dynType(s, k);
    return dynText(s, p, at);
  };
  const point = (text: string) => parseCoordinate(text, {}) as { x: number; y: number };

  it('shows two fields at a time (DYNDIVIS 1), Tab moving on through the rest', () => {
    const s = dynFor(line);
    expect(s.kind).toBe('grip');
    expect(s.fields.map((f) => f.label)).toEqual([
      'Resulting Dimension',
      'Length Change',
      'Absolute Angle',
      'Angle Change',
    ]);
    expect(labels(s)).toEqual(['Resulting Dimension', 'Length Change']);
    expect(labels(dynTab(dynTab(s)))).toEqual(['Absolute Angle', 'Angle Change']);
    expect(labels(dynFor(line, { ...DYN_SETTINGS, dimensionVisibility: 0 }))).toEqual([
      'Resulting Dimension',
    ]);
    // DYNDIVIS 2 shows DYNDIGRIP's fields together.
    const both = { ...DYN_SETTINGS, dimensionVisibility: 2 as const, gripFields: 1 | 4 };
    expect(labels(dynFor(line, both))).toEqual(['Resulting Dimension', 'Absolute Angle']);
    expect(dynLive(dynFor(line), line, at)).toEqual(['10.0000', '0.0000', '53', '53']);
    expect(dynFor(circle).fields.map((f) => f.label)).toEqual(['Arc Radius']);
    expect(dynLive(dynFor(circle), circle, at)).toEqual(['3.1623']);
    // Without dimension input, a grip's point is the rubber band's.
    expect(dynFor(line, { ...DYN_SETTINGS, dimension: false }).kind).not.toBe('grip');
  });

  it('sets the point by the fields typed, the cursor giving the rest', () => {
    // A length of 5 along the cursor's direction.
    const a = point(enter(line, '5'));
    expect(a.x).toBeCloseTo(3, 9);
    expect(a.y).toBeCloseTo(4, 9);
    // 2 longer than the line was (12), at an absolute 90°.
    const b = point(enter(line, '\t2\t90'));
    expect(b.x).toBeCloseTo(0, 9);
    expect(b.y).toBeCloseTo(12, 9);
    // Turned 180° from where it pointed, at the cursor's length (10).
    const c = point(enter(line, '\t\t\t180'));
    expect(c.x).toBeCloseTo(-10, 9);
    expect(c.y).toBeCloseTo(0, 9);
    // A radius of 4 from the circle's centre towards the cursor.
    const r = point(enter(circle, '4'));
    expect(Math.hypot(r.x - 5, r.y - 5)).toBeCloseTo(4, 9);
    // Nothing typed is Enter; what does not read goes as typed; a comma, as pointer input.
    expect(enter(line, '')).toBe('');
    expect(enter(line, 'x')).toBe('x');
    expect(enter(line, '\t\t\t1x')).toBe('1x');
  });
});

describe('pointer input visibility and tips (M3-06 part 8)', () => {
  it('reads DYNPIVIS, DYNDIVIS, DYNDIGRIP and DYNINFOTIPS from the drafting aids', () => {
    expect(
      dynSettings({
        ...INITIAL_DRAFTING,
        dynPiVis: 2,
        dynDiVis: 0,
        dynDiGrip: 5,
        dynInfoTips: false,
      }),
    ).toMatchObject({
      pointerVisibility: 2,
      dimensionVisibility: 0,
      gripFields: 5,
      infoTips: false,
    });
  });
});
