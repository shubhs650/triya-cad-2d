// The Command History palette (M7-03 part 2, UI_SPEC.md §4): AutoCAD's command history (F2, the
// text window TEXTSCR shows) as a palette of the stack. It lists every line the drawing's
// command line holds (the last 2000, `MAX_LINES`), the latest at the bottom and scrolled into
// view as lines come, unless the drafter scrolled up to read. The text can be selected and
// copied. It is a log, not a field: the command line keeps the keyboard, as F2 leaves it there.
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { CommandLines } from './command-line';

/** How near the bottom, px, the log counts as following the latest line. */
const FOLLOWING = 24;

export function CommandHistoryPalette({
  doc,
  lines,
  onClose,
}: {
  doc: number;
  lines: CommandLines;
  onClose: () => void;
}) {
  useSyncExternalStore(lines.subscribe, lines.version);
  const shown = lines.get(doc).lines;
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useLayoutEffect(() => {
    const l = log.current;
    if (l && following.current) l.scrollTop = l.scrollHeight;
  }, [shown, doc]);

  return (
    <aside className="palette command-history-palette" aria-labelledby="command-history-title">
      <header>
        <h2 id="command-history-title">Command History</h2>
        <button type="button" aria-label="Close Command History" onClick={onClose}>
          ×
        </button>
      </header>
      <div
        ref={log}
        className="command-history-log"
        role="log"
        aria-label="Command history"
        tabIndex={0}
        onScroll={(e) => {
          const l = e.currentTarget;
          following.current = l.scrollHeight - l.scrollTop - l.clientHeight < FOLLOWING;
        }}
      >
        {shown.length === 0 ? (
          <p className="command-history-empty">No commands yet.</p>
        ) : (
          shown.map((l, i) => <div key={i}>{l}</div>)
        )}
      </div>
    </aside>
  );
}
