// The navigation bar on the canvas (M1-22 part 2), as AutoCAD's: PAN, the ZOOM options
// (Extents, Window, Previous, All, In and Out = Scale 2X and 0.5X), REGEN, and the named views
// (VIEW restore and New). Each button calls the canvas controller of the space on screen; the
// ZOOM, PAN, REGEN and VIEW commands call the same functions through the view host (M2-02).
import { useState } from 'react';
import type { ChangeSet, ViewRecord, ViewState } from '@triya/engine';
import type { CanvasMode } from './canvas/controller';
import { controllerOf } from './canvas/registry';
import type { ViewportSize } from './canvas/navigate';
import { stateOf, type NamedView } from './canvas/view-host';
import { namedView } from './canvas/views';
import type { OpenDocument } from './documents';
import { drawingViews } from './saved-views';

/** VIEW table flag 1: a paper-space view. */
const PAPER_VIEW = 1;

/**
 * The drawing's views of the space shown, as its engine has them (M2-29: VIEW Save and Save view
 * write the VIEW table): model-space views on the Model tab, paper-space views in a layout.
 */
function fileViewsOf(doc: OpenDocument, changes: readonly ChangeSet[]): ViewRecord[] {
  const inModel = doc.block === doc.opened.modelSpace;
  return drawingViews(doc.opened.init, changes).filter((v: ViewRecord) =>
    (v.flags ?? 0) & PAPER_VIEW ? !inModel : inModel,
  );
}

/**
 * The named views of the space shown, as the Views list has them, each with the view a canvas
 * of `size` restores it to: what VIEW lists and restores.
 */
export function namedViewsOf(
  doc: OpenDocument,
  changes: readonly ChangeSet[],
  size: ViewportSize,
): NamedView[] {
  return fileViewsOf(doc, changes).map((v) => ({
    name: v.name,
    inDrawing: true,
    view: namedView(v, size),
  }));
}

export function NavBar({
  doc,
  changes,
  mode,
  onSaveView,
}: {
  doc: OpenDocument;
  /** The drawing's change log, which holds the views saved since it opened. */
  changes: readonly ChangeSet[];
  mode: CanvasMode;
  /** Save view: the view shown kept in the drawing as `name` (an engine edit, M2-29). */
  onSaveView: (name: string, view: ViewState) => void;
}) {
  const [viewsOpen, setViewsOpen] = useState(false);
  const [naming, setNaming] = useState('');
  const c = () => controllerOf(doc.id, doc.block);
  const toggle = (m: CanvasMode) => {
    const ctl = c();
    if (ctl) ctl.setMode(ctl.mode === m ? 'none' : m);
  };

  const fileViews = fileViewsOf(doc, changes);

  return (
    <div className="nav-bar" role="toolbar" aria-label="Navigation" aria-orientation="vertical">
      <button type="button" aria-pressed={mode === 'pan'} onClick={() => toggle('pan')}>
        Pan
      </button>
      <button type="button" onClick={() => void c()?.zoomExtents()}>
        Zoom Extents
      </button>
      <button type="button" aria-pressed={mode === 'window'} onClick={() => toggle('window')}>
        Zoom Window
      </button>
      <button type="button" onClick={() => c()?.zoomPrevious()}>
        Zoom Previous
      </button>
      <button type="button" onClick={() => void c()?.zoomAll()}>
        Zoom All
      </button>
      <button type="button" onClick={() => c()?.zoomScale(2)}>
        Zoom In
      </button>
      <button type="button" onClick={() => c()?.zoomScale(0.5)}>
        Zoom Out
      </button>
      <button type="button" onClick={() => c()?.regen()}>
        Regen
      </button>
      <button
        type="button"
        aria-expanded={viewsOpen}
        aria-controls="views-menu"
        onClick={() => setViewsOpen((o) => !o)}
      >
        Views
      </button>
      {viewsOpen && (
        <div className="views-menu" id="views-menu" role="group" aria-label="Named views">
          <ul>
            {fileViews.map((v) => {
              const ctl = c();
              const target = ctl ? namedView(v, ctl.size) : undefined;
              return (
                <li key={v.handle}>
                  <button
                    type="button"
                    disabled={!target}
                    title={target ? undefined : 'Not a plan view; 3D and twisted views come later'}
                    onClick={() => {
                      const now = c();
                      const t = now && namedView(v, now.size);
                      if (now && t) now.show(t);
                    }}
                  >
                    {v.name}
                  </button>
                </li>
              );
            })}
            {fileViews.length === 0 && <li className="empty">No named views</li>}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = naming.trim();
              const ctl = c();
              const view = ctl && stateOf(ctl);
              if (!name || !view) return;
              onSaveView(name, view);
              setNaming('');
            }}
          >
            <label>
              New view name
              <input value={naming} onChange={(e) => setNaming(e.currentTarget.value)} />
            </label>
            <button type="submit">Save view</button>
          </form>
        </div>
      )}
    </div>
  );
}
