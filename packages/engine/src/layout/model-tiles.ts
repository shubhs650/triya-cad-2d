// Model space's tiled viewports (M1-22 part 4; moved here from the app by M6-02 part 10, whose
// -VPORTS edits them): every `*Active` VPORT record is one tile of the current configuration,
// and the records of a named configuration share its name (AutoCAD DXF reference, VPORT).
import type { VportRecord } from '../model/types';

/** The name every tile of the current configuration has. */
export const ACTIVE_VPORT = '*Active';

export const isActiveVport = (v: VportRecord): boolean => v.name.toUpperCase() === '*ACTIVE';

/** A tile's part of the window as fractions of its width and height, from the top left. */
export interface TileRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** One tiled model-space viewport: the `*Active` VPORT it opens in and where it sits. */
export interface ModelTile {
  readonly vport: VportRecord | undefined;
  readonly rect: TileRect;
}

const WHOLE: TileRect = { left: 0, top: 0, width: 1, height: 1 };

/**
 * A corner stored this far outside the window (in fractions of it) is rounding, clipped to the
 * window; further out, the tile is not in the window.
 */
const RECT_SLACK = 1e-6;

/**
 * The tiled model-space viewports of a configuration (the `*Active` records unless `name` is
 * given): its VPORTs in table order, the first being the current one, each in its part of the
 * window. DXF 10/11 give its lower-left and upper-right corners as fractions of the drawing area
 * with the origin at the lower left (AutoCAD DXF reference, VPORT), so the top is 1 less the
 * upper corner's Y. A tile with no area or outside the window is left out; when the current one
 * is, or fewer than two are left, the current viewport fills the window alone, as a single
 * viewport always does whatever corners it states.
 */
export function modelTiles(
  vports: Iterable<VportRecord> | undefined,
  name: string = ACTIVE_VPORT,
): readonly ModelTile[] {
  const key = name.toUpperCase();
  const active = [...(vports ?? [])].filter((v) => v.name.toUpperCase() === key);
  const placed: ModelTile[] = [];
  for (const vport of active) {
    const rect = tileRect(vport);
    if (rect) placed.push({ vport, rect });
    else if (placed.length === 0) break;
  }
  if (placed.length < 2) return [{ vport: active[0], rect: WHOLE }];
  return placed;
}

function tileRect(v: VportRecord): TileRect | undefined {
  const { lowerLeft: ll, upperRight: ur } = v;
  if (![ll?.x, ll?.y, ur?.x, ur?.y].every(Number.isFinite)) return undefined;
  const inside = (n: number) => n >= -RECT_SLACK && n <= 1 + RECT_SLACK;
  if (![ll.x, ll.y, ur.x, ur.y].every(inside)) return undefined;
  const clip = (n: number) => Math.min(Math.max(n, 0), 1);
  const x0 = clip(ll.x);
  const y0 = clip(ll.y);
  const x1 = clip(ur.x);
  const y1 = clip(ur.y);
  if (!(x1 - x0 > RECT_SLACK) || !(y1 - y0 > RECT_SLACK)) return undefined;
  return { left: x0, top: 1 - y1, width: x1 - x0, height: y1 - y0 };
}
