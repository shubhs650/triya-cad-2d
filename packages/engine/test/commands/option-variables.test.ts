// M3-12: the modify commands' option variables (AutoCAD 2024 Help, "OFFSETDIST", "OFFSETERASE",
// "OFFSETGAPTYPE", "TRIMEXTENDMODE", "EDGEMODE", "PROJMODE", "TRIMMODE", "CHAMMODE",
// "PEDITACCEPT"). The app keeps them (`APP_VARIABLES`): SETVAR reads and sets them there, each
// command reads them as it starts and sets them when its option changes. Where no app answers,
// the commands keep their own values for the drawing (the other command tests).
import { describe, expect, it } from 'vitest';
import { APP_VARIABLES, systemVariable, type LwPolylineGeometry } from '../../src/index';
import { r6, setup } from './edit-harness';

const NAMES = [
  'OFFSETDIST',
  'OFFSETERASE',
  'OFFSETGAPTYPE',
  'TRIMEXTENDMODE',
  'EDGEMODE',
  'PROJMODE',
  'TRIMMODE',
  'CHAMMODE',
  'PEDITACCEPT',
  'TEXTALIGNMODE',
  'TEXTALIGNSPACING',
];

/** The app's variables with AutoCAD's initial values. */
const initial = (o: Record<string, number> = {}) =>
  new Map<string, number>(
    Object.entries({
      OFFSETDIST: -1,
      OFFSETERASE: 0,
      OFFSETGAPTYPE: 0,
      TRIMEXTENDMODE: 1,
      EDGEMODE: 0,
      PROJMODE: 1,
      TRIMMODE: 1,
      CHAMMODE: 0,
      PEDITACCEPT: 0,
      TEXTALIGNMODE: 9,
      TEXTALIGNSPACING: 2,
      ...o,
    }),
  );

