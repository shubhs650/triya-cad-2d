// The drawing's snap and grid spacing (M3-06 part 2). AutoCAD keeps SNAPUNIT, GRIDUNIT and
// GRIDMAJOR in the current viewport (AutoCAD 2024 Help, each variable: "Saved in: Drawing";
// DXF reference, VPORT codes 14/24, 15/25 and 61): Triya's is the model-space `*Active` VPORT,
// the first one when tiles share the name (the DXF reference: the first is the current
// viewport). The Snap and Grid tab, SNAP and GRID edit it; a drawing without one keeps the
// canvas's 10 × 10 spacing. Isometric snap is not built (PRD non-goal 7, DEC-026, DEC-060).
// Part 6 adds the Grid behavior, GRIDDISPLAY, which the VPORT keeps as its grid flags (DXF 60),
// and SETVAR's SNAPUNIT, GRIDUNIT, GRIDMAJOR, GRIDDISPLAY and SNAPBASE, which set it too.
import type { DocumentModel } from '../model/document';
import type { VportRecord } from '../model/types';
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

/** The Snap and Grid tab's settings as `v` holds them. */
export function snapGridOf(v: VportRecord): SnapGridSettings {
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
  v: VportRecord,
  s: SnapGridSettings,
): Partial<VportRecord> | undefined {
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
