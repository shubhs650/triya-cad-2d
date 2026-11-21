// A window dragged on a screen that shows model space turned (a twisted layout viewport, M6-02
// parts 15 and 16): the window is square to the screen, so in model space it is a rectangle
// turned by the twist. `turn` is the angle world X shows at on the screen, counterclockwise.
import type { Vec2 } from './types';

/** The screen's X and Y (up) axes in the world, on a screen that shows world X at `turn`. */
function screenAxes(turn: number): { u: Vec2; v: Vec2 } {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return { u: { x: c, y: -s }, v: { x: s, y: c } };
}

/** `p − a` along the screen's X and Y axes. */
export function screenOffset(a: Vec2, p: Vec2, turn = 0): Vec2 {
  if (!turn) return { x: p.x - a.x, y: p.y - a.y };
  const { u, v } = screenAxes(turn);
  const dx = p.x - a.x;
  const dy = p.y - a.y;
  return { x: dx * u.x + dy * u.y, y: dx * v.x + dy * v.y };
}

/** The corners of the window from `a` to `b` square to a screen turned by `turn`, from `a`. */
export function screenWindowCorners(a: Vec2, b: Vec2, turn = 0): Vec2[] {
  if (!turn) return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  const { u, v } = screenAxes(turn);
  const d = screenOffset(a, b, turn);
  return [
    a,
    { x: a.x + u.x * d.x, y: a.y + u.y * d.x },
    b,
    { x: a.x + v.x * d.y, y: a.y + v.y * d.y },
  ];
}

/**
 * Whether `p` lies in the window from `a` to `b` square to a screen turned by `turn`, its edges
 * and `pad` beyond them included.
 */
export function inScreenWindow(a: Vec2, b: Vec2, p: Vec2, turn = 0, pad = 0): boolean {
  const d = screenOffset(a, b, turn);
  const q = screenOffset(a, p, turn);
  return (
    q.x >= Math.min(0, d.x) - pad &&
    q.x <= Math.max(0, d.x) + pad &&
    q.y >= Math.min(0, d.y) - pad &&
    q.y <= Math.max(0, d.y) + pad
  );
}
