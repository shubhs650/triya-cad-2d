// The Publish dialog (M2-17 part 2; PUBLISH), with AutoCAD's labels (UI_SPEC.md §7): the drawing's
// sheets (model space, then each layout in tab order) with their page setups and a check to
// include each; "Publish to: PDF" (PDF, SVG or PNG since M2-39 part 4); Publish plots the included sheets into one PDF that downloads,
// each page labelled with its layout and bookmarked with its sheet's name. Cancel (and Esc)
// closes. A sheet that cannot plot is reported in its Status and the others still publish, as
// AutoCAD's publish log does.
//
// Part 3: each sheet plots with its page setup's plot style table and options (the drafter's own
// tables from Settings among them), as the Plot dialog opens on it.
//
// Part 6: each sheet's Page Setup is chosen from "<Default: None>" and the named page setups of
// its kind in its drawing; Load All Open Drawings adds the sheets of the other open drawings (a
// sheet plots from its own drawing's canvas); Remove Sheets, Move Sheet Up and Move Sheet Down act
// on the selected sheet (its row clicked or tabbed into); "Save publish log" downloads the log beside the PDF.
//
// M2-39 part 4: Publish to PDF, SVG or PNG; an SVG or PNG publish writes a file a sheet,
// downloaded as itself when one sheet published and as one ZIP when more did (publish.ts).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { download, downloadPdf } from './PlotDialog';
import { controllerOf } from './canvas/registry';
import { spacesOf, type OpenDocument } from './documents';
import { engines } from './engine/registry';
import type { PlotStyleTable } from '@triya/render';
import {
  defaultPlotSettings,
  pageSetupsOf,
  plotFile,
  withPageSetup,
  type UnderlayPageSource,
} from './plot';
import { plotSpaceOf } from './plot-spaces';
import { plotRequest } from './plot-preview';
import {
  DEFAULT_PAGE_SETUP,
  PUBLISH_TO,
  movedSheet,
  publishFileName,
  publishLog,
  publishLogName,
  publishPdf,
  publishSheetFiles,
  publishSheets,
  publishedDownload,
  withOpenDrawings,
  type PlottedSheet,
  type PublishDevice,
  type PublishFailure,
  type PublishSheet,
} from './publish';

/** Which drawing the dialog is open for, if any. */
export const publishDialog = (() => {
  let open: number | undefined;
  const listeners = new Set<() => void>();
  const set = (v: number | undefined) => {
    open = v;
    for (const l of listeners) l();
  };
  return {
    get: () => open,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    open: (doc: number) => set(doc),
    close: () => set(undefined),
  };
})();

/** The PDF file a PDF underlay names (M2-16 part 5): its pages plot as the Plot dialog's do. */
type UnderlayFile = (fileName: string) => Uint8Array | undefined;

type UserTables = () => ReadonlyMap<string, PlotStyleTable>;

export function PublishDialog({
  doc,
  docs,
  underlayFile,
  underlayPage,
  userTables,
}: {
  doc: OpenDocument | undefined;
  /** Every open drawing, in tab order (part 6: Load All Open Drawings). */
  docs?: readonly OpenDocument[];
  underlayFile?: UnderlayFile;
  /** PDF underlays' pages for an SVG or PNG publish (M2-39 part 4). */
  underlayPage?: UnderlayPageSource;
  /** The plot style tables added in Settings (part 3). */
  userTables?: UserTables;
}) {
  const open = useSyncExternalStore(publishDialog.subscribe, publishDialog.get);
  if (!doc || open !== doc.id) return null;
  return (
    <PublishBody
      key={doc.id}
      doc={doc}
      docs={docs ?? [doc]}
      {...(underlayFile && { underlayFile })}
      {...(underlayPage && { underlayPage })}
      {...(userTables && { userTables })}
    />
  );
}

