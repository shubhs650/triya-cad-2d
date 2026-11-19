// M5-18: LAYER and LAYERCLOSE open and close the Layer Properties Manager, and -LAYER changes
// layers at the command line with AutoCAD 2024's options (AutoCAD Help, "LAYER (Command)",
// "LAYERCLOSE (Command)", "-LAYER (Command)").
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type LayerRecord,
  type ViewRequest,
} from '../../src/index';
import { entityInit, layer, linetype, lineGeom, record, sampleInit } from '../model/fixtures';
import { host } from './edit-harness';

const L0 = '10';
const WALLS = '11';
const DOORS = '12';
const NOTES = '13';
const HANDLES = [L0, WALLS, DOORS, NOTES];
const NAMES: Record<string, string> = {
  [L0]: '0',
  [WALLS]: 'WALLS',
  [DOORS]: 'DOORS',
  [NOTES]: 'NOTES',
};
const CONTINUOUS = '14';
const DASHED = '15';

const OPTIONS =
  '[?/Make/Set/New/Rename/ON/OFF/Color/Ltype/LWeight/TRansparency/Plot/Freeze/Thaw/LOck/Unlock/stAte/Description]';
/** In a drawing with named plot styles ($PSTYLEMODE 0). */
const NAMED_OPTIONS =
  '[?/Make/Set/New/Rename/ON/OFF/Color/Ltype/LWeight/TRansparency/Plot/PStyle/Freeze/Thaw/LOck/Unlock/stAte/Description]';
const NORMAL = '80';
const HEAVY = '81';
const LIGHT = '82';

/**
 * Four layers, each holding one line from x 0 to 10: 0 at y 0, WALLS at y 10, DOORS at y 20 and
 * NOTES at y 30. WALLS is current. The drawing has the Continuous and DASHED linetypes.
 */
function setup(
  o: { layers?: Partial<Record<string, Partial<LayerRecord>>>; namedPlotStyles?: boolean } = {},
) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    header: new Map([
      ...(init.header ?? []),
      ['$CLAYER', 'WALLS'],
      ['$PSTYLEMODE', o.namedPlotStyles ? 0 : 1],
    ]),
    tables: {
      ...init.tables,
      plotStyles: o.namedPlotStyles
        ? [record(NORMAL, 'Normal'), record(HEAVY, 'Heavy'), record(LIGHT, 'Light')]
        : [],
      linetypes: [linetype(CONTINUOUS, 'Continuous'), linetype(DASHED, 'DASHED')],
      layers: HANDLES.map((h) => ({ ...layer(h, NAMES[h]!), ...o.layers?.[h] })),
    },
    entities: HANDLES.map((h, i) =>
      entityInit((0x30 + i).toString(16).toUpperCase(), lineGeom(0, i * 10, 10, i * 10), {
        layer: h,
      }),
    ),
  });
  const requests: ViewRequest[] = [];
  const base = host(() => model);
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r) => {
        if (r.op !== 'palette') return base.request(r);
        requests.push(r);
        return Promise.resolve({ ok: true });
      },
    },
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const lay = (h: string) => model.tables.layers.get(h)!;
  const byName = (name: string) =>
    [...model.tables.layers.values()].find((l) => l.name.toUpperCase() === name.toUpperCase());
  const states = (key: 'on' | 'frozen' | 'locked' | 'plot') => HANDLES.map((h) => lay(h)[key]);
  const current = () => model.header.get('$CLAYER');
  /** A pick on the line of the layer `h`. */
  const on = (h: string) => ({ x: 5, y: HANDLES.indexOf(h) * 10 });
  return { model, bus, log, lay, byName, states, current, on, requests };
}

