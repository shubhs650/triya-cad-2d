// The navigation bar on the canvas (M1-22 part 2), as AutoCAD's: PAN, the ZOOM options
// (Extents, Window, Previous, All, In and Out = Scale 2X and 0.5X), REGEN, and the named views
// (VIEW restore and New). Each button calls the canvas controller of the space on screen; the
// ZOOM and VIEW commands will call the same functions when the command line arrives (M2-01).
import { useState } from 'react';
import type { ViewRecord } from '@triya/engine';
import type { CanvasMode } from './canvas/controller';
import { controllerOf } from './canvas/registry';
import { namedView } from './canvas/views';
import type { DocumentStore, OpenDocument } from './documents';

/** VIEW table flag 1: a paper-space view. */
const PAPER_VIEW = 1;

export function NavBar({
  doc,
  store,
  mode,
}: {
  doc: OpenDocument;
  store: DocumentStore;
  mode: CanvasMode;
}) {
  const [viewsOpen, setViewsOpen] = useState(false);
  const [naming, setNaming] = useState('');
  const c = () => controllerOf(doc.id, doc.block);
  const toggle = (m: CanvasMode) => {
    const ctl = c();
    if (ctl) ctl.setMode(ctl.mode === m ? 'none' : m);
  };

  const inModel = doc.block === doc.opened.modelSpace;
  // The drawing's own views: model-space views on the Model tab, paper-space views in a layout.
  const fileViews = [...(doc.opened.init.tables?.views ?? [])].filter((v: ViewRecord) =>
    (v.flags ?? 0) & PAPER_VIEW ? !inModel : inModel,
  );
  const saved = doc.savedViews.filter((v) => v.block === doc.block);

  return (
    <div className="nav-bar" role="toolbar" aria-label="Navigation" aria-orientation="vertical">
      <button type="button" aria-pressed={mode === 'pan'} onClick={() => toggle('pan')}>
        Pan
      </button>
      <button type="button" onClick={() => c()?.zoomExtents()}>
        Zoom Extents
      </button>
      <button type="button" aria-pressed={mode === 'window'} onClick={() => toggle('window')}>
        Zoom Window
      </button>
      <button type="button" onClick={() => c()?.zoomPrevious()}>
        Zoom Previous
      </button>
      <button type="button" onClick={() => c()?.zoomAll()}>
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
            {saved.map((v) => (
              <li key={`saved:${v.name}`}>
                <button type="button" onClick={() => c()?.show(v.view)}>
                  {v.name}
                </button>
              </li>
            ))}
            {fileViews.length + saved.length === 0 && <li className="empty">No named views</li>}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = naming.trim();
              const view = c()?.view;
              if (!name || !view) return;
              store.saveView(doc.id, name, view);
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
