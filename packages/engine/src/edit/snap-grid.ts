// The drawing's snap and grid spacing (M3-06 part 2). AutoCAD keeps SNAPUNIT, GRIDUNIT and
// GRIDMAJOR in the current viewport (AutoCAD 2024 Help, each variable: "Saved in: Drawing";
// DXF reference, VPORT codes 14/24, 15/25 and 61): Triya's is the model-space `*Active` VPORT,
// the first one when tiles share the name (the DXF reference: the first is the current
// viewport). The Snap and Grid tab, SNAP and GRID edit it; a drawing without one keeps the
// canvas's 10 × 10 spacing. Isometric snap is not built (PRD non-goal 7, DEC-026, DEC-060).
// Part 6 adds the Grid behavior, GRIDDISPLAY, which the VPORT keeps as its grid flags (DXF 60),
// and SETVAR's SNAPUNIT, GRIDUNIT, GRIDMAJOR, GRIDDISPLAY and SNAPBASE, which set it too.
// Part 17 of M6-02 gives each layout viewport its own (`snapGridHolder`): AutoCAD keeps SNAPUNIT,
// GRIDUNIT, SNAPBASE, SNAPANG, GRIDMAJOR and GRIDDISPLAY in the viewport worked in, a layout
// viewport's in its VIEWPORT (DXF 13, 14, 15, 50, 61 and the 90 bits 262144 to 2097152), paper
// space's in the layout's paper-space viewport (DXF 69 id 1).
import type { DocumentModel } from '../model/document';
import type { ChangeSetBuilder } from '../model/builder';
import type { Handle } from '../model/handle';
import type { Vec2 } from '../geom/types';
import type { ViewportGeometry, ViewportSnapGrid, VportRecord } from '../model/types';
import type { SnapGridSettings } from '../commands/prompt';

const isActive = (v: VportRecord) => v.name.toUpperCase() === '*ACTIVE';

/** The model-space `*Active` VPORT, the current one of several. */
export function currentVport(model: DocumentModel): VportRecord | undefined {
  for (const v of model.tables.vports.values()) if (isActive(v)) return v;
  return undefined;
}

/**
 * GRIDDISPLAY's bits (AutoCAD 2024 Help, "GRIDDISPLAY"): the grid runs beyond the limits, is
 * adaptive (fewer lines when zoomed out), subdivides below the grid spacing when zoomed in
 * (adaptive only), and follows the dynamic UCS (Triya has none, so the bit is only kept).
 */
export const GRID_DISPLAY = { beyondLimits: 1, adaptive: 2, subdivide: 4, follow: 8 } as const;
const GRID_DISPLAY_BITS = 15;

/**
 * The snap and grid settings of the viewport worked in, as a VPORT record names them (a
 * VIEWPORT's are mapped to these names by `viewportSnapGrid`).
 */
export interface SnapGridState {
  readonly snapBase: Vec2;
  readonly snapSpacing: Vec2;
  /** SNAPANG, radians. */
  readonly snapRotation: number;
  readonly gridSpacing: Vec2;
  readonly gridMajor: number;
  /** GRIDDISPLAY's bits (`GRID_DISPLAY`). */
  readonly gridFlags: number;
}

/** The Snap and Grid tab's settings as `v` holds them. */
export function snapGridOf(v: SnapGridState): SnapGridSettings {
  return {
    snapSpacing: v.snapSpacing,
    gridSpacing: v.gridSpacing,
    gridMajor: v.gridMajor,
    gridDisplay: v.gridFlags,
  };
}

/** GRIDMAJOR's range (AutoCAD 2024 Help, "GRIDMAJOR": 1 to 100). */
export const GRID_MAJOR = { min: 1, max: 100 } as const;

/**
 * Why the settings cannot be kept, or undefined: snap spacing above 0, grid spacing 0 (follow
 * the snap spacing) or more, and a major line every 1 to 100 grid lines.
 */
