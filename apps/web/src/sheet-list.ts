// The Publish dialog's sheet list saved and loaded (M2-45 part 3). AutoCAD 2024 Help, "Publish
// Dialog Box": Save Sheet List writes the list as a DSD file, Load Sheet List reads one, asking
// whether to replace the sheets listed or append to them.
//
// A DSD is an INI file: `[DWF6Sheet:<sheet name>]` a sheet, with its drawing (DWG, a full path in
// AutoCAD's), its layout (Layout, `Model` for model space) and its named page setup (Setup, empty
// for the layout's own; AutoCAD writes `<name>|<drawing it comes from>`), and the publish's
// options in other sections (`ViewFile` under `[SheetSet Properties]` is "Open in viewer when
// done"). The browser hands Triya file names and no paths, so DWG is the drawing's file name and
// a drawing is found by its file name, any case, among those open or added (as Add Sheets matches
// one). Triya adds `Include=FALSE` to a sheet whose check is cleared and keeps its Publish to,
// Resolution and Save publish log under `[Triya]`; a reader that does not know them skips them.
// AutoCAD reading Triya's lists is not verified (DEC-047: compatibility welcome, not required).
//
// M6-05: a sheet's name is its section's (a renamed sheet keeps its name); a PDF publish's PDF
// Options go under AutoCAD's `[PdfOptions]` (IncludeHyperlinks, CreateBookmarks,
// ConvertTextToGeometry) and `IncludeLayer` under `[SheetSet Properties]`, and Publish Options'
// Type and multi-sheet file name under `[Triya]` (AutoCAD keeps its Type as a number in `[Target]`
// with a full path, which Triya does not read).
//
// A sheet whose drawing is not open stays listed with Status "Drawing file not found" (AutoCAD
// lists such a sheet with that warning) and does not publish; Add Sheets with that drawing finds
// it. A layout the drawing lacks is "Layout not found".
import { PLOT_PDF_OPTIONS, PNG_RESOLUTIONS, type PdfOptions } from './plot';
import {
  PUBLISH_FILE_TYPES,
  PUBLISH_TO,
  drawingNamed,
  publishSheets,
  type PublishDevice,
  type PublishFileType,
  type PublishSheet,
  type PublishSpace,
} from './publish';

/** A sheet as a list names it. */
export interface SheetListEntry {
  /** The drawing's file name. */
  readonly drawing: string;
  /** `Model` or the layout's name. */
  readonly layout: string;
  /** The named page setup it plots with; absent for its own. */
  readonly pageSetup?: string;
  readonly include: boolean;
  /** The sheet's name when renamed (M6-05); absent when it is `<drawing>-<layout>`. */
  readonly sheet?: string;
}

/** The publish options a list keeps. */
export interface SheetListOptions {
  readonly device: PublishDevice;
  readonly dpi: number;
  /** Open in viewer when done. */
  readonly viewFile: boolean;
  /** Save publish log. */
  readonly log: boolean;
  /** Publish Options' Type for a PDF (M6-05). */
  readonly fileType?: PublishFileType;
  /** Publish Options' multi-sheet file name (M6-05); empty names it after the drawing. */
  readonly fileName?: string;
  /** The PDF Options (M6-05). */
  readonly pdf?: PdfOptions;
}

/** A drawing whose sheets a list may name: one open, or one Add Sheets read. */
export interface ListedDrawing {
  readonly doc: number;
  readonly drawing: string;
  readonly spaces: readonly PublishSpace[];
  /** The names of its named page setups a space of `block`'s kind may plot with. */
  pageSetups(block: string): readonly string[];
}

/** Why a sheet of a list cannot publish. */
export const DRAWING_NOT_FOUND = 'Drawing file not found';
export const LAYOUT_NOT_FOUND = 'Layout not found';

/** What tells the sheets of a list apart (and React's rows). */
export function sheetKey(s: PublishSheet): string {
  return s.missing === undefined
    ? `${s.doc}:${s.block}`
    : `?${s.drawing.toLowerCase()}:${s.name.toLowerCase()}`;
}

const baseName = (drawing: string) => drawing.replace(/\.[^.]+$/, '');

/** The list's file name: the drawing's, as a .dsd. */
export function sheetListName(drawing: string): string {
  return `${baseName(drawing).replace(/[\\/:*?"<>|]/g, '_')}.dsd`;
}

const bool = (v: boolean) => (v ? 'TRUE' : 'FALSE');

