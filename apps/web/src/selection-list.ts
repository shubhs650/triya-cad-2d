// Selection cycling's Selection list (M3-04 part 3; AutoCAD 2024 Help, "To Select Overlapping or
// Close Objects": "Click to see a list of available objects, and then click in the list to select
// the object you want"). The engine asks for it (a `cycle` view request) when a pick finds
// overlapping objects with SELECTIONCYCLING 2; the list opens by the pick and the request waits
// for the drafter: the object clicked, or none when the list is dismissed (Esc, a click
// elsewhere). One list at a time; a new one dismisses the last.
import type { EntityId, ViewReply } from '@triya/engine';

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
