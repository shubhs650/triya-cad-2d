// A sloped LINE's end heights (DEC-063). Triya edits lines in plan; when a command moves a line's
// end along the line itself (BREAK, TRIM, EXTEND, LENGTHEN, FILLET, CHAMFER, JOIN), the end takes
// the height of the 3D line at that point, so the line stays on the line it was. Other edits keep
// each end's height (DEC-039: no command changes an existing height).
import type { Vec2 } from '../geom/types';
import { dot, sub } from '../geom/vec';
import type { LineGeometry } from '../model/types';

/** The heights of `g`'s start and end: its elevation for a level line. */
export function lineHeights(g: LineGeometry): readonly [number, number] {
  return g.heights ?? [g.elevation ?? 0, g.elevation ?? 0];
}

/** The height of the 3D line through `g` at plan point `p` (on its carrier, or square to it). */
export function heightAt(g: LineGeometry, p: Vec2): number {
  const [z0, z1] = lineHeights(g);
  if (z0 === z1) return z0;
  // Exactly at an end, exactly its height.
  if (p.x === g.start.x && p.y === g.start.y) return z0;
  if (p.x === g.end.x && p.y === g.end.y) return z1;
  const d = sub(g.end, g.start);
  const t = dot(sub(p, g.start), d) / dot(d, d);
  return z0 + (z1 - z0) * t;
}

/** `g` with these end heights: `heights` when they differ, else the elevation they share. */
export function withHeights(g: LineGeometry, z0: number, z1: number): LineGeometry {
  const { heights: _h, elevation: _e, ...rest } = g;
  if (z0 !== z1) return { ...rest, heights: [z0, z1] };
  return z0 !== 0 ? { ...rest, elevation: z0 } : rest;
}

/** `g` with its ends moved to `start` and `end` on its own carrier, heights following the line. */
export function alongLine(g: LineGeometry, start: Vec2, end: Vec2): LineGeometry {
  if (!g.heights) return { ...g, start, end };
  return withHeights({ ...g, start, end }, heightAt(g, start), heightAt(g, end));
}