function PublishBody({
  doc,
  docs,
  underlayFile,
  underlayPage,
  userTables,
}: {
  doc: OpenDocument;
  docs: readonly OpenDocument[];
  underlayFile?: UnderlayFile;
  underlayPage?: UnderlayPageSource;
  userTables?: UserTables;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [sheets, setSheets] = useState<PublishSheet[]>(() =>
    publishSheets(doc.name, spacesOf(doc, engines.changesOf(doc.id)), doc.id),
  );
  const [selected, setSelected] = useState<number>();
  const [status, setStatus] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [log, setLog] = useState(false);
  const [device, setDevice] = useState<PublishDevice>('pdf');

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  const included = sheets.filter((s) => s.include);
  const key = (s: PublishSheet) => `${s.doc}:${s.block}`;
  const drawingOf = (s: PublishSheet) => docs.find((d) => d.id === s.doc);
  /** The named page setups a sheet may plot with: its drawing's, of its kind. */
  const setupsOf = (s: PublishSheet) => {
    const d = drawingOf(s);
    return d ? pageSetupsOf(d.opened.init.objects, s.block === d.opened.modelSpace) : [];
  };

  const loadAll = () => {
    setSheets(
      withOpenDrawings(
        sheets,
        docs.map((d) => ({
          doc: d.id,
          drawing: d.name,
          spaces: spacesOf(d, engines.changesOf(d.id)),
        })),
      ),
    );
  };

  const move = (by: -1 | 1) => {
    if (selected === undefined) return;
    const j = selected + by;
    setSheets(movedSheet(sheets, selected, by));
    if (j >= 0 && j < sheets.length) setSelected(j);
  };

  const remove = () => {
    if (selected === undefined) return;
    setSheets(sheets.filter((_, i) => i !== selected));
    setSelected(undefined);
  };

  const publish = async () => {
    if (busy || included.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      const tables = userTables?.();
      const plotted: PlottedSheet[] = [];
      const failed = new Map<string, string>();
      for (const s of included) {
        try {
          const d = drawingOf(s);
          // A sheet plots from its own drawing's canvas, shown or not (`plotSpaceOf`).
          const active = d && controllerOf(d.id, d.block);
          const own = d && (await plotSpaceOf(d, s.block, s.name, tables));
          if (!active || !own) throw new Error('There is nothing to plot.');
          const space = withPageSetup(own, s.pageSetup);
          // The page setup's plot style table resolves the parts' colours and lineweights.
          const request = plotRequest(defaultPlotSettings(space), space);
          const parts = await active.plot({ block: s.block, ...request });
          plotted.push({ sheet: s.sheet, space, parts });
        } catch (e) {
          failed.set(key(s), e instanceof Error ? e.message : String(e));
        }
      }
      const written = await write(plotted);
      const bySheet = new Map(written.failed.map((f) => [f.sheet, f.message]));
      for (const s of included) {
        const m = bySheet.get(s.sheet);
        if (m !== undefined && !failed.has(key(s))) failed.set(key(s), m);
      }
      if (log) {
        const rows = included.map((s) => ({ sheet: s, status: failed.get(key(s)) ?? 'Published' }));
        const text = publishLog(rows, new Date());
        download(publishLogName(doc.name), new TextEncoder().encode(text), 'text/csv');
      }
      if (failed.size === 0) {
        publishDialog.close();
        return;
      }
      setStatus(new Map(included.map((s) => [key(s), failed.get(key(s)) ?? 'Published'])));
      setError(
        written.published
          ? `Published ${included.length - failed.size} of ${included.length} sheets.`
          : 'No sheet could be published.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** The plotted sheets written and downloaded as Publish to says; true when any published. */
  const write = async (
    plotted: readonly PlottedSheet[],
  ): Promise<{ published: boolean; failed: readonly PublishFailure[] }> => {
    if (device === 'pdf') {
      const result = publishPdf(plotted, doc.name.replace(/\.[^.]+$/, ''), underlayFile);
      if (result.bytes) downloadPdf(publishFileName(doc.name), result.bytes);
      return { published: result.bytes !== undefined, failed: result.failed };
    }
    const { files, failed } = await publishSheetFiles(
      plotted,
      device,
      (parts, page, settings, space, title) =>
        plotFile(parts, page, settings, space, title, underlayFile, underlayPage),
    );
    const file = publishedDownload(files, publishFileName(doc.name, 'zip'));
    if (file) download(file.name, file.bytes, file.type);
    return { published: file !== undefined, failed };
  };

  return (
    <dialog
      ref={ref}
      className="cad-dialog publish-dialog"
      aria-label="Publish"
      onCancel={(e) => {
        e.preventDefault();
        publishDialog.close();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2 className="cad-dialog-title">Publish</h2>
      <label className="cad-dialog-field">
        <span>Publish to:</span>
        <select
          aria-label="Publish to"
          value={device}
          disabled={busy}
          onChange={(e) => setDevice(e.currentTarget.value as PublishDevice)}
        >
          {PUBLISH_TO.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <div className="publish-tools" role="toolbar" aria-label="Sheet list">
        <button type="button" onClick={loadAll} disabled={busy}>
          Load All Open Drawings
        </button>
        <button type="button" onClick={remove} disabled={busy || selected === undefined}>
          Remove Sheets
        </button>
        <button type="button" onClick={() => move(-1)} disabled={busy || !selected}>
          Move Sheet Up
        </button>
        <button
          type="button"
          onClick={() => move(1)}
          disabled={busy || selected === undefined || selected >= sheets.length - 1}
        >
          Move Sheet Down
        </button>
      </div>
      <table className="publish-sheets" aria-label="Sheets to publish">
        <thead>
          <tr>
            <th scope="col">Sheet Name</th>
            <th scope="col">Page Setup</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {sheets.map((s, i) => {
            const setups = setupsOf(s);
            return (
              <tr
                key={key(s)}
                aria-selected={selected === i}
                className={selected === i ? 'selected' : undefined}
                onClick={() => setSelected(i)}
                // Tabbing into the row's check or page setup selects it too (keyboard use).
                onFocus={() => setSelected(i)}
              >
                <td>
                  <label className="cad-dialog-check">
                    <input
                      type="checkbox"
                      checked={s.include}
                      onChange={(e) => {
                        const include = e.currentTarget.checked;
                        setSheets(sheets.map((t, j) => (j === i ? { ...t, include } : t)));
                      }}
                    />
                    {s.sheet}
                  </label>
                </td>
                <td>
                  {setups.length === 0 ? (
                    DEFAULT_PAGE_SETUP
                  ) : (
                    <select
                      aria-label={`Page setup of ${s.sheet}`}
                      value={s.pageSetup ?? DEFAULT_PAGE_SETUP}
                      onChange={(e) => {
                        const v = e.currentTarget.value;
                        setSheets(
                          sheets.map((t, j) => {
                            if (j !== i) return t;
                            const { pageSetup: _p, ...rest } = t;
                            return v === DEFAULT_PAGE_SETUP ? rest : { ...rest, pageSetup: v };
                          }),
                        );
                      }}
                    >
                      <option value={DEFAULT_PAGE_SETUP}>{DEFAULT_PAGE_SETUP}</option>
                      {setups.map((p) => (
                        <option key={p.handle} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td>{status.get(key(s)) ?? (s.include ? '' : 'Not included')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Check label="Save publish log" checked={log} onChange={setLog} />
      {error && (
        <p className="publish-status" role="alert">
          {error}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button
          type="button"
          disabled={busy || included.length === 0}
          onClick={() => void publish()}
        >
          {busy ? 'Publishing…' : 'Publish'}
        </button>
        <button type="button" onClick={() => publishDialog.close()}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="cad-dialog-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      {label}
    </label>
  );
}
