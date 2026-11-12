// EXPORT and EXPORTPDF (M2-39 part 2). AutoCAD 2024 Help: EXPORT's Export Data dialog box saves
// to the format its "Files of type" names; EXPORTPDF's Save As PDF dialog box exports the
// Display, the Extents or a Window of model space, or the Current layout or All layouts, each
// with its current page setup (Page setup: Current). Triya's formats are the ones it writes: a
// PDF, SVG or PNG plot (the Plot dialog's Triya PDF, SVG and PNG plotters) and an AC1032 DXF of
// the whole drawing (DEC-047), which leaves the drawing's own file and its unsaved changes as
// they were, unlike Save As. All layouts makes one multi-page PDF, as PUBLISH does; for an SVG
// or a PNG (part 4) it makes a file a layout, as PUBLISH to SVG or PNG does, in one ZIP.
//
// Part 5: "Page setup: Override" and its Page Setup Override dialog box (AutoCAD 2024 Help, "Save
// As PDF Dialog Box": "Page Setup Override: Opens the Page Setup Override dialog box", which holds
// Paper size, Drawing orientation, Plot scale and Plot style table (pen assignments)) replace those
// four of the page setup for the export, every layout's for All layouts, leaving the page setup
// itself as it was. A PNG has a Resolution, as the Plot dialog's PNG plotter does (Triya's own:
// AutoCAD's PNG export is a screen capture).
import { dxfName } from './save';
import { defaultPlotSettings, type PlotSettings, type PlotSpace } from './plot';
import type { Box } from '@triya/engine';

export type ExportType = 'pdf' | 'svg' | 'png' | 'dxf';

/** Files of type, as the Export Data dialog lists them. */
export const EXPORT_TYPES: readonly { readonly id: ExportType; readonly name: string }[] = [
  { id: 'pdf', name: 'PDF (*.pdf)' },
  { id: 'svg', name: 'SVG (*.svg)' },
  { id: 'png', name: 'PNG (*.png)' },
  // Save As's own wording for the one DXF Triya writes.
  { id: 'dxf', name: 'AutoCAD 2018 DXF (*.dxf)' },
];

/** The media type of each export. */
export const EXPORT_MEDIA: Record<ExportType, string> = {
  pdf: 'application/pdf',
  svg: 'image/svg+xml',
  png: 'image/png',
  dxf: 'application/dxf',
};

/** A ZIP's media type: All layouts as SVG or PNG files (part 4). */
export const ZIP_MEDIA = 'application/zip';

/** Save As PDF's Export list: model space's areas, or a layout's. */
export type ExportArea = 'display' | 'extents' | 'window' | 'current' | 'all';

export const EXPORT_AREA_LABELS: Record<ExportArea, string> = {
  display: 'Display',
  extents: 'Extents',
  window: 'Window',
  current: 'Current layout',
  all: 'All layouts',
};

/** What the Export list offers for a space and a file type; nothing for the whole-drawing DXF. */
export function exportAreas(space: PlotSpace, type: ExportType): ExportArea[] {
  if (type === 'dxf') return [];
  if (space.sheet) return ['current', 'all'];
  const out: ExportArea[] = [];
  if (space.display) out.push('display');
  if (space.extents) out.push('extents');
  out.push('window');
  return out;
}

/** The Export list's first choice: Display in model space, Current layout in a layout. */
export function defaultExportArea(space: PlotSpace): ExportArea {
  if (space.sheet) return 'current';
  return space.display ? 'display' : 'extents';
}

const safe = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_');
const baseName = (drawing: string) => drawing.replace(/\.[^.]+$/, '');

/** The extension an export's file has: a ZIP for All layouts as SVG or PNG files (part 4). */
export function exportExtension(type: ExportType, area?: ExportArea): string {
  return area === 'all' && (type === 'svg' || type === 'png') ? 'zip' : type;
}

/**
 * The file name the dialog suggests: "<drawing>-<space>" for one sheet, as AutoCAD's Save As PDF
 * names it, the drawing's own name for All layouts and for a DXF.
 */
export function exportFileName(
  drawing: string,
  space: PlotSpace,
  type: ExportType,
  area: ExportArea | undefined,
): string {
  if (type === 'dxf') return safe(dxfName(drawing));
  if (area === 'all') return safe(`${baseName(drawing)}.${exportExtension(type, area)}`);
  return safe(`${baseName(drawing)}-${space.name}.${type}`);
}

const EXTENSION = /\.(pdf|svg|png|dxf|zip)$/i;

/**
 * The file name with the extension of the type chosen (a ZIP for All layouts as SVG or PNG), as
 * a file dialog changes it.
 */
export function withExportType(fileName: string, type: ExportType, area?: ExportArea): string {
  const ext = exportExtension(type, area);
  const name = fileName.trim();
  if (name === '') return `Drawing1.${ext}`;
  return EXTENSION.test(name) ? name.replace(EXTENSION, `.${ext}`) : `${name}.${ext}`;
}

/** What Page Setup Override replaces of the page setup (part 5). */
export interface PageSetupOverride {
  /** A `PAPER_SIZES` name, or `LAYOUT_PAPER` for the page setup's own paper. */
  readonly paper: string;
  readonly orientation: 'portrait' | 'landscape';
  readonly fit: boolean;
  /** `mm` millimetres = `units` drawing units. */
  readonly scale: { readonly mm: number; readonly units: number };
  /** A plot style table's file name, or '' for None. */
  readonly table: string;
}

/** The Page Setup Override dialog's first values: the space's current page setup's. */
export function pageSetupOverride(space: PlotSpace): PageSetupOverride {
  const { paper, orientation, fit, scale, table } = defaultPlotSettings(space);
  return { paper, orientation, fit, scale, table };
}

/**
 * The plot settings an export makes: the space's page setup (Page setup: Current), or that page
 * setup with an override's paper, orientation, scale and table (Override, part 5), plotted to the
 * type's plotter (a PNG at `dpi`), with model space's area as chosen. A layout plots its layout.
 */
export function exportSettings(
  space: PlotSpace,
  type: Exclude<ExportType, 'dxf'>,
  area: ExportArea,
  window?: Box,
  override?: PageSetupOverride,
  dpi?: number,
): PlotSettings {
  const settings: PlotSettings = {
    ...defaultPlotSettings(space),
    ...override,
    device: type,
    ...(dpi !== undefined && { dpi }),
  };
  if (area === 'current' || area === 'all') return settings;
  if (area === 'window') {
    if (!window) throw new Error('Specify a window to export.');
    return { ...settings, area, window };
  }
  return { ...settings, area };
}
