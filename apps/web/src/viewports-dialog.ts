// VPORTS' Viewports dialog (M6-02 part 11): the dialog VPORTS opens and waits for, and what its
// preview shows. The engine does what OK answers (vports-dialog.ts there); the dialog only picks.
import {
  ACTIVE_MODEL_CONFIGURATION,
  standardViewports,
  validViewName,
  type Box,
  type StandardViewports,
  type ViewReply,
  type ViewportsDialogChoice,
  type ViewportsDialogRequest,
} from '@triya/engine';

/** Change view to's entry for the view a viewport starts on. */
export const CURRENT_VIEW = '*Current*';

const WHOLE: Box = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

/** One viewport the preview draws: its corners (0–1, lower-left origin) and its view's label. */
export interface PreviewTile {
  readonly corners: Box;
  readonly label: string;
  /** Its place in the choice's `views`; absent for a tile the choice leaves as it is. */
  readonly index?: number;
}

/** What the New Viewports tab has chosen so far. */
export interface NewTab {
  readonly standard: StandardViewports | typeof ACTIVE_MODEL_CONFIGURATION;
  readonly applyTo: 'Display' | 'Current viewport';
  /** Change view to for each of the arrangement's viewports (null: the current view). */
  readonly views: readonly (string | null)[];
}

/**
 * The New Viewports tab's preview: the arrangement's viewports, each named by the view it will
 * show; under Apply to Current Viewport the current tile divided and the others as they are.
 */
export function newPreview(request: ViewportsDialogRequest, tab: NewTab): PreviewTile[] {
  const label = (i: number) => tab.views[i] ?? CURRENT_VIEW;
  if (tab.standard === ACTIVE_MODEL_CONFIGURATION) {
    const tiles = request.active.length > 0 ? request.active : [WHOLE];
    return tiles.map((corners, index) => ({ corners, label: label(index), index }));
  }
  const current = request.active[0] ?? WHOLE;
  const divide = !request.layout && tab.applyTo === 'Current viewport';
  const pieces = standardViewports(tab.standard, divide ? current : WHOLE).map(
    (corners, index): PreviewTile => ({ corners, label: label(index), index }),
  );
  if (!divide) return pieces;
  return [...pieces, ...request.active.slice(1).map((corners) => ({ corners, label: '' }))];
}

/** A named configuration's tiles, for the Named Viewports tab's preview. */
export function namedPreview(request: ViewportsDialogRequest, name: string): PreviewTile[] {
  const found = request.configurations.find((c) => c.name === name);
  return (found?.tiles ?? []).map((corners) => ({ corners, label: '' }));
}

/** How many viewports `tab`'s choice has a view for. */
export const viewCount = (request: ViewportsDialogRequest, tab: NewTab): number =>
  newPreview(request, tab).filter((t) => t.index !== undefined).length;

/** Why a New name or a new name for a configuration cannot be taken; undefined when it can. */
export function nameProblem(name: string, taken: readonly string[]): string | undefined {
  const n = name.trim();
  if (!validViewName(n) || n.toUpperCase() === '*ACTIVE') {
    return `"${n}" is not a valid viewport configuration name.`;
  }
  if (taken.some((t) => t.toUpperCase() === n.toUpperCase())) {
    return `A viewport configuration named "${n}" already exists.`;
  }
  return undefined;
}

/** The open dialog: which drawing it is open for, what VPORTS asked, and VPORTS waiting. */
export const viewportsDialog = (() => {
  let open: { readonly doc: number; readonly request: ViewportsDialogRequest } | undefined;
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
    /** Opens the dialog; resolves with OK's choice, or `{ ok: true }` for Cancel. */
    show(doc: number, request: ViewportsDialogRequest): Promise<ViewReply> {
      finish({ ok: true });
      set({ doc, request });
      return new Promise((resolve) => (done = resolve));
    },
    /** OK with `choice`; without, Cancel. */
    close(choice?: ViewportsDialogChoice) {
      finish({ ok: true, ...(choice && { viewports: choice }) });
    },
  };
})();
