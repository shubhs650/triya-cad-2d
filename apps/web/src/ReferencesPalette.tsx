// The References palette (M1-21, UI_SPEC.md §4 "References"): the drawing's xrefs, raster
// images and PDF underlays as AutoCAD's External References palette lists them, a tree with
// each reference's status, type and saved path. Files are found by name: dropped on the window
// (files or the folder that holds them), picked here, or kept from an earlier drop and read
// again without asking (reference-files.ts). A picture pasted from another app, whose file only
// this device keeps, can be saved as a file from here, to go with the drawing (M2-72).
//
// M5-04 part 1: the External References palette's Reload, Unload and Detach, on the xrefs
// selected (a click selects a row, Ctrl or Shift adds one). As AutoCAD's, only the xrefs the
// drawing attaches itself can be unloaded or detached; a nested one is reloaded with its file.
// M5-04 part 2: Bind…, on loaded xrefs the drawing attaches itself, opens the Bind Xrefs dialog
// (Bind or Insert). M5-04 part 5: Attach Image... runs IMAGEATTACH. M5-04 part 6: Attach DWG...
// runs XATTACH (AutoCAD's palette names its drawing attach so; a .dxf is picked as well as a
// .dwg). M5-04 part 8: Attach PDF... runs PDFATTACH. Path comes with a later part.
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { BindXrefsDialog } from './BindXrefsDialog';
import type { ReferenceKind, ReferenceRow, ReferenceStatus } from './xrefs';

const KIND: Record<ReferenceKind, string> = {
  attach: 'Attach',
  overlay: 'Overlay',
  image: 'Image',
  pdf: 'PDF underlay',
};

const STATUS: Record<ReferenceStatus, string> = {
  loaded: 'Loaded',
  'not-found': 'Not found',
  unloaded: 'Unloaded',
};