describe('modify option variables', () => {
  it('are variables the app keeps, with their ranges', () => {
    for (const name of NAMES) {
      expect(APP_VARIABLES.some((v) => v.name === name)).toBe(true);
    }
    const { model } = setup();
    expect(systemVariable(model, 'offsetgaptype')).toMatchObject({ kind: 'integer', max: 2 });
    expect(systemVariable(model, 'PROJMODE')).toMatchObject({ kind: 'integer', min: 0, max: 2 });
    expect(systemVariable(model, 'OFFSETDIST')).toMatchObject({ kind: 'distance' });
    expect(systemVariable(model, 'TRIMMODE')).toMatchObject({ kind: 'switch' });
  });

  it('SETVAR reads and sets them in the app, refusing values out of range', async () => {
    const variables = initial();
    const { bus, log } = setup([], { variables });
    await bus.script(['OFFSETDIST']);
    expect(bus.promptText).toBe('Enter new value for OFFSETDIST <-1.0000>:');
    await bus.submit('2.5');
    expect(variables.get('OFFSETDIST')).toBe(2.5);
    await bus.script(['OFFSETGAPTYPE', '3']);
    expect(log.at(-1)).toBe('Value must be between 0 and 2.');
    await bus.submit('1');
    expect(variables.get('OFFSETGAPTYPE')).toBe(1);
    await bus.script(['SETVAR', 'PEDITACCEPT', '1']);
    expect(variables.get('PEDITACCEPT')).toBe(1);
  });

  it('OFFSET starts from OFFSETDIST, OFFSETERASE and OFFSETGAPTYPE and sets them', async () => {
    const variables = initial({ OFFSETDIST: 3, OFFSETERASE: 1, OFFSETGAPTYPE: 2 });
    const { bus, log, byHandle, space, ends } = setup([], { variables });
    await bus.script(['OFFSET']);
    expect(log).toContain('Current settings: Erase source=Yes  Layer=Source  OFFSETGAPTYPE=2');
    expect(bus.promptText).toBe('Specify offset distance or [Through/Erase/Layer] <3.0000>:');
    await bus.submit('');
    await bus.pick({ x: 5, y: 0 });
    await bus.submit('5,5');
    // Erased: line 30 is gone, its offset 3 up is there.
    expect(byHandle('30')).toBeUndefined();
    expect(
      space()
        .filter((e) => e.geom.kind === 'LINE')
        .map(ends),
    ).toEqual([[0, 3, 10, 3]]);
    await bus.submit('');
    // A distance typed, Erase No and Through are what the variables hold next.
    await bus.script(['OFFSET', 'E', 'N', '4']);
    expect(variables.get('OFFSETERASE')).toBe(0);
    expect(variables.get('OFFSETDIST')).toBe(4);
    await bus.submit('');
    await bus.script(['OFFSET', 'T']);
    expect(variables.get('OFFSETDIST')).toBe(-1);
    await bus.submit('');
    // Set elsewhere (SETVAR in another drawing), the next OFFSET starts from it.
    variables.set('OFFSETDIST', 1.5);
    await bus.script(['OFFSET']);
    expect(bus.promptText).toBe('Specify offset distance or [Through/Erase/Layer] <1.5000>:');
  });

  it('OFFSET fillets or chamfers the outside corners of a polyline as OFFSETGAPTYPE says', async () => {
    // An L, CCW: five corners outside, one (5,5) inside.
    const L = [
      [0, 0],
      [10, 0],
      [10, 5],
      [5, 5],
      [5, 10],
      [0, 10],
    ].map(([x, y]) => ({ x: x!, y: y!, bulge: 0 }));
    const shape = { kind: 'LWPOLYLINE' as const, closed: true, vertices: L };
    for (const [gap, bulges] of [
      [0, 0],
      [1, 5],
      [2, 0],
    ] as const) {
      const variables = initial({ OFFSETGAPTYPE: gap });
      const { bus, log, space } = setup([shape], { variables });
      await bus.script(['OFFSET', '1']);
      expect(log).toContain(
        `Current settings: Erase source=No  Layer=Source  OFFSETGAPTYPE=${gap}`,
      );
      await bus.pick({ x: 0, y: 7 });
      await bus.submit('-4,7');
      const made = space().at(-1)!.geom as LwPolylineGeometry;
      expect(made.vertices).toHaveLength(gap === 0 ? 6 : 11);
      expect(made.vertices.filter((v) => v.bulge !== 0)).toHaveLength(bulges);
      // The inside corner is trimmed whatever the gap type.
      expect(made.vertices.some((v) => r6(v.x) === 6 && r6(v.y) === 6)).toBe(true);
      await bus.submit('');
    }
  });

  it('TRIM and EXTEND start from TRIMEXTENDMODE, EDGEMODE and PROJMODE and set them', async () => {
    const variables = initial({ TRIMEXTENDMODE: 0, EDGEMODE: 1, PROJMODE: 0 });
    const { bus, log } = setup([], { variables });
    await bus.script(['TRIM']);
    expect(log).toContain('Current settings: Projection=None, Edge=Extend, Mode=Standard');
    expect(log.at(-1)).toBe('Select cutting edges ...');
    expect(bus.promptText).toBe('Select objects or [mOde] <select all>:');
    await bus.submit('');
    await bus.script(['P', 'V']);
    expect(variables.get('PROJMODE')).toBe(2);
    await bus.script(['E', 'N']);
    expect(variables.get('EDGEMODE')).toBe(0);
    await bus.script(['O', 'Q']);
    expect(variables.get('TRIMEXTENDMODE')).toBe(1);
    await bus.submit('');
    // EXTEND shares them.
    await bus.script(['EXTEND']);
    expect(log).toContain('Current settings: Projection=View, Edge=None, Mode=Quick');
    await bus.script(['O', 'S']);
    expect(variables.get('TRIMEXTENDMODE')).toBe(0);
    // Standard chosen at the edges' own mOde prompt is kept too.
    variables.set('TRIMEXTENDMODE', 0);
    await bus.cancel();
    await bus.script(['TRIM', 'O', 'Q']);
    expect(variables.get('TRIMEXTENDMODE')).toBe(1);
    expect(bus.promptText).toMatch(/^Select object to trim/);
    await bus.cancel();
    await bus.script(['SETVAR', 'PROJMODE', '1', 'TRIM']);
    expect(log).toContain('Current settings: Projection=UCS, Edge=None, Mode=Quick');
  });

  it('FILLET and CHAMFER start from TRIMMODE and CHAMMODE and set them', async () => {
    const variables = initial({ TRIMMODE: 0, CHAMMODE: 1 });
    const { bus, log } = setup([], { variables });
    await bus.script(['FILLET']);
    expect(log).toContain('Current settings: Mode = NOTRIM, Radius = 0.0000');
    await bus.script(['T', 'T']);
    expect(variables.get('TRIMMODE')).toBe(1);
    await bus.cancel();
    await bus.script(['CHAMFER']);
    expect(log.at(-1)).toMatch(/^\(TRIM mode\) Current chamfer Length = 0\.0000, Angle = 0/);
    await bus.script(['E', 'D']);
    expect(variables.get('CHAMMODE')).toBe(0);
    await bus.script(['D', '1', '2']);
    expect(variables.get('CHAMMODE')).toBe(0);
    await bus.script(['A', '1', '30']);
    expect(variables.get('CHAMMODE')).toBe(1);
    await bus.script(['T', 'N']);
    expect(variables.get('TRIMMODE')).toBe(0);
  });

  it('PEDIT turns a line into a polyline without asking under PEDITACCEPT 1', async () => {
    const variables = initial({ PEDITACCEPT: 1 });
    const line = (y: number) => ({
      kind: 'LINE' as const,
      start: { x: 0, y },
      end: { x: 10, y },
    });
    const { bus, log, space } = setup([line(20), line(40)], { variables });
    const polylines = () => space().filter((e) => e.geom.kind === 'LWPOLYLINE').length;
    await bus.script(['PEDIT']);
    await bus.pick({ x: 5, y: 0 });
    expect(log).not.toContain('Object selected is not a polyline');
    expect(bus.promptText).toMatch(/^Enter an option \[Close\/Join/);
    await bus.submit('');
    expect(polylines()).toBe(1);
    // Multiple converts the lines chosen without asking too.
    await bus.script(['PEDIT', 'M']);
    await bus.pick({ x: 5, y: 20 });
    await bus.submit('');
    expect(bus.promptText).toMatch(/^Enter an option/);
    expect(polylines()).toBe(2);
    await bus.submit('');
    // PEDITACCEPT 0 asks again.
    variables.set('PEDITACCEPT', 0);
    await bus.script(['PEDIT']);
    await bus.pick({ x: 5, y: 40 });
    expect(log.at(-1)).toBe('Object selected is not a polyline');
    expect(bus.promptText).toBe('Do you want to turn it into one? [Yes/No] <Y>:');
  });

  it('TEXTALIGN starts from TEXTALIGNMODE and TEXTALIGNSPACING and sets them (M4-09 part 3)', async () => {
    const variables = initial({ TEXTALIGNMODE: 10, TEXTALIGNSPACING: 0 });
    const { bus } = setup([], { variables });
    await bus.script(['TEXTALIGN', 'I']);
    expect(bus.promptText).toContain('<Center>:');
    await bus.submit('TR');
    expect(variables.get('TEXTALIGNMODE')).toBe(2);
    await bus.submit('O');
    expect(bus.promptText).toContain('<Distribute>:');
    await bus.submit('H');
    expect(variables.get('TEXTALIGNSPACING')).toBe(3);
    await bus.answer({ kind: 'enter' });
    expect(bus.command).toBeUndefined();
  });
});
