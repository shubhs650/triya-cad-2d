// Selection cycling's Selection list (M3-04 part 3; AutoCAD 2024 Help, "To Select Overlapping or
// Close Objects": "Click to see a list of available objects, and then click in the list to select
// the object you want"). The engine asks for it (a `cycle` view request) when a pick finds
// overlapping objects with SELECTIONCYCLING 2; the list opens by the pick and the request waits
// for the drafter: the object clicked, or none when the list is dismissed (Esc, a click
// elsewhere). One list at a time; a new one dismisses the last.
// Where it opens (M3-04 part 7; AutoCAD 2024 Help, "Selection Cycling Tab (Drafting Settings
// Dialog Box)"): Cursor dependent, in the Quadrant of the pick chosen, Distance in pixels away;
// Static, where its title bar was last dragged (by the pick until then). Inside the window.
import type { EntityId, ViewReply } from '@triya/engine';
import type { QpQuadrant } from './drafting';
import { quickPlacement, type Placement } from './quick-properties';

export interface SelectionListRequest {
  readonly candidates: readonly { readonly id: EntityId; readonly label: string }[];
  /** Where the pick was made, in window pixels; the list opens beside it. */
  readonly at: { readonly x: number; readonly y: number };
}

/** The reply for the object chosen, or for none (the list dismissed). */
export const chosen = (id?: EntityId): ViewReply => ({
  ok: true,
  ids: id === undefined ? [] : [id],
});

/** The open list: the drawing it is for, what the engine asked, and the request waiting. */
export const selectionList = (() => {
  let open: { readonly doc: number; readonly request: SelectionListRequest } | undefined;
  let done: ((reply: ViewReply) => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (v: typeof open) => {
    open = v;
    for (const l of listeners) l();
  };
  const finish = (reply: ViewReply) => {
    const d = done;
    done = undefined;
    set(undefined);
    d?.(reply);
  };
  return {
    get: () => open,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Opens the list; resolves with the object chosen, or none. */
    show(doc: number, request: SelectionListRequest): Promise<ViewReply> {
      if (done) finish(chosen());
      set({ doc, request });
      return new Promise((resolve) => (done = resolve));
    },
    /** Closes the list with `id` chosen, or none. */
    close(id?: EntityId) {
      finish(chosen(id));
    },
  };
})();

interface Size {
  readonly width: number;
  readonly height: number;
}

/** Where the list goes: by the pick `at`, or where it was `dragged` when static. */
export function listPlacement(o: {
  at: { readonly x: number; readonly y: number };
  size: Size;
  view: Size;
  /** Cursor dependent (0) or Static (1). */
  location: 0 | 1;
  quadrant: QpQuadrant;
  distance: number;
  dragged?: Placement | undefined;
}): Placement {
  const fixed = o.location === 1 && o.dragged !== undefined;
  return quickPlacement({
    location: fixed ? 1 : 0,
    pointer: o.at,
    size: o.size,
    area: o.view,
    dragged: o.dragged,
    quadrant: o.quadrant,
    distance: o.distance,
  });
}

/** Where the drafter dragged the static list this session. */
export const staticList: { dragged: Placement | undefined } = { dragged: undefined };
