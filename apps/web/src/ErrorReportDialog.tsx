// The error report (M7-08, PRD §8 G6, DEC-029): when a problem reaches the app, this panel shows
// the report it would send, in full, with Send Report and Don't Send, as AutoCAD's Customer
// Error Report does. Nothing is sent until Send Report (error-report/offers.ts). It floats over
// the drawing's bottom right and is not modal: the drawing stays usable, and the user decides
// when to answer. Esc in it is Don't Send.
import { useId, useSyncExternalStore } from 'react';
import type { ErrorReports } from './error-report/offers';

export function ErrorReportDialog({ reports }: { reports: ErrorReports }) {
  const offer = useSyncExternalStore(reports.subscribe, reports.getSnapshot);
  const id = useId();
  if (!offer) return null;
  const { state } = offer;
  const busy = state === 'sending';
  return (
    <section
      className="error-report"
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) {
          e.stopPropagation();
          reports.dismiss();
        }
      }}
    >
      <h2 id={`${id}-title`}>Triya CAD 2D Error Report</h2>
      <div id={`${id}-text`}>
        <p>
          Triya CAD 2D ran into a problem. You can keep working; if anything looks wrong, save the
          drawing under a new name.
        </p>
        <p>
          Send this report to help fix it? It holds the error, your browser, the app version and
          counts of what the drawing holds, never its text, names, file names or paths. Nothing is
          sent unless you press Send Report.
        </p>
      </div>
      <pre className="error-report-payload" tabIndex={0} aria-label="Report contents">
        {offer.text}
      </pre>
      <p className="error-report-status" role="status">
        {state === 'sending' && 'Sending…'}
        {state === 'sent' && 'Report sent. Thank you.'}
        {state === 'failed' && 'The report could not be sent. Check your connection and try again.'}
      </p>
      <div className="buttons">
        {state !== 'sent' && (
          <button type="button" disabled={busy} onClick={() => void reports.send()}>
            {state === 'failed' ? 'Try Again' : 'Send Report'}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => reports.dismiss()}>
          {state === 'review' || state === 'sending' ? "Don't Send" : 'Close'}
        </button>
      </div>
    </section>
  );
}
