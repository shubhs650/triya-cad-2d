// The first-run browser compatibility notice (M7-09, PRD §8, DEC-023): in Firefox and Safari a
// banner under the title bar lists what the app does differently there (browser-support.ts),
// until OK dismisses it for good. A notice, not a dialog: it takes no focus and blocks nothing.
import type { BrowserLimit } from './browser-support';

export function BrowserNotice({
  limits,
  onDismiss,
}: {
  limits: readonly BrowserLimit[];
  onDismiss: () => void;
}) {
  return (
    <div className="banner browser-notice" role="region" aria-label="Browser compatibility">
      <div>
        <p>
          <strong>Triya CAD 2D works in this browser with a few differences.</strong> Chrome or Edge
          has the full feature set. Here:
        </p>
        <ul>
          {limits.map((l) => (
            <li key={l.id}>{l.text}</li>
          ))}
        </ul>
      </div>
      <span className="banner-actions">
        <button type="button" onClick={onDismiss}>
          OK
        </button>
      </span>
    </div>
  );
}
