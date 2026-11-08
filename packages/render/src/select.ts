// Selection windows against what is drawn (M2-03): which primitives a window takes. AutoCAD's
// rules (AutoCAD 2024 Help, "To Select Objects"): a window (dragged left to right) "selects
// objects that are entirely enclosed", a crossing window (right to left) "selects objects that
// are enclosed or crossed". An object is the primitives it draws: a window must enclose every
// one, a crossing window take any one it encloses or touches. Measured on the continuous path of
// a dashed line (its gaps count, as a pick's do), with arcs exact; ellipses and Bézier curves
// (TrueType glyphs) by fine chords, and text by its glyphs and the boxes of its runs. XLINEs and
// RAYs are never enclosed.
import type { Box } from '@triya/engine';
import {
  PATH_A,
  PATH_C,
  PATH_E,
  PATH_L,
  PATH_M,
  PATH_Q,
  PATH_Z,
  type RenderPrimitive,
} from './types';

const ELLIPSE_CHORDS = 64;
const BEZIER_CHORDS = 16;

interface Walker {
  /** A straight piece, from the current point. */
  line(x0: number, y0: number, x1: number, y1: number): void;
  /** A circular arc from a0 to a1 (radians), counter-clockwise when `ccw`. */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw: boolean): void;
}

/** Walks a packed path as the canvas draws it: an arc starts with a line from the current point. */
function walk(path: readonly number[], w: Walker): void {
  let has = false;
  let px = 0;
  let py = 0;
  let sx = 0;
  let sy = 0;
  const to = (x: number, y: number): void => {
    if (has) w.line(px, py, x, y);
    else {
      sx = x;
      sy = y;
    }
    px = x;
    py = y;
    has = true;
  };
  for (let i = 0; i < path.length;) {
    switch (path[i]) {
      case PATH_M:
        px = sx = path[i + 1]!;
        py = sy = path[i + 2]!;
        has = true;
        i += 3;
        break;
      case PATH_L:
        to(path[i + 1]!, path[i + 2]!);
        i += 3;
        break;
      case PATH_A: {
        const cx = path[i + 1]!;
        const cy = path[i + 2]!;
        const r = path[i + 3]!;
        const a0 = path[i + 4]!;
        const a1 = path[i + 5]!;
        to(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
        w.arc(cx, cy, r, a0, a1, path[i + 6] !== 0);
        px = cx + r * Math.cos(a1);
        py = cy + r * Math.sin(a1);
        i += 7;
        break;
      }
      case PATH_E: {
        const [cx, cy, rx, ry, rot, a0, a1] = path.slice(i + 1, i + 8) as number[];
        const point = (t: number): [number, number] => {
          const ux = rx! * Math.cos(t);
          const uy = ry! * Math.sin(t);
          return [
            cx! + ux * Math.cos(rot!) - uy * Math.sin(rot!),
            cy! + ux * Math.sin(rot!) + uy * Math.cos(rot!),
          ];
        };
        for (let j = 0; j <= ELLIPSE_CHORDS; j++) {
          to(...point(a0! + ((a1! - a0!) * j) / ELLIPSE_CHORDS));
        }
        i += 9;
        break;
      }
      case PATH_Q:
      case PATH_C: {
        const q = path[i] === PATH_Q;
        const [x0, y0] = [px, py];
        for (let j = 1; j <= BEZIER_CHORDS; j++) {
          const t = j / BEZIER_CHORDS;
          const u = 1 - t;
          if (q) {
            to(
              u * u * x0 + 2 * u * t * path[i + 1]! + t * t * path[i + 3]!,
              u * u * y0 + 2 * u * t * path[i + 2]! + t * t * path[i + 4]!,
            );
          } else {
            const [b0, b1, b2, b3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
            to(
              b0 * x0 + b1 * path[i + 1]! + b2 * path[i + 3]! + b3 * path[i + 5]!,
              b0 * y0 + b1 * path[i + 2]! + b2 * path[i + 4]! + b3 * path[i + 6]!,
            );
          }
        }
        i += q ? 5 : 7;
        break;
      }
      case PATH_Z:
        if (has) w.line(px, py, sx, sy);
        px = sx;
        py = sy;
        i += 1;
        break;
      default:
        i += 1;
    }
  }
}

/**
 * Whether angle `a` lies on the arc from a0 to a1: the tessellator writes a1 as a0 plus or
 * minus the sweep, so |a1 − a0| is the sweep (as the renderer's hit test reads it).
 */
function onSweep(a: number, a0: number, a1: number, ccw: boolean): boolean {
  const TAU = 2 * Math.PI;
  const norm = (x: number) => ((x % TAU) + TAU) % TAU;
  const sweep = Math.abs(a1 - a0);
  if (sweep >= TAU - 1e-12) return true;
  return (ccw ? norm(a - a0) : norm(a0 - a)) <= sweep + 1e-12;
}

/** The paths of a primitive selection looks at: its continuous path, and text's run boxes. */
function pathsOf(prim: Extract<RenderPrimitive, { path: unknown }>): (readonly number[])[] {
  const out: (readonly number[])[] = [prim.continuous ?? prim.path];
  if (prim.text && prim.text.greek.length > 0) out.push(prim.text.greek);
  return out;
}

/** Whether a primitive lies wholly inside `box` (a window takes it). */
export function primInside(prim: RenderPrimitive, box: Box): boolean {
  const inX = (x: number) => x >= box.minX && x <= box.maxX;
  const inY = (y: number) => y >= box.minY && y <= box.maxY;
  if (prim.kind === 'point') return inX(prim.x) && inY(prim.y);
  if (prim.kind === 'infinite') return false;
  let inside = true;
  for (const path of pathsOf(prim)) {
    walk(path, {
      line(x0, y0, x1, y1) {
        if (!(inX(x0) && inY(y0) && inX(x1) && inY(y1))) inside = false;
      },
      arc(cx, cy, r, a0, a1, ccw) {
        // The arc's extremes: its ends and the quadrant points it sweeps over.
        const angles = [a0, a1, 0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
        for (const a of angles) {
          if (a !== a0 && a !== a1 && !onSweep(a, a0, a1, ccw)) continue;
          if (!(inX(cx + r * Math.cos(a)) && inY(cy + r * Math.sin(a)))) inside = false;
        }
      },
    });
    // A path's first point counts even when nothing is drawn from it (a dot).
    if (path.length >= 3 && path[0] === PATH_M && !(inX(path[1]!) && inY(path[2]!))) {
      inside = false;
    }
    if (!inside) return false;
  }
  return inside;
}

/** Liang–Barsky: does the segment touch the closed box? */
function segmentTouches(x0: number, y0: number, x1: number, y1: number, b: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, x0 - b.minX) &&
    clip(dx, b.maxX - x0) &&
    clip(-dy, y0 - b.minY) &&
    clip(dy, b.maxY - y0) &&
    t0 <= t1
  );
}

/** Does the arc touch the closed box: an end inside it, or crossing one of its sides? */
function arcTouches(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  ccw: boolean,
  b: Box,
): boolean {
  const inBox = (x: number, y: number) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
  if (inBox(cx + r * Math.cos(a0), cy + r * Math.sin(a0))) return true;
  // Where the circle meets each side's line, on the side and on the sweep.
  const hits = (fixed: number, vertical: boolean, lo: number, hi: number): boolean => {
    const d = vertical ? fixed - cx : fixed - cy;
    if (Math.abs(d) > r) return false;
    const h = Math.sqrt(r * r - d * d);
    for (const s of [-h, h]) {
      const along = (vertical ? cy : cx) + s;
      if (along < lo || along > hi) continue;
      const a = vertical ? Math.atan2(s, d) : Math.atan2(d, s);
      if (onSweep(a, a0, a1, ccw)) return true;
    }
    return false;
  };
  return (
    hits(b.minX, true, b.minY, b.maxY) ||
    hits(b.maxX, true, b.minY, b.maxY) ||
    hits(b.minY, false, b.minX, b.maxX) ||
    hits(b.maxY, false, b.minX, b.maxX)
  );
}

/** Even-odd: is the point inside the closed path (a fill's area)? */
function insidePath(path: readonly number[], x: number, y: number): boolean {
  let crossings = 0;
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    if (y0 > y !== y1 > y && x < ((x1 - x0) * (y - y0)) / (y1 - y0) + x0) crossings++;
  };
  walk(path, {
    line: edge,
    arc(cx, cy, r, a0, a1) {
      const n = ELLIPSE_CHORDS;
      let [qx, qy] = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
      for (let j = 1; j <= n; j++) {
        const t = a0 + ((a1 - a0) * j) / n;
        const [nx, ny] = [cx + r * Math.cos(t), cy + r * Math.sin(t)];
        edge(qx, qy, nx, ny);
        [qx, qy] = [nx, ny];
      }
    },
  });
  return crossings % 2 === 1;
}

