// The start screen's Recent drawings (M2-14; thumbnails M2-32, UI_SPEC §10): one card per
// drawing, newest first, with its picture as last autosaved, saved or closed (recent.ts), as
// AutoCAD's Start tab shows its recent documents. A drawing with no picture yet shows a frame.
import { useEffect, useState } from 'react';
import type { RecentEntry } from './recent';

/** The largest picture, CSS pixels: what `pictureForRecent` asks the canvas for. */
export const RECENT_THUMBNAIL = { width: 192, height: 120 } as const;

export function RecentDrawings({
  entries,
  onOpen,
}: {
  entries: readonly RecentEntry[];
  onOpen: (key: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="recent" aria-label="Recent drawings">
      <h2>Recent drawings</h2>
      <ul>
        {entries.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              title={`Opened ${new Date(r.openedAt).toLocaleString()}`}
              onClick={() => onOpen(r.key)}
            >
              <Picture blob={r.thumbnail} />
              <span className="recent-name">{r.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A picture kept as a Blob, shown through an object URL that goes with it. */
function Picture({ blob }: { blob: Blob | undefined }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <span className="recent-thumbnail" data-drawn={url ? 'true' : undefined}>
      {url && <img src={url} alt="" draggable={false} />}
    </span>
  );
}
