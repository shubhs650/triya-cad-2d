// Selection cycling's badge (M3-04 part 7; AutoCAD 2024 Help, "To Select Overlapping or Close
// Objects": with selection cycling on, "the selection cycling badge displays" when the cursor
// is over overlapping objects). The canvas says where its cursor rests over them; the badge
// follows it, for the drawing the canvas shows.

export interface BadgeAt {
  readonly doc: number;
  /** The cursor, in window pixels. */
  readonly x: number;
  readonly y: number;
}

export const cyclingBadge = (() => {
  let at: BadgeAt | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => at,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** The badge by the cursor of drawing `doc`, or none (only that drawing's is taken away). */
    set(doc: number, cursor: { readonly x: number; readonly y: number } | undefined) {
      if (!cursor && at?.doc !== doc) return;
      at = cursor && { doc, x: cursor.x, y: cursor.y };
      for (const l of listeners) l();
    },
  };
})();
