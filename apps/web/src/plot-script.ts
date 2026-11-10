// -PLOT (M2-17 part 5): what the command line's plot is made of. The engine asks the prompts; the
// app answers what each defaults to (the settings the Plot dialog opens on for the space, its page
// setup) and what each takes (the plotters, papers, plot areas and plot style tables the dialog
// lists), and turns the answers back into the dialog's settings to plot with.
//
// The papers are named as the command line types them: the page setup's own first, by its media
// name as AutoCAD shows it (DXF 4 with spaces for underscores, "ANSI full bleed B (17.00 x 11.00
// Inches)"), then the dialog's list with their sizes in millimetres ("ISO A1 (594 x 841 mm)");
// -PLOT takes either whole or the part before the bracket.
import type { PlotScriptChoice, PlotScriptSettings, PlotScriptSetup } from '@triya/engine';
import { PAPER_SIZES } from '@triya/pdf';
import {
  LAYOUT_PAPER,
  PLOT_DEVICES,
  defaultPlotSettings,
  ownPaper,
  plotAreas,
  plotFileName,
  plotStyleTables,
  type PlotSettings,
  type PlotSpace,
} from './plot';

const mm = (v: number) => Math.round(v * 10) / 10;

/** The papers -PLOT takes for a space: the page setup's own, then the dialog's list. */
export function scriptPapers(space: PlotSpace): PlotScriptChoice[] {
  const out: PlotScriptChoice[] = [];
  const own = ownPaper(space);
  if (own) {
    const media = space.pageSetup?.plot?.paperSize.replace(/_/g, ' ').trim();
    // A media name says its own size; another is given it.
    const name =
      media && /\(.*\)$/.test(media)
        ? media
        : `${media || `${space.sheet ? 'Layout' : 'Page setup'} paper`} (${mm(own.width)} x ${mm(own.height)} mm)`;
    out.push({ id: LAYOUT_PAPER, name });
  }
  for (const p of PAPER_SIZES)
    out.push({ id: p.name, name: `${p.name} (${p.width} x ${p.height} mm)` });
  return out;
}

/** What `plotSetup` answers for a space: the dialog's settings for it and its lists. */
export function scriptSetup(
  space: PlotSpace,
  drawing: string,
  layouts: readonly string[],
): PlotScriptSetup {
  const s = defaultPlotSettings(space);
  const { dpi: _dpi, background: _background, ...settings } = s;
  return {
    layout: space.name,
    layouts,
    devices: PLOT_DEVICES.map(({ id, name }) => ({ id, name })),
    papers: scriptPapers(space),
    areas: plotAreas(space),
    tables: plotStyleTables(space),
    inches: space.inches === true,
    paper: space.sheet !== undefined,
    canSave: space.pageSetup?.layout !== undefined && space.pageSetup.plot !== undefined,
    file: plotFileName(drawing, space, s.device),
    settings,
  };
}

/** The dialog's settings -PLOT's answers make (the PNG plotter's resolution and sheet its own). */
export function scriptSettings(space: PlotSpace, answers: PlotScriptSettings): PlotSettings {
  const device = PLOT_DEVICES.find((d) => d.id === answers.device)?.id;
  if (!device) throw new Error(`Output device "${answers.device}" not found.`);
  return { ...defaultPlotSettings(space), ...answers, device };
}
