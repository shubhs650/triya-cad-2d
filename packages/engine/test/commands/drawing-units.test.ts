// M3-09: UNITS (the Drawing Units dialog) and -UNITS on the PromptBus (AutoCAD 2024 Help,
// "UNITS (Command)", "Drawing Units Dialog Box", "Direction Control Dialog Box", "-UNITS").
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  INSUNITS_NAMES,
  PromptBus,
  builtinCommands,
  metresPerUnit,
  unitsSample,
  unitsSettings,
  validUnitsSettings,
  type HeaderValue,
  type UnitsSettings,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

function setup(header: [string, HeaderValue][] = []) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    header: new Map([...(init.header ?? []), ...header]),
  });
  const bus = new PromptBus({ model, registry: builtinCommands() });
  return { model, bus };
}

const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

const DEFAULTS: UnitsSettings = {
  lunits: 2,
  luprec: 4,
  aunits: 0,
  auprec: 0,
  angbase: 0,
  clockwise: false,
  insunits: 4,
};

describe('UNITS', () => {
  it("opens Drawing Units on the drawing's settings; OK sets what changed, undone as one", async () => {
    const { bus, model } = setup();
    await bus.submit('UN');
    expect(bus.prompt).toMatchObject({
      kind: 'dialog',
      message: 'Drawing Units',
      dialog: { type: 'units', settings: DEFAULTS },
    });
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      units: {
        lunits: 4,
        luprec: 4,
        aunits: 1,
        auprec: 2,
        angbase: Math.PI / 2,
        clockwise: true,
        insunits: 1,
      },
    });
    expect(bus.command).toBeUndefined();
    expect(model.header.get('$LUNITS')).toBe(4);
    expect(model.header.has('$LUPREC')).toBe(false);
    expect(model.header.get('$AUNITS')).toBe(1);
    expect(model.header.get('$AUPREC')).toBe(2);
    expect(model.header.get('$ANGBASE')).toBeCloseTo(Math.PI / 2, 12);
    expect(model.header.get('$ANGDIR')).toBe(1);
    expect(model.header.get('$INSUNITS')).toBe(1);
    await bus.submit('U');
    expect(unitsSettings(model)).toEqual(DEFAULTS);
  });

  it('changes nothing on Cancel, on OK unchanged, or on settings the dialog cannot give', async () => {
    const { bus, model } = setup([['$ANGDIR', true]]);
    const version = model.version;
    await bus.submit('UNITS');
    await bus.cancel();
    const was = unitsSettings(model);
    for (const units of [
      was,
      { ...was, lunits: 6 },
      { ...was, luprec: 1.5 },
      { ...was, insunits: 25 },
      { ...was, angbase: Number.NaN },
      { ...was, clockwise: 1 as unknown as boolean },
    ]) {
      await bus.submit('UNITS');
      await bus.answer({ kind: 'dialog', action: 'ok', units });
      expect(bus.command).toBeUndefined();
    }
    await bus.submit('UNITS');
    await bus.answer({ kind: 'dialog', action: 'ok' });
    expect(model.version).toBe(version);
    // A switch the drawing holds as a boolean stays one.
    await bus.submit('UNITS');
    await bus.answer({ kind: 'dialog', action: 'ok', units: { ...was, clockwise: false } });
    expect(model.header.get('$ANGDIR')).toBe(false);
  });

  it('picks the direction of angle 0 and opens again on Direction Control', async () => {
    const { bus, model } = setup([['$ANGDIR', 1]]);
    await bus.submit('UNITS');
    const draft = { ...unitsSettings(model), aunits: 1 };
    await bus.answer({ kind: 'dialog', action: 'select', units: draft });
    expect(bus.promptText).toBe('Pick angle:');
    await bus.submit('0,0');
    expect(bus.promptText).toBe('Specify second point:');
    await bus.submit('0,10');
    expect(bus.prompt).toMatchObject({
      kind: 'dialog',
      dialog: { type: 'units', direction: true, settings: { aunits: 1 } },
    });
    const picked = (bus.prompt as { dialog: { settings: UnitsSettings } }).dialog.settings;
    expect(picked.angbase).toBeCloseTo(Math.PI / 2, 12);
    // Typed, the angle counts counter-clockwise from east whatever ANGDIR says.
    await bus.answer({ kind: 'dialog', action: 'select', units: picked });
    await bus.submit('180');
    const typed = (bus.prompt as { dialog: { settings: UnitsSettings } }).dialog.settings;
    expect(typed.angbase).toBeCloseTo(Math.PI, 12);
    await bus.answer({ kind: 'dialog', action: 'ok', units: typed });
    expect(model.header.get('$ANGBASE')).toBeCloseTo(Math.PI, 12);
    expect(model.header.get('$AUNITS')).toBe(1);
  });

  it('runs transparently, its change in the outer command', async () => {
    const { bus, model } = setup();
    await bus.submit('LINE');
    await bus.submit("'UNITS");
    expect(bus.prompt?.kind).toBe('dialog');
    await bus.answer({ kind: 'dialog', action: 'ok', units: { ...DEFAULTS, luprec: 2 } });
    expect(bus.promptText).toBe('Specify first point:');
    expect(model.header.get('$LUPREC')).toBe(2);
    await bus.cancel();
  });

  it('ends quietly when Pick angle is cancelled', async () => {
    const { bus, model } = setup();
    const version = model.version;
    await bus.submit('UNITS');
    await bus.answer({ kind: 'dialog', action: 'select', units: DEFAULTS });
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    expect(model.version).toBe(version);
  });
});

