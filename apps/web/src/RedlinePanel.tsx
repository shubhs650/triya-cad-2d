// The red-line card over a drawing opened from a PDF on the start screen (M7-07, redline.ts):
// the offer to calibrate the page's scale with two picks, the steps while SCALE asks for them,
// or why the PDF could not be attached.
import { useSyncExternalStore } from 'react';
import { redline } from './redline';

export function RedlinePanel({
  doc,
  onCalibrate,
}: {
  doc: number;
  /** Calibrate scale: the drawing's SCALE Reference, typed up to the picks. */
  onCalibrate: () => void;
}) {
  const state = useSyncExternalStore(redline.subscribe, () => redline.get(doc));
  if (!state || state.phase === 'attaching') return null;
  return (
    <section className="redline-panel" role="region" aria-label="Red-line PDF">
      {state.phase === 'offer' && (
        <>
          <p>
            <strong>{state.file}</strong> is attached at its printed size, page 1 at 0,0. If it was
            plotted to a scale, calibrate it: pick two points a known distance apart, then type that
            distance.
          </p>
          {state.note && <p className="redline-note">{state.note}</p>}
          <div className="redline-actions">
            <button type="button" onClick={onCalibrate}>
              Calibrate scale
            </button>
            <button type="button" onClick={() => redline.dismiss(doc)}>
              Not now
            </button>
          </div>
        </>
      )}
      {state.phase === 'calibrating' && (
        <p>
          Pick two points a known distance apart on the PDF (object snaps find its lines), then type
          the distance they really are. Esc cancels.
        </p>
      )}
      {state.phase === 'failed' && (
        <>
          <p>{state.message}</p>
          <div className="redline-actions">
            <button type="button" onClick={() => redline.dismiss(doc)}>
              Close
            </button>
          </div>
        </>
      )}
    </section>
  );
}
