// A hatch's pattern lines laid out again (M2-35 part 3), shared by the Properties palette's
// Angle and Scale rows and the hatch grip's Hatch Angle and Hatch Scale (M3-05 part 3).
import type { Vec2 } from '../geom/types';
import type { HatchPatternLine } from '../model/types';

/**
 * Pattern lines turned by `by` and scaled by `k` about `o`, as AutoCAD lays a pattern out again
 * at a new angle or scale about the same origin (each line's base point, its offset and dashes).
 */
export function relaidLines(
  lines: readonly HatchPatternLine[],
  o: Vec2,
  by: number,
  k: number,
): HatchPatternLine[] {
  const c = Math.cos(by);
  const s = Math.sin(by);
  const t = (v: Vec2): Vec2 => ({ x: k * (v.x * c - v.y * s), y: k * (v.x * s + v.y * c) });
  return lines.map((l) => {
    const d = t({ x: l.base.x - o.x, y: l.base.y - o.y });
    return {
      angle: l.angle + by,
      base: { x: o.x + d.x, y: o.y + d.y },
      offset: t(l.offset),
      dashes: l.dashes.map((x) => x * k),
    };
  });
}