/** The sheets and options as a DSD file, CRLF lines as AutoCAD writes them. */
export function writeSheetList(sheets: readonly PublishSheet[], options: SheetListOptions): string {
  const lines = ['[DWF6Version]', 'Ver=1', '[DWF6MinorVersion]', 'MinorVer=1'];
  for (const s of sheets) {
    lines.push(
      `[DWF6Sheet:${s.sheet}]`,
      `DWG=${s.drawing}`,
      `Layout=${s.name}`,
      `Setup=${s.pageSetup ?? ''}`,
      `OriginalSheetPath=${s.drawing}`,
      'Has Plot Port=0',
      'Has3DDWF=0',
    );
    if (!s.include) lines.push('Include=FALSE');
  }
  lines.push(
    '[SheetSet Properties]',
    'IsSheetSet=FALSE',
    'IsHomogeneous=FALSE',
    'SheetSet Name=',
    'NoOfCopies=1',
    'PlotStampOn=FALSE',
    `ViewFile=${bool(options.viewFile)}`,
  );
  const pdf = options.pdf;
  if (pdf) {
    lines.push(
      `IncludeLayer=${bool(pdf.layers)}`,
      '[PdfOptions]',
      `IncludeHyperlinks=${bool(pdf.hyperlinks)}`,
      `CreateBookmarks=${bool(pdf.bookmarks)}`,
      `ConvertTextToGeometry=${bool(pdf.textAsGeometry)}`,
    );
  }
  lines.push(
    '[Triya]',
    `PublishTo=${PUBLISH_TO.find((d) => d.id === options.device)!.name}`,
    `Resolution=${options.dpi}`,
    `SavePublishLog=${bool(options.log)}`,
  );
  if (options.fileType) {
    lines.push(`FileType=${PUBLISH_FILE_TYPES.find((t) => t.id === options.fileType)!.name}`);
  }
  if (options.fileName !== undefined) lines.push(`FileName=${options.fileName}`);
  return `${lines.join('\r\n')}\r\n`;
}

/** An INI file's sections in order, each with its keys. */
function sections(text: string): { name: string; keys: Map<string, string> }[] {
  const out: { name: string; keys: Map<string, string> }[] = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith(';')) continue;
    const head = /^\[(.*)\]$/.exec(line);
    if (head) {
      out.push({ name: head[1]!, keys: new Map() });
      continue;
    }
    const eq = line.indexOf('=');
    if (eq > 0) out.at(-1)?.keys.set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1));
  }
  return out;
}

const flag = (v: string | undefined) =>
  v === undefined
    ? undefined
    : /^true$/i.test(v.trim())
      ? true
      : /^false$/i.test(v.trim())
        ? false
        : undefined;

/** Whether a sheet's name is its own, not `<drawing>-<layout>` (any case). */
const renamed = (sheet: string, drawing: string, layout: string) =>
  sheet !== '' && sheet.toLowerCase() !== `${baseName(drawing)}-${layout}`.toLowerCase();

/** A path's file name, whether `\` or `/` separates it. */
const fileName = (path: string) => path.trim().split(/[\\/]/).at(-1) ?? '';

/**
 * A DSD file's sheets and the options it keeps; throws when it lists no sheets or a sheet names
 * no drawing.
 */
