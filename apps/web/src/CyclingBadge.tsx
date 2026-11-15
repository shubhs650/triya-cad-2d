// Selection cycling's badge (M3-04 part 7, `cycling-badge.ts`): AutoCAD's small icon of two
// overlapping squares at the top right of the cursor where objects overlap. It takes no
// pointer events: the click goes to the canvas under it.
import { useSyncExternalStore } from 'react';
import { cyclingBadge } from './cycling-badge';

/** Up and right of the cursor's hot spot, clear of the pickbox, as AutoCAD's sits. */
const OFFSET = { x: 10, y: -26 } as const;

export function CyclingBadge({ doc }: { doc: number }) {
  const at = useSyncExternalStore(cyclingBadge.subscribe, cyclingBadge.get);
  if (at?.doc !== doc) return null;
  return (
    <svg
      className="cycling-badge"
      data-testid="cycling-badge"
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      style={{ left: at.x + OFFSET.x, top: at.y + OFFSET.y }}
    >
      <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
      <rect x="5.5" y="5.5" width="9" height="9" rx="1" />
    </svg>
  );
}
