// Block references (M1-14, ARCHITECTURE.md §7.2): an INSERT draws its block's entities in the
// block's own coordinates, carried into the drawing by position · rotation · scale about the
// block's base point, once per MINSERT cell, through nested inserts.
//
// AutoCAD rules encoded here:
// - ByBlock colour, linetype and lineweight take the INSERT's, and objects on layer 0 take the
//   INSERT's layer (`blockContext`, M1-13).
// - Turning the INSERT's layer off hides the objects on layer 0 inside it but not those on
//   their own layers; freezing it hides the whole reference.
// - Linetypes inside a block are generated in the block's units and scaled with the
//   reference, so a block inserted at scale 5 shows its dashes five times as long.
// - MINSERT cells step by the row and column spacing along the rotated axes, which the
//   insertion scale does not stretch (DXF 44/45).
// A DIMENSION (M1-15) draws its anonymous `*D` block the same way, untransformed: the block
// holds the dimension as AutoCAD last drew it, in drawing coordinates, and the dimension hands
// its colour, linetype, lineweight and layer down to it as an INSERT does. DXF 12 ("insertion
// point for clones", OCS) is not applied: the DXF reference leaves its use open, every
// dimension in the public corpus has it at the origin, and the spatial index bounds a
// dimension by its block's extents as they stand. A dimension without a block draws nothing
// until the dimension engine (M5) generates one.
// A block that (through nesting) contains itself draws its contents once per level up to
// MAX_DEPTH, as AutoCAD never lets such a drawing be built; this keeps a damaged file finite.

import type {
  BlockDefinition,
  DocumentModel,
  Entity,
  EntityId,
  Handle,
  InsertGeometry,
  Vec2,
} from '@triya/engine';
import type { Paint } from './tessellate';
import { tessellate } from './tessellate';
import { PATH_A, PATH_E, PATH_L, PATH_M, PATH_Z, type RenderPrimitive } from './types';
import type { BlockContext } from './style/resolve';
import { patternLength } from './style/pattern';

/** x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function applyAffine(m: Affine, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** `m` after `n`: applying the result is applying `n`, then `m`. */
export function composeAffine(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

/** How much a transform stretches lengths: the square root of its area scale. */
export const affineScale = (m: Affine): number => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));

/**
 * Block coordinates → the INSERT's owner's coordinates, one transform per MINSERT cell, row by
 * row: translate to the insertion point, turn, step to the cell, scale, and move the base point
 * to the origin.
 */
export function insertTransforms(g: InsertGeometry, base: Vec2): Affine[] {
  const cos = Math.cos(g.rotation);
  const sin = Math.sin(g.rotation);
  const sx = g.scale.x;
  const sy = g.scale.y;
  const cols = g.array ? g.array.columns : 1;
  const rows = g.array ? g.array.rows : 1;
  const out: Affine[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ox = g.array ? col * g.array.columnSpacing : 0;
      const oy = g.array ? row * g.array.rowSpacing : 0;
      // In the turned frame a block point p sits at (ox + sx (px − bx), oy + sy (py − by)).
      const tx = ox - sx * base.x;
      const ty = oy - sy * base.y;
      out.push({
        a: cos * sx,
        b: sin * sx,
        c: -sin * sy,
        d: cos * sy,
        e: g.position.x + cos * tx - sin * ty,
        f: g.position.y + sin * tx + cos * ty,
      });
    }
  }
  return out;
}

/**
 * An ellipse arc through a transform, as an exact ellipse arc. The image of
 * P(t) = C + U cos t + V sin t is C' + U' cos t + V' sin t with conjugate half-diameters
 * U' = L·U, V' = L·V; its axes are where |P − C'| is extreme, at
 * tan 2t₀ = 2 U'·V' / (|U'|² − |V'|²).
 */
