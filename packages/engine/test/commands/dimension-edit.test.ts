// M4-02 part 2: DIMEDIT, DIMTEDIT and DIMOVERRIDE on the PromptBus with AutoCAD 2024's
// prompts, on the stand-in dimension engine of dimension-harness.ts.
import { describe, expect, it } from 'vitest';
import {
  clearDimensionOverridesCommand,
  dragMotion,
  dstyleOverrides,
  type Entity,
} from '../../src/index';
import { snapshot } from '../model/fixtures';
import { regenerate, said, setup, standard } from './dimension-harness';

/** A drawing with one DIMLINEAR dimension from (0,0) to (10,0), its line at y = 5. */
async function linear(o: Parameters<typeof setup>[0] = {}) {
  const s = setup(o);
  await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']);
  return s;
}

const overrides = (s: ReturnType<typeof setup>, e: Entity = s.dims()[0]!) =>
  dstyleOverrides(s.model.entity(e.id)!.xdata, s.model);

describe('DIMEDIT', () => {
  it('asks AutoCAD 2024 prompts; Rotate turns the text of the dimensions selected', async () => {
    const s = await linear();
    await s.bus.submit('DIMEDIT');
    expect(s.bus.promptText).toBe(
      'Enter type of dimension editing [Home/New/Rotate/Oblique] <Home>:',
    );
    await s.bus.submit('R');
    expect(s.bus.promptText).toBe('Specify angle for dimension text:');
    await s.bus.submit('30');
    expect(s.bus.promptText).toBe('Select objects:');
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    expect(s.dim<'linear'>().textRotation).toBeCloseTo(Math.PI / 6, 12);
  });

  it('Home (the default) takes the rotation off and sends the text home', async () => {
    const s = await linear();
    await s.bus.script(['DIMEDIT', 'R', '30']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.script(['', 'DIMTEDIT']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.script(['3,9']);
    expect(s.dim<'linear'>()).toMatchObject({ textUserPositioned: true });
    await s.bus.script(['DIMEDIT', '']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('');
    expect(s.dim<'linear'>()).toMatchObject({ textRotation: 0, textUserPositioned: false });
  });

  it('New gives every dimension selected the text, <> its measurement', async () => {
    const s = await linear();
    await s.bus.script(['DIMLINEAR', '0,10', '4,10', '2,12']);
    await s.bus.script(['DIMEDIT', 'N']);
    expect(s.bus.promptText).toBe('Enter dimension text <<>>:');
    await s.bus.script(['<> TYP']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.pick({ x: 4, y: 12 });
    await s.bus.submit('');
    expect(s.dims().map((e) => (e.geom as { text: string }).text)).toEqual(['<> TYP', '<> TYP']);
    // `<>` alone is the measurement: no override.
    await s.bus.script(['DIMEDIT', 'N', '<>']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('');
    expect((s.dims()[0]!.geom as { text: string }).text).toBe('');
  });

  it('Oblique slants a linear dimension’s extension lines; Enter takes it off', async () => {
    const s = await linear();
    const before = snapshot(s.model);
    await s.bus.script(['DIMEDIT', 'O']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Enter obliquing angle (press ENTER for none):');
    await s.bus.submit('60');
    expect(s.dim<'linear'>().oblique).toBeCloseTo(Math.PI / 3, 12);
    await s.bus.script(['DIMEDIT', 'O']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.script(['', '']);
    expect(s.dim<'linear'>().oblique).toBeUndefined();
    await s.bus.script(['U', 'U']);
    expect(snapshot(s.model)).toEqual(before);
  });

  it('Oblique leaves other dimensions, and an angle along the dimension line, alone', async () => {
    const s = await linear();
    await s.bus.script(['DIMRADIUS']);
    await s.bus.pick({ x: 60, y: 0 });
    await s.bus.script(['70,0', 'DIMEDIT', 'O']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.pick({ x: 60, y: 0 });
    await s.bus.script(['', '0']);
    expect(s.dim<'radius'>()).not.toHaveProperty('oblique');
    await s.bus.script(['DIMEDIT', 'O']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.script(['', '180']);
    expect(s.dims()[0]!.geom).not.toHaveProperty('oblique');
  });

  it('selects nothing that is not a dimension; Esc ends it anywhere', async () => {
    const s = await linear();
    const before = snapshot(s.model);
    await s.bus.script(['DIMEDIT', 'R', '30']);
    await s.bus.pick({ x: 5, y: 20 });
    await s.bus.submit('');
    expect(snapshot(s.model)).toEqual(before);
    for (const answers of [['DIMEDIT'], ['DIMEDIT', 'N'], ['DIMEDIT', 'R'], ['DIMEDIT', 'O']]) {
      await s.bus.script(answers);
      await s.bus.cancel();
      expect(s.bus.command).toBeUndefined();
    }
    await s.bus.script(['DIMEDIT', 'O']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('');
    await s.bus.cancel();
    expect(snapshot(s.model)).toEqual(before);
  });
});

describe('DIMTEDIT', () => {
  it('asks AutoCAD 2024 prompts and moves the text where it is put, dragged there', async () => {
    const s = await linear();
    await s.bus.submit('DIMTEDIT');
    expect(s.bus.promptText).toBe('Select dimension:');
    await s.bus.pick({ x: 5, y: 20 });
    expect(said(s.bus)).toContain('Object selected is not a dimension.');
    await s.bus.pick({ x: 10, y: 5 });
    expect(s.bus.promptText).toBe(
      'Specify new location for dimension text or [Left/Right/Center/Home/Angle]:',
    );
    const m = dragMotion(s.bus.prompt!.drag!, { x: 3, y: 9 });
    expect(m?.grip?.ids).toEqual([s.dims()[0]!.id]);
    await s.bus.submit('3,9');
    expect(s.dim<'linear'>()).toMatchObject({
      textPosition: { x: 3, y: 9 },
      textUserPositioned: true,
    });
  });

  it('Home sends it back; Angle turns it', async () => {
    const s = await linear();
    await s.bus.script(['DIMTEDIT']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.script(['3,9', 'DIMTEDIT']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.script(['H']);
    expect(s.dim<'linear'>()).toMatchObject({ textUserPositioned: false });
    await s.bus.script(['DIMTED']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.script(['A']);
    expect(s.bus.promptText).toBe('Specify angle for dimension text:');
    await s.bus.submit('45');
    expect(s.dim<'linear'>().textRotation).toBeCloseTo(Math.PI / 4, 12);
  });

  it('Left, Right and Center file DIMJUST and send the text home', async () => {
    const s = await linear();
    await s.bus.script(['DIMTEDIT']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.script(['3,9', 'DIMTEDIT']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.script(['L']);
    expect(overrides(s)).toEqual({ DIMJUST: 1 });
    expect(s.dim<'linear'>().textUserPositioned).toBe(false);
    await s.bus.script(['DIMTEDIT']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.script(['R']);
    expect(overrides(s)).toEqual({ DIMJUST: 2 });
    // Center is the style's own (DIMJUST 0): no override left.
    await s.bus.script(['DIMTEDIT']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.script(['C']);
    expect(overrides(s)).toEqual({});
  });

  it('Left and Right are for linear, radial and diameter dimensions only', async () => {
    const s = setup();
    await s.bus.script(['DIMANGULAR']);
    await s.bus.pick({ x: 60, y: 0 });
    await s.bus.script(['58,5']);
    const before = snapshot(s.model);
    await s.bus.script(['DIMTEDIT']);
    await s.bus.pick({ x: 50, y: 0 });
    await s.bus.script(['L']);
    expect(said(s.bus)).toContain(
      'Left and Right work only with linear, radial and diameter dimensions.',
    );
    expect(snapshot(s.model)).toEqual(before);
  });

  it('Esc or Enter ends it unchanged', async () => {
    const s = await linear();
    const before = snapshot(s.model);
    await s.bus.script(['DIMTEDIT']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('');
    await s.bus.script(['DIMTEDIT', '']);
    await s.bus.script(['DIMTEDIT']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.script(['A']);
    await s.bus.cancel();
    expect(snapshot(s.model)).toEqual(before);
  });
});

describe('DIMOVERRIDE', () => {
  const header = { header: [['$DIMSCALE', 1] as [string, number]] };

  it('asks AutoCAD 2024 prompts and files each DIMVAR given on the dimensions selected', async () => {
    const s = await linear(header);
    await s.bus.submit('DIMOVERRIDE');
    expect(s.bus.promptText).toBe(
      'Enter dimension variable name to override or [Clear overrides]:',
    );
    await s.bus.submit('dimscale');
    expect(s.bus.promptText).toBe('Enter new value for dimension variable <1>:');
    await s.bus.submit('2');
    expect(s.bus.promptText).toBe(
      'Enter dimension variable name to override or [Clear overrides]:',
    );
    await s.bus.script(['DIMDSEP', ',', 'DIMTAD', '1', '']);
    expect(s.bus.promptText).toBe('Select objects:');
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    expect(overrides(s)).toEqual({ DIMSCALE: 2, DIMDSEP: 44, DIMTAD: 1 });
  });

  it('refuses unknown names and values of the wrong kind', async () => {
    const s = await linear(header);
    await s.bus.script(['DOV', 'DIMFOO']);
    expect(said(s.bus)).toContain('Unknown dimension variable name.');
    await s.bus.script(['DIMSCALE', 'big']);
    expect(said(s.bus)).toContain('Requires a number.');
    await s.bus.script(['2', 'DIMTAD', '1.5']);
    expect(said(s.bus)).toContain('Requires an integer.');
    await s.bus.script(['1', 'DIMDSEP', ',,']);
    expect(said(s.bus)).toContain('Requires a single character.');
    await s.bus.script(['.', 'DIMTXSTY', 'NOSUCH']);
    expect(said(s.bus)).toContain('NOSUCH not found.');
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
  });

  it('names a block for DIMBLK, `.` for none; strings for DIMPOST', async () => {
    const s = await linear(header);
    await s.bus.script(['DIMOVERRIDE', 'DIMPOST', '<> mm', 'DIMBLK', '.', '']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('');
    expect(overrides(s)).toEqual({ DIMPOST: '<> mm' });
  });

  it('Clear overrides takes them all off; each step one undo', async () => {
    const s = await linear(header);
    await s.bus.script(['DIMOVERRIDE', 'DIMSCALE', '2', 'DIMTAD', '1', '']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('');
    const overridden = snapshot(s.model);
    await s.bus.script(['DIMOVERRIDE', 'C']);
    expect(s.bus.promptText).toBe('Select objects:');
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('');
    expect(overrides(s)).toEqual({});
    await s.bus.script(['U']);
    expect(snapshot(s.model)).toEqual(overridden);
  });

  it('a value equal to the style’s is no override; nothing asked, nothing done', async () => {
    const s = await linear({ ...header, styles: [standard({ DIMSCALE: 1 })] });
    const before = snapshot(s.model);
    await s.bus.script(['DIMOVERRIDE', 'DIMSCALE', '1', '']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('');
    expect(snapshot(s.model)).toEqual(before);
    await s.bus.script(['DIMOVERRIDE', '']);
    expect(s.bus.command).toBeUndefined();
    await s.bus.script(['DIMOVERRIDE', 'DIMSCALE', '2', '']);
    await s.bus.submit('');
    expect(snapshot(s.model)).toEqual(before);
  });

  it('says so in a drawing without the ACAD application', async () => {
    const s = await linear(header);
    // The ACAD APPID removed: nothing to file overrides under.
    const acad = [...s.model.tables.appIds.values()].find((r) => r.name === 'ACAD')!;
    s.model.apply({ tables: { appIds: { removed: [acad] } } } as never);
    await s.bus.script(['DIMOVERRIDE', 'DIMSCALE', '2', '']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('');
    expect(said(s.bus)).toContain('The drawing has no ACAD application to file overrides under.');
  });

  it('the Health palette’s Clear Overrides clears every dimension and redraws them (M8-07)', async () => {
    const redrawn: string[] = [];
    const s = setup({
      ...header,
      regenerate: (e, model, measure) => {
        redrawn.push(e.handle);
        return regenerate(e, model, measure);
      },
    });
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']);
    await s.bus.script(['DIMLINEAR', '0,20', '10,20', '5,25']);
    await s.bus.script(['DIMOVERRIDE', 'DIMSCALE', '2', '']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.pick({ x: 10, y: 25 });
    await s.bus.submit('');
    const [a, b] = s.dims();
    expect([overrides(s, a), overrides(s, b)]).toEqual([{ DIMSCALE: 2 }, { DIMSCALE: 2 }]);
    redrawn.length = 0;
    await s.bus.run(clearDimensionOverridesCommand());
    expect([overrides(s, a), overrides(s, b)]).toEqual([{}, {}]);
    // Each is drawn again (the stand-in draws the same block, so the command's end may too).
    expect([...new Set(redrawn)].sort()).toEqual([a!.handle, b!.handle].sort());
    expect(said(s.bus)).toContain('Overrides cleared from 2 dimensions.');
    await s.bus.script(['U']);
    expect([overrides(s, a), overrides(s, b)]).toEqual([{ DIMSCALE: 2 }, { DIMSCALE: 2 }]);
  });
});

describe('DIMSPACE', () => {
  /** A base dimension with its line at y = 5 and two more above it, at y = 12 and 8. */
  async function three() {
    const s = await linear();
    await s.bus.script(['DIMLINEAR', '0,0', '4,0', '2,12']);
    await s.bus.script(['DIMLINEAR', '4,0', '10,0', '7,8']);
    return s;
  }
  const lines = (s: ReturnType<typeof setup>) =>
    s.dims().map((e) => (e.geom as { definitionPoint: { y: number } }).definitionPoint.y);

  it('asks AutoCAD 2024 prompts; Auto spaces them twice the text height apart', async () => {
    const s = await three();
    await s.bus.submit('DIMSPACE');
    expect(s.bus.promptText).toBe('Select base dimension:');
    await s.bus.pick({ x: 10, y: 5 });
    expect(s.bus.promptText).toBe('Select dimensions to space:');
    await s.bus.pick({ x: 4, y: 12 });
    await s.bus.pick({ x: 10, y: 8 });
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Enter value or [Auto] <Auto>:');
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    // DIMTXT 0.18 (AutoCAD's default), in the order they stood from the base.
    const [a, b, c] = lines(s);
    expect(a).toBe(5);
    expect(b).toBeCloseTo(5.72, 12);
    expect(c).toBeCloseTo(5.36, 12);
  });

  it('a value spaces them that far apart, 0 lines them up; one undo step', async () => {
    const s = await three();
    const before = snapshot(s.model);
    await s.bus.script(['DIMSPACE']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.pick({ x: 4, y: 12 });
    await s.bus.pick({ x: 10, y: 8 });
    await s.bus.script(['', '3']);
    expect(lines(s)).toEqual([5, 11, 8]);
    await s.bus.script(['DIMSPACE']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.pick({ x: 4, y: 11 });
    await s.bus.pick({ x: 10, y: 8 });
    await s.bus.script(['', '0']);
    expect(lines(s)).toEqual([5, 5, 5]);
    await s.bus.script(['U', 'U']);
    expect(snapshot(s.model)).toEqual(before);
  });

  it('dimensions below the base go down; a text placed by hand goes with its line', async () => {
    const s = await linear();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,-3', 'DIMTEDIT']);
    await s.bus.pick({ x: 10, y: -3 });
    await s.bus.script(['2,-4', 'DIMSPACE']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.pick({ x: 10, y: -3 });
    await s.bus.script(['', '1']);
    expect(lines(s)).toEqual([5, 4]);
    expect(s.dim<'linear'>().textPosition).toEqual({ x: 2, y: 3 });
  });

  it('leaves out dimensions running another way, and refuses a base that is not linear or angular', async () => {
    const s = await linear();
    await s.bus.script(['DIMLINEAR', '0,0', '10,10', '15,5']);
    await s.bus.script(['DIMRADIUS']);
    await s.bus.pick({ x: 60, y: 0 });
    await s.bus.script(['70,0']);
    const before = snapshot(s.model);
    await s.bus.script(['DIMSPACE']);
    await s.bus.pick({ x: 60, y: 0 });
    expect(said(s.bus)).toContain('Object selected is not a linear or angular dimension.');
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.pick({ x: 15, y: 10 });
    await s.bus.pick({ x: 60, y: 0 });
    await s.bus.script(['', '2']);
    expect(snapshot(s.model)).toEqual(before);
  });

  it('angular dimensions about the same vertex take their arcs in or out', async () => {
    const s = setup();
    // About the sample arc's centre (50, 0): its arc's angle at radius √89, and a three-point
    // one at radius √18.
    await s.bus.script(['DIMANGULAR']);
    await s.bus.pick({ x: 60, y: 0 });
    await s.bus.script(['58,5']);
    await s.bus.script(['DIMANGULAR', '', '50,0', '60,0', '50,10', '53,3']);
    await s.bus.script(['DIMSPACE']);
    await s.bus.pick({ x: 58, y: 5 });
    await s.bus.pick({ x: 53, y: 3 });
    await s.bus.script(['', '2']);
    const g = s.dim<'angular3pt'>();
    const r = Math.hypot(g.definitionPoint.x - 50, g.definitionPoint.y);
    expect(r).toBeCloseTo(Math.sqrt(89) - 2, 12);
  });

  it('Esc or nothing selected ends it unchanged', async () => {
    const s = await three();
    const before = snapshot(s.model);
    await s.bus.script(['DIMSPACE', '']);
    await s.bus.script(['DIMSPACE']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('');
    await s.bus.script(['DIMSPACE']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.pick({ x: 4, y: 12 });
    await s.bus.submit('');
    await s.bus.cancel();
    await s.bus.script(['DIMSPACE']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.cancel();
    expect(snapshot(s.model)).toEqual(before);
  });
});
