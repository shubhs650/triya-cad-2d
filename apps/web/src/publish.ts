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
// M2-39 part 4: Publish to PDF, SVG or PNG. AutoCAD publishes to a PDF (one multi-sheet file) or
// to the plotter a page setup names, which for a raster or SVG plotter writes a file a sheet;
// Triya's SVG and PNG plotters write a file a sheet, named after it ("<drawing>-<layout>.svg"),
// downloaded as itself when there is one and as one ZIP (`zipFiles`) when there are more.
// M2-45 part 2: Add Sheets lists the sheets of a drawing that is not open (the dialog opens it for
// the publish and closes it after, as AutoCAD loads it), and Page Setup's own entry names the
// page setup the sheet's layout has applied, "<Default: A3 Monochrome>", as AutoCAD's does.

import { layoutSheet, type Box, type Layout, type NamedPageSetup } from '@triya/engine';
import { PdfDocument, zipFiles, type ArchiveFile } from '@triya/pdf';
import type { PlotPart } from '@triya/render';
import type { PlotStyleTable } from '@triya/render';
import {
  addPlotPage,
  appliedPageSetupName,
  defaultPlotSettings,
  pageSetupOf,
  plotPage,
  type PlotSettings,
  type PlotSpace,
} from './plot';
import type { PlotSetup } from '@triya/render';

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
  /** The named page setup it plots with; absent for "<Default: …>", its own (part 6). */
  readonly pageSetup?: string;
  /** The page setup its layout has applied (LAYOUT DXF 1, M2-45), which "<Default: …>" names. */
  readonly applied?: string;
  /**
   * Why a sheet a loaded sheet list names cannot publish (M2-45 part 3): its drawing is not open
   * ("Drawing file not found") or lacks its layout; its `doc` is 0 and its `block` empty.
   */
  readonly missing?: string;
}

/** A drawing's space as the Publish dialog lists it. */
export interface PublishSpace {
  readonly name: string;
  readonly block: string;
  /** The page setup the space's layout has applied, if any (M2-45 part 2). */
  readonly applied?: string | undefined;
}

/** Page Setup's own entry: the sheet's own page setup. */
export const DEFAULT_PAGE_SETUP = '<Default: None>';

/**
 * How Page Setup's own entry reads (M2-45 part 2): AutoCAD 2024 Help, "Publish Dialog Box",
 * "<Default: page setup name>": the page setup the layout has applied, or None.
 */
export function defaultPageSetup(applied: string | undefined): string {
  return applied === undefined ? DEFAULT_PAGE_SETUP : `<Default: ${applied}>`;
}

/**
 * The drawing listed under a picked file's name (Add Sheets, M2-45 part 2), any case, as the
 * browser hands files by name: a drawing open or added already is not read again.
 */
export function drawingNamed(
  name: string,
  drawings: readonly { readonly doc: number; readonly drawing: string }[],
): number | undefined {
  const n = name.toLowerCase();
  return drawings.find((d) => d.drawing.toLowerCase() === n)?.doc;
}

const baseName = (drawing: string) => drawing.replace(/\.[^.]+$/, '');

