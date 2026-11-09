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
// dimension by its block's extents as they stand. A dimension without a block (one a script
// wrote without its graphics) draws what the dimension engine (`@triya/dims`, M2-10)
// generates for it, as parts like a MULTILEADER's; its definition points are not drawn.
// An ACAD_TABLE (M1-17) draws its anonymous `*T` block in the table's frame: its insertion
// point is the block's origin and the table's top-left corner, the block's x axis runs along
// the horizontal direction and its y axis along normal × direction (every corpus table's
// block spans x 0 → width and y −height → 0), scale 1. A table without a block draws nothing
// until the table engine (M4-05) generates one from its cells.
// Attributes (M1-14 part 2): an INSERT's ATTRIBs are stored in the INSERT's owner's
// coordinates, so they draw where they stand, carried only by the references around the
// INSERT, once for a MINSERT (AutoCAD keeps one set of ATTRIBs per MINSERT, at the first
// cell; drawing them per cell is not documented). Each is painted as an object inside the
// reference: ByBlock takes the INSERT's properties and layer 0 the INSERT's layer, the common
// drafter expectation (AutoCAD's documentation only says ATTRIBs belong to the INSERT). A
// block's ATTDEFs do not draw through a reference, except a constant one, which no ATTRIB
// stands for and which shows its value. ATTMODE decides which of them show (`attributeShown`).
// XCLIP (M1-103): a reference with a SPATIAL_FILTER (`BlockSource.clip`) shows its block's
// contents only inside the clip boundary, which is kept in the block's coordinates and so follows
// the reference; each part carries the boundaries of every clipped reference around it (nested
// clips intersect). XCLIP OFF shows the whole block. The frame is the boundary drawn with the
// reference's own properties, unless XCLIPFRAME is 0 (AutoCAD 2024 help: 1 and 2 display it).
// The reference's ATTRIBs are not clipped: the filter clips the block's contents, and ATTRIBs
// belong to the INSERT (AutoCAD's help does not say; the drafter's expectation that XCLIP leaves
// attributes showing is encoded here, an ambiguity noted in the PR).
// A block that (through nesting) contains itself draws its contents once per level up to
// MAX_DEPTH, as AutoCAD never lets such a drawing be built; this keeps a damaged file finite.

