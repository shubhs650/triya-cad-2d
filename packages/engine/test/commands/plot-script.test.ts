// M2-17 part 5: -PLOT asks AutoCAD 2024's -PLOT prompts ("-PLOT (Command)"), each defaulting to
// what the Plot dialog opens on for the space (the app's `plotSetup`), and hands what they make
// to the app (`plotScript`), which plots it without the dialog.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type PlotScriptSetup,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { parsePlotOffset, parsePlotScale } from '../../src/commands/plot-script';
import { sampleInit } from '../model/fixtures';

const MODEL: PlotScriptSetup = {
  layout: 'Model',
  layouts: ['Model', 'Layout1', 'Sheet 2'],
  devices: [
    { id: 'pdf', name: 'Triya PDF (vector, to file)' },
    { id: 'svg', name: 'Triya SVG (vector, to file)' },
  ],
  papers: [
    { id: 'ISO A4', name: 'ISO A4 (210 x 297 mm)' },
    { id: 'ISO A1', name: 'ISO A1 (594 x 841 mm)' },
  ],
  areas: ['extents', 'display', 'limits', 'window'],
  tables: ['acad.ctb', 'monochrome.ctb'],
  inches: false,
  paper: false,
  canSave: true,
  file: 'plan-Model.pdf',
  pageSetups: ['Model A1 Fit', 'Model ANSI B 1:2'],
  settings: {
    device: 'pdf',
    paper: 'ISO A4',
    orientation: 'landscape',
    upsideDown: false,
    area: 'display',
    fit: true,
    scale: { mm: 1, units: 1 },
    center: true,
    offset: { x: 0, y: 0 },
    plotStyles: true,
    table: 'monochrome.ctb',
    lineweights: true,
    scaleLineweights: false,
    paperspaceLast: false,
  },
};

const LAYOUT: PlotScriptSetup = {
  ...MODEL,
  layout: 'Layout1',
  papers: [{ id: 'layout', name: 'ANSI full bleed B (17.00 x 11.00 Inches)' }, ...MODEL.papers],
  areas: ['layout', 'extents', 'window'],
  inches: true,
  paper: true,
  file: 'plan-Layout1.pdf',
  settings: {
    ...MODEL.settings,
    paper: 'layout',
    area: 'layout',
    fit: false,
    scale: { mm: 25.4, units: 1 },
    center: false,
    offset: { x: 0, y: 0 },
    paperspaceLast: true,
  },
};

function setup(answer?: (r: ViewRequest) => ViewReply | undefined) {
  const asked: ViewRequest[] = [];
  const model = DocumentModel.create(sampleInit());
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r) => {
        asked.push(r);
        const given = answer?.(r);
        if (given) return Promise.resolve(given);
        if (r.op === 'plotSetup') {
          return Promise.resolve({ ok: true, plotSetup: r.layout === 'Layout1' ? LAYOUT : MODEL });
        }
        return Promise.resolve({ ok: true });
      },
    },
  });
  return { bus, asked, model };
}

const scripts = (asked: readonly ViewRequest[]) =>
  asked.flatMap((r) => (r.op === 'plotScript' ? [r.script] : []));

async function answer(bus: PromptBus, ...answers: string[]) {
  for (const a of answers) await bus.submit(a);
}

