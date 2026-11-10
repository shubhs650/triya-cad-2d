// The plot preview (M2-18 part 2; PREVIEW, the Plot dialog's Preview…, the status bar's plot
// preview toggle; PRD FR-P3/FR-P4, UI_SPEC.md §6): the sheet exactly as the plot would come out,
// in the drawing area. AutoCAD 2024 Help, "PREVIEW": "Displays the drawing as it will be
// plotted"; the preview is drawn from the plot itself, so what it shows is what is written.
//
// What it draws is the PDF the Plot dialog writes with the same settings (`previewOf`), drawn by
// pdf.js (the app's own copy, as PDF underlays use): the preview pixel-matches the rasterised PDF,
// including the plot style table on white and the PDF underlays' own content, rather than a
// second drawing of the plot that could drift from it. SVG and PNG plots are the same plot.
//
// The settings: PREVIEW and the status bar toggle preview the space shown with the settings it
// was last plotted or previewed with in this session, else the Plot dialog's defaults (AutoCAD
// previews with the layout's page setup, which a plot updates; Triya keeps no page setups yet,
// M2-17 part 3). The Plot dialog's Preview… previews its own settings and returns to the dialog.
import type { Box } from '@triya/engine';
import type { PlotPart, PlotRequest, PlotSetup } from '@triya/render';
import {
  defaultPlotSettings,
  plotPage,
  plotPdf,
  plotTable,
  type PlotSettings,
  type PlotSpace,
} from './plot';

/** A preview to show: a one-page plot PDF of `paper` millimetres (as turned). */
export interface PreviewRequest {
  readonly doc: number;
  /** The plot's title: the drawing and the space. */
  readonly title: string;
  readonly pdf: Uint8Array;
  readonly paper: { readonly width: number; readonly height: number };
  /** The preview's Plot button: writes the plot (and closes the dialog it came from). */
  readonly plot?: () => Promise<void>;
}

/** The preview shown, if any; `show` answers when it closes. */
export const previewMode = (() => {
  let shown: PreviewRequest | undefined;
  let done: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (v: PreviewRequest | undefined) => {
    shown = v;
    for (const l of listeners) l();
  };
  const finish = () => {
    const d = done;
    done = undefined;
    d?.();
  };
  return {
    get: () => shown,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    show(request: PreviewRequest): Promise<void> {
      finish();
      set(request);
      return new Promise((resolve) => (done = resolve));
    },
    close() {
      if (!shown) return;
      set(undefined);
      finish();
    },
    /** The Plot button: plots, then closes; a failed plot leaves the preview open. */
    async plot() {
      const r = shown;
      if (!r?.plot) return;
      await r.plot();
      if (shown === r) {
        set(undefined);
        finish();
      }
    },
  };
})();

/** The settings each space last plotted or previewed with, this session. */
export const lastPlotSettings = (() => {
  const kept = new Map<string, PlotSettings>();
  const key = (doc: number, block: string) => `${doc}\n${block}`;
  return {
    get: (doc: number, block: string) => kept.get(key(doc, block)),
    set: (doc: number, block: string, s: PlotSettings) => void kept.set(key(doc, block), s),
    /** A closed drawing. */
    forget(doc: number) {
      for (const k of [...kept.keys()]) if (k.startsWith(`${doc}\n`)) kept.delete(k);
    },
  };
})();

/** What PREVIEW previews a space with. */
export function previewSettings(doc: number, block: string, space: PlotSpace): PlotSettings {
  return lastPlotSettings.get(doc, block) ?? defaultPlotSettings(space);
}

/** What the renderer is asked for to plot a space with these settings. */
export function plotRequest(settings: PlotSettings, space: PlotSpace): PlotRequest {
  const table = plotTable(settings);
  return {
    ...(table && { table }),
    ...(settings.paperspaceLast && space.sheet && { paperspaceLast: true }),
  };
}

/** The plot's PDF and its paper; throws the message the Plot dialog would show. */
export async function previewOf(
  plot: (request: PlotRequest) => Promise<PlotPart[]>,
  space: PlotSpace,
  settings: PlotSettings,
  title: string,
  underlayFile?: (fileName: string) => Uint8Array | undefined,
): Promise<{
  pdf: Uint8Array;
  paper: { width: number; height: number };
  /** What the preview's Plot button plots, unchanged. */
  parts: PlotPart[];
  page: PlotSetup;
}> {
  const page = plotPage(settings, space);
  const parts = await plot(plotRequest(settings, space));
  // The PDF plotter's page whatever the plotter chosen: the SVG and PNG plots draw the same.
  const pdf = plotPdf(parts, page, { ...settings, device: 'pdf' }, space, title, underlayFile);
  return { pdf, paper: { width: page.width, height: page.height }, parts, page };
}

/** A region of the paper (millimetres from its top-left corner) in inches from its bottom-left. */
export function regionInches(
  r: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  paper: { readonly width: number; readonly height: number },
): Box {
  const inch = (mm: number) => mm / 25.4;
  return {
    minX: inch(r.x),
    maxX: inch(r.x + r.width),
    minY: inch(paper.height - r.y - r.height),
    maxY: inch(paper.height - r.y),
  };
}
