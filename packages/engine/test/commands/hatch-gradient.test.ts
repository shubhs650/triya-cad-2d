// M4-07 part 3: gradient fills (-HATCH Properties Gradient, GRADIENT) and a pattern hatch's
// background colour (hatch COlor's second prompt), on the command line. AutoCAD 2024's help
// names the gradients (HPNAME's GR_ names, GFNAME 1–9), the settings (GFANG, GFSHIFT, GFCLR1,
// GFCLR2, GFCLRSTATE, GFCLRLUM, HPBACKGROUNDCOLOR) and the HATCHBACKGROUNDCOLOR xdata; the
// wording of the gradient prompts is ours (see hatch-options.ts).
import { describe, expect, it } from 'vitest';
import { setup, square } from './hatch-fixtures';

const DASH_PROMPT =
  'Specify internal point or [Properties/Select objects/draW boundary/remove Boundaries/' +
  'Advanced/DRaw order/Origin/hatch COlor/LAyer/Transparency/Undo]:';
const BLUE = { kind: 'aci', index: 5 } as const;
const YELLOW = { kind: 'aci', index: 2 } as const;

describe('gradient fills (M4-07 part 3)', () => {
  it('fills with a gradient (-HATCH Properties Gradient): name, angle, centred', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'P']);
    expect(s.bus.promptText).toBe(
      'Enter a pattern name or [?/Solid/User defined/Gradient] <TRIYA_LINES45>:',
    );
    await s.bus.script(['G']);
    expect(s.bus.promptText).toBe('Enter a gradient name or [?] <GR_LINEAR>:');
    await s.bus.script(['gr_invsph']);
    expect(s.bus.promptText).toBe('Specify an angle for the gradient <0>:');
    await s.bus.script(['30']);
    expect(s.bus.promptText).toBe('Centered gradient? [Yes/No] <Y>:');
    await s.bus.script(['N', '5,5']);
    // Previewed as it will be made.
    expect(s.previews.at(-1)![0]).toMatchObject({ kind: 'HATCH', solid: true });
    await s.bus.script(['']);
    const h = s.hatches()[0]!;
    expect(h.geom).toMatchObject({
      pattern: 'SOLID',
      solid: true,
      patternType: 1,
      patternLines: [],
      gradient: {
        name: 'INVSPHERICAL',
        shift: 1,
        singleColor: false,
        colors: [
          { value: 0, color: BLUE },
          { value: 1, color: YELLOW },
        ],
      },
    });
    expect(h.geom.gradient!.angle).toBeCloseTo(Math.PI / 6, 12);
    // A gradient asks the library for no pattern.
    expect(s.requests.some((r) => r.op === 'hatchPattern')).toBe(false);
    // Kept for the next hatch, and offered by name.
    await s.bus.script(['-HATCH', 'P']);
    expect(s.bus.promptText).toBe(
      'Enter a pattern name or [?/Solid/User defined/Gradient] <GR_INVSPH>:',
    );
  });

  it('takes a gradient by its name at the pattern prompt, and lists the nine', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'P', 'GR_CYLIN', '', '', '5,5', '']);
    expect(s.hatches()[0]!.geom.gradient).toMatchObject({ name: 'CYLINDER', angle: 0, shift: 0 });
    await s.bus.script(['-HATCH', 'P', 'G', '?']);
    expect(s.log.slice(-9)).toEqual([
      'GR_LINEAR - Linear',
      'GR_CYLIN - Cylindrical',
      'GR_INVCYL - Inverted cylindrical',
      'GR_SPHER - Spherical',
      'GR_INVSPH - Inverted spherical',
      'GR_HEMISP - Hemispherical',
      'GR_INVHEM - Inverted hemispherical',
      'GR_CURVED - Curved',
      'GR_INVCUR - Inverted curved',
    ]);
    expect(s.bus.promptText).toBe('Enter a gradient name or [?] <GR_CYLIN>:');
    await s.bus.script(['GR_NOPE']);
    expect(s.log).toContain('Gradient "GR_NOPE" is not defined.');
    expect(s.bus.promptText).toBe('Enter a gradient name or [?] <GR_CYLIN>:');
    // Enter keeps the gradient, then its angle and centring.
    await s.bus.script(['', '', '']);
    expect(s.bus.promptText).toBe(DASH_PROMPT);
  });

  it('sets the gradient colours with COlor, one colour with a tint', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'P', 'G', '', '', '', 'CO']);
    expect(s.bus.promptText).toBe('Enter first gradient color or [Truecolor/COlorbook] <blue>:');
    await s.bus.script(['1']);
    expect(s.bus.promptText).toBe(
      'Enter second gradient color or [One color/Truecolor/COlorbook] <yellow>:',
    );
    await s.bus.script(['T', '10,20,30', '5,5', '']);
    expect(s.hatches()[0]!.geom.gradient).toMatchObject({
      singleColor: false,
      colors: [
        { value: 0, color: { kind: 'aci', index: 1 } },
        { value: 1, color: { kind: 'rgb', r: 10, g: 20, b: 30 } },
      ],
    });
    // The hatch keeps the current colour; the gradient shows its own.
    expect(s.hatches()[0]!.color).toEqual({ kind: 'byLayer' });
    await s.bus.script(['-HATCH', 'CO', '', 'O']);
    expect(s.bus.promptText).toBe('Specify tint (0 dark to 1 light) <1.0000>:');
    await s.bus.script(['2']);
    expect(s.log).toContain('Value must be between 0 and 1.');
    await s.bus.script(['0.25', '5,5', '']);
    expect(s.hatches()[1]!.geom.gradient).toMatchObject({ singleColor: true, tint: 0.25 });
    await s.bus.script(['-HATCH', 'CO', '']);
    expect(s.bus.promptText).toBe(
      'Enter second gradient color or [One color/Truecolor/COlorbook] <one color>:',
    );
    // ByLayer and ByBlock are no gradient colours: AutoCAD's are true colours (DXF 421).
    await s.bus.script(['bylayer']);
    expect(s.log).toContain('Invalid color.');
    await s.bus.script(['CO', 'bylayer']);
    expect(s.log.filter((l) => l === 'Invalid color.')).toHaveLength(2);
  });

  it('GRADIENT hatches with the last gradient (GD), Linear at first', async () => {
    const s = setup([...square(0, 0, 10), ...square(20, 0, 10)]);
    await s.bus.script(['GD']);
    expect(s.bus.promptText).toBe('Pick internal point or [Select objects/Undo]:');
    await s.bus.script(['5,5', '']);
    expect(s.hatches()[0]!.geom.gradient).toMatchObject({ name: 'LINEAR', shift: 0 });
    // AutoCAD has no -GRADIENT: -HATCH Properties Gradient is the command line's way.
    await s.bus.script(['-GRADIENT']);
    expect(s.log).toContain('Unknown command "-GRADIENT".  Press F1 for help.');
  });

  it('switches back from a gradient to a pattern, and GRADIENT keeps the gradient', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'P', 'G', 'GR_CURVED', '', '', '5,5', '']);
    await s.bus.script(['-HATCH', 'P', 'TRIYA_GRID', '', '', '5,5', '']);
    expect(s.hatches()[1]!.geom).toMatchObject({ pattern: 'TRIYA_GRID', solid: false });
    expect(s.hatches()[1]!.geom.gradient).toBeUndefined();
    await s.bus.script(['GRADIENT', '5,5', '']);
    expect(s.hatches()[2]!.geom.gradient).toMatchObject({ name: 'CURVED' });
    // HATCH carries on with the gradient GRADIENT chose, as HPNAME holds it.
    await s.bus.script(['HATCH', '5,5', '']);
    expect(s.hatches()[3]!.geom.gradient).toMatchObject({ name: 'CURVED' });
  });
});

