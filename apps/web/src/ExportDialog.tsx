// The Export Data (EXPORT) and Save As PDF (EXPORTPDF) dialogs (M2-39 part 2), with AutoCAD's
// labels (UI_SPEC.md §7): File name, Files of type (Export Data only: PDF, SVG, PNG and DXF, see
// export.ts), and Export: Display, Extents or Window in model space, Current layout or All layouts
// in a layout (All layouts for a PDF only). Each plot uses the space's current page setup, as
// AutoCAD's "Page setup: Current" does. Choosing Window hides the dialog and the command asks for
// the corners at the command line, then shows the dialog again with them (Window< picks again).
// Save writes the file, which downloads as a plot does; Cancel (and Esc) closes.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Box } from '@triya/engine';
import type { PlotStyleTable } from '@triya/render';
import { download } from './PlotDialog';
import { controllerOf } from './canvas/registry';
import { spacesOf, type OpenDocument } from './documents';
import { engines } from './engine/registry';
import {
  EXPORT_AREA_LABELS,
  EXPORT_MEDIA,
  EXPORT_TYPES,
  defaultExportArea,
  exportAreas,
  exportFileName,
  exportSettings,
  withExportType,
  type ExportArea,
  type ExportType,
} from './export';
import { plotFile, plotPage, type PlotSpace, type UnderlayPageSource } from './plot';
import { plotRequest } from './plot-preview';
import { plotSpaceOf } from './plot-spaces';
import { publishPdf } from './publish';

/** EXPORT's Export Data or EXPORTPDF's Save As PDF. */
export type ExportKind = 'export' | 'exportpdf';

/** What the dialog shows, kept while a window is picked. */
interface ExportState {
  readonly type: ExportType;
  readonly area: ExportArea | undefined;
  readonly fileName: string;
  readonly window?: Box | undefined;
}

/**
 * Which drawing the dialog is open for, if any, and as which. The command opens it (`show`) and
 * waits until it closes: true when it closed for a window to be picked, its state kept for the
 * space it was open on until the command shows it again (`resume`).
 */
