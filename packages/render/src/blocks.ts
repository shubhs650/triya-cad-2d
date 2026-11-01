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
// An ACAD_TABLE (M1-17) draws its anonymous `*T` block in the table's frame: its insertion
// point is the block's origin and the table's top-left corner, the block's x axis runs along
// the horizontal direction and its y axis along normal × direction (every corpus table's
// block spans x 0 → width and y −height → 0), scale 1. A table without a block draws nothing
// until the table engine (M4-05) generates one from its cells.
// A block that (through nesting) contains itself draws its contents once per level up to
// MAX_DEPTH, as AutoCAD never lets such a drawing be built; this keeps a damaged file finite.

import {
  tableAxes,
  type BlockDefinition,
  type DocumentModel,
  type Entity,
  type EntityId,
  type Handle,
  type InsertGeometry,
  type Vec2,
} from '@triya/engine';
import type { Paint, TessellateContext } from './tessellate';
import { tessellate } from './tessellate';
import type { RenderPrimitive } from './types';
import {
  affineScale,
  applyAffine,
  composeAffine,
  IDENTITY,
  transformPath,
  type Affine,
} from './affine';

export { affineScale, applyAffine, composeAffine, IDENTITY, transformPath, type Affine };
import type { BlockContext } from './style/resolve';
import { patternLength } from './style/pattern';

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
        ...(p.gradient
          ? { gradient: { ...p.gradient, frame: composeAffine(m, p.gradient.frame) } }
          : {}),
        ...(p.hatch
          ? {
              hatch: {
                ...p.hatch,
                area: transformPath(p.hatch.area, m),
                spacing: p.hatch.spacing * affineScale(m),
                period: p.hatch.period * affineScale(m),
                dashLength: p.hatch.dashLength * affineScale(m),
              },
            }
          : {}),
      };
  }
}

/**
 * The block an entity draws by reference and where each copy goes: an INSERT's cells, a
 * dimension's `*D` block in place, or a table's `*T` block at its insertion point. Undefined
 * for every other entity.
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
  if (g.kind === 'ACAD_TABLE' && g.block !== undefined) {
    // The `*T` block holds the table as AutoCAD last drew it (M1-17), in the table's frame:
    // the insertion point is its top-left corner, x runs along the direction (DXF 11).
    const d = def(g.block);
    if (!d) return undefined;
    const { x: ax, y: ay } = tableAxes(g);
    const { x: bx, y: by } = d.basePoint;
    return {
      block: g.block,
      cells: [
        {
          a: ax.x,
          b: ax.y,
          c: ay.x,
          d: ay.y,
          e: g.position.x - bx * ax.x - by * ay.x,
          f: g.position.y - bx * ax.y - by * ay.y,
        },
      ],
    };
  }
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
  /** Fonts and styles for the text inside blocks (dimension text, table cells). */
  readonly tessellate?: TessellateContext;
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
        for (const p of tessellate(child.geom, options.dashes ? paint : continuous, src.tessellate))
          prims.push(transformPrimitive(p, cm));
      }
    }
  };
  walk(insert, IDENTITY, undefined, 0);
  return { prims, period, blocks };
}
