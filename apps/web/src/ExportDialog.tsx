// The Export Data (EXPORT) and Save As PDF (EXPORTPDF) dialogs (M2-39 part 2), with AutoCAD's
// labels (UI_SPEC.md §7): File name, Files of type (Export Data only: PDF, SVG, PNG and DXF, see
// export.ts), and Export: Display, Extents or Window in model space, Current layout or All layouts
// in a layout (All layouts as SVG or PNG since M2-39 part 4: a file a layout in one ZIP). Each plot uses the space's current page setup, as
// AutoCAD's "Page setup: Current" does. Choosing Window hides the dialog and the command asks for
// the corners at the command line, then shows the dialog again with them (Window< picks again).
// Save writes the file, which downloads as a plot does; Cancel (and Esc) closes.
//
// Part 5: "Page setup:" Current or Override; Override opens the Page Setup Override dialog
// (PageSetupOverride.tsx), whose paper, orientation, scale and plot style table replace the page
// setup's for this export ("Page Setup Override..." opens it again). A PNG has a Resolution. The
// file is written by export-file.ts, which -EXPORT's also is.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Box } from '@triya/engine';
import type { PlotStyleTable } from '@triya/render';
import { PageSetupOverrideDialog } from './PageSetupOverride';
import { controllerOf } from './canvas/registry';
import type { OpenDocument } from './documents';
import {
  EXPORT_AREA_LABELS,
  EXPORT_TYPES,
  defaultExportArea,
  exportAreas,
  exportFileName,
  pageSetupOverride,
  withExportType,
  type ExportArea,
  type ExportType,
  type PageSetupOverride,
} from './export';
import { exportFile } from './export-file';
import { PNG_RESOLUTIONS, type PlotSpace, type UnderlayPageSource } from './plot';

/** EXPORT's Export Data or EXPORTPDF's Save As PDF. */
export type ExportKind = 'export' | 'exportpdf';

/** What the dialog shows, kept while a window is picked. */
interface ExportState {
  readonly type: ExportType;
  readonly area: ExportArea | undefined;
  readonly fileName: string;
  readonly window?: Box | undefined;
  /** Page setup: Override's paper, orientation, scale and table (part 5); absent for Current. */
  readonly override?: PageSetupOverride | undefined;
  /** A PNG's resolution (part 5). */
  readonly dpi: number;
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
  const [overriding, setOverriding] = useState(false);
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
          dpi: 150,
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
        : withExportType(s.fileName, type, area);
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
    const file = withExportType(s.fileName, s.type, s.area);
    setBusy(true);
    try {
      await exportFile(
        doc,
        space,
        { type: s.type, file, area: s.area, window: s.window, override: s.override, dpi: s.dpi },
        { underlayFile, underlayPage, userTables: userTables?.(), exportDxf },
      );
      exportDialog.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
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
          {s.type === 'png' && (
            <label className="cad-dialog-field">
              <span>Resolution:</span>
              <select
                aria-label="Resolution"
                value={s.dpi}
                onChange={(e) => setState({ ...s, dpi: Number(e.currentTarget.value) })}
              >
                {PNG_RESOLUTIONS.map((dpi) => (
                  <option key={dpi} value={dpi}>
                    {`${dpi} dpi`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {areas.length > 0 && (
            <div className="export-area">
              <label className="cad-dialog-field">
                <span>Page setup:</span>
                <select
                  aria-label="Page setup"
                  value={s.override ? 'override' : 'current'}
                  onChange={(e) => {
                    if (e.currentTarget.value === 'current')
                      setState({ ...s, override: undefined });
                    // Override opens the Page Setup Override dialog, as AutoCAD's does.
                    else setOverriding(true);
                  }}
                >
                  <option value="current">Current</option>
                  <option value="override">Override</option>
                </select>
              </label>
              <button type="button" disabled={busy} onClick={() => setOverriding(true)}>
                Page Setup Override...
              </button>
            </div>
          )}
          {areas.length > 0 && (
            <p className="export-note">
              {s.override
                ? `Page setup: Override (${space.name}'s, with the paper, orientation, scale and plot style table chosen)`
                : `Page setup: Current (${space.name})`}
              {s.area === 'all' ? (s.override ? ', every layout' : ', each layout its own') : ''}
              {s.area === 'all' && s.type !== 'pdf' && '. A file a layout, saved in one ZIP.'}
            </p>
          )}
        </div>
      )}
      {overriding && s && space && (
        <PageSetupOverrideDialog
          space={space}
          value={s.override ?? pageSetupOverride(space)}
          onOk={(override) => {
            setState({ ...s, override });
            setOverriding(false);
          }}
          onCancel={() => setOverriding(false)}
        />
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
