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
  annotationParts,
  partEntity,
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
import { textMeasure } from './text';
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
import { effectiveLayer, type BlockContext } from './style/resolve';
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
    case 'infinite': {
      const k = affineScale(m);
      return {
        ...p,
        base: applyAffine(m, p.base),
        ...(p.dashes
          ? {
              dashes: { lengths: p.dashes.lengths.map((l) => l * k), period: p.dashes.period * k },
            }
          : {}),
        direction: {
          x: m.a * p.direction.x + m.c * p.direction.y,
          y: m.b * p.direction.x + m.d * p.direction.y,
        },
      };
    }
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
        ...(p.image ? { image: { ...p.image, frame: composeAffine(m, p.image.frame) } } : {}),
        ...(p.text
          ? {
              text: {
                height: p.text.height * affineScale(m),
                greek: transformPath(p.text.greek, m),
              },
            }
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

/**
 * Whether an entity draws through `expandInsert`: a block reference (`referenceOf`), or an
 * annotation drawn as parts (MULTILEADER, LEADER and TOLERANCE, M1-52).
 */
export function expands(e: Entity, def: (block: Handle) => BlockDefinition | undefined): boolean {
  const k = e.geom.kind;
  return (
    k === 'MULTILEADER' || k === 'LEADER' || k === 'TOLERANCE' || referenceOf(e, def) !== undefined
  );
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
 * The primitives of an INSERT (or MINSERT, a dimension's `*D` block, a table's `*T` block or a
 * MULTILEADER's parts) and everything nested in it. `dashes` false draws
 * every linetype continuous (the scene cache's first pass); true fits the linetypes.
 */
export function expandInsert(
  insert: Entity,
  src: BlockSource,
  options: {
    readonly dashes: boolean;
    /**
     * Multiplies every linetype scale: 1 / the viewport scale for model space seen through a
     * PSLTSCALE layout viewport (M1-18). `period` stays at the unmultiplied scale.
     */
    readonly linetypeScale?: number;
  },
): BlockExpansion {
  const prims: RenderPrimitive[] = [];
  const blocks = new Set<Handle>();
  let period = 0;
  const ltMul = options.linetypeScale ?? 1;
  // The layer tags (M1-18 viewport freeze) are shared per chain and leaf layer, so a block's
  // thousand parts on one layer carry one array.
  const tags = new Map<string, readonly Handle[]>();
  const tagOf = (chain: readonly Handle[], leaf: Handle | undefined): readonly Handle[] => {
    const all = leaf === undefined || chain.includes(leaf) ? chain : [...chain, leaf];
    const key = all.join(' ');
    let t = tags.get(key);
    if (!t) tags.set(key, (t = all));
    return t;
  };
  const layers = src.model.tables.layers;

  const def = (block: Handle) => src.model.blocks.get(block);
  // TOLERANCE frames size their compartments by the text (M1-52 part 4).
  const text = src.tessellate?.text;
  const measure = text ? textMeasure(text) : undefined;
  const draw = (
    e: Entity,
    m: Affine,
    ctx: BlockContext | undefined,
    depth: number,
    chain: readonly Handle[],
  ): void => {
    if (expands(e, def)) {
      walk(e, m, ctx, depth + 1, chain);
      return;
    }
    const paint = src.paint(e, src.model, ctx);
    if (!paint) return;
    const { linetype, ...continuous } = paint;
    if (linetype)
      period = Math.max(period, patternLength(linetype.pattern) * linetype.scale * affineScale(m));
    const used =
      options.dashes && linetype && ltMul !== 1
        ? { ...paint, linetype: { ...linetype, scale: linetype.scale * ltMul } }
        : options.dashes
          ? paint
          : continuous;
    const tag = tagOf(chain, effectiveLayer(e, { layers, lwDefault: 0 }, ctx)?.handle);
    for (const p of tessellate(e.geom, used, src.tessellate)) {
      // transformPrimitive makes a fresh object, so tagging it in place copies nothing.
      const q = transformPrimitive(p, m) as { layers?: readonly Handle[] };
      if (tag.length > 0) q.layers = tag;
      prims.push(q as RenderPrimitive);
    }
  };
  const walk = (
    e: Entity,
    m: Affine,
    outer: BlockContext | undefined,
    depth: number,
    above: readonly Handle[],
  ): void => {
    if (depth > MAX_DEPTH) return;
    // Below the top level, a reference's own layer hides everything in it when frozen in a
    // viewport (the top-level one is the cache entry's layer).
    const own = depth > 0 ? effectiveLayer(e, { layers, lwDefault: 0 }, outer)?.handle : undefined;
    const chain = own === undefined || above.includes(own) ? above : [...above, own];
    // A MULTILEADER draws its parts where it stands, each painted as an entity of its own
    // (M1-52); its arrowhead blocks expand as inserts.
    const parts = annotationParts(e.geom, src.model, e.xdata, measure);
    if (parts) {
      for (const part of parts) draw(partEntity(e, part), m, outer, depth, chain);
      return;
    }
    const ref = referenceOf(e, def);
    if (!ref) return;
    const ctx = src.insertContext(e, src.model, outer);
    if (!ctx) return;
    blocks.add(ref.block);
    const order = src.order(ref.block);
    for (const cell of ref.cells) {
      const cm = composeAffine(m, cell);
      for (const id of order) {
        const child = src.model.entity(id);
        if (child) draw(child, cm, ctx, depth, chain);
      }
    }
  };
  walk(insert, IDENTITY, undefined, 0, []);
  return { prims, period, blocks };
}