describe('hatch background colour (M4-07 part 3)', () => {
  it('asks for a background colour after the hatch colour, and fills behind the pattern', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'CO', '1']);
    expect(s.bus.promptText).toBe(
      'Enter new background color or [. (none)/Truecolor/COlorbook] <none>:',
    );
    await s.bus.script(['T', '200,220,240', '5,5', '']);
    const h = s.hatches()[0]!;
    expect(h.color).toEqual({ kind: 'aci', index: 1 });
    expect(h.geom.background).toEqual({ kind: 'rgb', r: 200, g: 220, b: 240 });
    // Saved as AutoCAD keeps it: HATCHBACKGROUNDCOLOR xdata, an AcCmEntityColor (0xC2 RGB).
    const app = [...s.model.tables.appIds.values()].find((a) => a.name === 'HATCHBACKGROUNDCOLOR')!;
    expect(app).toBeDefined();
    expect(h.xdata).toEqual([
      { appId: app.handle, values: [{ code: 1071, value: 0xc2c8dcf0 | 0 }] },
    ]);
    await s.bus.script(['-HATCH', 'CO', '']);
    expect(s.bus.promptText).toBe(
      'Enter new background color or [. (none)/Truecolor/COlorbook] <200,220,240>:',
    );
    await s.bus.script(['4', '5,5', '']);
    expect(s.hatches()[1]!.geom.background).toEqual({ kind: 'aci', index: 4 });
    expect(s.hatches()[1]!.xdata![0]!.values).toEqual([{ code: 1071, value: 0xc3000004 | 0 }]);
    // Only one APPID for both.
    expect(
      [...s.model.tables.appIds.values()].filter((a) => a.name === 'HATCHBACKGROUNDCOLOR'),
    ).toHaveLength(1);
    await s.bus.script(['-HATCH', 'CO', '', '.', '5,5', '']);
    expect(s.hatches()[2]!.geom.background).toBeUndefined();
    expect(s.hatches()[2]!.xdata).toBeUndefined();
    // One undo step takes back a hatch and the APPID it registered.
    await s.bus.script(['U', 'U', 'U']);
    expect(s.hatches()).toHaveLength(0);
    expect([...s.model.tables.appIds.values()].some((a) => a.name === 'HATCHBACKGROUNDCOLOR')).toBe(
      false,
    );
  });

  it('gives no background to solid and gradient fills, and refuses ByLayer', async () => {
    const s = setup(square(0, 0, 10));
    await s.bus.script(['-HATCH', 'CO', '', 'byblock']);
    expect(s.log).toContain('Invalid color.');
    await s.bus.script(['CO', '', '3', 'P', 'S', '5,5', '']);
    expect(s.hatches()[0]!.geom.background).toBeUndefined();
    expect(s.hatches()[0]!.xdata).toBeUndefined();
    await s.bus.script(['-HATCH', 'P', 'G', '', '', '', '5,5', '']);
    expect(s.hatches()[1]!.geom.background).toBeUndefined();
    await s.bus.script(['-HATCH', 'P', 'U', '', '', '', '5,5', '']);
    expect(s.hatches()[2]!.geom.background).toEqual({ kind: 'aci', index: 3 });
  });
});
