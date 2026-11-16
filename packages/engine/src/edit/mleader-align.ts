// MLEADERALIGN and MLEADERCOLLECT geometry (M4-04 part 3): where each multileader's content
// goes, as the moves AutoCAD 2024's commands make ("MLEADERALIGN (Command)", "MLEADERCOLLECT
// (Command)", AutoCAD 2024 Help). Content moves with its landings and the leader lines keep
// their arrowheads and vertices, as the landing grip moves it (object-grips.ts `moveLanding`).
//
// AutoCAD's help names the options and not the arithmetic; the readings here, the ones a
// drafter expects, are:
// - Content is aligned by its content base point (context DXF 10, the landing's end), along the
//   line from the reference multileader's in the direction given.
// - Use current spacing keeps each one's distance along that line: its base point moves square
//   to the line onto it.
// - Specify spacing puts that gap between the extents of neighbouring content along the line,
//   in the order the multileaders already lie along it, the reference staying where it is.
// - Make leader segments parallel moves each one along the line until its last leader segment
//   (its first leader line's) is parallel to the reference's.
// - Distribute spaces the base points evenly from the first point to the second, in the order
//   they lie along that line.
// - MLEADERCOLLECT keeps the leader of the multileader selected first and lays the blocks out
//   in the order selected from the point given, the collection's upper-left corner, a landing
//   gap apart. The other multileaders stay multileaders without leader lines (a MULTILEADER
//   holds one block, so the collection is several), as AutoCAD's collected balloons stay
//   selectable one by one. With the kept leader coming from the right, its block goes last.
import type { Box } from '../geom/bounds';
import type { Vec2 } from '../geom/types';
import type { MultiLeaderGeometry } from '../model/types';
import { moveLanding } from './object-grips';

/** How MLEADERALIGN spaces content (its Options). */
export type MLeaderAlignMode =
  | { readonly kind: 'current' }
  | { readonly kind: 'parallel' }
  | { readonly kind: 'spacing'; readonly spacing: number }
  | { readonly kind: 'distribute' };

/** A multileader to align: its geometry and its content's box where known. */
export interface AlignItem {
  readonly geom: MultiLeaderGeometry;
  readonly box?: Box;
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
const unit = (a: Vec2): Vec2 | undefined => {
  const l = Math.hypot(a.x, a.y);
  return l > 0 ? { x: a.x / l, y: a.y / l } : undefined;
};

/** The multileader with its content and landings moved by `d`. */
export const moveMultiLeaderContent = (g: MultiLeaderGeometry, d: Vec2): MultiLeaderGeometry =>
  d.x === 0 && d.y === 0 ? g : moveLanding(g, d);

/** The content's extent along `u` relative to its base point: [lo, hi]; none without a box. */
function extentAlong(item: AlignItem, u: Vec2): readonly [number, number] {
  const b = item.box;
  if (!b) return [0, 0];
  const c = item.geom.contentBase;
  const ts = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.minX, y: b.maxY },
    { x: b.maxX, y: b.maxY },
  ].map((p) => dot(sub(p, c), u));
  return [Math.min(...ts), Math.max(...ts)];
}

/** The last segment of a multileader's first leader line, towards the landing. */
function lastSegment(g: MultiLeaderGeometry): { from: Vec2; to: Vec2 } | undefined {
  const b = g.branches[0];
  const line = b?.lines[0];
  const from = line?.vertices.at(-1);
  if (!b || !from) return undefined;
  return { from, to: b.connection };
}

/**
 * The content moves MLEADERALIGN makes, one per item: the item at `reference` stays, the others
 * line up from its base point in the direction `towards` (any point off it). Distribute is
 * `distribute` instead.
 */
