// SCALELISTEDIT's Edit Drawing Scales dialog (M6-02 part 22): the dialog SCALELISTEDIT opens and
// waits for, and the list edits its buttons make. The engine checks and makes the list OK answers
// (annotation/scale-list.ts there); the dialog only edits a copy.
import {
  parseScaleRatio,
  resetScaleEntries,
  scaleNameProblem,
  type ScaleListDialogEntry,
  type ScaleListDialogRequest,
  type ScaleListEntry,
  type ViewReply,
} from '@triya/engine';

/** The dialog's list: the drawing's scales as edited so far, each with how it is in use. */
export type DialogScales = readonly ScaleListDialogEntry[];

/** `list` with the entry at `i` moved one place up (-1) or down (+1); as it is at an end. */
export function moved(list: DialogScales, i: number, by: -1 | 1): DialogScales {
  const j = i + by;
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** Reset: the defaults, the scales in use kept (the engine's `resetScaleEntries`). */
export const reset = (list: DialogScales, defaults: readonly ScaleListEntry[]): DialogScales =>
  resetScaleEntries(list, (s) => (s as ScaleListDialogEntry).use !== undefined, defaults);

/** What the Add Scale and Edit Scale dialogs hold: a name and the two units as typed. */
export interface ScaleFields {
  readonly name: string;
  readonly paperUnits: string;
  readonly drawingUnits: string;
}

/**
 * The scale the fields make, or why they make none: a name the list's other scales do not have
 * (`self`, the entry edited), and paper and drawing units that are positive numbers.
 */
export function scaleOf(
  list: DialogScales,
  fields: ScaleFields,
  self?: number,
): { readonly name: string; readonly paperUnits: number; readonly drawingUnits: number } | string {
  const name = fields.name.trim();
  const problem = scaleNameProblem(list, name, self);
  if (problem) return problem;
  const ratio = parseScaleRatio(`${fields.paperUnits.trim()}:${fields.drawingUnits.trim()}`);
  if (!ratio) return 'Paper units and drawing units must be positive numbers.';
  return { name, ...ratio };
}

/** A number as the unit fields show it, without float noise. */
export const unitText = (n: number): string => String(Number(n.toPrecision(12)));

/** The open dialog: which drawing it is open for, what SCALELISTEDIT asked, and it waiting. */
export const scaleListDialog = (() => {
  let open: { readonly doc: number; readonly request: ScaleListDialogRequest } | undefined;
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
    /** Opens the dialog; resolves with OK's list, or `{ ok: true }` for Cancel. */
    show(doc: number, request: ScaleListDialogRequest): Promise<ViewReply> {
      finish({ ok: true });
      set({ doc, request });
      return new Promise((resolve) => (done = resolve));
    },
    /** OK with `list`; without, Cancel. */
    close(list?: readonly ScaleListEntry[]) {
      finish({ ok: true, ...(list && { scaleList: list }) });
    },
  };
})();
