// M6-06: -PAGESETUP asks AutoCAD 2024's -PAGESETUP prompts ("-PAGESETUP (Command)"): -PLOT's
// detailed configuration without its layout, file and plot, each defaulting to the page setup of
// the space shown (the app's `plotSetup`), and the answers saved into that page setup (the app's
// `plotScript`, saving and not plotting) as the Page Setup dialog's OK saves them.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type PlotScriptSetup,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

const MODEL: PlotScriptSetup = {
  layout: 'Model',
  layouts: ['Model', 'Layout1'],
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
  pageSetups: [],
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
    hidePaperspace: false,
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
        if (r.op === 'plotSetup') return Promise.resolve({ ok: true, plotSetup: MODEL });
        return Promise.resolve({ ok: true });
      },
    },
  });
  return { bus, asked, model };
}

const scripts = (asked: readonly ViewRequest[]) =>
  asked.flatMap((r) => (r.op === 'plotScript' ? [r.script] : []));

describe('-PAGESETUP', () => {
  it('asks each setting of model space’s page setup and saves the answers without plotting', async () => {
    const { bus, asked, model } = setup();
    const version = model.version;
    await bus.submit('-PAGESETUP');
    const steps: [string, string][] = [
      ['Enter an output device name or [?] <Triya PDF (vector, to file)>:', 'svg'],
      ['Enter paper size or [?] <ISO A4 (210 x 297 mm)>:', 'ISO A1'],
      ['Enter paper units [Inches/Millimeters] <Millimeters>:', ''],
      ['Enter drawing orientation [Portrait/Landscape] <Landscape>:', 'P'],
      ['Plot upside down? [Yes/No] <No>:', ''],
      ['Enter plot area [Display/Extents/Limits/Window] <Display>:', 'E'],
      ['Enter plot scale (Plotted Millimeters=Drawing Units) or [Fit] <Fit>:', '1=50'],
      ['Enter plot offset (x,y) or [Center] <Center>:', ''],
      ['Plot with plot styles? [Yes/No] <Yes>:', ''],
      ['Enter plot style table name (enter . for none) or [?] <monochrome.ctb>:', ''],
      ['Plot with lineweights? [Yes/No] <Yes>:', ''],
      [
        'Enter shade plot setting [As displayed/legacy Wireframe/legacy Hidden/Visual styles/Rendered] <As displayed>:',
        '',
      ],
    ];
    for (const [prompt, typed] of steps) {
      expect(bus.promptText).toBe(prompt);
      await bus.submit(typed);
    }
    expect(bus.command).toBeUndefined();
    // The space shown, as the app answers it; no layout is asked.
    expect(asked.filter((r) => r.op === 'plotSetup')).toEqual([{ op: 'plotSetup' }]);
    expect(scripts(asked)).toEqual([
      {
        layout: 'Model',
        settings: {
          ...MODEL.settings,
          device: 'svg',
          paper: 'ISO A1',
          orientation: 'portrait',
          area: 'extents',
          fit: false,
          scale: { mm: 1, units: 50 },
        },
        file: 'plan-Model.svg',
        save: true,
        plot: false,
      },
    ]);
    expect(bus.history).toContain('Command: -PAGESETUP');
    // The app saves the page setup (its own undo step); the command itself edits nothing.
    expect(model.version).toBe(version);
  });

  it('asks a layout its own options, in its paper units', async () => {
    const { bus, asked } = setup((r) =>
      r.op === 'plotSetup' ? { ok: true, plotSetup: LAYOUT } : undefined,
    );
    await bus.submit('-PAGESETUP');
    const steps: [string, string][] = [
      ['Enter an output device name or [?] <Triya PDF (vector, to file)>:', ''],
      ['Enter paper size or [?] <ANSI full bleed B (17.00 x 11.00 Inches)>:', ''],
      ['Enter paper units [Inches/Millimeters] <Inches>:', ''],
      ['Enter drawing orientation [Portrait/Landscape] <Landscape>:', ''],
      ['Plot upside down? [Yes/No] <No>:', ''],
      ['Enter plot area [Extents/Layout/Window] <Layout>:', ''],
      ['Enter plot scale (Plotted Inches=Drawing Units) or [Fit] <1=1>:', '1=2'],
      ['Enter plot offset (x,y) or [Center] <0.00,0.00>:', ''],
      ['Plot with plot styles? [Yes/No] <Yes>:', ''],
      ['Enter plot style table name (enter . for none) or [?] <monochrome.ctb>:', '.'],
      ['Plot with lineweights? [Yes/No] <Yes>:', ''],
      ['Scale lineweights with plot scale? [Yes/No] <No>:', ''],
      ['Plot paper space first? [Yes/No] <No>:', 'Y'],
      ['Hide paperspace objects? [Yes/No] <No>:', ''],
    ];
    for (const [prompt, typed] of steps) {
      expect(bus.promptText).toBe(prompt);
      await bus.submit(typed);
    }
    expect(bus.command).toBeUndefined();
    expect(scripts(asked)).toEqual([
      {
        layout: 'Layout1',
        settings: {
          ...LAYOUT.settings,
          scale: { mm: 25.4, units: 2 },
          table: '',
          paperspaceLast: false,
        },
        file: 'plan-Layout1.pdf',
        save: true,
        plot: false,
      },
    ]);
  });

  it('saves nothing when a prompt is cancelled', async () => {
    const { bus, asked } = setup();
    await bus.submit('-PAGESETUP');
    await bus.submit('');
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    expect(scripts(asked)).toEqual([]);
  });

  it('says so where the space shown has no page setup to save, and asks nothing', async () => {
    const { bus, asked } = setup((r) =>
      r.op === 'plotSetup' ? { ok: true, plotSetup: { ...MODEL, canSave: false } } : undefined,
    );
    await bus.submit('-PAGESETUP');
    expect(bus.command).toBeUndefined();
    expect(bus.history.at(-1)).toBe('Model has no page setup to change.');
    expect(scripts(asked)).toEqual([]);
  });

  it('reports what the app could not save, and ends where it has nothing to set up', async () => {
    const refused = setup((r) =>
      r.op === 'plotScript'
        ? { ok: false, message: 'The plot scale must be positive.' }
        : undefined,
    );
    await refused.bus.submit('-PAGESETUP');
    for (let i = 0; i < 12; i++) await refused.bus.submit('');
    expect(refused.bus.command).toBeUndefined();
    expect(refused.bus.history.at(-1)).toBe('The plot scale must be positive.');

    const none = setup((r) =>
      r.op === 'plotSetup' ? { ok: false, message: 'There is nothing to plot.' } : undefined,
    );
    await none.bus.submit('-PAGESETUP');
    expect(none.bus.command).toBeUndefined();
    expect(none.bus.history.at(-1)).toBe('There is nothing to plot.');
  });

  it('PAGESETUP without the dash still opens the Page Setup Manager', async () => {
    const { bus, asked } = setup();
    await bus.submit('PAGESETUP');
    expect(asked).toEqual([{ op: 'file', action: 'pagesetup' }]);
  });
});
