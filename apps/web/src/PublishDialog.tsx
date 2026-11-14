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
// Part 5: Publish to PNG has a Resolution, as the Plot dialog's PNG plotter does.
//
// M2-45 part 2: Add Sheets adds the sheets of drawings picked from the device (AutoCAD's Select
// Drawings): one open already, or added already, adds its own sheets; one not open is read to list
// its sheets and, when its sheets publish, opened with no tab (its engine and a hidden canvas to
// plot from) and closed after, as AutoCAD loads it. Page Setup's own entry names the page setup the
// layout has applied, "<Default: A3 Monochrome>".
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { download, downloadPdf } from './PlotDialog';
import { controllerOf } from './canvas/registry';
import type { OpenResult } from '@triya/io';
import { layoutsOf, spacesOf, type OpenDocument } from './documents';
import { engines } from './engine/registry';
import type { PlotStyleTable } from '@triya/render';
import {
  PNG_RESOLUTIONS,
  appliedPageSetupName,
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
  defaultPageSetup,
  drawingNamed,
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
  type PublishSpace,
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

/** Drawings that are not open, read and opened for a publish (M2-45 part 2, Add Sheets). */
export interface BackgroundDrawings {
  /** Reads a picked drawing as opening one does, without opening it. */
  read(file: File): Promise<OpenResult>;
  /** Opens a drawing read with no tab, once its canvas exists; undefined when it has none. */
  open(name: string, opened: OpenResult): Promise<OpenDocument | undefined>;
  /** Closes a drawing `open` opened. */
  close(id: number): void;
}

/** A drawing Add Sheets read: its sheets' `doc` is its `key`, below zero. */
interface AddedDrawing {
  readonly key: number;
  readonly name: string;
  readonly opened: OpenResult;
}

/** A drawing's spaces as the dialog lists them, each with the page setup its layout has applied. */
function publishSpaces(
  d: Pick<OpenDocument, 'opened'>,
  changes: Parameters<typeof spacesOf>[1],
): PublishSpace[] {
  const layouts = layoutsOf(d.opened.init, changes);
  return spacesOf(d, changes).map((s) => ({
    ...s,
    applied: appliedPageSetupName(layouts.find((l) => l.blockRecord === s.block)),
  }));
}

export function PublishDialog({
  doc,
  docs,
  underlayFile,
  underlayPage,
  userTables,
  background,
}: {
  doc: OpenDocument | undefined;
  /** Every open drawing, in tab order (part 6: Load All Open Drawings). */
  docs?: readonly OpenDocument[];
  underlayFile?: UnderlayFile;
  /** PDF underlays' pages for an SVG or PNG publish (M2-39 part 4). */
  underlayPage?: UnderlayPageSource;
  /** The plot style tables added in Settings (part 3). */
  userTables?: UserTables;
  /** Drawings that are not open (Add Sheets, M2-45 part 2). */
  background?: BackgroundDrawings;
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
      {...(background && { background })}
    />
  );
}

function PublishBody({
  doc,
  docs,
  underlayFile,
  underlayPage,
  userTables,
  background,
}: {
  doc: OpenDocument;
  docs: readonly OpenDocument[];
  underlayFile?: UnderlayFile;
  underlayPage?: UnderlayPageSource;
  userTables?: UserTables;
  background?: BackgroundDrawings;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [sheets, setSheets] = useState<PublishSheet[]>(() =>
    publishSheets(doc.name, publishSpaces(doc, engines.changesOf(doc.id)), doc.id),
  );
  const [added, setAdded] = useState<readonly AddedDrawing[]>([]);
  const nextKey = useRef(-1);
  const [selected, setSelected] = useState<number>();
  const [status, setStatus] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [log, setLog] = useState(false);
  const [device, setDevice] = useState<PublishDevice>('pdf');
  const [dpi, setDpi] = useState(150);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  const included = sheets.filter((s) => s.include);
  const key = (s: PublishSheet) => `${s.doc}:${s.block}`;
  const drawingOf = (s: PublishSheet) => docs.find((d) => d.id === s.doc);
  const openedOf = (s: PublishSheet) =>
    drawingOf(s)?.opened ?? added.find((a) => a.key === s.doc)?.opened;
  /** The named page setups a sheet may plot with: its drawing's, of its kind. */
  const setupsOf = (s: PublishSheet) => {
    const o = openedOf(s);
    return o ? pageSetupsOf(o.init.objects, s.block === o.modelSpace) : [];
  };

  /** Add Sheets: the picked drawings' sheets added after those listed. */
  const addSheets = async (files: readonly File[]) => {
    if (!background || busy || files.length === 0) return;
    setBusy(true);
    setError(undefined);
    let list = sheets;
    const more = [...added];
    const unread: string[] = [];
    for (const f of files) {
      const known = drawingNamed(f.name, [
        ...docs.map((d) => ({ doc: d.id, drawing: d.name })),
        ...more.map((a) => ({ doc: a.key, drawing: a.name })),
      ]);
      const open = docs.find((d) => d.id === known);
      let drawing: { doc: number; drawing: string; spaces: PublishSpace[] };
      if (open) {
        drawing = {
          doc: open.id,
          drawing: open.name,
          spaces: publishSpaces(open, engines.changesOf(open.id)),
        };
      } else {
        let a = more.find((x) => x.key === known);
        if (!a) {
          try {
            const opened = await background.read(f);
            if (!opened.modelSpace) throw new Error('the drawing has no model space');
            a = { key: nextKey.current--, name: f.name, opened };
            more.push(a);
          } catch (e) {
            unread.push(
              `${f.name} could not be read: ${e instanceof Error ? e.message : String(e)}`,
            );
            continue;
          }
        }
        drawing = { doc: a.key, drawing: a.name, spaces: publishSpaces(a, []) };
      }
      list = withOpenDrawings(list, [drawing]);
    }
    setAdded(more);
    setSheets(list);
    if (unread.length) setError(unread.join(' '));
    setBusy(false);
  };

  const loadAll = () => {
    setSheets(
      withOpenDrawings(
        sheets,
        docs.map((d) => ({
          doc: d.id,
          drawing: d.name,
          spaces: publishSpaces(d, engines.changesOf(d.id)),
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
    // Drawings Add Sheets read, opened for the publish (with no tab) and closed after it.
    const opening = new Map<number, Promise<OpenDocument | undefined>>();
    const sheetDrawing = (s: PublishSheet): Promise<OpenDocument | undefined> => {
      const open = drawingOf(s);
      if (open) return Promise.resolve(open);
      const a = added.find((x) => x.key === s.doc);
      if (!a || !background) return Promise.resolve(undefined);
      let p = opening.get(a.key);
      if (!p) opening.set(a.key, (p = background.open(a.name, a.opened)));
      return p;
    };
    try {
      const tables = userTables?.();
      const plotted: PlottedSheet[] = [];
      const failed = new Map<string, string>();
      for (const s of included) {
        try {
          const d = await sheetDrawing(s);
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
      for (const p of opening.values()) {
        const d = await p.catch(() => undefined);
        if (d) background?.close(d.id);
      }
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
      { dpi },
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
      {device === 'png' && (
        <label className="cad-dialog-field">
          <span>Resolution:</span>
          <select
            aria-label="Resolution"
            value={dpi}
            disabled={busy}
            onChange={(e) => setDpi(Number(e.currentTarget.value))}
          >
            {PNG_RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {`${r} dpi`}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="publish-tools" role="toolbar" aria-label="Sheet list">
        {background && (
          <>
            <button type="button" onClick={() => picker.current?.click()} disabled={busy}>
              Add Sheets…
            </button>
            <input
              ref={picker}
              type="file"
              accept=".dwg,.dxf"
              multiple
              hidden
              aria-label="Drawings to add"
              onChange={(e) => {
                const files = [...(e.currentTarget.files ?? [])];
                e.currentTarget.value = '';
                void addSheets(files);
              }}
            />
          </>
        )}
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
                    defaultPageSetup(s.applied)
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
                      <option value={DEFAULT_PAGE_SETUP}>{defaultPageSetup(s.applied)}</option>
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
