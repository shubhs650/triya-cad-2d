// Where the last line or arc drawn ended (M3-01): LINE and ARC continue from it when Enter
// answers their first prompt, as AutoCAD's do (AutoCAD 2024 Help, "LINE (Command)": "continue
// from the endpoint of the most recently drawn line or arc"; "ARC (Command)", Continue). One per
// document's commands, shared by the two.
import type { Vec2 } from '../../geom/types';

export interface DrawnEnd {
  readonly point: Vec2;
  /** The direction the line or arc travelled at its end (unit). */
  readonly direction: Vec2;
  /** It was an arc: LINE continues tangent to it, asking only for the length. */
  readonly arc: boolean;
}

export interface LastDrawn {
  end: DrawnEnd | undefined;
}

export const lastDrawn = (): LastDrawn => ({ end: undefined });

/** A line's direction from `from` to `to`; a zero-length line keeps `fallback`'s (else +X). */
export function lineDirection(from: Vec2, to: Vec2, fallback?: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const l = Math.hypot(dx, dy);
  return l > 0 ? { x: dx / l, y: dy / l } : (fallback ?? { x: 1, y: 0 });
}