describe('-PLOT', () => {
  it('plots the space shown with its page setup when every prompt takes its default', async () => {
    const { bus, asked, model } = setup();
    const version = model.version;
    await bus.submit('-PLOT');
    expect(bus.promptText).toBe('Detailed plot configuration? [Yes/No] <No>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Enter a layout name or [?] <Model>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Enter a page setup name <>:');
    await bus.submit('');
    expect(bus.promptText).toBe(
      'Enter an output device name or [?] <Triya PDF (vector, to file)>:',
    );
    await bus.submit('');
    expect(bus.promptText).toBe('Enter file name <plan-Model.pdf>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Save changes to page setup? [Yes/No] <No>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Proceed with plot? [Yes/No] <Yes>:');
    await bus.submit('');
    expect(bus.command).toBeUndefined();
    expect(asked.filter((r) => r.op === 'plotSetup')).toEqual([{ op: 'plotSetup' }]);
    expect(scripts(asked)).toEqual([
      {
        layout: 'Model',
        settings: MODEL.settings,
        file: 'plan-Model.pdf',
        save: false,
        plot: true,
      },
    ]);
    expect(bus.history).toContain('Command: -PLOT');
    expect(model.version).toBe(version);
    expect(bus.undo.state.undoable).toBe(0);
  });

  it('lists the layouts at ?, refuses one the drawing lacks and asks for the one named', async () => {
    const { bus, asked } = setup();
    await answer(bus, '-PLOT', 'N', '?');
    expect(bus.history.slice(-3)).toEqual(['Model', 'Layout1', 'Sheet 2']);
    await answer(bus, 'Nowhere');
    expect(bus.history).toContain('Layout "Nowhere" not found.');
    await answer(bus, 'layout1');
    expect(asked.at(-1)).toEqual({ op: 'plotSetup', layout: 'Layout1' });
    await answer(bus, '', 'svg', 'sheet.svg', 'Y', '');
    expect(scripts(asked)).toEqual([
      {
        layout: 'Layout1',
        settings: { ...LAYOUT.settings, device: 'svg' },
        file: 'sheet.svg',
        save: true,
        plot: true,
      },
    ]);
  });

  it('takes a device by its full name, its short name or its id; the file gets its extension', async () => {
    const { bus, asked } = setup();
    await answer(bus, '-PLOT', '', '', '', 'Triya SVG', 'out', 'N', 'Y');
    expect(bus.history).toContain('Enter file name <plan-Model.svg>: out');
    expect(scripts(asked)[0]).toMatchObject({ settings: { device: 'svg' }, file: 'out.svg' });
  });

  it('refuses a page setup the space lacks and asks again', async () => {
    const { bus } = setup();
    await answer(bus, '-PLOT', '', '', 'Setup A');
    expect(bus.history).toContain('Page setup "Setup A" not found.');
    expect(bus.promptText).toBe('Enter a page setup name <>:');
  });

  // Part 6: a named page setup (ACAD_PLOTSETTINGS) gives the defaults that follow.
  it('plots with a named page setup, case aside, its settings the defaults', async () => {
    const A1: PlotScriptSetup = {
      ...MODEL,
      pageSetup: 'Model A1 Fit',
      file: 'plan-Model.pdf',
      settings: { ...MODEL.settings, paper: 'ISO A1', area: 'extents', table: 'acad.ctb' },
    };
    const { bus, asked } = setup((r) =>
      r.op === 'plotSetup' && r.pageSetup === 'Model A1 Fit'
        ? { ok: true, plotSetup: A1 }
        : undefined,
    );
    await answer(bus, '-PLOT', '', '', 'model a1 fit');
    expect(asked.at(-1)).toEqual({ op: 'plotSetup', layout: 'Model', pageSetup: 'Model A1 Fit' });
    await answer(bus, '', '', 'N', '');
    expect(scripts(asked)).toEqual([
      {
        layout: 'Model',
        pageSetup: 'Model A1 Fit',
        settings: A1.settings,
        file: 'plan-Model.pdf',
        save: false,
        plot: true,
      },
    ]);
  });

  // M2-45: a layout with a named page setup applied (its DXF 1) offers that name; Enter takes the
  // layout's page setup as it is, still under that name, and another name still loads its own.
  it('offers the page setup the layout has applied, Enter keeping its own settings', async () => {
    const applied: PlotScriptSetup = {
      ...LAYOUT,
      pageSetups: ['A3 Monochrome'],
      pageSetup: 'A3 Monochrome',
    };
    const named: PlotScriptSetup = {
      ...LAYOUT,
      pageSetup: 'A3 Monochrome',
      settings: { ...LAYOUT.settings, table: 'monochrome.ctb' },
    };
    const { bus, asked } = setup((r) =>
      r.op === 'plotSetup' && r.layout === 'Layout1'
        ? { ok: true, plotSetup: r.pageSetup === undefined ? applied : named }
        : undefined,
    );
    await answer(bus, '-PLOT', '', 'Layout1');
    expect(bus.promptText).toBe('Enter a page setup name <A3 Monochrome>:');
    await answer(bus, '');
    expect(asked.filter((r) => r.op === 'plotSetup')).toEqual([
      { op: 'plotSetup' },
      { op: 'plotSetup', layout: 'Layout1' },
    ]);
    await answer(bus, '', '', 'Y', '');
    expect(scripts(asked)).toEqual([
      {
        layout: 'Layout1',
        settings: applied.settings,
        file: LAYOUT.file,
        save: true,
        plot: true,
      },
    ]);

    // Typed again (in any case), the named page setup's own settings.
    const again = setup((r) =>
      r.op === 'plotSetup' && r.layout === 'Layout1'
        ? { ok: true, plotSetup: r.pageSetup === undefined ? applied : named }
        : undefined,
    );
    await answer(again.bus, '-PLOT', '', 'Layout1', 'a3 monochrome', '', '', 'N', '');
    expect(scripts(again.asked)[0]).toMatchObject({
      pageSetup: 'A3 Monochrome',
      settings: named.settings,
    });
  });

  it('plots nothing when the drafter does not proceed and keeps nothing', async () => {
    const { bus, asked } = setup();
    await answer(bus, '-PLOT', '', '', '', '', '', 'N', 'N');
    expect(bus.command).toBeUndefined();
    expect(scripts(asked)).toEqual([]);
  });

  it('asks every setting of a model space plot in the detailed configuration', async () => {
    const { bus, asked } = setup();
    await answer(bus, '-PLOT', 'Y', '');
    // No page setup name in the detailed configuration.
    expect(bus.promptText).toBe(
      'Enter an output device name or [?] <Triya PDF (vector, to file)>:',
    );
    const prompts: string[] = [];
    const steps: [string, string][] = [
      ['Enter an output device name or [?] <Triya PDF (vector, to file)>:', ''],
      ['Enter paper size or [?] <ISO A4 (210 x 297 mm)>:', 'iso a1'],
      ['Enter paper units [Inches/Millimeters] <Millimeters>:', ''],
      ['Enter drawing orientation [Portrait/Landscape] <Landscape>:', 'P'],
      ['Plot upside down? [Yes/No] <No>:', 'Y'],
      ['Enter plot area [Display/Extents/Limits/Window] <Display>:', 'W'],
      ['Enter lower left corner of window <0.0000,0.0000>:', '10,20'],
      ['Enter upper right corner of window <0.0000,0.0000>:', '410,320'],
      ['Enter plot scale (Plotted Millimeters=Drawing Units) or [Fit] <Fit>:', '2'],
      ['Enter plot scale (Plotted Millimeters=Drawing Units) or [Fit] <Fit>:', '1:2'],
      ['Enter plot offset (x,y) or [Center] <Center>:', '5,7.5'],
      ['Plot with plot styles? [Yes/No] <Yes>:', ''],
      ['Enter plot style table name (enter . for none) or [?] <monochrome.ctb>:', 'nope.ctb'],
      ['Enter plot style table name (enter . for none) or [?] <monochrome.ctb>:', 'ACAD.CTB'],
      ['Plot with lineweights? [Yes/No] <Yes>:', 'N'],
      [
        'Enter shade plot setting [As displayed/legacy Wireframe/legacy Hidden/Visual styles/Rendered] <As displayed>:',
        'H',
      ],
      ['Enter file name <plan-Model.pdf>:', ''],
      ['Save changes to page setup? [Yes/No] <No>:', ''],
      ['Proceed with plot? [Yes/No] <Yes>:', ''],
    ];
    for (const [prompt, typed] of steps) {
      prompts.push(bus.promptText);
      expect(bus.promptText).toBe(prompt);
      await bus.submit(typed);
    }
    expect(bus.history).toContain(
      'Requires a scale as plotted units=drawing units, such as 1=100, or Fit.',
    );
    expect(bus.history).toContain('Plot style table "nope.ctb" not found.');
    expect(scripts(asked)).toEqual([
      {
        layout: 'Model',
        settings: {
          ...MODEL.settings,
          paper: 'ISO A1',
          orientation: 'portrait',
          upsideDown: true,
          area: 'window',
          window: { minX: 10, minY: 20, maxX: 410, maxY: 320 },
          fit: false,
          scale: { mm: 1, units: 2 },
          center: false,
          offset: { x: 5, y: 7.5 },
          table: 'acad.ctb',
          lineweights: false,
        },
        file: 'plan-Model.pdf',
        save: false,
        plot: true,
      },
    ]);
  });

  it('offers the page setup’s window as the corners’ defaults, and refuses one without area', async () => {
    const window = { minX: 1, minY: 2, maxX: 30, maxY: 40 };
    const shown: PlotScriptSetup = {
      ...MODEL,
      areas: ['extents', 'window'],
      settings: { ...MODEL.settings, area: 'layout', window },
    };
    const { bus, asked } = setup((r) =>
      r.op === 'plotSetup' ? { ok: true, plotSetup: shown } : undefined,
    );
    await answer(bus, '-PLOT', 'Y', '', '', '', '', '', '');
    // The page setup's area is not offered here: the first one offered is the default.
    expect(bus.promptText).toBe('Enter plot area [Extents/Window] <Extents>:');
    await bus.submit('W');
    expect(bus.promptText).toBe('Enter lower left corner of window <1.0000,2.0000>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Enter upper right corner of window <30.0000,40.0000>:');
    await bus.submit('1,9');
    expect(bus.history).toContain('The window has no area.');
    expect(bus.command).toBeUndefined();
    expect(scripts(asked)).toEqual([]);
  });

  it('asks a layout its own options, in the page setup units', async () => {
    const { bus, asked } = setup();
    await answer(bus, '-PLOT', 'Y', 'Layout1', '');
    const steps: [string, string][] = [
      ['Enter paper size or [?] <ANSI full bleed B (17.00 x 11.00 Inches)>:', ''],
      ['Enter paper units [Inches/Millimeters] <Inches>:', ''],
      ['Enter drawing orientation [Portrait/Landscape] <Landscape>:', ''],
      ['Plot upside down? [Yes/No] <No>:', ''],
      ['Enter plot area [Extents/Layout/Window] <Layout>:', ''],
      ['Enter plot scale (Plotted Inches=Drawing Units) or [Fit] <1=1>:', '1=48'],
      ['Enter plot offset (x,y) or [Center] <0.00,0.00>:', '0.5,0.25'],
      ['Plot with plot styles? [Yes/No] <Yes>:', ''],
      ['Enter plot style table name (enter . for none) or [?] <monochrome.ctb>:', '.'],
      ['Plot with lineweights? [Yes/No] <Yes>:', ''],
      ['Scale lineweights with plot scale? [Yes/No] <No>:', 'Y'],
      // Flag 512 (paperspace last) is set, so paper space is not plotted first.
      ['Plot paper space first? [Yes/No] <No>:', 'Y'],
      ['Hide paperspace objects? [Yes/No] <No>:', ''],
      ['Enter file name <plan-Layout1.pdf>:', ''],
      ['Save changes to page setup? [Yes/No] <No>:', ''],
      ['Proceed with plot? [Yes/No] <Yes>:', ''],
    ];
    for (const [prompt, typed] of steps) {
      expect(bus.promptText).toBe(prompt);
      await bus.submit(typed);
    }
    const [script] = scripts(asked);
    expect(script?.settings).toEqual({
      ...LAYOUT.settings,
      scale: { mm: 25.4, units: 48 },
      offset: { x: 12.7, y: 6.35 },
      table: '',
      scaleLineweights: true,
      paperspaceLast: false,
    });
  });

  it('ends when the app has nothing to plot, and reports what the app could not do', async () => {
    const none = setup((r) =>
      r.op === 'plotSetup' ? { ok: false, message: 'There is nothing to plot.' } : undefined,
    );
    await answer(none.bus, '-PLOT', '');
    expect(none.bus.command).toBeUndefined();
    expect(none.bus.history.at(-1)).toBe('There is nothing to plot.');

    const refused = setup((r) =>
      r.op === 'plotScript'
        ? { ok: false, message: 'The plot scale must be positive.' }
        : undefined,
    );
    await answer(refused.bus, '-PLOT', '', '', '', '', '', '', '');
    expect(refused.bus.command).toBeUndefined();
    expect(refused.bus.history.at(-1)).toBe('The plot scale must be positive.');
  });

  it('PLOT without the dash still opens the dialog', async () => {
    const { bus, asked } = setup();
    await bus.submit('PLOT');
    expect(asked).toEqual([{ op: 'file', action: 'plot' }]);
  });
});

describe('-PLOT answers', () => {
  it('reads a scale as plotted units=drawing units', () => {
    expect(parsePlotScale('1=100')).toEqual({ plotted: 1, units: 100 });
    expect(parsePlotScale(' 2 : 1 ')).toEqual({ plotted: 2, units: 1 });
    expect(parsePlotScale('0.25=12')).toEqual({ plotted: 0.25, units: 12 });
    expect(parsePlotScale('1=0')).toBeUndefined();
    expect(parsePlotScale('100')).toBeUndefined();
    expect(parsePlotScale('a=b')).toBeUndefined();
  });

  it('reads an offset as x,y', () => {
    expect(parsePlotOffset('0.5,-1')).toEqual({ x: 0.5, y: -1 });
    expect(parsePlotOffset('1')).toBeUndefined();
  });
});
