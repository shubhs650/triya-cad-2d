// PUBLISH (M2-17 part 2): the drawing's sheets into one PDF. AutoCAD 2024 Help, "Publish Dialog
// Box": the sheet list names each sheet "<drawing>-<layout>" (model space as "Model"), each is
// plotted with its page setup ("<Default: None>" plots a layout with its own settings, as the Plot
// dialog opens on it), and a PDF publishes as one multi-sheet file. Each page is labelled with its
// layout's name and bookmarked with its sheet's, as AutoCAD's PDFs are. A sheet that cannot plot
// is left out and reported, as AutoCAD's publish log reports it, and the others still publish.
// Part 3: each sheet plots with its page setup's plot style table and plot options, and the
// drafter's own tables, as the Plot dialog would open on it.
// Part 6: each sheet's Page Setup is "<Default: None>" (its own) or a named page setup of its
// kind; the list takes the sheets of every open drawing (AutoCAD's "Load All Open Drawings"),
// sheets are removed and moved up or down, and the publish log (AutoCAD's .csv, one row a sheet
// with its status) is saved beside the PDF when asked for.

import { layoutSheet, type Box, type Layout, type NamedPageSetup } from '@triya/engine';
import { PdfDocument } from '@triya/pdf';
import type { PlotPart } from '@triya/render';
import type { PlotStyleTable } from '@triya/render';
import { addPlotPage, defaultPlotSettings, pageSetupOf, plotPage, type PlotSpace } from './plot';

export interface PublishSheet {
  /** The open drawing the sheet is in (part 6). */
  readonly doc: number;
  /** That drawing's file name. */
  readonly drawing: string;
  /** "<drawing>-<space>". */
  readonly sheet: string;
  /** The space's name: `Model` or the layout's. */
  readonly name: string;
  readonly block: string;
  readonly include: boolean;
  /** The named page setup it plots with; absent for "<Default: None>", its own (part 6). */
  readonly pageSetup?: string;
}

/** Page Setup's own entry: the sheet's own page setup. */
export const DEFAULT_PAGE_SETUP = '<Default: None>';

const baseName = (drawing: string) => drawing.replace(/\.[^.]+$/, '');

/** The drawing's sheets as the Publish dialog lists them, every one included. */
export function publishSheets(
  drawing: string,
  spaces: readonly { readonly name: string; readonly block: string }[],
  doc = 0,
): PublishSheet[] {
  const base = baseName(drawing);
  return spaces.map((s) => ({ doc, drawing, sheet: `${base}-${s.name}`, ...s, include: true }));
}

/**
 * Load All Open Drawings (part 6): the list with every open drawing's sheets added after it, in
 * tab order, those already listed kept as they are.
 */
export function withOpenDrawings(
  sheets: readonly PublishSheet[],
  drawings: readonly {
    readonly doc: number;
    readonly drawing: string;
    readonly spaces: readonly { readonly name: string; readonly block: string }[];
  }[],
): PublishSheet[] {
  const listed = new Set(sheets.map((s) => `${s.doc}:${s.block}`));
  const added = drawings.flatMap((d) =>
    publishSheets(d.drawing, d.spaces, d.doc).filter((s) => !listed.has(`${s.doc}:${s.block}`)),
  );
  return [...sheets, ...added];
}

/** Move Sheet Up (-1) or Down (+1): the list with sheet `i` moved, or as it was at an end. */
export function movedSheet<T>(sheets: readonly T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  const out = [...sheets];
  if (i < 0 || i >= out.length || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** The published PDF's file name. */
export function publishFileName(drawing: string): string {
  return `${baseName(drawing)}.pdf`.replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * What a sheet that is not shown plots from: a layout's sheet from its page setup, model space
 * by its extents (the Plot dialog's Display needs the canvas, which a sheet not shown lacks).
 * `layout` is the space's LAYOUT object, the Model layout for model space (`model`), whose page
 * setup gives its plot style table and options but no sheet.
 */
export function sheetSpace(s: {
  readonly name: string;
  readonly layout?: Layout | undefined;
  readonly model?: boolean;
  readonly extents?: Box | undefined;
  readonly namedPlotStyles?: boolean;
  readonly userTables?: ReadonlyMap<string, PlotStyleTable> | undefined;
  /** The drawing's named page setups of the space's kind (part 6). */
  readonly pageSetups?: readonly NamedPageSetup[] | undefined;
}): PlotSpace {
  const sheet = s.layout && !s.model ? layoutSheet(s.layout) : undefined;
  return {
    name: s.name,
    sheet: sheet && { paper: sheet.paper, unitsPerMm: sheet.unitsPerMm },
    inches: s.layout?.plot?.paperUnits === 'inches',
    extents: s.extents,
    namedPlotStyles: s.namedPlotStyles ?? false,
    pageSetup: pageSetupOf(s.layout),
    userTables: s.userTables,
    pageSetups: s.pageSetups,
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
  /** The PDF file a PDF underlay names (M2-16 part 5), as the Plot dialog plots it. */
  underlayFile?: (fileName: string) => Uint8Array | undefined,
): { bytes: Uint8Array | undefined; failed: PublishFailure[] } {
  const doc = new PdfDocument({ title, creator: 'Triya CAD 2D' });
  const failed: PublishFailure[] = [];
  let pages = 0;
  for (const { sheet, space, parts } of sheets) {
    const settings = defaultPlotSettings(space);
    try {
      addPlotPage(doc, parts, plotPage(settings, space), settings, space, sheet, underlayFile);
      pages++;
    } catch (e) {
      failed.push({ sheet, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { bytes: pages > 0 ? doc.bytes() : undefined, failed };
}

/** A sheet's line in the publish log. */
export interface PublishLogRow {
  readonly sheet: PublishSheet;
  /** "Published", or why the sheet did not. */
  readonly status: string;
}

const csv = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * The publish log (part 6): AutoCAD writes one per publish (a .csv in its "Log file location");
 * its columns are not documented, so these are the Publish dialog's own: the drawing, the sheet,
 * its layout, its page setup and its status, a row a sheet, under the time it published.
 */
export function publishLog(rows: readonly PublishLogRow[], when: Date): string {
  const lines = [
    `Publish log,${csv(when.toISOString())}`,
    'Drawing,Sheet Name,Layout,Page Setup,Status',
    ...rows.map(({ sheet: s, status }) =>
      [s.drawing, s.sheet, s.name, s.pageSetup ?? DEFAULT_PAGE_SETUP, status].map(csv).join(','),
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/** The publish log's file name: the published PDF's, as a .csv. */
export function publishLogName(drawing: string): string {
  return publishFileName(drawing).replace(/\.pdf$/, '.csv');
}
