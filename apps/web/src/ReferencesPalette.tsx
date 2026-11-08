// The References palette (M1-21, UI_SPEC.md §4 "References"): the drawing's xrefs, raster
// images and PDF underlays as AutoCAD's External References palette lists them, a tree with
// each reference's status, type and saved path. Files are found by name: dropped on the window
// (files or the folder that holds them), picked here, or kept from an earlier drop and read
// again without asking (reference-files.ts). Attach, detach, reload, unload and bind are the
// XREF manager's (M5-04).
import { useRef } from 'react';
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
  onClose,
}: {
  rows: readonly ReferenceRow[];
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
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.handle} ${i}`} data-status={r.status}>
                    <th scope="row" style={{ paddingLeft: `${6 + r.depth * 16}px` }}>
                      {r.name}
                    </th>
                    <td className="status">{STATUS[r.status]}</td>
                    <td>{KIND[r.kind]}</td>
                    <td className="path">{r.path || '—'}</td>
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
