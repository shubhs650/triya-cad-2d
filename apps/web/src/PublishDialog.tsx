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
//
// M2-45 part 3: Save Sheet List downloads the list as a DSD file and Load Sheet List reads one
// (sheet-list.ts), asking to Replace or Append when sheets are listed already, as AutoCAD's
// Publish does; a sheet whose drawing is not open is listed as "Drawing file not found" until Add
// Sheets supplies it. "Open in viewer when done" opens the published PDF (or the one SVG or PNG)
// in a new browser tab: the tab opens on the Publish click (a tab opened when the publish ends,
// seconds later, is a pop-up the browser blocks) and shows the file when it is written, in the
// browser's own PDF viewer (an <embed>) or as a picture, titled with the file's name.
//
// M6-05: "Include when adding sheets" (Model tab, Layout tabs; kept for the session, as AutoCAD
// keeps it between publishes) decides which spaces the list opens with and which Load All Open
// Drawings and Add Sheets add. Rename Sheet (the button, F2 or a double-click on the name) names
// the selected sheet in place: Enter keeps the name, Esc leaves it. Publish Options... (AutoCAD's
// Publish Options dialog, its General PDF options) sets the PDF's Type, a single-sheet file a
// sheet or one multi-sheet file, and the multi-sheet file's name; PDF Options... is Save As
// PDF's dialog (PdfOptions.tsx: layers, hyperlinks, bookmarks, text as geometry). The sheet list
// keeps them all.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Group, download, downloadPdf } from './PlotDialog';
import { PdfOptionsDialog } from './PdfOptions';
import { controllerOf } from './canvas/registry';
import type { OpenResult } from '@triya/io';
import { layoutsOf, spacesOf, type OpenDocument } from './documents';
import { engines } from './engine/registry';
import { drawingObjects } from './saved-views';
import type { PlotStyleTable } from '@triya/render';
import {
  PLOT_PDF_OPTIONS,
  PNG_RESOLUTIONS,
  appliedPageSetupName,
  defaultPlotSettings,
  pageSetupsOf,
  plotFile,
  withPageSetup,
  type PdfOptions,
  type UnderlayPageSource,
} from './plot';
import { plotSpaceOf } from './plot-spaces';
import { plotRequest } from './plot-preview';
import {
  DEFAULT_PAGE_SETUP,
  INCLUDE_ALL,
  PUBLISH_FILE_TYPES,
  PUBLISH_TO,
  defaultPageSetup,
  drawingNamed,
  movedSheet,
  multiSheetFileName,
  publishFileName,
  publishLog,
  publishLogName,
  publishPdf,
  publishPdfFiles,
  publishSheetFiles,
  publishSheets,
  publishedDownload,
  renamedSheet,
  withOpenDrawings,
  type IncludeWhenAdding,
  type PlottedSheet,
  type PublishDevice,
  type PublishFileType,
  type PublishFailure,
  type PublishSheet,
  type PublishSpace,
} from './publish';
import {
  appendedSheets,
  listedSheets,
  readSheetList,
  sheetKey,
  sheetListName,
  withDrawingFound,
  writeSheetList,
  type ListedDrawing,
} from './sheet-list';

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

