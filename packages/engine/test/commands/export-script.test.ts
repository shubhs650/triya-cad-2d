// M2-39 part 5: -EXPORT asks AutoCAD 2024's -EXPORT prompts ("-EXPORT (Command)": "Enter file
// format", "Enter plot area", "Detailed plot configuration?", the file name) with Triya's formats
// (PDF, SVG, PNG and DXF, as Export Data lists them), and hands what they make to the app
// (`exportScript`), which writes the file as the Export Data dialog's Save does.
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
    { id: 'png', name: 'Triya PNG (raster, to file)' },
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
  drawing: 'plan.dxf',
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
  },
};

const LAYOUT: PlotScriptSetup = {
  ...MODEL,
  layout: 'Layout1',
  papers: [{ id: 'layout', name: 'Layout paper (420 x 297 mm)' }, ...MODEL.papers],
  areas: ['layout', 'extents', 'window'],
  paper: true,
  file: 'plan-Layout1.pdf',
  settings: { ...MODEL.settings, paper: 'layout', area: 'layout', fit: false, center: false },
};

function setup(shown: PlotScriptSetup = MODEL, answer?: (r: ViewRequest) => ViewReply | undefined) {
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
        if (r.op === 'plotSetup') return Promise.resolve({ ok: true, plotSetup: shown });
        return Promise.resolve({ ok: true });
      },
    },
  });
  return { bus, asked, model };
}

const scripts = (asked: readonly ViewRequest[]) =>
  asked.flatMap((r) => (r.op === 'exportScript' ? [r.script] : []));

async function answer(bus: PromptBus, ...answers: string[]) {
  for (const a of answers) await bus.submit(a);
}