/** The drawing's sheets as the Publish dialog lists them, every one included. */
export function publishSheets(
  drawing: string,
  spaces: readonly PublishSpace[],
  doc = 0,
): PublishSheet[] {
  const base = baseName(drawing);
  return spaces.map(({ name, block, applied }) => ({
    doc,
    drawing,
    sheet: `${base}-${name}`,
    name,
    block,
    include: true,
    ...(applied !== undefined && { applied }),
  }));
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
    readonly spaces: readonly PublishSpace[];
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

/** Publish to: the formats a publish writes (part 4). */
export type PublishDevice = 'pdf' | 'svg' | 'png';

export const PUBLISH_TO: readonly { readonly id: PublishDevice; readonly name: string }[] = [
  { id: 'pdf', name: 'PDF' },
  { id: 'svg', name: 'SVG' },
  { id: 'png', name: 'PNG' },
];

const safe = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_');

/** The published PDF's file name, or the ZIP's of several SVG or PNG sheets (`ext` "zip"). */
export function publishFileName(drawing: string, ext = 'pdf'): string {
  return safe(`${baseName(drawing)}.${ext}`);
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
    pageSetupName: appliedPageSetupName(s.layout),
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
  sheets: readonly PlottedSheet[],
  title: string,
  /** The PDF file a PDF underlay names (M2-16 part 5), as the Plot dialog plots it. */
  underlayFile?: (fileName: string) => Uint8Array | undefined,
): { bytes: Uint8Array | undefined; failed: PublishFailure[] } {
  const doc = new PdfDocument({ title, creator: 'Triya CAD 2D' });
  const failed: PublishFailure[] = [];
  let pages = 0;
  for (const { sheet, space, parts, settings: own } of sheets) {
    const settings = own ?? defaultPlotSettings(space);
    try {
      addPlotPage(doc, parts, plotPage(settings, space), settings, space, sheet, underlayFile);
      pages++;
    } catch (e) {
      failed.push({ sheet, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { bytes: pages > 0 ? doc.bytes() : undefined, failed };
}

/** A sheet plotted for a publish: its parts and the space (with its page setup) they are of. */
export interface PlottedSheet {
  readonly sheet: string;
  readonly space: PlotSpace;
  readonly parts: readonly PlotPart[];
  /**
   * The settings the parts were plotted with, when not the page setup's (Save As PDF's Page
   * Setup Override, M2-39 part 5); the plotter is the publish's.
   */
  readonly settings?: PlotSettings | undefined;
}

/** Writes a sheet's file in its plotter's format (the app's `plotFile`). */
export type SheetWriter = (
  parts: readonly PlotPart[],
  page: PlotSetup,
  settings: PlotSettings,
  space: PlotSpace,
  title: string,
) => Promise<{ readonly bytes: Uint8Array }>;

/**
 * The sheets as SVG or PNG files (part 4), a file a sheet named after it, each plotted with its
 * page setup to the plotter chosen; a sheet that cannot plot is left out and reported.
 */
export async function publishSheetFiles(
  sheets: readonly PlottedSheet[],
  device: Exclude<PublishDevice, 'pdf'>,
  write: SheetWriter,
  /** The PNG plotter's resolution (M2-39 part 5); the Plot dialog's 150 dpi when absent. */
  options: { readonly dpi?: number } = {},
): Promise<{ files: ArchiveFile[]; failed: PublishFailure[] }> {
  const files: ArchiveFile[] = [];
  const failed: PublishFailure[] = [];
  for (const { sheet, space, parts, settings: own } of sheets) {
    const settings: PlotSettings = {
      ...(own ?? defaultPlotSettings(space)),
      device,
      ...(options.dpi !== undefined && { dpi: options.dpi }),
    };
    try {
      const file = await write(parts, plotPage(settings, space), settings, space, sheet);
      files.push({ name: safe(`${sheet}.${device}`), bytes: file.bytes });
    } catch (e) {
      failed.push({ sheet, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { files, failed };
}

/** The media type of each file a publish downloads. */
const MEDIA: Record<string, string> = {
  pdf: 'application/pdf',
  svg: 'image/svg+xml',
  png: 'image/png',
  zip: 'application/zip',
};

/**
 * What a publish to SVG or PNG downloads: the one file as itself, or every file in one ZIP named
 * `zipName` (always a ZIP when `zip` is "always", as Export's All layouts names one); nothing when
 * no sheet plotted.
 */
export function publishedDownload(
  files: readonly ArchiveFile[],
  zipName: string,
  zip: 'several' | 'always' = 'several',
): { name: string; bytes: Uint8Array; type: string } | undefined {
  const [first] = files;
  if (!first) return undefined;
  if (files.length === 1 && zip === 'several') {
    const ext = first.name.slice(first.name.lastIndexOf('.') + 1).toLowerCase();
    return { name: first.name, bytes: first.bytes, type: MEDIA[ext] ?? 'application/octet-stream' };
  }
  return { name: zipName, bytes: zipFiles(files), type: MEDIA.zip! };
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
      [s.drawing, s.sheet, s.name, s.pageSetup ?? defaultPageSetup(s.applied), status]
        .map(csv)
        .join(','),
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/** The publish log's file name: the published PDF's, as a .csv. */
export function publishLogName(drawing: string): string {
  return publishFileName(drawing).replace(/\.pdf$/, '.csv');
}
