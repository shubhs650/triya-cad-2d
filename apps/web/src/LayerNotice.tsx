// The Unreconciled New Layers alert (M5-19 part 4, layer-notice.ts): the status bar's icon and
// balloon, and PLOT's question.
//
// - The icon shows while the drawing's alert is raised and a layer is still unreconciled (Help,
//   "Use New Layer Notification": "an Unreconciled New Layers icon displays on the status bar").
//   Help documents its right-click menu's View Unreconciled New Layers; a click, which Help leaves
//   unsaid, does the same here, so the keyboard reaches it too.
// - The balloon comes with each event that alerts, until it is closed or the layers are viewed.
// - PLOT (LAYERNOTIFY 1) asks instead: "a dialog box is displayed instead of an icon on the
//   status bar"; Yes shows the new layers in the Layer Properties Manager before plotting (PLOT
//   ends without plotting), No plots.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { OpenDocument } from './documents';
import { useModalDialog } from './modal-dialog';
import { drafting } from './drafting';
import { engines } from './engine/registry';
import { layerNotices, noticeText, plotNotice } from './layer-notice';
import { currentLayers } from './layers';

export function LayerNoticeTray({
  doc,
  onView,
}: {
  doc: OpenDocument;
  /** View Unreconciled New Layers. */
  onView: () => void;
}) {
  const notice = useSyncExternalStore(layerNotices.subscribe, () => layerNotices.get(doc.id));
  const evaluating = useSyncExternalStore(drafting.subscribe, () => drafting.get().layerEvalCtl);
  // `doc` is a new object with every edit, so the layers are read again after each.
  const unreconciled = useMemo(
    () => currentLayers(doc.opened.init, engines.changesOf(doc.id)).some((l) => l.unreconciled),
    [doc],
  );
  const shown = notice !== undefined && unreconciled && evaluating;
  // Reconciled (or LAYEREVALCTL turned off): the alert is over.
  useEffect(() => {
    if (notice && !shown) layerNotices.forget(doc.id);
  }, [notice, shown, doc.id]);
  const [menu, setMenu] = useState(false);
  if (!shown) return null;
  return (
    <span className="layer-notice">
      <button
        type="button"
        className="layer-notice-icon"
        aria-label="Unreconciled New Layers"
        title="Unreconciled New Layers"
        onClick={onView}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(true);
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <path d="M8 2 1.5 5.5 8 9l6.5-3.5Z" fill="none" stroke="currentColor" />
          <path d="m1.5 8.5 6.5 3.5 6.5-3.5" fill="none" stroke="currentColor" />
          <circle cx="13" cy="3" r="2.5" fill="currentColor" />
        </svg>
      </button>
      {menu && (
        <span className="layer-notice-menu" role="menu" onMouseLeave={() => setMenu(false)}>
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              setMenu(false);
              onView();
            }}
            onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}
            onBlur={() => setMenu(false)}
          >
            View Unreconciled New Layers
          </button>
        </span>
      )}
      {notice.balloon && (
        <span className="layer-notice-balloon" role="status" aria-label="Unreconciled New Layers">
          <button
            type="button"
            className="close"
            aria-label="Close"
            onClick={() => layerNotices.closeBalloon(doc.id)}
          >
            ×
          </button>
          <strong>Unreconciled New Layers</strong>
          <span>{noticeText(notice.layers)}</span>
          <button type="button" className="link" onClick={onView}>
            View Unreconciled New Layers
          </button>
        </span>
      )}
    </span>
  );
}

/** PLOT's question while the drawing has unreconciled new layers (LAYERNOTIFY 1). */
export function PlotNoticeDialog() {
  const question = useSyncExternalStore(plotNotice.subscribe, plotNotice.get);
  const dialog = useRef<HTMLDialogElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  useModalDialog(dialog, question !== undefined, () => yes.current?.focus());
  return (
    <dialog
      ref={dialog}
      className="save-changes layer-notice-dialog"
      aria-labelledby="layer-notice-title"
      aria-describedby="layer-notice-text"
      onCancel={(e) => {
        // Esc plots, as AutoCAD's message box goes on with the command.
        e.preventDefault();
        plotNotice.answer(false);
      }}
    >
      <h2 id="layer-notice-title">Unreconciled New Layers</h2>
      <p id="layer-notice-text">
        {question && noticeText(question.layers)} View the new layers in the Layer Properties
        Manager before plotting?
      </p>
      <div className="buttons">
        <button ref={yes} type="button" onClick={() => plotNotice.answer(true)}>
          Yes
        </button>
        <button type="button" onClick={() => plotNotice.answer(false)}>
          No
        </button>
      </div>
    </dialog>
  );
}