export function readSheetList(text: string): {
  entries: SheetListEntry[];
  options: Partial<SheetListOptions>;
} {
  const entries: SheetListEntry[] = [];
  const options: { -readonly [K in keyof SheetListOptions]?: SheetListOptions[K] } = {};
  /** The PDF options the list names; the rest stay a plot's. */
  const pdf: { -readonly [K in keyof PdfOptions]?: PdfOptions[K] } = {};
  for (const { name, keys } of sections(text)) {
    if (/^DWF6Sheet:/i.test(name)) {
      const drawing = fileName(keys.get('dwg') ?? keys.get('originalsheetpath') ?? '');
      if (!drawing) throw new Error(`The sheet ${name.slice(10)} names no drawing.`);
      const setup = (keys.get('setup') ?? '').split('|')[0]!.trim();
      const layout = (keys.get('layout') ?? 'Model').trim() || 'Model';
      const sheet = name.slice(10).trim();
      entries.push({
        drawing,
        layout,
        ...(setup !== '' && { pageSetup: setup }),
        include: flag(keys.get('include')) ?? true,
        ...(renamed(sheet, drawing, layout) && { sheet }),
      });
    } else if (/^SheetSet Properties$/i.test(name)) {
      const view = flag(keys.get('viewfile'));
      if (view !== undefined) options.viewFile = view;
      const layers = flag(keys.get('includelayer'));
      if (layers !== undefined) pdf.layers = layers;
    } else if (/^PdfOptions$/i.test(name)) {
      const links = flag(keys.get('includehyperlinks'));
      if (links !== undefined) pdf.hyperlinks = links;
      const marks = flag(keys.get('createbookmarks'));
      if (marks !== undefined) pdf.bookmarks = marks;
      const geometry = flag(keys.get('converttexttogeometry'));
      if (geometry !== undefined) pdf.textAsGeometry = geometry;
    } else if (/^Triya$/i.test(name)) {
      const to = keys.get('publishto')?.trim().toLowerCase();
      const device = PUBLISH_TO.find((d) => d.name.toLowerCase() === to);
      if (device) options.device = device.id;
      const dpi = Number(keys.get('resolution'));
      if (PNG_RESOLUTIONS.includes(dpi)) options.dpi = dpi;
      const log = flag(keys.get('savepublishlog'));
      if (log !== undefined) options.log = log;
      const type = keys.get('filetype')?.trim().toLowerCase();
      const fileType = PUBLISH_FILE_TYPES.find((t) => t.name.toLowerCase() === type);
      if (fileType) options.fileType = fileType.id;
      const file = keys.get('filename');
      if (file !== undefined) options.fileName = file.trim();
    }
  }
  if (Object.keys(pdf).length > 0) options.pdf = { ...PLOT_PDF_OPTIONS, ...pdf };
  if (entries.length === 0) throw new Error('The file lists no sheets.');
  return { entries, options };
}

/** A sheet of a list that cannot publish, keeping what the list says of it. */
function missingSheet(e: SheetListEntry, drawing: string, missing: string): PublishSheet {
  return {
    doc: 0,
    drawing,
    sheet: e.sheet ?? `${baseName(drawing)}-${e.layout}`,
    name: e.layout,
    block: '',
    include: e.include,
    ...(e.pageSetup !== undefined && { pageSetup: e.pageSetup }),
    missing,
  };
}

/** The entry as a sheet of drawing `d`, or one not found when `d` lacks its layout. */
function sheetOf(e: SheetListEntry, d: ListedDrawing): PublishSheet {
  const layout = e.layout.toLowerCase();
  const space = d.spaces.find((s) => s.name.toLowerCase() === layout);
  if (!space) return missingSheet(e, d.drawing, LAYOUT_NOT_FOUND);
  const sheet = publishSheets(d.drawing, [space], d.doc)[0]!;
  // A page setup the drawing lacks (or has for the other kind of space) plots as its own.
  const setup = e.pageSetup !== undefined && d.pageSetups(space.block).includes(e.pageSetup);
  return {
    ...sheet,
    include: e.include,
    ...(e.sheet !== undefined && { sheet: e.sheet }),
    ...(setup && { pageSetup: e.pageSetup }),
  };
}

/** The list's sheets, each in the drawing open or added under its file name; once each. */
export function listedSheets(
  entries: readonly SheetListEntry[],
  drawings: readonly ListedDrawing[],
): PublishSheet[] {
  const out: PublishSheet[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const doc = drawingNamed(e.drawing, drawings);
    const d = drawings.find((x) => x.doc === doc);
    const sheet = d ? sheetOf(e, d) : missingSheet(e, e.drawing, DRAWING_NOT_FOUND);
    const key = sheetKey(sheet);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sheet);
  }
  return out;
}

/** The list with the sheets whose drawing was not found found in `d`, which Add Sheets read. */
export function withDrawingFound(
  sheets: readonly PublishSheet[],
  d: ListedDrawing,
): PublishSheet[] {
  const name = d.drawing.toLowerCase();
  return sheets.map((s) =>
    s.missing === DRAWING_NOT_FOUND && s.drawing.toLowerCase() === name
      ? sheetOf(
          {
            drawing: s.drawing,
            layout: s.name,
            include: s.include,
            ...(renamed(s.sheet, s.drawing, s.name) && { sheet: s.sheet }),
            ...(s.pageSetup !== undefined && { pageSetup: s.pageSetup }),
          },
          d,
        )
      : s,
  );
}

/** Load Sheet List's Append: the loaded sheets not listed already, after those listed. */
export function appendedSheets(
  current: readonly PublishSheet[],
  loaded: readonly PublishSheet[],
): PublishSheet[] {
  const listed = new Set(current.map(sheetKey));
  return [...current, ...loaded.filter((s) => !listed.has(sheetKey(s)))];
}
