// The Publish dialog (M2-17 part 2; PUBLISH), with AutoCAD's labels (UI_SPEC.md §7): the drawing's
// sheets (model space, then each layout in tab order) with their page setups and a check to
// include each; "Publish to: PDF"; Publish plots the included sheets into one PDF that downloads,
// each page labelled with its layout and bookmarked with its sheet's name. Cancel (and Esc)
// closes. A sheet that cannot plot is reported in its Status and the others still publish, as
// AutoCAD's publish log does.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { downloadPdf } from './PlotDialog';
import { controllerOf } from './canvas/registry';
import { layoutsOf, spacesOf, type OpenDocument } from './documents';
import { engines } from './engine/registry';
import type { PlotSpace } from './plot';
import {
  publishFileName,
  publishPdf,
  publishSheets,
  sheetSpace,
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

export function PublishDialog({
  doc,
  underlayFile,
}: {
  doc: OpenDocument | undefined;
  underlayFile?: UnderlayFile;
}) {
  const open = useSyncExternalStore(publishDialog.subscribe, publishDialog.get);
  if (!doc || open !== doc.id) return null;
  return <PublishBody key={doc.id} doc={doc} {...(underlayFile && { underlayFile })} />;
}

function PublishBody({ doc, underlayFile }: { doc: OpenDocument; underlayFile?: UnderlayFile }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [sheets, setSheets] = useState<PublishSheet[]>(() =>
    publishSheets(doc.name, spacesOf(doc, engines.changesOf(doc.id))),
  );
  const [status, setStatus] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  const included = sheets.filter((s) => s.include);

  const publish = async () => {
    const active = controllerOf(doc.id, doc.block);
    if (!active || busy || included.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      const here = await active.plotSpace();
      const layouts = layoutsOf(doc.opened.init, engines.changesOf(doc.id));
      const plotted = [];
      for (const s of included) {
        // A sheet shown on a canvas plots as the Plot dialog would (model space's Display); one
        // not shown from its page setup, or model space by its extents.
        const live = controllerOf(doc.id, s.block);
        const space: PlotSpace = live
          ? await live.plotSpace()
          : sheetSpace({
              name: s.name,
              layout: layouts.find((l) => l.blockRecord === s.block),
              extents: doc.opened.extents[s.block],
              namedPlotStyles: here.namedPlotStyles ?? false,
            });
        plotted.push({ sheet: s.sheet, space, parts: await active.plot({ block: s.block }) });
      }
      const { bytes, failed } = publishPdf(plotted, doc.name.replace(/\.[^.]+$/, ''), underlayFile);
      if (bytes) downloadPdf(publishFileName(doc.name), bytes);
      if (failed.length === 0) {
        publishDialog.close();
        return;
      }
      const next = new Map(included.map((s) => [s.sheet, 'Published']));
      for (const f of failed) next.set(f.sheet, f.message);
      setStatus(next);
      setError(
        bytes
          ? `Published ${included.length - failed.length} of ${included.length} sheets.`
          : 'No sheet could be published.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
        <input type="text" value="PDF" readOnly aria-label="Publish to" />
      </label>
      <table className="publish-sheets" aria-label="Sheets to publish">
        <thead>
          <tr>
            <th scope="col">Sheet Name</th>
            <th scope="col">Page Setup</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {sheets.map((s, i) => (
            <tr key={s.block}>
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
              <td>&lt;Default: None&gt;</td>
              <td>{status.get(s.sheet) ?? (s.include ? '' : 'Not included')}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