describe('-EXPORT', () => {
  it('exports the Display of model space to a PDF when every prompt takes its default', async () => {
    const { bus, asked, model } = setup();
    const version = model.version;
    await bus.submit('-EXPORT');
    expect(bus.promptText).toBe('Enter file format [Pdf/Svg/pNg/Dxf] <Pdf>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Enter plot area [Display/Extents/Window] <Display>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Detailed plot configuration? [Yes/No] <No>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Enter file name <plan-Model.pdf>:');
    await bus.submit('');
    expect(bus.command).toBeUndefined();
    expect(scripts(asked)).toEqual([{ type: 'pdf', area: 'display', file: 'plan-Model.pdf' }]);
    expect(model.version).toBe(version);
    expect(bus.undo.state.undoable).toBe(0);
  });

  it('opens the Export Data dialog without the dash', async () => {
    const { bus, asked } = setup();
    await bus.submit('EXPORT');
    expect(asked[0]).toEqual({ op: 'file', action: 'export' });
  });

  it('exports a window picked at the command line to a PNG', async () => {
    const { bus, asked } = setup();
    await answer(bus, '-EXPORT', 'N', 'W');
    expect(bus.promptText).toBe('Specify first corner:');
    await bus.submit('10,20');
    expect(bus.promptText).toBe('Specify opposite corner:');
    await answer(bus, '0,5', '', 'shot');
    expect(bus.history).toContain('Enter file name <plan-Model.png>: shot');
    expect(scripts(asked)).toEqual([
      {
        type: 'png',
        area: 'window',
        window: { minX: 0, minY: 5, maxX: 10, maxY: 20 },
        file: 'shot.png',
      },
    ]);
  });

  it('offers Extents first when there is no Display', async () => {
    const { bus } = setup({ ...MODEL, areas: ['extents', 'limits', 'window'] });
    await answer(bus, '-EXPORT', 'S');
    expect(bus.promptText).toBe('Enter plot area [Extents/Window] <Extents>:');
  });

  it('exports a layout, or all layouts in one PDF or one ZIP, without the detailed questions', async () => {
    const { bus, asked } = setup(LAYOUT);
    await answer(bus, '-EXPORT', '');
    expect(bus.promptText).toBe('Enter plot area [Current layout/All layouts] <Current layout>:');
    await answer(bus, '', '', '');
    await answer(bus, '-EXPORT', 'P', 'A');
    expect(bus.promptText).toBe('Enter file name <plan.pdf>:');
    await bus.submit('');
    await answer(bus, '-EXPORT', 'S', 'A', '');
    expect(scripts(asked)).toEqual([
      { type: 'pdf', area: 'current', file: 'plan-Layout1.pdf' },
      { type: 'pdf', area: 'all', file: 'plan.pdf' },
      { type: 'svg', area: 'all', file: 'plan.zip' },
    ]);
  });

  it('asks every plot setting but the area for a detailed plot configuration', async () => {
    const { bus, asked } = setup();
    await answer(bus, '-EXPORT', '', 'E', 'Y');
    expect(bus.promptText).toBe('Enter paper size or [?] <ISO A4 (210 x 297 mm)>:');
    await answer(bus, 'ISO A1', '', 'Portrait', '');
    // The area was asked already: the scale follows "Plot upside down?".
    expect(bus.promptText).toBe(
      'Enter plot scale (Plotted Millimeters=Drawing Units) or [Fit] <Fit>:',
    );
    await answer(bus, '1=50', '', '', '', '', '');
    expect(bus.promptText).toBe('Enter file name <plan-Model.pdf>:');
    await bus.submit('');
    expect(scripts(asked)).toEqual([
      {
        type: 'pdf',
        area: 'extents',
        file: 'plan-Model.pdf',
        settings: {
          ...MODEL.settings,
          paper: 'ISO A1',
          orientation: 'portrait',
          area: 'extents',
          fit: false,
          scale: { mm: 1, units: 50 },
        },
      },
    ]);
  });

  it('exports the drawing as a DXF by name', async () => {
    const { bus, asked } = setup();
    await answer(bus, '-EXPORT', 'D');
    expect(bus.promptText).toBe('Enter file name <plan.dxf>:');
    await bus.submit('copy');
    expect(scripts(asked)).toEqual([{ type: 'dxf', file: 'copy.dxf' }]);
  });

  it('reports what the app could not write', async () => {
    const { bus } = setup(MODEL, (r) =>
      r.op === 'exportScript' ? { ok: false, message: 'There is nothing to export.' } : undefined,
    );
    await answer(bus, '-EXPORT', '', '', '', '');
    expect(bus.history).toContain('There is nothing to export.');
  });

  it('ends at Esc and exports nothing', async () => {
    const { bus, asked } = setup();
    await answer(bus, '-EXPORT', '');
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    expect(scripts(asked)).toEqual([]);
  });

  it('asks a layout’s detailed configuration with its page setup’s own area', async () => {
    const { bus, asked } = setup(LAYOUT);
    await answer(bus, '-EXPORT', '', '', 'Y');
    expect(bus.promptText).toBe('Enter paper size or [?] <Layout paper (420 x 297 mm)>:');
    // Paper, units, orientation, upside down, scale, offset, plot styles, table, lineweights,
    // then a layout's three plot options.
    await answer(bus, '', '', '', '', '', '', '', '', '', '', '', '');
    expect(bus.promptText).toBe('Enter file name <plan-Layout1.pdf>:');
    await bus.submit('sheet.PDF');
    expect(scripts(asked)).toEqual([
      {
        type: 'pdf',
        area: 'current',
        file: 'sheet.PDF',
        settings: { ...LAYOUT.settings, area: 'layout' },
      },
    ]);
  });

  it('names the files after the plot file when the app gives no drawing name', async () => {
    const { drawing: _drawing, ...bare } = MODEL;
    const { bus, asked } = setup(bare);
    await answer(bus, '-EXPORT', 'D');
    expect(bus.promptText).toBe('Enter file name <plan.dxf>:');
    await bus.submit('');
    expect(scripts(asked)).toEqual([{ type: 'dxf', file: 'plan.dxf' }]);
  });

  it('refuses a window without area', async () => {
    const { bus, asked } = setup();
    await answer(bus, '-EXPORT', '', 'W', '5,5', '5,9');
    expect(bus.history).toContain('The window has no area.');
    expect(bus.command).toBeUndefined();
    expect(scripts(asked)).toEqual([]);
  });

  it('exports nothing when the drafter stops at any prompt', async () => {
    for (const typed of [
      ['-EXPORT'],
      ['-EXPORT', ''],
      ['-EXPORT', 'D'],
      ['-EXPORT', '', ''],
      ['-EXPORT', '', 'W'],
      ['-EXPORT', '', 'W', '0,0'],
      ['-EXPORT', '', 'E'],
      ['-EXPORT', '', 'E', 'Y'],
      ['-EXPORT', '', 'E', ''],
    ]) {
      const { bus, asked } = setup();
      await answer(bus, ...typed);
      await bus.cancel();
      expect(bus.command, typed.join(' ')).toBeUndefined();
      expect(scripts(asked)).toEqual([]);
    }
  });

  it('ends when the app has nothing to export', async () => {
    const { bus, asked } = setup(MODEL, (r) => (r.op === 'plotSetup' ? { ok: true } : undefined));
    await answer(bus, '-EXPORT', '');
    expect(bus.history).toContain('There is nothing to plot.');
    expect(bus.command).toBeUndefined();
    expect(scripts(asked)).toEqual([]);
  });

  it('takes every kind of answer in the detailed configuration, asking again after a bad one', async () => {
    const portrait: PlotScriptSetup = {
      ...MODEL,
      settings: { ...MODEL.settings, orientation: 'portrait', fit: false, center: false },
    };
    const { bus, asked } = setup(portrait);
    await answer(bus, '-EXPORT', 'S', 'E', 'Y');
    const steps: [string, string][] = [
      ['Enter paper size or [?] <ISO A4 (210 x 297 mm)>:', 'Nope'],
      ['Enter paper size or [?] <ISO A4 (210 x 297 mm)>:', 'ISO A1 (594 x 841 mm)'],
      ['Enter paper units [Inches/Millimeters] <Millimeters>:', 'I'],
      ['Enter drawing orientation [Portrait/Landscape] <Portrait>:', ''],
      ['Plot upside down? [Yes/No] <No>:', 'Y'],
      ['Enter plot scale (Plotted Inches=Drawing Units) or [Fit] <0.03937=1>:', 'F'],
      ['Enter plot offset (x,y) or [Center] <0.00,0.00>:', 'here'],
      ['Enter plot offset (x,y) or [Center] <0.00,0.00>:', 'C'],
      ['Plot with plot styles? [Yes/No] <Yes>:', 'N'],
      ['Enter plot style table name (enter . for none) or [?] <monochrome.ctb>:', '?'],
      ['Enter plot style table name (enter . for none) or [?] <monochrome.ctb>:', '.'],
      ['Plot with lineweights? [Yes/No] <Yes>:', 'N'],
      [
        'Enter shade plot setting [As displayed/legacy Wireframe/legacy Hidden/Visual styles/Rendered] <As displayed>:',
        '',
      ],
      ['Enter file name <plan-Model.svg>:', ''],
    ];
    for (const [prompt, typed] of steps) {
      expect(bus.promptText).toBe(prompt);
      await bus.submit(typed);
    }
    expect(bus.history).toContain('Paper size "Nope" not found.');
    expect(bus.history).toContain('Requires an offset as x,y, or Center.');
    expect(bus.history.slice(-8)).toContain('acad.ctb');
    expect(scripts(asked)).toEqual([
      {
        type: 'svg',
        area: 'extents',
        file: 'plan-Model.svg',
        settings: {
          ...portrait.settings,
          device: 'svg',
          paper: 'ISO A1',
          upsideDown: true,
          area: 'extents',
          fit: true,
          center: true,
          plotStyles: false,
          table: '',
          lineweights: false,
        },
      },
    ]);
  });

  it('names a drawing without a name Drawing1', async () => {
    const { bus } = setup({ ...MODEL, drawing: '.dxf' });
    await answer(bus, '-EXPORT', 'D');
    expect(bus.promptText).toBe('Enter file name <Drawing1.dxf>:');
  });
});
