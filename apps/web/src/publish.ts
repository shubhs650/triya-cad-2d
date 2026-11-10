// PUBLISH (M2-17 part 2): the drawing's sheets into one PDF. AutoCAD 2024 Help, "Publish Dialog
// Box": the sheet list names each sheet "<drawing>-<layout>" (model space as "Model"), each is
// plotted with its page setup ("<Default: None>" plots a layout with its own settings, as the Plot
// dialog opens on it), and a PDF publishes as one multi-sheet file. Each page is labelled with its
// layout's name and bookmarked with its sheet's, as AutoCAD's PDFs are. A sheet that cannot plot
// is left out and reported, as AutoCAD's publish log reports it, and the others still publish.

import { layoutSheet, type Box, type Layout } from '@triya/engine';
import { PdfDocument } from '@triya/pdf';
import type { PlotPart } from '@triya/render';
import { addPlotPage, defaultPlotSettings, plotPage, type PlotSpace } from './plot';

export interface PublishSheet {
  /** "<drawing>-<space>". */
  readonly sheet: string;
  /** The space's name: `Model` or the layout's. */
  readonly name: string;
  readonly block: string;
  readonly include: boolean;
}

const baseName = (drawing: string) => drawing.replace(/\.[^.]+$/, '');

/** The drawing's sheets as the Publish dialog lists them, every one included. */
export function publishSheets(
  drawing: string,
  spaces: readonly { readonly name: string; readonly block: string }[],
): PublishSheet[] {
  const base = baseName(drawing);
  return spaces.map((s) => ({ sheet: `${base}-${s.name}`, ...s, include: true }));
}

/** The published PDF's file name. */
export function publishFileName(drawing: string): string {
  return `${baseName(drawing)}.pdf`.replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * What a sheet that is not shown plots from: a layout's sheet from its page setup, model space
 * by its extents (the Plot dialog's Display needs the canvas, which a sheet not shown lacks).
 */
export function sheetSpace(s: {
  readonly name: string;
  readonly layout?: Layout | undefined;
  readonly extents?: Box | undefined;
  readonly namedPlotStyles?: boolean;
}): PlotSpace {
  const sheet = s.layout ? layoutSheet(s.layout) : undefined;
  return {
    name: s.name,
    sheet: sheet && { paper: sheet.paper, unitsPerMm: sheet.unitsPerMm },
    inches: s.layout?.plot?.paperUnits === 'inches',
    extents: s.extents,
    namedPlotStyles: s.namedPlotStyles ?? false,
  };
}

export interface PublishFailure {
  readonly sheet: string;
  readonly message: string;
}

/**
 * The sheets as one PDF, each with its page setup's settings; `bytes` is undefined when no sheet
 * plotted.
 */
export function publishPdf(
  sheets: readonly {
    readonly sheet: string;
    readonly space: PlotSpace;
    readonly parts: readonly PlotPart[];
  }[],
  title: string,
): { bytes: Uint8Array | undefined; failed: PublishFailure[] } {
  const doc = new PdfDocument({ title, creator: 'Triya CAD 2D' });
  const failed: PublishFailure[] = [];
  let pages = 0;
  for (const { sheet, space, parts } of sheets) {
    const settings = defaultPlotSettings(space);
    try {
      addPlotPage(doc, parts, plotPage(settings, space), settings, space, sheet);
      pages++;
    } catch (e) {
      failed.push({ sheet, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { bytes: pages > 0 ? doc.bytes() : undefined, failed };
}