export function alignMultiLeaders(
  items: readonly AlignItem[],
  reference: number,
  towards: Vec2,
  mode: Exclude<MLeaderAlignMode, { kind: 'distribute' }>,
): readonly Vec2[] {
  const ref = items[reference]!;
  const origin = ref.geom.contentBase;
  const u = unit(sub(towards, origin));
  const none = { x: 0, y: 0 };
  if (!u) return items.map(() => none);
  const along = items.map((it) => dot(sub(it.geom.contentBase, origin), u));
  const onLine = (i: number, t: number): Vec2 =>
    sub(add(origin, scale(u, t)), items[i]!.geom.contentBase);
  if (mode.kind === 'current') {
    return items.map((_, i) => (i === reference ? none : onLine(i, along[i]!)));
  }
  if (mode.kind === 'parallel') {
    const seg = lastSegment(ref.geom);
    const v = seg && unit(sub(seg.to, seg.from));
    return items.map((it, i) => {
      if (i === reference) return none;
      const own = lastSegment(it.geom);
      const det = v ? cross(u, v) : 0;
      // A reference without leaders, or a last segment along the line: no parallel place.
      if (!v || !own || Math.abs(det) < 1e-12) return onLine(i, along[i]!);
      // own.from + k·v + (base − connection) on the line: k from cross products.
      const offset = sub(it.geom.contentBase, own.to);
      const w = sub(sub(origin, own.from), offset);
      const k = cross(u, w) / det;
      return sub(add(own.from, scale(v, k)), own.to);
    });
  }
  // Specify spacing: neighbours along the line, outwards from the reference.
  const ext = items.map((it) => extentAlong(it, u));
  const out: Vec2[] = items.map(() => none);
  const order = items.map((_, i) => i).filter((i) => i !== reference);
  const ahead = order.filter((i) => along[i]! >= 0).sort((a, b) => along[a]! - along[b]!);
  const behind = order.filter((i) => along[i]! < 0).sort((a, b) => along[b]! - along[a]!);
  let t = 0;
  let prev = reference;
  for (const i of ahead) {
    t = t + ext[prev]![1] + mode.spacing - ext[i]![0];
    out[i] = onLine(i, t);
    prev = i;
  }
  t = 0;
  prev = reference;
  for (const i of behind) {
    t = t + ext[prev]![0] - mode.spacing - ext[i]![1];
    out[i] = onLine(i, t);
    prev = i;
  }
  return out;
}

/** MLEADERALIGN Distribute: the base points spaced evenly from `first` to `second`. */
export function distributeMultiLeaders(
  items: readonly AlignItem[],
  first: Vec2,
  second: Vec2,
): readonly Vec2[] {
  const span = sub(second, first);
  const u = unit(span) ?? { x: 1, y: 0 };
  const order = items
    .map((it, i) => ({ i, t: dot(sub(it.geom.contentBase, first), u) }))
    .sort((a, b) => a.t - b.t);
  const out: Vec2[] = items.map(() => ({ x: 0, y: 0 }));
  const n = items.length;
  order.forEach(({ i }, k) => {
    const at = add(first, scale(span, n > 1 ? k / (n - 1) : 0));
    out[i] = sub(at, items[i]!.geom.contentBase);
  });
  return out;
}

/** How MLEADERCOLLECT lays the blocks out. */
export type MLeaderCollectLayout =
  | { readonly kind: 'horizontal' }
  | { readonly kind: 'vertical' }
  | { readonly kind: 'wrap'; readonly width: number }
  | { readonly kind: 'number'; readonly perRow: number };

/** MLEADERCOLLECT's result: each multileader's new geometry, in the order given. */
export function collectMultiLeaders(
  items: readonly AlignItem[],
  corner: Vec2,
  layout: MLeaderCollectLayout,
): readonly MultiLeaderGeometry[] {
  const kept = items[0]!.geom;
  const gap = Math.max(0, kept.landingGap);
  // The block nearest the kept leader: first, or last when the leader comes from the right.
  const fromRight = (kept.branches[0]?.direction.x ?? 1) < 0 && layout.kind !== 'vertical';
  const order = items.map((_, i) => i);
  if (fromRight) order.push(order.shift()!);
  const boxOf = (it: AlignItem): Box => {
    const p = it.geom.block?.position ?? it.geom.contentBase;
    return it.box ?? { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
  };
  const moves: Vec2[] = items.map(() => ({ x: 0, y: 0 }));
  let x = corner.x;
  let top = corner.y;
  let rowHeight = 0;
  let inRow = 0;
  for (const i of order) {
    const b = boxOf(items[i]!);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const full =
      inRow > 0 &&
      (layout.kind === 'vertical' ||
        (layout.kind === 'wrap' && x + w > corner.x + layout.width) ||
        (layout.kind === 'number' && inRow >= Math.max(1, layout.perRow)));
    if (full) {
      x = corner.x;
      top -= rowHeight + gap;
      rowHeight = 0;
      inRow = 0;
    }
    moves[i] = { x: x - b.minX, y: top - b.maxY };
    x += w + gap;
    rowHeight = Math.max(rowHeight, h);
    inRow++;
  }
  return items.map((it, i) => {
    const moved = moveMultiLeaderContent(it.geom, moves[i]!);
    return i === 0 ? moved : { ...moved, branches: [] };
  });
}