export function snapGridProblem(s: SnapGridSettings): string | undefined {
  const finite = (n: number) => Number.isFinite(n);
  const { snapSpacing: snap, gridSpacing: grid } = s;
  if (!(snap.x > 0 && snap.y > 0 && finite(snap.x + snap.y)))
    return 'Snap spacing must be more than 0.';
  if (!(grid.x >= 0 && grid.y >= 0 && finite(grid.x + grid.y)))
    return 'Grid spacing must be 0 or more.';
  if (!(
    Number.isInteger(s.gridMajor) &&
    s.gridMajor >= GRID_MAJOR.min &&
    s.gridMajor <= GRID_MAJOR.max
  ))
    return 'Major line every must be a whole number from 1 to 100.';
  const d = s.gridDisplay;
  if (d !== undefined && !(Number.isInteger(d) && d >= 0 && d <= GRID_DISPLAY_BITS))
    return 'Grid behavior must be GRIDDISPLAY bits from 0 to 15.';
  return undefined;
}

/** What setting `s` in `v` changes in it; undefined when nothing. */
export function snapGridPatch(
  v: SnapGridState,
  s: SnapGridSettings,
): Partial<SnapGridState> | undefined {
  const same = (p: { x: number; y: number }, q: { x: number; y: number }) =>
    p.x === q.x && p.y === q.y;
  const patch = {
    ...(!same(v.snapSpacing, s.snapSpacing) && { snapSpacing: { ...s.snapSpacing } }),
    ...(!same(v.gridSpacing, s.gridSpacing) && { gridSpacing: { ...s.gridSpacing } }),
    ...(v.gridMajor !== s.gridMajor && { gridMajor: s.gridMajor }),
    ...(s.gridDisplay !== undefined &&
      v.gridFlags !== s.gridDisplay && { gridFlags: s.gridDisplay }),
  };
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * Where a VIEWPORT keeps GRIDDISPLAY (DXF reference, VIEWPORT 90): 262144 the grid beyond the
 * limits, 524288 adaptive, 1048576 subdivision below the spacing, 2097152 following the dynamic
 * UCS, the VPORT's DXF 60 bits 1, 2, 4 and 8 shifted up by 18.
 */
export const VIEWPORT_GRID_DISPLAY_SHIFT = 18;
const VIEWPORT_GRID_DISPLAY_MASK = GRID_DISPLAY_BITS << VIEWPORT_GRID_DISPLAY_SHIFT;

/**
 * What a viewport made without them starts with: AutoCAD's 10 × 10 spacing, a major line every
 * 5, from 0,0, square to the UCS (the canvas's own defaults, M3-06 part 2).
 */
export const DEFAULT_VIEWPORT_SNAP_GRID: ViewportSnapGrid = {
  snapBase: { x: 0, y: 0 },
  snapSpacing: { x: 10, y: 10 },
  gridSpacing: { x: 10, y: 10 },
  snapAngle: 0,
  gridMajor: 5,
};

/** A VIEWPORT's snap and grid settings, by the VPORT record's names. */
export function viewportSnapGrid(g: ViewportGeometry): SnapGridState {
  const s = g.snapGrid ?? DEFAULT_VIEWPORT_SNAP_GRID;
  return {
    snapBase: s.snapBase,
    snapSpacing: s.snapSpacing,
    snapRotation: s.snapAngle,
    gridSpacing: s.gridSpacing,
    gridMajor: s.gridMajor,
    gridFlags: (g.flags & VIEWPORT_GRID_DISPLAY_MASK) >>> VIEWPORT_GRID_DISPLAY_SHIFT,
  };
}

/** `g` with `patch` of its snap and grid settings set (GRIDDISPLAY into its 90 bits). */
export function withViewportSnapGrid(
  g: ViewportGeometry,
  patch: Partial<SnapGridState>,
): ViewportGeometry {
  const n = { ...viewportSnapGrid(g), ...patch };
  const display = (n.gridFlags & GRID_DISPLAY_BITS) << VIEWPORT_GRID_DISPLAY_SHIFT;
  return {
    ...g,
    flags: (g.flags & ~VIEWPORT_GRID_DISPLAY_MASK) | display,
    snapGrid: {
      snapBase: { ...n.snapBase },
      snapSpacing: { ...n.snapSpacing },
      gridSpacing: { ...n.gridSpacing },
      snapAngle: n.snapRotation,
      gridMajor: n.gridMajor,
    },
  };
}

/**
 * `g`, a viewport MVIEW is making, with model space's snap and grid settings (its `*Active`
 * VPORT's, GRIDDISPLAY too), else AutoCAD's defaults. AutoCAD's help does not say what a new
 * layout viewport starts with; model space's is the common drafter expectation, as -VPORTS's new
 * tiles start with the current viewport's (M6-02 part 10).
 */
export function withNewViewportSnapGrid(
  model: DocumentModel,
  g: ViewportGeometry,
): ViewportGeometry {
  const v = currentVport(model);
  if (!v) return { ...g, snapGrid: DEFAULT_VIEWPORT_SNAP_GRID };
  const { snapBase, snapSpacing, snapRotation, gridSpacing, gridMajor, gridFlags } = v;
  return withViewportSnapGrid(g, {
    snapBase,
    snapSpacing,
    snapRotation,
    gridSpacing,
    gridMajor,
    gridFlags,
  });
}

/** The snap and grid settings of the viewport worked in, and how to edit them. */
export interface SnapGridHolder {
  /** The VPORT record or the VIEWPORT that keeps them. */
  readonly kind: 'vport' | 'viewport';
  readonly handle: Handle;
  readonly state: SnapGridState;
  /** Sets `patch` in it, in `b`. */
  write(b: ChangeSetBuilder, patch: Partial<SnapGridState>): void;
}

/** A layout's paper-space viewport (DXF 69 id 1), if it has one. */
function paperViewportOf(
  model: DocumentModel,
  sheet: Handle,
): { handle: Handle; geom: ViewportGeometry } | undefined {
  if (!model.hasBlock(sheet)) return undefined;
  for (const id of model.blockEntities(sheet)) {
    const e = model.entity(id);
    if (e?.geom.kind === 'VIEWPORT' && e.geom.id === 1) return { handle: e.handle, geom: e.geom };
  }
  return undefined;
}

function viewportHolder(
  model: DocumentModel,
  handle: Handle,
  geom: ViewportGeometry,
): SnapGridHolder {
  return {
    kind: 'viewport',
    handle,
    state: viewportSnapGrid(geom),
    write(b, patch) {
      const id = model.ids.idOf(handle);
      if (id === undefined) return;
      b.updateEntity(id, { geom: withViewportSnapGrid(geom, patch) });
    },
  };
}

/**
 * Where the snap and grid settings of the viewport worked in are kept (M6-02 part 17): the
 * layout viewport made current (`viewport`), else, on a layout (`sheet`, its paper-space block),
 * its paper-space viewport, else model space's `*Active` VPORT, which also stands in for a
 * layout that has no paper-space viewport yet (AutoCAD makes one when the layout is first
 * shown). Undefined when the drawing has none of them.
 */
export function snapGridHolder(
  model: DocumentModel,
  at?: { readonly sheet?: Handle | undefined; readonly current?: Handle | undefined },
): SnapGridHolder | undefined {
  const current = at?.current;
  if (current !== undefined) {
    const id = model.ids.idOf(current);
    const e = id === undefined ? undefined : model.entity(id);
    if (e?.geom.kind === 'VIEWPORT') return viewportHolder(model, current, e.geom);
  }
  const paper = at?.sheet === undefined ? undefined : paperViewportOf(model, at.sheet);
  if (paper) return viewportHolder(model, paper.handle, paper.geom);
  const v = currentVport(model);
  if (!v) return undefined;
  return {
    kind: 'vport',
    handle: v.handle,
    state: v,
    write: (b, patch) => b.updateTableRecord('vports', v.handle, patch),
  };
}
