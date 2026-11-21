// The Viewports dialog's Standard viewports (M6-02 part 11; AutoCAD 2024 Help, "Viewports Dialog
// Box", New Viewports tab: "Standard Viewports: Lists and sets the standard viewport
// configurations, including CURRENT, which is the current configuration"), and what its OK
// answers. Each arrangement is MVIEW's and -VPORTS' (`viewportArrangement`) where they share one;
// Four: Right and Four: Left, which only the dialog has, put the large viewport (half the area,
// as Three's large one) on that side and the other three in rows on the other. Help does not
// draw them; half is the common reading, the same as Three's.
import type { Box } from '../geom/bounds';
import { viewportArrangement, type ViewportArrangement } from './mview';

/** The list's first entry: the configuration as it is (Help's "CURRENT"). */
export const ACTIVE_MODEL_CONFIGURATION = '*Active Model Configuration*';

export const STANDARD_VIEWPORTS = [
  'Single',
  'Two: Vertical',
  'Two: Horizontal',
  'Three: Right',
  'Three: Left',
  'Three: Above',
  'Three: Below',
  'Three: Vertical',
  'Three: Horizontal',
  'Four: Equal',
  'Four: Right',
  'Four: Left',
] as const;

export type StandardViewports = (typeof STANDARD_VIEWPORTS)[number];

const box = (minX: number, minY: number, maxX: number, maxY: number): Box => ({
  minX,
  minY,
  maxX,
  maxY,
});

/**
 * The frames of `standard` in `area`: the large one first, then top to bottom and left to right,
 * as MVIEW orders them; the first is the one made current.
 */
export function standardViewports(standard: StandardViewports, area: Box): Box[] {
  if (standard === 'Single') return [area];
  if (standard === 'Four: Equal') return viewportArrangement(area, 4);
  const [count, side] = standard.split(': ') as [string, string];
  if (count === 'Four') {
    const { minX: x0, minY: y0, maxX: x1, maxY: y1 } = area;
    const xm = (x0 + x1) / 2;
    const h = (y1 - y0) / 3;
    const [lx0, lx1, sx0, sx1] = side === 'Right' ? [xm, x1, x0, xm] : [x0, xm, xm, x1];
    return [
      box(lx0, y0, lx1, y1),
      box(sx0, y1 - h, sx1, y1),
      box(sx0, y0 + h, sx1, y1 - h),
      box(sx0, y0, sx1, y0 + h),
    ];
  }
  return viewportArrangement(area, count === 'Two' ? 2 : 3, side as ViewportArrangement);
}

/**
 * `frames` with `spacing` between them (the layout's Viewport Spacing, AutoCAD 2024 Help: "the
 * spacing you want to apply between the floating viewports"): each side shared with another
 * frame, not on `area`'s edge, moves in by half of it. A spacing that would leave a frame no size
 * leaves the frames as they are.
 */
export function spacedViewports(frames: readonly Box[], area: Box, spacing: number): Box[] {
  if (!(spacing > 0)) return [...frames];
  const size = Math.max(area.maxX - area.minX, area.maxY - area.minY);
  const edge = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * size;
  const half = spacing / 2;
  const out = frames.map((f) =>
    box(
      edge(f.minX, area.minX) ? f.minX : f.minX + half,
      edge(f.minY, area.minY) ? f.minY : f.minY + half,
      edge(f.maxX, area.maxX) ? f.maxX : f.maxX - half,
      edge(f.maxY, area.maxY) ? f.maxY : f.maxY - half,
    ),
  );
  return out.every((f) => f.maxX > f.minX && f.maxY > f.minY) ? out : [...frames];
}

/** The New Viewports tab's OK. */
export interface NewViewportsChoice {
  readonly tab: 'new';
  readonly standard: StandardViewports | typeof ACTIVE_MODEL_CONFIGURATION;
  /** New name (model space only): the configuration is saved under it too. */
  readonly name?: string;
  /** Apply to (model space). */
  readonly applyTo: 'Display' | 'Current viewport';
  /** Viewport Spacing (a layout), in paper units. */
  readonly spacing: number;
  /**
   * Change view to, for each viewport of the arrangement in `standardViewports` order (the
   * configuration's tiles, the current first, for the active one): a named model view, or null
   * for the current view (a new layout viewport: model space's extents).
   */
  readonly views: readonly (string | null)[];
}

/** The Named Viewports tab's OK with a configuration selected. */
export interface NamedViewportsChoice {
  readonly tab: 'named';
  readonly name: string;
}

/**
 * What the Viewports dialog's OK answers: the named configurations renamed and deleted on its
 * Named Viewports tab (their shortcut menu), and the configuration to apply, if any.
 */
export interface ViewportsDialogChoice {
  readonly renamed: readonly { readonly from: string; readonly to: string }[];
  readonly deleted: readonly string[];
  readonly apply?: NewViewportsChoice | NamedViewportsChoice;
}

/** What VPORTS opens the dialog with. */
export interface ViewportsDialogRequest {
  /** A layout: New name unavailable, Viewport Spacing for Apply to, the area asked after OK. */
  readonly layout: boolean;
  /** The Named Viewports tab's Current name (`*Active` when the configuration has none). */
  readonly current: string;
  /** The named configurations, by name, each tile's corners (0–1, lower-left origin). */
  readonly configurations: readonly {
    readonly name: string;
    readonly tiles: readonly Box[];
  }[];
  /** The current configuration's tiles, the current one first. */
  readonly active: readonly Box[];
  /** The named model views Change view to lists. */
  readonly views: readonly string[];
}
