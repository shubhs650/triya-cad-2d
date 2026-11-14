// The View Manager (M2-47 part 2), VIEW's dialog: what it lists and shows, and the state it keeps
// while VIEW asks for the New View dialog's window at the command line. AutoCAD 2024 Help, "View
// Manager Dialog Box": a Views tree of Current, Model Views and Layout Views (Preset Views are 3D
// orthographic ones, which a 2D canvas does not show), the selected view's properties, and Set
// Current, New..., Update Layers, Edit Boundaries... and Delete. "New View / Shot Properties
// Dialog Box": View name and Boundary (Current display, or Define window, which hides the dialogs
// for two corners at the command line).
import type { Vec2, ViewRecord, ViewState } from '@triya/engine';

/** VIEW table flag 1: a paper-space view. */
const PAPER_VIEW = 1;

/** The tree's Model Views and Layout Views, each sorted by name, case ignored. */
export function viewTree(views: readonly ViewRecord[]): {
  model: ViewRecord[];
  layout: ViewRecord[];
} {
  const sorted = [...views].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
  return {
    model: sorted.filter((v) => !((v.flags ?? 0) & PAPER_VIEW)),
    layout: sorted.filter((v) => (v.flags ?? 0) & PAPER_VIEW),
  };
}

export function isPaperView(v: ViewRecord): boolean {
  return ((v.flags ?? 0) & PAPER_VIEW) !== 0;
}

/** One row of the properties the dialog shows for the selected view. */
export interface ViewRow {
  readonly group: 'General' | 'View';
  readonly label: string;
  readonly value: string;
}

/** Four decimals: AutoCAD's default linear precision (LUPREC 4). */
const num = (n: number): string => n.toFixed(4);

function extentRows(center: Vec2, height: number, width: number): ViewRow[] {
  return [
    { group: 'View', label: 'Center X', value: num(center.x) },
    { group: 'View', label: 'Center Y', value: num(center.y) },
    { group: 'View', label: 'Height', value: num(height) },
    { group: 'View', label: 'Width', value: num(width) },
  ];
}

const isPlan = (v: ViewRecord): boolean => {
  const d = v.direction;
  const len = Math.hypot(d.x, d.y, d.z);
  return d.z > 0 && Math.abs(d.x) <= 1e-9 * len && Math.abs(d.y) <= 1e-9 * len;
};

/**
 * A named view's rows: its Name (which the dialog lets the drafter change) and the window it
 * shows. The centre is in world coordinates (a VIEW's DXF 10 is in display coordinates, so its
 * target is added), which is what a 2D drafter reads; AutoCAD's camera and target rows are 3D.
 */
export function viewRows(v: ViewRecord): ViewRow[] {
  const center = { x: v.center.x + v.target.x, y: v.center.y + v.target.y };
  const rows: ViewRow[] = [
    { group: 'General', label: 'Name', value: v.name },
    ...extentRows(center, v.height, v.width),
    {
      group: 'View',
      label: 'Roll angle',
      value: String(Math.round(((v.twist * 180) / Math.PI) * 1e4) / 1e4),
    },
    { group: 'View', label: 'Perspective', value: (v.viewMode ?? 0) & 1 ? 'On' : 'Off' },
  ];
  if (!isPlan(v)) {
    rows.push({
      group: 'View',
      label: 'View direction',
      value: 'Not a plan view: Set Current waits for 3D views',
    });
  }
  return rows;
}

/** The Current view's rows: the window the space shown shows now. */
export function currentRows(v: ViewState): ViewRow[] {
  return extentRows(v.center, v.height, v.width);
}

/** Two corners of a window, in the space's world coordinates. */
export interface Corners {
  readonly a: Vec2;
  readonly b: Vec2;
}

/** A named view's window in world coordinates (its DXF 10 centre is less its target). */
export function boundaryOf(v: ViewRecord): Corners {
  const x = v.center.x + v.target.x;
  const y = v.center.y + v.target.y;
  return {
    a: { x: x - v.width / 2, y: y - v.height / 2 },
    b: { x: x + v.width / 2, y: y + v.height / 2 },
  };
}

/** The view two picked corners frame, in the space shown; undefined when it has no area. */
export function pickedWindow(
  w: { readonly a: Vec2; readonly b: Vec2 },
  paper: boolean,
): ViewState | undefined {
  const width = Math.abs(w.b.x - w.a.x);
  const height = Math.abs(w.b.y - w.a.y);
  if (!(width > 0) || !(height > 0)) return undefined;
  return { center: { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }, width, height, paper };
}

/** The New View dialog, while it is open. */
export interface NewViewState {
  readonly name: string;
  readonly boundary: 'display' | 'window';
  /** The corners Define window picked. */
  readonly window?: { readonly a: Vec2; readonly b: Vec2 };
}

/** What the dialog shows, kept while VIEW asks for a window. */
export interface ManagerState {
  /** The tree item selected: `current`, or `model:<name>` / `layout:<name>`. */
  readonly selected: string;
  /** The view Set Current chose, restored on OK or Apply. */
  readonly current: string | undefined;
  readonly creating: NewViewState | undefined;
  /**
   * Edit Boundaries... (part 5): the view whose boundary VIEW asks for at the command line, by
   * its tree key, and the window picked for it once the dialog shows again.
   */
  readonly editing?: { readonly key: string; readonly window?: Corners };
}

/** Why the dialog closed for VIEW: a window to pick, with the boundary to edit if any. */
export interface PickRequest {
  readonly boundary?: Corners;
}

/**
 * The open View Manager: which drawing it is open for, and VIEW waiting for it. Define window
 * hides it (`pickWindow`), VIEW asks for the corners and shows it again (`show` with `resume`),
 * with the state it hid with and the window picked.
 */
export const viewManager = (() => {
  let open: number | undefined;
  let kept: { doc: number; block: string; state: ManagerState } | undefined;
  let done: ((pick: PickRequest | false) => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (v: number | undefined) => {
    open = v;
    for (const l of listeners) l();
  };
  const finish = (pick: PickRequest | false) => {
    const d = done;
    done = undefined;
    d?.(pick);
  };
  return {
    get: () => open,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    show(
      doc: number,
      again: { window?: Corners | undefined; resume?: boolean } = {},
    ): Promise<PickRequest | false> {
      finish(false);
      const { window, resume } = again;
      if (resume && kept?.doc === doc) {
        const { creating, editing } = kept.state;
        if (window && editing) {
          kept = { ...kept, state: { ...kept.state, editing: { ...editing, window } } };
        } else if (window && creating) {
          kept = { ...kept, state: { ...kept.state, creating: { ...creating, window } } };
        }
      } else kept = undefined;
      set(doc);
      return new Promise((resolve) => (done = resolve));
    },
    /** The state to show a space's dialog with again, after Define window. */
    resume: (doc: number, block: string): ManagerState | undefined =>
      kept?.doc === doc && kept.block === block ? kept.state : undefined,
    /**
     * Define window, or Edit Boundaries... with the view's `boundary`: hides the dialogs, keeping
     * their state, for VIEW to ask for the corners.
     */
    pickWindow(doc: number, block: string, state: ManagerState, boundary?: Corners) {
      kept = { doc, block, state };
      set(undefined);
      finish(boundary ? { boundary } : {});
    },
    close() {
      kept = undefined;
      set(undefined);
      finish(false);
    },
  };
})();