import {
  annotationParts,
  clipBoundary,
  partEntity,
  tableAxes,
  type SpatialFilter,
  type BlockDefinition,
  type DocumentModel,
  type Entity,
  type EntityId,
  type Handle,
  type InsertGeometry,
  type Vec2,
} from '@triya/engine';
import { dimensionParts, generates } from '@triya/dims';
import type { Paint, TessellateContext } from './tessellate';
import { tessellate } from './tessellate';
import { attributeShown, attributeText, textMeasure } from './text';
import type { PrimitiveClip, RenderPrimitive } from './types';
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
  if (p.clip) {
    const { clip, ...rest } = p;
    const moved = transformPrimitive(rest as RenderPrimitive, m);
    return { ...moved, clip: clip.map((c) => transformPoints(c, m)) } as RenderPrimitive;
  }
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
        ...(p.underlay
          ? { underlay: { ...p.underlay, frame: composeAffine(m, p.underlay.frame) } }
          : {}),
        ...(p.text
          ? {
              text: {
                height: p.text.height * affineScale(m),
                greek: transformPath(p.text.greek, m),
                ...(p.text.glyphs
                  ? { glyphs: p.text.glyphs.map((g) => ({ ...g, m: composeAffine(m, g.m) })) }
                  : {}),
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

/** Flat `x, y` pairs through a transform. */
function transformPoints(points: readonly number[], m: Affine): number[] {
  const out = new Array<number>(points.length);
  for (let i = 0; i + 1 < points.length; i += 2) {
    const q = applyAffine(m, { x: points[i]!, y: points[i + 1]! });
    out[i] = q.x;
    out[i + 1] = q.y;
  }
  return out;
}

/** XCLIP (M1-103): where a reference is clipped, in its block's coordinates. */
export interface InsertClip {
  /** The closed boundary polygon. */
  readonly boundary: readonly Vec2[];
  /** Whether the frame shows (XCLIPFRAME not 0). */
  readonly frame: boolean;
}

/**
 * The drawing's XCLIPs by INSERT handle: each filter that clips (XCLIP ON) and encloses an area.
 * XCLIPFRAME is AutoCAD's 2 (displayed, not plotted) when the header has none.
 */
export function insertClips(model: DocumentModel): (insert: Handle) => InsertClip | undefined {
  const xclipFrame = model.header.get('$XCLIPFRAME');
  const frame = xclipFrame !== 0 && xclipFrame !== false;
  const clips = new Map<Handle, InsertClip>();
  for (const o of model.objects.values()) {
    if (o.type !== 'SPATIAL_FILTER') continue;
    const f = o as SpatialFilter;
    const boundary = f.enabled ? clipBoundary(f) : undefined;
    if (boundary) clips.set(f.insert, { boundary, frame });
  }
  return (insert) => clips.get(insert);
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
  if (
    (g.kind === 'DIMENSION' || g.kind === 'ARC_DIMENSION' || g.kind === 'LARGE_RADIAL_DIMENSION') &&
    g.block !== undefined
  )
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

/** A dimension with no stored block that the dimension engine draws (M2-10). */
export function generatedDimension(
  e: Entity,
  def: (block: Handle) => BlockDefinition | undefined,
): boolean {
  const g = e.geom;
  return 'dimType' in g && generates(g) && (g.block === undefined || !def(g.block));
}

/**
 * Whether an entity draws through `expandInsert`: a block reference (`referenceOf`), an
 * annotation drawn as parts (MULTILEADER, LEADER and TOLERANCE, M1-52), or a dimension the
 * engine generates (M2-10).
 */
export function expands(e: Entity, def: (block: Handle) => BlockDefinition | undefined): boolean {
  const k = e.geom.kind;
  return (
    k === 'MULTILEADER' ||
    k === 'LEADER' ||
    k === 'TOLERANCE' ||
    referenceOf(e, def) !== undefined ||
    generatedDimension(e, def)
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
  /** XCLIP (M1-103): a reference's clip, by INSERT handle (`insertClips`); none without it. */
  readonly clip?: (insert: Handle) => InsertClip | undefined;
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
  const attMode = src.tessellate?.attributeMode;
  const draw = (
    e: Entity,
    m: Affine,
    ctx: BlockContext | undefined,
    depth: number,
    chain: readonly Handle[],
    clip: PrimitiveClip | undefined,
  ): void => {
    const g = e.geom;
    if (g.kind === 'ATTDEF') {
      // Only a constant definition shows through a reference, as its value.
      if (!(g.flags & 2) || !attributeShown(g.flags, attMode)) return;
      const shown = attributeText(g);
      draw({ ...e, geom: shown, type: shown.kind }, m, ctx, depth, chain, clip);
      return;
    }
    if (expands(e, def)) {
      walk(e, m, ctx, depth + 1, chain, clip);
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
      const q = transformPrimitive(p, m) as {
        layers?: readonly Handle[];
        clip?: PrimitiveClip;
      };
      if (tag.length > 0) q.layers = tag;
      if (clip) q.clip = clip;
      prims.push(q as RenderPrimitive);
    }
  };
  const walk = (
    e: Entity,
    m: Affine,
    outer: BlockContext | undefined,
    depth: number,
    above: readonly Handle[],
    clip: PrimitiveClip | undefined,
  ): void => {
    if (depth > MAX_DEPTH) return;
    // Below the top level, a reference's own layer hides everything in it when frozen in a
    // viewport (the top-level one is the cache entry's layer).
    const own = depth > 0 ? effectiveLayer(e, { layers, lwDefault: 0 }, outer)?.handle : undefined;
    const chain = own === undefined || above.includes(own) ? above : [...above, own];
    // A MULTILEADER draws its parts where it stands, each painted as an entity of its own
    // (M1-52); its arrowhead blocks expand as inserts.
    const parts =
      annotationParts(e.geom, src.model, e.xdata, measure) ??
      (measure && generatedDimension(e, def)
        ? dimensionParts(e, src.model, measure)?.filter((p) => !p.defpoint)
        : undefined);
    if (parts) {
      for (const part of parts) draw(partEntity(e, part), m, outer, depth, chain, clip);
      return;
    }
    const ref = referenceOf(e, def);
    if (!ref) return;
    const ctx = src.insertContext(e, src.model, outer);
    if (!ctx) return;
    blocks.add(ref.block);
    const order = src.order(ref.block);
    const xclip = e.geom.kind === 'INSERT' ? src.clip?.(e.handle) : undefined;
    const flat = xclip?.boundary.flatMap((p) => [p.x, p.y]);
    for (const cell of ref.cells) {
      const cm = composeAffine(m, cell);
      // One array per cell, shared by every part inside it (and nested clips add theirs).
      const inner = flat ? [...(clip ?? []), transformPoints(flat, cm)] : clip;
      for (const id of order) {
        const child = src.model.entity(id);
        if (child) draw(child, cm, ctx, depth, chain, inner);
      }
      if (xclip?.frame) {
        // The frame, in the reference's owner coordinates, painted as the reference itself.
        const vertices = xclip.boundary.map((p) => ({ ...applyAffine(cell, p), bulge: 0 }));
        const geom = { kind: 'LWPOLYLINE', vertices, closed: true } as const;
        draw({ ...e, type: 'LWPOLYLINE', geom }, m, outer, depth, chain, clip);
      }
    }
    if (e.geom.kind !== 'INSERT') return;
    for (const a of e.geom.attributes) {
      if (!attributeShown(a.flags, attMode)) continue;
      const shown = attributeText(a);
      const attrib: Entity = {
        id: e.id,
        type: shown.kind,
        owner: e.owner,
        geom: shown,
        handle: a.handle,
        layer: a.layer,
        color: a.color,
        linetype: a.linetype,
        lineweight: a.lineweight,
        transparency: a.transparency,
        ltScale: a.ltScale,
        visible: a.visible,
      };
      draw(attrib, m, ctx, depth, chain, clip);
    }
  };
  walk(insert, IDENTITY, undefined, 0, [], undefined);
  return { prims, period, blocks };
}