function ellipseThrough(
  m: Affine,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
  a0: number,
  a1: number,
  ccw: number,
): number[] {
  const ux = rx * Math.cos(rot);
  const uy = rx * Math.sin(rot);
  const vx = -ry * Math.sin(rot);
  const vy = ry * Math.cos(rot);
  const Ux = m.a * ux + m.c * uy;
  const Uy = m.b * ux + m.d * uy;
  const Vx = m.a * vx + m.c * vy;
  const Vy = m.b * vx + m.d * vy;
  const t0 = 0.5 * Math.atan2(2 * (Ux * Vx + Uy * Vy), Ux * Ux + Uy * Uy - (Vx * Vx + Vy * Vy));
  const Ax = Ux * Math.cos(t0) + Vx * Math.sin(t0);
  const Ay = Uy * Math.cos(t0) + Vy * Math.sin(t0);
  const Bx = -Ux * Math.sin(t0) + Vx * Math.cos(t0);
  const By = -Uy * Math.sin(t0) + Vy * Math.cos(t0);
  const c = applyAffine(m, { x: cx, y: cy });
  // B is A turned +90° unless the transform mirrors; then the parameter runs backwards.
  const flip = Ax * By - Ay * Bx < 0;
  const p0 = flip ? t0 - a0 : a0 - t0;
  const p1 = flip ? t0 - a1 : a1 - t0;
  return [
    PATH_E,
    c.x,
    c.y,
    Math.hypot(Ax, Ay),
    Math.hypot(Bx, By),
    Math.atan2(Ay, Ax),
    p0,
    p1,
    flip ? 1 - ccw : ccw,
  ];
}

/** Packed path commands through a transform; arcs stay arcs under similarity, else ellipses. */
export function transformPath(path: readonly number[], m: Affine): number[] {
  const out: number[] = [];
  const det = m.a * m.d - m.b * m.c;
  // Rotation and uniform scale (a = d, b = −c) or the same with a mirror (a = −d, b = c).
  const tol = 1e-12 * (Math.abs(m.a) + Math.abs(m.b) + Math.abs(m.c) + Math.abs(m.d));
  const similar =
    det > 0
      ? Math.abs(m.a - m.d) <= tol && Math.abs(m.b + m.c) <= tol
      : Math.abs(m.a + m.d) <= tol && Math.abs(m.b - m.c) <= tol;
  const s = Math.sqrt(Math.abs(det));
  const phi = Math.atan2(m.b, m.a);
  for (let i = 0; i < path.length;) {
    const op = path[i]!;
    switch (op) {
      case PATH_M:
      case PATH_L: {
        const p = applyAffine(m, { x: path[i + 1]!, y: path[i + 2]! });
        out.push(op, p.x, p.y);
        i += 3;
        break;
      }
      case PATH_A: {
        const [cx, cy, r, a0, a1, ccw] = [
          path[i + 1]!,
          path[i + 2]!,
          path[i + 3]!,
          path[i + 4]!,
          path[i + 5]!,
          path[i + 6]!,
        ];
        if (similar) {
          const c = applyAffine(m, { x: cx, y: cy });
          // A turn adds φ to every angle; a mirror (reflection, then turn by φ) maps t to φ − t
          // and reverses the direction.
          if (det > 0) out.push(PATH_A, c.x, c.y, r * s, a0 + phi, a1 + phi, ccw);
          else out.push(PATH_A, c.x, c.y, r * s, phi - a0, phi - a1, 1 - ccw);
        } else {
          out.push(...ellipseThrough(m, cx, cy, r, r, 0, a0, a1, ccw));
        }
        i += 7;
        break;
      }
      case PATH_E:
        out.push(
          ...ellipseThrough(
            m,
            path[i + 1]!,
            path[i + 2]!,
            path[i + 3]!,
            path[i + 4]!,
            path[i + 5]!,
            path[i + 6]!,
            path[i + 7]!,
            path[i + 8]!,
          ),
        );
        i += 9;
        break;
      case PATH_Z:
        out.push(PATH_Z);
        i += 1;
        break;
      default:
        throw new Error(`bad path command ${op} at ${i}`);
    }
  }
  return out;
}

