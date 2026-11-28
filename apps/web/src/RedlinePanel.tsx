// The red-line card over a drawing opened from a PDF on the start screen (M7-07, redline.ts):
// the offer to calibrate the page's scale with two picks, the steps while SCALE asks for them,
// or why the PDF could not be attached. M8-04: then the markup on layer REDLINE, its commands
// and Plot... a click away until Done.
import { useSyncExternalStore } from 'react';
import { REDLINE_LAYER, redline } from './redline';

/** The markup's buttons: the command each runs, as the ribbon's buttons run theirs. */
const MARKUP: readonly { readonly label: string; readonly command: string }[] = [
  { label: 'Revision Cloud', command: 'REVCLOUD' },
  { label: 'Text', command: 'MTEXT' },
  { label: 'Leader', command: 'MLEADER' },
  { label: 'Plot...', command: 'PLOT' },
];

export function RedlinePanel({
  doc,
  onCalibrate,
  onSkip,
  onRun,
}: {
  doc: number;
  /** Calibrate scale: the drawing's SCALE Reference, typed up to the picks. */
  onCalibrate: () => void;
  /** Not now: on to the markup at the printed size. */
  onSkip: () => void;
  /** A markup button: the command to run. */
  onRun: (command: string) => void;
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
            <button type="button" onClick={onSkip}>
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
      {state.phase === 'markup' && (
        <>
          <p>
            Mark up <strong>{state.file}</strong>: what you draw goes on layer{' '}
            <strong>{REDLINE_LAYER}</strong> in red, over the page. Turn the layer off to see the
            page alone; Plot prints the page with the markup.
          </p>
          <div className="redline-actions">
            {MARKUP.map((m) => (
              <button
                key={m.command}
                type="button"
                disabled={!state.ready}
                onClick={(e) => {
                  // As the ribbon's buttons: a click leaves the focus on the page, so the keys
                  // typed for the command's prompts reach the command line, not this button.
                  if (e.detail > 0) e.currentTarget.blur();
                  onRun(m.command);
                }}
              >
                {m.label}
              </button>
            ))}
            <button type="button" onClick={() => redline.dismiss(doc)}>
              Done
            </button>
          </div>
        </>
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