export function ReferencesPalette({
  rows,
  waiting,
  onFiles,
  onReconnect,
  savable = () => false,
  onSaveFile,
  onUnload,
  onReload,
  onDetach,
  onBind,
  onAttachImage,
  onAttachDrawing,
  onAttachPdf,
  onClose,
}: {
  /** Attach DWG... (XATTACH, M5-04 part 6), as the palette's Attach menu offers it. */
  onAttachDrawing?: () => void;
  /** Attach Image... (IMAGEATTACH, M5-04 part 5), as the palette's Attach menu offers it. */
  onAttachImage?: () => void;
  /** Attach PDF... (PDFATTACH, M5-04 part 8), as the palette's Attach menu offers it. */
  onAttachPdf?: () => void;
  /** XREF Bind, as Insert when `insert`: why not, or undefined. */
  onBind?: (rows: readonly ReferenceRow[], insert: boolean) => Promise<string | undefined>;
  /** XREF Unload: what it did, one line each. */
  onUnload?: (rows: readonly ReferenceRow[]) => Promise<readonly string[]>;
  /** XREF Reload: what it did, one line each. */
  onReload?: (rows: readonly ReferenceRow[]) => Promise<readonly string[]>;
  /** XREF Detach: why not, or undefined. */
  onDetach?: (rows: readonly ReferenceRow[]) => Promise<string | undefined>;
  rows: readonly ReferenceRow[];
  /** A reference whose file this device keeps and can save (a pasted picture). */
  savable?: (row: ReferenceRow) => boolean;
  /** Save file…: the kept file of `row`. */
  onSaveFile?: (row: ReferenceRow) => void;
  /** Kept folders and files the browser asks about before they are read again. */
  waiting: number;
  /** Files picked here: they answer references only, none opens as a drawing. */
  onFiles: (files: readonly File[]) => void;
  onReconnect: () => void;
  onClose: () => void;
}) {
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const missing = rows.filter((r) => r.status === 'not-found').length;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [said, setSaid] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  /** The xrefs the Bind Xrefs dialog binds, while it is open. */
  const [binding, setBinding] = useState<readonly ReferenceRow[]>();
  // A reference that goes (detached, or nested in one unloaded) is no longer selected.
  useEffect(() => {
    const present = new Set(rows.map((r) => r.handle));
    setSelected((s) =>
      [...s].every((h) => present.has(h)) ? s : new Set([...s].filter((h) => present.has(h))),
    );
  }, [rows]);
  const picked = rows.filter(
    (r, i) => selected.has(r.handle) && rows.findIndex((x) => x.handle === r.handle) === i,
  );
  const xrefs =
    picked.length > 0 && picked.every((r) => r.kind === 'attach' || r.kind === 'overlay');
  const topLevel = xrefs && picked.every((r) => r.depth === 0);
  // An xref is bound from what was loaded of it (AutoCAD: "the xref must be loaded").
  const loaded = topLevel && picked.every((r) => r.status === 'loaded');
  const select = (e: MouseEvent, handle: string) => {
    const add = e.ctrlKey || e.metaKey || e.shiftKey;
    setSelected((s) => {
      if (!add) return new Set([handle]);
      const next = new Set(s);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  };
  const run = async (action: () => Promise<readonly string[]>) => {
    setBusy(true);
    try {
      setSaid(await action());
    } finally {
      setBusy(false);
    }
  };
  const take = (input: HTMLInputElement) => {
    onFiles([...(input.files ?? [])]);
    input.value = '';
  };
  return (
    <aside className="palette references-palette" aria-labelledby="references-title">
      <header>
        <h2 id="references-title">References</h2>
        <button type="button" aria-label="Close References" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="references-actions">
        <button type="button" onClick={() => files.current?.click()}>
          Find files…
        </button>
        <button type="button" onClick={() => folder.current?.click()}>
          Choose folder…
        </button>
        {onAttachDrawing && (
          <button type="button" onClick={onAttachDrawing}>
            Attach DWG...
          </button>
        )}
        {onAttachImage && (
          <button type="button" onClick={onAttachImage}>
            Attach Image...
          </button>
        )}
        {onAttachPdf && (
          <button type="button" onClick={onAttachPdf}>
            Attach PDF...
          </button>
        )}
        {waiting > 0 && (
          <button type="button" onClick={onReconnect}>
            Reconnect {waiting === 1 ? 'kept folder' : `${waiting} kept folders`}
          </button>
        )}
        <input
          ref={files}
          type="file"
          multiple
          hidden
          aria-label="Reference files"
          onChange={(e) => take(e.currentTarget)}
        />
        <input
          ref={folder}
          type="file"
          hidden
          aria-label="Reference folder"
          // Chromium, Firefox and Safari all pick folders through this attribute.
          {...{ webkitdirectory: '' }}
          onChange={(e) => take(e.currentTarget)}
        />
      </div>
      {rows.length > 0 && (
        <div className="references-actions" role="toolbar" aria-label="Selected references">
          <button
            type="button"
            disabled={!xrefs || busy || !onReload}
            title="Reloads the selected xrefs from their files"
            onClick={() => void run(() => onReload!(picked))}
          >
            Reload
          </button>
          <button
            type="button"
            disabled={!topLevel || busy || !onUnload}
            title="Unloads the selected xrefs: they stay in the drawing and draw nothing"
            onClick={() => void run(() => onUnload!(picked))}
          >
            Unload
          </button>
          <button
            type="button"
            disabled={!topLevel || busy || !onDetach}
            title="Detaches the selected xrefs: every reference to them is erased"
            onClick={() =>
              void run(async () => {
                const names = picked.map((r) => r.name);
                const problem = await onDetach!(picked);
                return problem ? [problem] : names.map((n) => `Xref "${n}" has been detached.`);
              })
            }
          >
            Detach
          </button>
          <button
            type="button"
            disabled={!loaded || busy || !onBind}
            title="Binds the selected xrefs: they become blocks of the drawing"
            onClick={() => setBinding(picked)}
          >
            Bind…
          </button>
        </div>
      )}
      {binding && (
        <BindXrefsDialog
          names={binding.map((r) => r.name)}
          onCancel={() => setBinding(undefined)}
          onOk={(insert) => {
            const rows = binding;
            setBinding(undefined);
            void run(async () => {
              const problem = await onBind!(rows, insert);
              return problem ? [problem] : rows.map((r) => `Xref "${r.name}" has been bound.`);
            });
          }}
        />
      )}
      {said.length > 0 && (
        <ul className="references-said" aria-label="What was done" aria-live="polite">
          {said.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      {rows.length === 0 ? (
        <p className="empty">None: the drawing attaches no other files.</p>
      ) : (
        <>
          <p className="hint" role="status">
            {missing === 0
              ? 'Every reference is found.'
              : `${missing} not found. Files are matched by name: drop them, or the folder that holds them, on the window.`}
          </p>
          <div className="layer-table-wrap">
            <table className="layer-table references-table" aria-label="References of the drawing">
              <thead>
                <tr>
                  <th scope="col">Reference name</th>
                  <th scope="col">Status</th>
                  <th scope="col">Type</th>
                  <th scope="col">Saved path</th>
                  <th scope="col">
                    <span className="visually-hidden">File</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={`${r.handle} ${i}`}
                    data-status={r.status}
                    aria-selected={selected.has(r.handle)}
                    onClick={(e) => select(e, r.handle)}
                  >
                    <th scope="row" style={{ paddingLeft: `${6 + r.depth * 16}px` }}>
                      {r.name}
                    </th>
                    <td className="status">{STATUS[r.status]}</td>
                    <td>{KIND[r.kind]}</td>
                    <td className="path">{r.path || '—'}</td>
                    <td className="file">
                      {savable(r) && (
                        <button
                          type="button"
                          aria-label={`Save file ${r.name}`}
                          title="Save the file this device keeps, to send with the drawing"
                          onClick={() => onSaveFile?.(r)}
                        >
                          Save file…
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </aside>
  );
}