describe('LAYER and LAYERCLOSE', () => {
  it('open and close the Layer Properties Manager, LA too, keeping the selection', async () => {
    const t = setup();
    await t.bus.selectAll();
    await t.bus.submit('LA');
    await t.bus.submit('LAYERCLOSE');
    await t.bus.submit('LAYER');
    expect(t.requests).toEqual([
      { op: 'palette', palette: 'layers', open: true },
      { op: 'palette', palette: 'layers', open: false },
      { op: 'palette', palette: 'layers', open: true },
    ]);
    expect(t.bus.selection).toHaveLength(4);
    expect(t.bus.undo.state.undoable).toBe(0);
  });
});

describe('-LAYER', () => {
  it('names the current layer and asks for an option until Enter', async () => {
    const t = setup();
    await t.bus.script(['-LAYER']);
    expect(t.log).toContain('Current layer:  "WALLS"');
    expect(t.bus.promptText).toBe(`Enter an option ${OPTIONS}:`);
    await t.bus.script(['ON', 'DOORS']);
    expect(t.bus.promptText).toBe(`Enter an option ${OPTIONS}:`);
    await t.bus.script(['']);
    expect(t.bus.prompt).toBeUndefined();
  });

  it('-LA runs it too', async () => {
    const t = setup();
    await t.bus.script(['-LA']);
    expect(t.bus.promptText).toBe(`Enter an option ${OPTIONS}:`);
  });

  it('? lists the layers matching the names, then the current layer', async () => {
    const t = setup({
      layers: { [DOORS]: { on: false, locked: true }, [NOTES]: { frozen: true } },
    });
    await t.bus.script(['-LAYER', '?']);
    expect(t.bus.promptText).toBe('Enter layer name(s) to list <*>:');
    await t.bus.script(['']);
    const header = t.log.findIndex((l) => l.startsWith('Layer name'));
    expect(t.log[header]).toMatch(
      /^Layer name +State +Color +Linetype +Lineweight +Transparency +Plot$/,
    );
    const rows = t.log.slice(header + 1, header + 5);
    expect(rows[0]).toMatch(/^"0" +On +7 \(white\) +"Continuous" +Default +0 +Plot$/);
    expect(rows[1]).toMatch(/^"WALLS" +On +7 \(white\)/);
    expect(rows[2]).toMatch(/^"DOORS" +Off Locked +7 \(white\)/);
    expect(rows[3]).toMatch(/^"NOTES" +On Frozen +7/);
    expect(t.log[header + 5]).toBe('Current layer:  "WALLS"');
    await t.bus.script(['?', 'D*,n*']);
    const last = t.log.lastIndexOf(t.log[header]!);
    expect(t.log.slice(last + 1, last + 3).map((l) => l.split(' ')[0])).toEqual([
      '"DOORS"',
      '"NOTES"',
    ]);
    await t.bus.script(['?', 'X*']);
    expect(t.log).toContain('No matching layer names found.');
  });

  it('Make makes a new layer current with color 7, Continuous and Default lineweight', async () => {
    const t = setup({
      layers: { [L0]: { color: { kind: 'aci', index: 3 }, linetype: DASHED, lineweight: 50 } },
    });
    await t.bus.script(['-LAYER', 'M']);
    expect(t.bus.promptText).toBe('Enter name for new layer (becomes the current layer) <WALLS>:');
    await t.bus.script(['STAIRS', '']);
    const made = t.byName('STAIRS')!;
    expect(made).toMatchObject({
      color: { kind: 'aci', index: 7 },
      linetype: CONTINUOUS,
      lineweight: 'Default',
      transparency: { alpha: 255 },
      plot: true,
      on: true,
      frozen: false,
      locked: false,
    });
    expect(t.current()).toBe('STAIRS');
    // One command, one LAYER undo step.
    expect(t.bus.undo.state.undoable).toBe(1);
    await t.bus.script(['U']);
    expect(t.byName('STAIRS')).toBeUndefined();
    expect(t.current()).toBe('WALLS');
  });

  it('Make of a layer that is off turns it on; a frozen one cannot be made current', async () => {
    const t = setup({ layers: { [DOORS]: { on: false }, [NOTES]: { frozen: true } } });
    await t.bus.script(['-LAYER', 'M', 'doors']);
    expect(t.current()).toBe('DOORS');
    expect(t.lay(DOORS).on).toBe(true);
    await t.bus.script(['M', 'NOTES']);
    expect(t.log).toContain('Cannot make frozen layer "NOTES" current.');
    expect(t.current()).toBe('DOORS');
    await t.bus.script(['M', 'BAD*NAME']);
    expect(t.log).toContain('Invalid layer name.');
  });

  it('Set makes a layer current by name or by an object picked', async () => {
    const t = setup({ layers: { [NOTES]: { frozen: true } } });
    await t.bus.script(['-LAYER', 'S']);
    expect(t.bus.promptText).toBe('Enter layer name to make current or <select object>:');
    await t.bus.script(['doors']);
    expect(t.current()).toBe('DOORS');
    await t.bus.script(['S', 'MISSING']);
    expect(t.log).toContain('Cannot find layer "MISSING".');
    await t.bus.script(['S', 'NOTES']);
    expect(t.log).toContain('Cannot make frozen layer "NOTES" current.');
    await t.bus.script(['S', '']);
    expect(t.bus.promptText).toBe('Select object:');
    await t.bus.pick(t.on(L0));
    expect(t.current()).toBe('0');
    expect(t.bus.promptText).toBe(`Enter an option ${OPTIONS}:`);
  });

  it('New makes each layer of a comma list, saying which it cannot', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'N']);
    expect(t.bus.promptText).toBe('Enter name list for new layer(s):');
    await t.bus.script(['A-1,A-2,walls,BAD<']);
    expect(t.byName('A-1')).toBeDefined();
    expect(t.byName('A-2')).toBeDefined();
    expect(t.log).toContain('Layer "walls" already exists.');
    expect(t.log).toContain('Invalid layer name.');
    expect(t.current()).toBe('WALLS');
  });

  it('Rename renames a layer, the current one following; layer 0 is kept', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'R']);
    expect(t.bus.promptText).toBe('Enter old layer name:');
    await t.bus.script(['walls']);
    expect(t.bus.promptText).toBe('Enter new layer name:');
    await t.bus.script(['WALLS-NEW']);
    expect(t.lay(WALLS).name).toBe('WALLS-NEW');
    expect(t.current()).toBe('WALLS-NEW');
    await t.bus.script(['R', 'NOPE']);
    expect(t.log).toContain('Cannot find layer "NOPE".');
    await t.bus.script(['R', '0', 'ZERO']);
    expect(t.log).toContain('The name of layer 0 cannot be changed.');
    await t.bus.script(['R', 'DOORS', 'NOTES']);
    expect(t.log).toContain('A layer named "NOTES" already exists.');
    expect(t.lay(DOORS).name).toBe('DOORS');
  });

  it('ON and OFF take name lists with wildcards; OFF asks before the current layer', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'OFF']);
    expect(t.bus.promptText).toBe('Enter name list of layer(s) to turn off or <select objects>:');
    await t.bus.script(['D*,NOTES']);
    expect(t.states('on')).toEqual([true, true, false, false]);
    await t.bus.script(['OFF', 'WALLS']);
    expect(t.bus.promptText).toBe('Really want layer "WALLS" (the CURRENT layer) off? <N>:');
    await t.bus.script(['']);
    expect(t.lay(WALLS).on).toBe(true);
    await t.bus.script(['OFF', 'WALLS', 'Y']);
    expect(t.lay(WALLS).on).toBe(false);
    await t.bus.script(['ON']);
    expect(t.bus.promptText).toBe('Enter name list of layer(s) to turn On:');
    await t.bus.script(['*']);
    expect(t.states('on')).toEqual([true, true, true, true]);
    await t.bus.script(['ON', 'Q*']);
    expect(t.log).toContain('No matching layer names found.');
    await t.bus.script(['']);
    expect(t.bus.undo.state.undoable).toBe(1);
  });

  it('OFF, Freeze and LOck take the layers of objects selected at Enter', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'OFF', '']);
    expect(t.bus.promptText).toBe('Select objects:');
    await t.bus.pick(t.on(DOORS));
    await t.bus.pick(t.on(NOTES));
    await t.bus.script(['']);
    expect(t.states('on')).toEqual([true, true, false, false]);
    await t.bus.script(['LO', '']);
    await t.bus.pick(t.on(L0));
    await t.bus.script(['']);
    expect(t.states('locked')).toEqual([true, false, false, false]);
    await t.bus.script(['F', '']);
    await t.bus.pick(t.on(L0));
    await t.bus.script(['']);
    expect(t.states('frozen')).toEqual([true, false, false, false]);
  });

  it('Freeze and Thaw; the current layer is never frozen', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'F']);
    expect(t.bus.promptText).toBe('Enter name list of layer(s) to freeze or <select objects>:');
    await t.bus.script(['*']);
    expect(t.log).toContain('Cannot freeze layer "WALLS".  It is the CURRENT layer.');
    expect(t.states('frozen')).toEqual([true, false, true, true]);
    await t.bus.script(['T']);
    expect(t.bus.promptText).toBe('Enter name list of layer(s) to thaw:');
    await t.bus.script(['0,doors']);
    expect(t.states('frozen')).toEqual([false, false, false, true]);
  });

  it('LOck and Unlock', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'LO']);
    expect(t.bus.promptText).toBe('Enter name list of layer(s) to lock or <select objects>:');
    await t.bus.script(['WALLS,NOTES']);
    expect(t.states('locked')).toEqual([false, true, false, true]);
    await t.bus.script(['U']);
    expect(t.bus.promptText).toBe('Enter name list of layer(s) to unlock or <select objects>:');
    await t.bus.script(['NOTES']);
    expect(t.states('locked')).toEqual([false, true, false, false]);
  });

  it('Color sets a colour by number, name or Truecolor, turning the layers on (off when negative)', async () => {
    const t = setup({ layers: { [DOORS]: { on: false } } });
    await t.bus.script(['-LAYER', 'C']);
    expect(t.bus.promptText).toBe('New color [Truecolor/COlorbook]:');
    await t.bus.script(['red']);
    expect(t.bus.promptText).toBe('Enter name list of layer(s) for color 1 (red) <WALLS>:');
    await t.bus.script(['']);
    expect(t.lay(WALLS).color).toEqual({ kind: 'aci', index: 1 });
    await t.bus.script(['C', '30', 'DOORS']);
    expect(t.lay(DOORS).color).toEqual({ kind: 'aci', index: 30 });
    expect(t.lay(DOORS).on).toBe(true);
    await t.bus.script(['C', '-5', 'NOTES']);
    expect(t.lay(NOTES).color).toEqual({ kind: 'aci', index: 5 });
    expect(t.lay(NOTES).on).toBe(false);
    await t.bus.script(['C', 'T']);
    expect(t.bus.promptText).toBe('Red, Green, Blue:');
    await t.bus.script(['10,20,30']);
    expect(t.bus.promptText).toBe('Enter name list of layer(s) for color 10,20,30 <WALLS>:');
    await t.bus.script(['0']);
    expect(t.lay(L0).color).toEqual({ kind: 'rgb', r: 10, g: 20, b: 30 });
    await t.bus.script(['C', 'BYLAYER']);
    expect(t.log).toContain('Invalid color.');
    expect(t.bus.promptText).toBe(`Enter an option ${OPTIONS}:`);
  });

  it('Ltype sets a loaded linetype; ? lists them', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'L']);
    expect(t.bus.promptText).toBe('Enter a loaded linetype name or [?] <Continuous>:');
    await t.bus.script(['?']);
    expect(t.log).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Continuous +Solid line$/),
        expect.stringMatching(/^DASHED +Solid line$/),
      ]),
    );
    expect(t.bus.promptText).toBe('Enter a loaded linetype name or [?] <Continuous>:');
    await t.bus.script(['dashed']);
    expect(t.bus.promptText).toBe('Enter name list of layer(s) for linetype "DASHED" <WALLS>:');
    await t.bus.script(['DOORS,NOTES']);
    expect(t.lay(DOORS).linetype).toBe(DASHED);
    expect(t.lay(NOTES).linetype).toBe(DASHED);
    await t.bus.script(['L', 'HIDDEN']);
    expect(t.log).toContain(
      'Linetype "HIDDEN" is not loaded.  Use the LINETYPE command to load it.',
    );
    await t.bus.script(['L', '', '']);
    expect(t.lay(WALLS).linetype).toBe(CONTINUOUS);
  });

  it('LWeight takes the nearest lineweight', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'LW']);
    expect(t.bus.promptText).toBe('Enter lineweight (0.0mm - 2.11mm):');
    await t.bus.script(['0.31']);
    expect(t.bus.promptText).toBe('Enter name list of layers(s) for lineweight 0.30mm <WALLS>:');
    await t.bus.script(['']);
    expect(t.lay(WALLS).lineweight).toBe(30);
    await t.bus.script(['LW', 'default', 'WALLS']);
    expect(t.lay(WALLS).lineweight).toBe('Default');
    await t.bus.script(['LW', 'thick']);
    expect(t.log).toContain('Invalid lineweight.');
  });

  it('TRansparency takes 0 to 90 percent', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'TR']);
    expect(t.bus.promptText).toBe('Enter transparency value (0-90):');
    await t.bus.script(['50']);
    expect(t.bus.promptText).toBe('Enter name list of layer(s) for transparency 50% <WALLS>:');
    await t.bus.script(['DOORS']);
    expect(t.lay(DOORS).transparency).toEqual({ alpha: 128 });
    await t.bus.script(['TR', '95']);
    expect(t.log).toContain('Value must be between 0 and 90.');
    expect(t.lay(DOORS).transparency).toEqual({ alpha: 128 });
  });

  it('Plot sets the plotting preference', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'P']);
    expect(t.bus.promptText).toBe('Enter a plotting preference [Plot/No plot] <Plot>:');
    await t.bus.script(['N']);
    expect(t.bus.promptText).toBe('Enter layer name(s) for this plot preference <WALLS>:');
    await t.bus.script(['DOORS,NOTES']);
    expect(t.states('plot')).toEqual([true, true, false, false]);
    await t.bus.script(['P', '', '*']);
    expect(t.states('plot')).toEqual([true, true, true, true]);
  });

  it('Description sets a description, asking before one is replaced', async () => {
    const t = setup({ layers: { [NOTES]: { description: 'Old notes' } } });
    await t.bus.script(['-LAYER', 'D']);
    expect(t.bus.promptText).toBe('Enter layer description:');
    await t.bus.script(['Door swings and frames']);
    expect(t.bus.promptText).toBe(
      'Enter name list of layer(s) to apply description or <select objects>:',
    );
    await t.bus.script(['DOORS']);
    expect(t.lay(DOORS).description).toBe('Door swings and frames');
    await t.bus.script(['D', 'Annotations', 'NOTES']);
    expect(t.bus.promptText).toBe(
      'Layer description already exists. Override existing description? <N>:',
    );
    await t.bus.script(['']);
    expect(t.lay(NOTES).description).toBe('Old notes');
    await t.bus.script(['D', 'Annotations', 'NOTES', 'Y']);
    expect(t.lay(NOTES).description).toBe('Annotations');
  });

  it('Enter at a prompt leaves the option, changing nothing', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'M', '', 'S', '', '']);
    expect(t.bus.promptText).toBe(`Enter an option ${OPTIONS}:`);
    await t.bus.script(['N', '', 'N', ' , ', 'R', '', 'R', 'DOORS', '']);
    await t.bus.script(['LW', '', 'TR', '', 'LW', 'ByLayer', 'D', '', '', '']);
    expect(t.log).toContain('Invalid lineweight.');
    await t.bus.script(['OFF', '', '', 'TR', 'x']);
    expect(t.log).toContain('Value must be between 0 and 90.');
    await t.bus.script(['M', 'walls', 'C', 'T', '1,2']);
    expect(t.log).toContain('Invalid color.');
    await t.bus.script(['C', 'CO', 'NO BOOK']);
    expect(t.log).toContain('Color book "NO BOOK" not found.');
    expect(t.bus.promptText).toBe(`Enter an option ${OPTIONS}:`);
    await t.bus.script(['']);
    expect(t.bus.prompt).toBeUndefined();
    expect(t.bus.undo.state.undoable).toBe(0);
    expect(t.states('on')).toEqual([true, true, true, true]);
    expect(t.byName('LAYER1')).toBeUndefined();
  });

  it('? names a colour book colour by book and name', async () => {
    const t = setup({
      layers: {
        [DOORS]: {
          color: { kind: 'rgb', r: 1, g: 2, b: 3, bookName: 'RAL CLASSIC', colorName: 'RAL 1000' },
        },
        [NOTES]: { color: { kind: 'aci', index: 30 }, lineweight: 25, plot: false },
      },
    });
    await t.bus.script(['-LAYER', '?', 'DOORS,NOTES']);
    expect(t.log).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^"DOORS" +On +RAL CLASSIC\$RAL 1000 +"Continuous"/),
        expect.stringMatching(/^"NOTES" +On +30 +"Continuous" +0\.25mm +0 +No plot$/),
      ]),
    );
  });

  it('PStyle sets a named plot style, offered only with named plot styles', async () => {
    const t = setup({ namedPlotStyles: true });
    await t.bus.script(['-LAYER']);
    expect(t.bus.promptText).toBe(`Enter an option ${NAMED_OPTIONS}:`);
    await t.bus.script(['PS']);
    expect(t.bus.promptText).toBe('Enter plot style or [?] <Normal>:');
    await t.bus.script(['?']);
    expect(t.bus.promptText).toBe('Enter plot style(s) to list <*>:');
    await t.bus.script(['h*']);
    expect(t.log.at(-1)).toBe('Heavy');
    await t.bus.script(['?', '']);
    expect(t.log.slice(-3)).toEqual(['Heavy', 'Light', 'Normal']);
    await t.bus.script(['heavy']);
    expect(t.bus.promptText).toBe('Enter name list of layer(s) for plot style current <WALLS>:');
    await t.bus.script(['DOORS,NOTES']);
    expect(t.lay(DOORS).plotStyle).toBe(HEAVY);
    expect(t.lay(NOTES).plotStyle).toBe(HEAVY);
    // Enter takes Normal, and the current layer.
    await t.bus.script(['PS', '', '']);
    expect(t.lay(WALLS).plotStyle).toBe(NORMAL);
    await t.bus.script(['PS', 'Missing']);
    expect(t.log.at(-1)).toBe('Cannot find plot style "Missing".');
    await t.bus.script(['']);
    expect(t.bus.undo.state.undoable).toBe(1);
    await t.bus.script(['U']);
    expect(t.lay(DOORS).plotStyle).toBeUndefined();

    // A colour-dependent drawing has no PStyle.
    const c = setup();
    await c.bus.script(['-LAYER', 'PS']);
    expect(c.bus.promptText).toBe(`Enter an option ${OPTIONS}:`);
  });

  it('an option that changes nothing is no undo step', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'ON', '*', '']);
    expect(t.bus.undo.state.undoable).toBe(0);
  });
});