/** A primitive carried through a transform. Lineweights are display widths and do not scale. */
export function transformPrimitive(p: RenderPrimitive, m: Affine): RenderPrimitive {
  switch (p.kind) {
    case 'point': {
      const q = applyAffine(m, p);
      return { ...p, x: q.x, y: q.y };
    }
    case 'infinite':
      return {
        ...p,
        base: applyAffine(m, p.base),
        direction: {
          x: m.a * p.direction.x + m.c * p.direction.y,
          y: m.b * p.direction.x + m.d * p.direction.y,
        },
      };
    default:
      return {
        ...p,
        path: transformPath(p.path, m),
        ...(p.continuous ? { continuous: transformPath(p.continuous, m) } : {}),
        ...(p.patternLength === undefined
          ? {}
          : { patternLength: p.patternLength * affineScale(m) }),
      };
  }
}

/**
 * The block an entity draws by reference and where each copy goes: an INSERT's cells, or a
 * dimension's `*D` block in place. Undefined for every other entity.
 */
export function referenceOf(
  e: Entity,
  def: (block: Handle) => BlockDefinition | undefined,
): { readonly block: Handle; readonly cells: readonly Affine[] } | undefined {
  const g = e.geom;
  if (g.kind === 'INSERT') {
    const d = def(g.block);
    return d ? { block: g.block, cells: insertTransforms(g, d.basePoint) } : undefined;
  }
  if ((g.kind === 'DIMENSION' || g.kind === 'ARC_DIMENSION') && g.block !== undefined)
    return def(g.block) ? { block: g.block, cells: [IDENTITY] } : undefined;
  return undefined;
}

/** What an INSERT hands its block's entities, or undefined when the whole reference is hidden. */
export type InsertContextFunction = (
  insert: Entity,
  model: DocumentModel,
  outer?: BlockContext,
) => BlockContext | undefined;

/** What expanding a reference reads. */
export interface BlockSource {
  readonly model: DocumentModel;
  readonly paint: (e: Entity, model: DocumentModel, block?: BlockContext) => Paint | undefined;
  readonly insertContext: InsertContextFunction;
  /** A block's entities in draw order (its SORTENTSTABLE applied). */
  readonly order: (block: Handle) => readonly EntityId[];
}

export interface BlockExpansion {
  /** The reference's primitives in drawing coordinates. */
  readonly prims: RenderPrimitive[];
  /** The longest pattern repetition among its dashed parts, drawing units; 0 for none. */
  readonly period: number;
  /** Every block definition it draws from, for invalidation. */
  readonly blocks: ReadonlySet<Handle>;
}

/** Deepest nesting drawn. AutoCAD drawings rarely nest past a handful of levels. */
const MAX_DEPTH = 32;

/**
 * The primitives of an INSERT (or MINSERT, or a dimension's `*D` block) and everything nested
 * in it. `dashes` false draws
 * every linetype continuous (the scene cache's first pass); true fits the linetypes.
 */
export function expandInsert(
  insert: Entity,
  src: BlockSource,
  options: { readonly dashes: boolean },
): BlockExpansion {
  const prims: RenderPrimitive[] = [];
  const blocks = new Set<Handle>();
  let period = 0;

  const def = (block: Handle) => src.model.blocks.get(block);
  const walk = (e: Entity, m: Affine, outer: BlockContext | undefined, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    const ref = referenceOf(e, def);
    if (!ref) return;
    const ctx = src.insertContext(e, src.model, outer);
    if (!ctx) return;
    blocks.add(ref.block);
    const order = src.order(ref.block);
    for (const cell of ref.cells) {
      const cm = composeAffine(m, cell);
      const k = affineScale(cm);
      for (const id of order) {
        const child = src.model.entity(id);
        if (!child) continue;
        if (referenceOf(child, def)) {
          walk(child, cm, ctx, depth + 1);
          continue;
        }
        const paint = src.paint(child, src.model, ctx);
        if (!paint) continue;
        const { linetype, ...continuous } = paint;
        if (linetype)
          period = Math.max(period, patternLength(linetype.pattern) * linetype.scale * k);
        for (const p of tessellate(child.geom, options.dashes ? paint : continuous))
          prims.push(transformPrimitive(p, cm));
      }
    }
  };
  walk(insert, IDENTITY, undefined, 0);
  return { prims, period, blocks };
}
