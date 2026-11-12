// What EXPORT, EXPORTPDF and -EXPORT write (M2-39 parts 2–5): the Export Data and Save As PDF
// dialogs and the command line's -EXPORT make the same file from the same choices, so both hand
// them here. One space plots as the Plot dialog's OK plots it; All layouts plots every layout, as
// PUBLISH does, into one PDF or a ZIP of SVG or PNG files; a DXF is the drawing as Save writes it.
import type { Box } from '@triya/engine';
import type { PlotStyleTable } from '@triya/render';
import { download } from './PlotDialog';
import { controllerOf } from './canvas/registry';
import { spacesOf, type OpenDocument } from './documents';
import { engines } from './engine/registry';
import {
  EXPORT_MEDIA,
  defaultExportArea,
  exportSettings,
  type ExportArea,
  type ExportType,
  type PageSetupOverride,
} from './export';
import {
  plotFile,
  plotPage,
  type PlotSettings,
  type PlotSpace,
  type UnderlayPageSource,
} from './plot';
import { plotRequest } from './plot-preview';
import { plotSpaceOf } from './plot-spaces';
import { publishPdf, publishSheetFiles, publishedDownload, type PlottedSheet } from './publish';

/** One export, as a dialog's Save or -EXPORT's answers make it. */
export interface ExportJob {
  readonly type: ExportType;
  /** The file's name, with its extension. */
  readonly file: string;
  readonly area?: ExportArea | undefined;
  readonly window?: Box | undefined;
  /** Page setup: Override (part 5). */
  readonly override?: PageSetupOverride | undefined;
  /** A PNG's resolution (part 5). */
  readonly dpi?: number | undefined;
  /** Every setting, from -EXPORT's detailed plot configuration (part 5); one space only. */
  readonly settings?: PlotSettings | undefined;
}

/** What an export needs of the app. */
export interface ExportEnv {
  /** The PDF file a PDF underlay names, as supplied this session. */
  readonly underlayFile?: ((fileName: string) => Uint8Array | undefined) | undefined;
  /** Its page drawn, for an SVG or PNG export. */
  readonly underlayPage?: UnderlayPageSource | undefined;
  /** The plot style tables added in Settings. */
  readonly userTables?: ReadonlyMap<string, PlotStyleTable> | undefined;
  /** The drawing as an AC1032 DXF with its changes, as Save would write it. */
  readonly exportDxf: (doc: number) => Promise<Uint8Array>;
}

/** Writes the export of the space `space` (the one shown) and downloads it. */
export async function exportFile(
  doc: OpenDocument,
  space: PlotSpace,
  job: ExportJob,
  env: ExportEnv,
): Promise<void> {
  const { type } = job;
  if (type === 'dxf') {
    download(job.file, await env.exportDxf(doc.id), EXPORT_MEDIA.dxf);
    return;
  }
  if (job.area === 'all') {
    await exportLayouts(doc, job.file, type, job, env);
    return;
  }
  const controller = controllerOf(doc.id, doc.block);
  if (!controller) throw new Error('There is nothing to export.');
  const settings =
    job.settings !== undefined
      ? { ...job.settings, device: type }
      : exportSettings(
          space,
          type,
          job.area ?? defaultExportArea(space),
          job.window,
          job.override,
          job.dpi,
        );
  const page = plotPage(settings, space);
  const parts = await controller.plot(plotRequest(settings, space));
  const title = `${doc.name} - ${space.name}`;
  const file = await plotFile(
    parts,
    page,
    settings,
    space,
    title,
    env.underlayFile,
    env.underlayPage,
  );
  download(job.file, file.bytes, file.type);
}

/**
 * All layouts: one PDF, a page per layout in tab order with its page setup (or the override), as
 * PUBLISH makes; as SVG or PNG (part 4), a file a layout in one ZIP, as PUBLISH to SVG or PNG
 * writes them. Throws, after downloading what plotted, when a layout could not be exported.
 */
async function exportLayouts(
  doc: OpenDocument,
  name: string,
  type: Exclude<ExportType, 'dxf'>,
  job: ExportJob,
  env: ExportEnv,
): Promise<void> {
  const active = controllerOf(doc.id, doc.block);
  if (!active) throw new Error('There is nothing to export.');
  const layouts = spacesOf(doc, engines.changesOf(doc.id)).filter(
    (l) => l.block !== doc.opened.modelSpace,
  );
  const base = doc.name.replace(/\.[^.]+$/, '');
  const plotted: PlottedSheet[] = [];
  const failed: string[] = [];
  for (const l of layouts) {
    const sheet = `${base}-${l.name}`;
    try {
      const sp = await plotSpaceOf(doc, l.block, l.name, env.userTables);
      if (!sp) throw new Error('There is nothing to plot.');
      const settings = exportSettings(sp, 'pdf', 'all', undefined, job.override);
      const parts = await active.plot({ block: l.block, ...plotRequest(settings, sp) });
      plotted.push({ sheet, space: sp, parts, ...(job.override && { settings }) });
    } catch (e) {
      failed.push(`${sheet}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (type === 'pdf') {
    const result = publishPdf(plotted, base, env.underlayFile);
    failed.push(...result.failed.map((f) => `${f.sheet}: ${f.message}`));
    if (!result.bytes) throw new Error(failed[0] ?? 'The drawing has no layouts to export.');
    download(name, result.bytes, EXPORT_MEDIA.pdf);
  } else {
    const result = await publishSheetFiles(
      plotted,
      type,
      (parts, page, settings, sp, title) =>
        plotFile(parts, page, settings, sp, title, env.underlayFile, env.underlayPage),
      job.dpi !== undefined ? { dpi: job.dpi } : {},
    );
    failed.push(...result.failed.map((f) => `${f.sheet}: ${f.message}`));
    const file = publishedDownload(result.files, name, 'always');
    if (!file) throw new Error(failed[0] ?? 'The drawing has no layouts to export.');
    download(file.name, file.bytes, file.type);
  }
  if (failed.length > 0) throw new Error(`Not exported: ${failed.join('; ')}`);
}