export const exportDialog = (() => {
  let open: { doc: number; kind: ExportKind } | undefined;
  let kept: { doc: number; block: string; kind: ExportKind; state: ExportState } | undefined;
  let done: ((pickWindow: boolean) => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (v: typeof open) => {
    open = v;
    for (const l of listeners) l();
  };
  const finish = (pickWindow: boolean) => {
    const d = done;
    done = undefined;
    d?.(pickWindow);
  };
  return {
    get: () => open,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    show(
      doc: number,
      kind: ExportKind,
      again: { window?: Box | undefined; resume?: boolean } = {},
    ): Promise<boolean> {
      finish(false);
      const { window, resume } = again;
      if (resume && kept?.doc === doc && kept.kind === kind) {
        if (window) kept = { ...kept, state: { ...kept.state, area: 'window', window } };
      } else kept = undefined;
      set({ doc, kind });
      return new Promise((resolve) => (done = resolve));
    },
    /** The state to reopen a space's dialog with, after a window was asked for in it. */
    resume: (doc: number, block: string, kind: ExportKind): ExportState | undefined =>
      kept?.doc === doc && kept.block === block && kept.kind === kind ? kept.state : undefined,
    /** Export Window: hides the dialog, keeping its state, for the command to ask for corners. */
    pickWindow(doc: number, block: string, kind: ExportKind, state: ExportState) {
      kept = { doc, block, kind, state };
      set(undefined);
      finish(true);
    },
    close() {
      kept = undefined;
      set(undefined);
      finish(false);
    },
  };
})();

type UnderlayFile = (fileName: string) => Uint8Array | undefined;

export function ExportDialog({
  doc,
  underlayFile,
  underlayPage,
  userTables,
  exportDxf,
}: {
  doc: OpenDocument | undefined;
  /** The PDF file a PDF underlay names, as supplied this session. */
  underlayFile?: UnderlayFile;
  /** Its page drawn, for an SVG or PNG export. */
  underlayPage?: UnderlayPageSource;
  /** The plot style tables added in Settings. */
  userTables?: () => ReadonlyMap<string, PlotStyleTable>;
  /** The drawing as an AC1032 DXF with its changes, as Save would write it. */
  exportDxf: (doc: number) => Promise<Uint8Array>;
}) {
  const open = useSyncExternalStore(exportDialog.subscribe, exportDialog.get);
  if (!doc || open?.doc !== doc.id) return null;
  return (
    <ExportBody
      key={`${doc.id}:${doc.block}:${open.kind}`}
      doc={doc}
      kind={open.kind}
      exportDxf={exportDxf}
      {...(underlayFile && { underlayFile })}
      {...(underlayPage && { underlayPage })}
      {...(userTables && { userTables })}
    />
  );
}

function ExportBody({
  doc,
  kind,
  underlayFile,
  underlayPage,
  userTables,
  exportDxf,
}: {
  doc: OpenDocument;
  kind: ExportKind;
  underlayFile?: UnderlayFile;
  underlayPage?: UnderlayPageSource;
  userTables?: () => ReadonlyMap<string, PlotStyleTable>;
  exportDxf: (doc: number) => Promise<Uint8Array>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [space, setSpace] = useState<PlotSpace>();
  const [s, setState] = useState<ExportState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const block = doc.block;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    let live = true;
    const controller = controllerOf(doc.id, block);
    void controller?.plotSpace().then((measured) => {
      if (!live) return;
      const sp = { ...measured, userTables: userTables?.() };
      setSpace(sp);
      const area = defaultExportArea(sp);
      setState(
        exportDialog.resume(doc.id, block, kind) ?? {
          type: 'pdf',
          area,
          fileName: exportFileName(doc.name, sp, 'pdf', area),
        },
      );
    });
    return () => {
      live = false;
      d?.close();
    };
  }, [doc.id, doc.name, block, kind, userTables]);

  // A choice that changes the suggested name changes the name, unless the drafter typed one.
  const choose = (type: ExportType, area: ExportArea | undefined) => {
    if (!s || !space) return;
    setError(undefined);
    const suggested = exportFileName(doc.name, space, s.type, s.area);
    const fileName =
      s.fileName === suggested
        ? exportFileName(doc.name, space, type, area)
        : withExportType(s.fileName, type);
    const next = { ...s, type, area, fileName };
    if (area === 'window' && (s.area !== 'window' || !s.window)) {
      // Export Window: the corners at the command line, then the dialog again.
      exportDialog.pickWindow(doc.id, block, kind, next);
      return;
    }
    setState(next);
  };

  const chooseType = (type: ExportType) => {
    if (!s || !space) return;
    const areas = exportAreas(space, type);
    const area = s.area && areas.includes(s.area) ? s.area : areas[0] && defaultExportArea(space);
    choose(type, area);
  };

  const save = async () => {
    if (!s || !space || busy) return;
    setError(undefined);
    const name = withExportType(s.fileName, s.type);
    setBusy(true);
    try {
      if (s.type === 'dxf') {
        download(name, await exportDxf(doc.id), EXPORT_MEDIA.dxf);
      } else if (s.area === 'all') {
        await exportLayouts(name);
      } else {
        const controller = controllerOf(doc.id, block);
        if (!controller) throw new Error('There is nothing to export.');
        const settings = exportSettings(
          space,
          s.type,
          s.area ?? defaultExportArea(space),
          s.window,
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
          underlayFile,
          underlayPage,
        );
        download(name, file.bytes, file.type);
      }
      exportDialog.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  // All layouts: one PDF, a page per layout in tab order with its page setup, as PUBLISH makes.
  const exportLayouts = async (name: string) => {
    const active = controllerOf(doc.id, block);
    if (!active) throw new Error('There is nothing to export.');
    const tables = userTables?.();
    const layouts = spacesOf(doc, engines.changesOf(doc.id)).filter(
      (l) => l.block !== doc.opened.modelSpace,
    );
    const base = doc.name.replace(/\.[^.]+$/, '');
    const plotted = [];
    const failed: string[] = [];
    for (const l of layouts) {
      const sheet = `${base}-${l.name}`;
      try {
        const sp = await plotSpaceOf(doc, l.block, l.name, tables);
        if (!sp) throw new Error('There is nothing to plot.');
        const settings = exportSettings(sp, 'pdf', 'all');
        const parts = await active.plot({ block: l.block, ...plotRequest(settings, sp) });
        plotted.push({ sheet, space: sp, parts });
      } catch (e) {
        failed.push(`${sheet}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const result = publishPdf(plotted, base, underlayFile);
    failed.push(...result.failed.map((f) => `${f.sheet}: ${f.message}`));
    if (!result.bytes) throw new Error(failed[0] ?? 'The drawing has no layouts to export.');
    download(name, result.bytes, EXPORT_MEDIA.pdf);
    if (failed.length > 0) throw new Error(`Not exported: ${failed.join('; ')}`);
  };

  const title = kind === 'exportpdf' ? 'Save As PDF' : 'Export Data';
  const areas = s && space ? exportAreas(space, s.type) : [];
  return (
    <dialog
      ref={ref}
      className="cad-dialog export-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        exportDialog.close();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        const t = e.target as HTMLElement;
        if (e.key === 'Enter' && t.tagName === 'INPUT') {
          e.preventDefault();
          void save();
        }
      }}
    >
      <h2 className="cad-dialog-title">{title}</h2>
      {s && space && (
        <div className="export-form">
          <label className="cad-dialog-field">
            <span>File name:</span>
            <input
              type="text"
              value={s.fileName}
              onChange={(e) => setState({ ...s, fileName: e.currentTarget.value })}
              aria-label="File name"
              spellCheck={false}
            />
          </label>
          {kind === 'export' && (
            <label className="cad-dialog-field">
              <span>Files of type:</span>
              <select
                value={s.type}
                onChange={(e) => chooseType(e.currentTarget.value as ExportType)}
                aria-label="Files of type"
              >
                {EXPORT_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {areas.length > 0 && (
            <div className="export-area">
              <label className="cad-dialog-field">
                <span>Export:</span>
                <select
                  value={s.area}
                  onChange={(e) => choose(s.type, e.currentTarget.value as ExportArea)}
                  aria-label="Export"
                >
                  {areas.map((a) => (
                    <option key={a} value={a}>
                      {EXPORT_AREA_LABELS[a]}
                    </option>
                  ))}
                </select>
              </label>
              {s.area === 'window' && (
                <button
                  type="button"
                  onClick={() => exportDialog.pickWindow(doc.id, block, kind, s)}
                  disabled={busy}
                >
                  Window&lt;
                </button>
              )}
            </div>
          )}
          {areas.length > 0 && (
            <p className="export-note">
              Page setup: Current ({space.name}){s.area === 'all' ? ', each layout its own' : ''}
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="publish-status" role="alert">
          {error}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" disabled={busy || !s} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => exportDialog.close()}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