describe('-UNITS', () => {
  it("asks AutoCAD's questions and sets the answers as one undo step", async () => {
    const { bus, model } = setup();
    await bus.submit('-UNITS');
    expect(bus.history.some((l) => l.includes('4. Architectural'))).toBe(true);
    expect(bus.promptText).toBe('Enter choice, 1 to 5 <2>:');
    await bus.submit('4');
    expect(bus.promptText).toBe(
      'Enter denominator of smallest fraction to display (1, 2, 4, 8, 16, 32, 64, 128, or 256) <16>:',
    );
    await bus.submit('3');
    expect(bus.history.at(-1)).toBe('Requires 1, 2, 4, 8, 16, 32, 64, 128 or 256.');
    await bus.submit('64');
    expect(bus.promptText).toBe('Enter choice, 1 to 5 <1>:');
    await bus.submit('2');
    expect(bus.promptText).toBe(
      'Enter number of fractional places for display of angles (0 to 8) <0>:',
    );
    await bus.submit('9');
    expect(bus.history.at(-1)).toBe('Requires an integer between 0 and 8.');
    await bus.submit('3');
    expect(bus.history.slice(-4)).toEqual([
      `  East   3 o'clock = 0d0'0"`,
      `  North 12 o'clock = 90d0'0"`,
      `  West   9 o'clock = 180d0'0"`,
      `  South  6 o'clock = 270d0'0"`,
    ]);
    // The default is shown in the drawing's units: nothing is set until the last answer.
    expect(bus.promptText).toBe('Enter direction for angle 0 <0>:');
    await bus.submit('90');
    expect(bus.promptText).toBe('Do you want angles measured clockwise? [Yes/No] <No>:');
    await bus.submit('Y');
    expect(bus.command).toBeUndefined();
    expect(unitsSettings(model)).toMatchObject({
      lunits: 4,
      luprec: 6,
      aunits: 1,
      auprec: 3,
      clockwise: true,
      insunits: 4,
    });
    expect(model.header.get('$ANGBASE')).toBeCloseTo(Math.PI / 2, 12);
    await bus.submit('U');
    expect(unitsSettings(model)).toEqual(DEFAULTS);
  });

  it('takes the defaults on Enter, decimal places for decimal units, and says what is out of range', async () => {
    const { bus, model } = setup([
      ['$LUNITS', 4],
      ['$LUPREC', 3],
      ['$ANGBASE', Math.PI],
      ['$ANGDIR', 1],
    ]);
    const version = model.version;
    await bus.submit('-UNITS');
    await bus.submit('0');
    expect(bus.history.at(-1)).toBe('Requires an integer between 1 and 5.');
    expect(bus.promptText).toBe('Enter choice, 1 to 5 <4>:');
    await bus.submit('');
    expect(bus.promptText).toContain('<8>:');
    await bus.submit('');
    await bus.submit('6');
    expect(bus.history.at(-1)).toBe('Requires an integer between 1 and 5.');
    await bus.submit('');
    await bus.submit('');
    expect(bus.promptText).toBe('Enter direction for angle 0 <180>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Do you want angles measured clockwise? [Yes/No] <Yes>:');
    await bus.submit('');
    expect(model.version).toBe(version);
    // Decimal units ask for decimal places.
    await bus.submit('-UNITS');
    await bus.submit('2');
    expect(bus.promptText).toBe('Enter number of digits to right of decimal point (0 to 8) <3>:');
    await bus.submit('2');
    await bus.submit('5');
    await bus.submit('1');
    expect(bus.history.at(-3)).toBe("  North 12 o'clock = N");
    await bus.submit('N');
    await bus.submit('No');
    expect(unitsSettings(model)).toMatchObject({ lunits: 2, luprec: 2, aunits: 4, auprec: 1 });
    expect(model.header.get('$ANGBASE')).toBeCloseTo(Math.PI / 2, 12);
    expect(model.header.get('$ANGDIR')).toBe(0);
  });

  it('changes nothing when cancelled at any question', async () => {
    const { bus, model } = setup();
    const version = model.version;
    const answers = ['2', '4', '1', '0', '0'];
    for (let n = 0; n <= answers.length; n++) {
      await bus.submit('-UNITS');
      for (const a of answers.slice(0, n)) await bus.submit(a);
      await bus.cancel();
      await flush();
      expect(bus.command).toBeUndefined();
    }
    // Fractional units ask for a denominator too; Esc there.
    await bus.submit('-UNITS');
    await bus.submit('5');
    await bus.cancel();
    expect(model.version).toBe(version);
  });
});

describe('Drawing Units helpers', () => {
  it('names every INSUNITS code the unit table has', () => {
    expect(INSUNITS_NAMES).toHaveLength(25);
    expect(INSUNITS_NAMES[4]).toBe('Millimeters');
    expect(INSUNITS_NAMES[24]).toBe('US Survey Mile');
    INSUNITS_NAMES.forEach((_, code) => {
      expect(metresPerUnit(code) === undefined).toBe(code === 0);
    });
  });

  it("writes the Sample Output in the dialog's units", () => {
    expect(unitsSample(DEFAULTS)).toEqual(['1.5000,2.0039,0.0000', '3.0000<45,0.0000']);
    expect(unitsSample({ ...DEFAULTS, lunits: 4, luprec: 4, aunits: 1, auprec: 2 })).toEqual([
      `0'-1 1/2",0'-2",0'-0"`,
      `0'-3"<45d0',0'-0"`,
    ]);
  });

  it('reads an angle base outside one turn into it, and an INSUNITS AutoCAD lists not as unitless', () => {
    const { model } = setup([
      ['$ANGBASE', -Math.PI / 2],
      ['$INSUNITS', 99],
    ]);
    const s = unitsSettings(model);
    expect(s.angbase).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(s.insunits).toBe(0);
    expect(validUnitsSettings(s)).toBe(true);
  });
});