/** Whether a primitive is inside or crosses `box` (a crossing window takes it). */
export function primCrosses(prim: RenderPrimitive, box: Box): boolean {
  if (prim.kind === 'point') return primInside(prim, box);
  if (prim.kind === 'infinite') {
    const far = 1e12;
    const x0 = prim.both ? prim.base.x - prim.direction.x * far : prim.base.x;
    const y0 = prim.both ? prim.base.y - prim.direction.y * far : prim.base.y;
    return segmentTouches(
      x0,
      y0,
      prim.base.x + prim.direction.x * far,
      prim.base.y + prim.direction.y * far,
      box,
    );
  }
  for (const path of pathsOf(prim)) {
    let touches = false;
    walk(path, {
      line(x0, y0, x1, y1) {
        if (!touches && segmentTouches(x0, y0, x1, y1, box)) touches = true;
      },
      arc(cx, cy, r, a0, a1, ccw) {
        if (!touches && arcTouches(cx, cy, r, a0, a1, ccw, box)) touches = true;
      },
    });
    if (touches) return true;
    const lone = path.length === 3 && path[0] === PATH_M;
    if (
      lone &&
      path[1]! >= box.minX &&
      path[1]! <= box.maxX &&
      path[2]! >= box.minY &&
      path[2]! <= box.maxY
    )
      return true;
    // A window wholly inside a fill (or a run of text) still crosses it.
    const filled = prim.kind === 'fill' || path !== (prim.continuous ?? prim.path);
    if (filled && insidePath(path, box.minX, box.minY)) return true;
  }
  return false;
}