/** Include when adding sheets (M6-05): kept for the session, every open of the dialog. */
let includeWhenAdding: IncludeWhenAdding = INCLUDE_ALL;

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
  const listPicker = useRef<HTMLInputElement>(null);
  const ask = useRef<HTMLDialogElement>(null);
  const [include, setInclude] = useState(includeWhenAdding);
  const [sheets, setSheets] = useState<PublishSheet[]>(() =>
    publishSheets(doc.name, publishSpaces(doc, engines.changesOf(doc.id)), doc.id, include),
  );
  /** The sheet being renamed and the name typed (M6-05). */
  const [renaming, setRenaming] = useState<{ readonly at: number; readonly name: string }>();
  /** Set once Enter or Esc ends a rename, so the blur of the box going away does nothing. */
  const renameEnded = useRef(false);
  const [fileType, setFileType] = useState<PublishFileType>('multi');
  const [fileName, setFileName] = useState('');
  const [pdfOptions, setPdfOptions] = useState<PdfOptions>(PLOT_PDF_OPTIONS);
  const [options, setOptions] = useState<'publish' | 'pdf'>();
  const [added, setAdded] = useState<readonly AddedDrawing[]>([]);
  const nextKey = useRef(-1);
  const [selected, setSelected] = useState<number>();
  const [status, setStatus] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [log, setLog] = useState(false);
  const [device, setDevice] = useState<PublishDevice>('pdf');
  const [dpi, setDpi] = useState(150);
  const [viewFile, setViewFile] = useState(false);
  /** A loaded list's sheets waiting on Replace or Append. */
  const [loaded, setLoaded] = useState<readonly PublishSheet[]>();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  const included = sheets.filter((s) => s.include);
  const key = sheetKey;
  const drawingOf = (s: PublishSheet) => docs.find((d) => d.id === s.doc);
  const openedOf = (s: PublishSheet) =>
    drawingOf(s)?.opened ?? added.find((a) => a.key === s.doc)?.opened;
  /** The named page setups a sheet may plot with: its drawing's, of its kind. */
  const setupsOf = (s: PublishSheet) => {
    const o = openedOf(s);
    // An open drawing's as edited (M6-01 part 3: the Page Setup Manager's).
    const d = drawingOf(s);
    return o && s.missing === undefined
      ? pageSetupsOf(
          d ? drawingObjects(o.init, engines.changesOf(d.id)) : o.init.objects,
          s.block === o.modelSpace,
        )
      : [];
  };
  /** A drawing open or added, as a loaded sheet list finds its sheets in it (part 3). */
  const listed = (
    doc: number,
    drawing: string,
    o: Pick<OpenDocument, 'opened'>,
    spaces: PublishSpace[],
  ): ListedDrawing => ({
    doc,
    drawing,
    spaces,
    pageSetups: (block) =>
      pageSetupsOf(o.opened.init.objects, block === o.opened.modelSpace).map((p) => p.name),
  });

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
      let drawing: ListedDrawing;
      if (open) {
        drawing = listed(open.id, open.name, open, publishSpaces(open, engines.changesOf(open.id)));
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
        drawing = listed(a.key, a.name, a, publishSpaces(a, []));
      }
      // A loaded list's sheets of this drawing are found in it (part 3), then the rest added.
      list = withOpenDrawings(withDrawingFound(list, drawing), [drawing], include);
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
        include,
      ),
    );
  };

  const includeChanged = (p: Partial<IncludeWhenAdding>) => {
    includeWhenAdding = { ...include, ...p };
    setInclude(includeWhenAdding);
  };

  /** Rename Sheet: the name typed kept (Enter, or leaving the box), or why it is refused. */
  const rename = () => {
    if (!renaming || renameEnded.current) return;
    const out = renamedSheet(sheets, renaming.at, renaming.name);
    if (typeof out === 'string') {
      setError(out);
      return;
    }
    setError(undefined);
    setSheets(out);
    renameEnded.current = true;
    setRenaming(undefined);
  };
  const startRename = (i: number | undefined) => {
    if (busy || i === undefined || !sheets[i]) return;
    renameEnded.current = false;
    setRenaming({ at: i, name: sheets[i].sheet });
  };

  /** Save Sheet List (part 3): the list as a DSD file. */
  const saveList = () => {
    const text = writeSheetList(sheets, {
      device,
      dpi,
      viewFile,
      log,
      fileType,
      fileName,
      pdf: pdfOptions,
    });
    download(sheetListName(doc.name), new TextEncoder().encode(text), 'text/plain');
  };

  /** Load Sheet List (part 3): replaces the list, or asks first when sheets are listed. */
  const loadList = async (file: File) => {
    setError(undefined);
    try {
      const { entries, options } = readSheetList(await file.text());
      const drawings = [
        ...docs.map((d) => listed(d.id, d.name, d, publishSpaces(d, engines.changesOf(d.id)))),
        ...added.map((a) => listed(a.key, a.name, a, publishSpaces(a, []))),
      ];
      const list = listedSheets(entries, drawings);
      if (options.device) setDevice(options.device);
      if (options.dpi) setDpi(options.dpi);
      if (options.viewFile !== undefined) setViewFile(options.viewFile);
      if (options.log !== undefined) setLog(options.log);
      if (options.fileType) setFileType(options.fileType);
      if (options.fileName !== undefined) setFileName(options.fileName);
      if (options.pdf) setPdfOptions(options.pdf);
      setStatus(new Map());
      if (sheets.length === 0) {
        setSheets(list);
        setSelected(undefined);
      } else {
        setLoaded(list);
        ask.current?.showModal();
      }
    } catch (e) {
      setError(`${file.name} could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** The Replace or Append answer to a loaded list; undefined is Cancel. */
  const answer = (how?: 'replace' | 'append') => {
    ask.current?.close();
    if (loaded && how) {
      setSheets(how === 'replace' ? [...loaded] : appendedSheets(sheets, loaded));
      setSelected(undefined);
    }
    setLoaded(undefined);
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
    // Open in viewer when done: a tab opened now, while the click lets the page open one.
    const viewer = viewFile ? window.open('', '_blank') : null;
    let viewed = false;
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
          if (s.missing !== undefined) throw new Error(`${s.missing}.`);
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
      if (viewer && written.view) {
        showInViewer(viewer, written.view);
        viewed = true;
      }
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
      if (viewer && !viewed) viewer.close();
      for (const p of opening.values()) {
        const d = await p.catch(() => undefined);
        if (d) background?.close(d.id);
      }
      setBusy(false);
    }
  };

  /**
   * The plotted sheets written and downloaded as Publish to says; `published` when any did, and
   * `view` the file a viewer shows (a PDF, or one SVG or PNG; a ZIP has none).
   */
  const write = async (
    plotted: readonly PlottedSheet[],
  ): Promise<{
    published: boolean;
    failed: readonly PublishFailure[];
    view?: ViewedFile;
  }> => {
    if (device === 'pdf' && fileType === 'multi') {
      const name = multiSheetFileName(fileName, doc.name);
      const result = publishPdf(plotted, name.replace(/\.pdf$/i, ''), underlayFile, pdfOptions);
      if (!result.bytes) return { published: false, failed: result.failed };
      downloadPdf(name, result.bytes);
      return {
        published: true,
        failed: result.failed,
        view: { name, bytes: result.bytes, type: 'application/pdf' },
      };
    }
    if (device === 'pdf') {
      // Single-sheet files (M6-05): a PDF a sheet, one as itself and several in one ZIP.
      const { files, failed } = publishPdfFiles(plotted, underlayFile, pdfOptions);
      const file = publishedDownload(files, publishFileName(doc.name, 'zip'));
      if (!file) return { published: false, failed };
      download(file.name, file.bytes, file.type);
      return { published: true, failed, ...(file.type !== 'application/zip' && { view: file }) };
    }
    const { files, failed } = await publishSheetFiles(
      plotted,
      device,
      (parts, page, settings, space, title) =>
        plotFile(parts, page, settings, space, title, underlayFile, underlayPage),
      { dpi },
    );
    const file = publishedDownload(files, publishFileName(doc.name, 'zip'));
    if (!file) return { published: false, failed };
    download(file.name, file.bytes, file.type);
    return {
      published: true,
      failed,
      ...(file.type !== 'application/zip' && { view: file }),
    };
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
      <div className="publish-tools">
        <button type="button" disabled={busy} onClick={() => setOptions('publish')}>
          Publish Options…
        </button>
        {device === 'pdf' && (
          <button type="button" disabled={busy} onClick={() => setOptions('pdf')}>
            PDF Options…
          </button>
        )}
      </div>
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
        <button type="button" onClick={() => listPicker.current?.click()} disabled={busy}>
          Load Sheet List…
        </button>
        <input
          ref={listPicker}
          type="file"
          accept=".dsd"
          hidden
          aria-label="Sheet list to load"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) void loadList(file);
          }}
        />
        <button type="button" onClick={saveList} disabled={busy || sheets.length === 0}>
          Save Sheet List…
        </button>
        <button type="button" onClick={remove} disabled={busy || selected === undefined}>
          Remove Sheets
        </button>
        <button
          type="button"
          onClick={() => startRename(selected)}
          disabled={busy || selected === undefined}
        >
          Rename Sheet
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
                onKeyDown={(e) => {
                  if (e.key === 'F2' && renaming === undefined) {
                    e.preventDefault();
                    startRename(i);
                  }
                }}
              >
                <td onDoubleClick={() => startRename(i)}>
                  {renaming?.at === i ? (
                    <input
                      type="text"
                      aria-label="Sheet name"
                      className="publish-rename"
                      value={renaming.name}
                      autoFocus
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setRenaming({ at: i, name: e.currentTarget.value })}
                      onBlur={rename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          rename();
                        } else if (e.key === 'Escape') {
                          // Esc leaves the name as it was and the dialog up.
                          e.preventDefault();
                          renameEnded.current = true;
                          setRenaming(undefined);
                          setError(undefined);
                        }
                      }}
                    />
                  ) : (
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
                  )}
                </td>
                <td>
                  {setups.length === 0 ? (
                    (s.pageSetup ?? defaultPageSetup(s.applied))
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
                <td>{status.get(key(s)) ?? s.missing ?? (s.include ? '' : 'Not included')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Group label="Include when adding sheets">
        <Check
          label="Model tab"
          checked={include.model}
          onChange={(model) => includeChanged({ model })}
        />
        <Check
          label="Layout tabs"
          checked={include.layouts}
          onChange={(layouts) => includeChanged({ layouts })}
        />
      </Group>
      <Check label="Save publish log" checked={log} onChange={setLog} />
      <Check label="Open in viewer when done" checked={viewFile} onChange={setViewFile} />
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
      {options === 'pdf' && (
        <PdfOptionsDialog
          value={pdfOptions}
          onOk={(v) => {
            setPdfOptions(v);
            setOptions(undefined);
          }}
          onCancel={() => setOptions(undefined)}
        />
      )}
      {options === 'publish' && (
        <PublishOptionsDialog
          value={{ fileType, fileName }}
          drawing={doc.name}
          onOk={(v) => {
            setFileType(v.fileType);
            setFileName(v.fileName);
            setOptions(undefined);
          }}
          onCancel={() => setOptions(undefined)}
        />
      )}
      <dialog
        ref={ask}
        className="cad-dialog"
        aria-label="Replace or Append"
        onCancel={(e) => {
          // Esc answers Cancel here and leaves the Publish dialog up.
          e.preventDefault();
          e.stopPropagation();
          answer();
        }}
      >
        <h2 className="cad-dialog-title">Replace or Append</h2>
        <p>Replace the sheets listed with the sheet list loaded, or append its sheets to them?</p>
        <div className="cad-dialog-buttons">
          <button type="button" onClick={() => answer('replace')}>
            Replace
          </button>
          <button type="button" onClick={() => answer('append')}>
            Append
          </button>
          <button type="button" onClick={() => answer()}>
            Cancel
          </button>
        </div>
      </dialog>
    </dialog>
  );
}

/**
 * Publish Options (M6-05; AutoCAD 2024 Help, "Publish Options Dialog Box"): its General DWF/PDF
 * options that a PDF publish uses, Type (Single-sheet file, Multi-sheet file) and the multi-sheet
 * file's name. AutoCAD's Naming "Prompt for name" is the browser's download, its output location
 * the browser's downloads folder; its DWF and 3D DWF choices have no Triya plotter, and layer
 * information is the PDF Options' Include layer information.
 */
function PublishOptionsDialog({
  value,
  drawing,
  onOk,
  onCancel,
}: {
  value: { readonly fileType: PublishFileType; readonly fileName: string };
  drawing: string;
  onOk: (v: { fileType: PublishFileType; fileName: string }) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [fileType, setFileType] = useState(value.fileType);
  const [fileName, setFileName] = useState(value.fileName);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="cad-dialog"
      aria-label="Publish Options"
      onCancel={(e) => {
        // Esc closes this dialog only, leaving the Publish dialog up.
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2 className="cad-dialog-title">Publish Options</h2>
      <Group label="General PDF options">
        <label className="cad-dialog-field">
          <span>Type:</span>
          <select
            aria-label="Type"
            value={fileType}
            onChange={(e) => setFileType(e.currentTarget.value as PublishFileType)}
          >
            {PUBLISH_FILE_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="cad-dialog-field">
          <span>Multi-sheet file name:</span>
          <input
            type="text"
            aria-label="Multi-sheet file name"
            value={fileName}
            placeholder={publishFileName(drawing)}
            disabled={fileType !== 'multi'}
            onChange={(e) => setFileName(e.currentTarget.value)}
          />
        </label>
      </Group>
      <p className="export-note">
        A single-sheet file is named after its sheet; several download as one ZIP.
      </p>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => onOk({ fileType, fileName: fileName.trim() })}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

/** A published file "Open in viewer when done" shows. */
interface ViewedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly type: string;
}

/**
 * Shows a published file in the tab opened for it (part 3): a PDF in the browser's PDF viewer
 * (an <embed> filling the tab), an SVG or PNG as a picture. The tab is the app's own about:blank
 * page, so it takes the app's blob: URL, which lives as long as the app's page; it is not revoked,
 * as the PDF viewer reads it again to save or print.
 */
function showInViewer(viewer: Window, file: ViewedFile): void {
  const url = URL.createObjectURL(
    new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.type }),
  );
  const d = viewer.document;
  d.title = file.name;
  d.body.style.margin = '0';
  const pdf = file.type === 'application/pdf';
  const el = d.createElement(pdf ? 'embed' : 'img');
  el.setAttribute('src', url);
  if (pdf) {
    el.setAttribute('type', file.type);
    el.style.cssText = 'display:block;width:100vw;height:100vh;border:0';
  } else {
    el.setAttribute('alt', file.name);
    el.style.cssText = 'display:block;max-width:100%;margin:auto';
  }
  d.body.replaceChildren(el);
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
