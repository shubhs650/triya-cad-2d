// The cutting and boundary edges of objects that are not curves themselves (M3-12 part 4), for
// TRIM and EXTEND, as AutoCAD 2024 takes them (AutoCAD 2024 Help, "TRIM (Command)", "About
// Trimming and Extending Objects": "To select cutting edges that include blocks, you can use only
// the single selection, Crossing, Fence, and Select All options"; the AutoCAD 2004–2024 lists of
// valid edges name "floating viewports, regions, text"):
//
// - A block reference cuts with what it draws: each object of its block carried by the
//   reference's transform (nested references followed, every MINSERT cell), a circle or arc of a
//   nonuniformly scaled one as the ellipse it is drawn as, and its attributes' text. Each object
//   in the block is an edge of its own, so EDGEMODE 1 carries its lines and arcs on as it does
//   for the drawing's own.
// - A dimension cuts with the lines, arcs and text of its block, a table with its `*T` block's
//   (in the table's frame), a leader and a multileader with their leader lines and landings.
//   EDGEMODE does not carry an annotation's parts on: their ends are where the annotation means
//   them to be (the most common drafter expectation; AutoCAD's help says nothing).
// - Text (TEXT, MTEXT, an attribute definition outside a block, which shows its tag) cuts with
//   the box it is drawn in, as the canvas measures it with its fonts (`textOutlines`); text no
//   loaded font draws, and a multileader's text, cut with nothing.
// - A region cuts with its loops, a floating viewport with its frame (a clipped one is cut by its
//   clip boundary, an object of its own), a hatch with its boundary loops. A hatch is an edge only
//   when chosen as one: AutoCAD 2021 and later leave hatches out of Quick mode's every-object
//   edges (forums: "Hatch Patterns Ignored while Trimming"), and Enter at "Select cutting edges"
//   is taken the same way here, the ambiguity resolved towards the lines a drafter sees.
//
// Solids, traces, 3D faces, images, underlays, points and the rest cut with nothing, as before.
import { TAU } from '../geom/angle';
import type { Curve, Polyline } from '../geom/curves';
import { explodePolyline } from '../geom/eval';
import { compose, IDENTITY, transformCurve, type Matrix2D } from '../geom/transform';
import type { Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import { leaderParts } from '../annotation/leader';
import { multiLeaderParts } from '../annotation/multileader';
import { insertMatrices } from '../input/osnap';
import type { DocumentModel } from '../model/document';
import { splineCurve } from '../model/spline';
import type {
  Entity,
  EntityGeometry,
  HatchEdge,
  HatchGeometry,
  InsertAttribute,
  MTextGeometry,
  TextGeometry,
} from '../model/types';
import { tableAxes } from '../spatial/entity-bounds';
import { edgeCurvesOf } from './trim';

/** A text as the canvas draws it, which `textOutlines` measures. */
export type EdgeText = TextGeometry | MTextGeometry;

/** Block nesting followed, and MINSERT cells taken per reference (as OSNAP's). */
const MAX_DEPTH = 8;
const MAX_CELLS = 1024;
/**
 * Objects visited inside one object's blocks before giving up: a block holding MINSERTs of
 * itself would otherwise multiply cells level by level.
 */
const MAX_VISITS = 50_000;

/** DXF 70 bits of an attribute: 1 invisible, 2 constant. */
const INVISIBLE = 1;
const CONSTANT = 2;

export interface EdgeSource {
  readonly model: DocumentModel;
  /** The drawing's tolerance, for transforms. */
  readonly tol: Tolerance;
  /**
   * The corners of the box a text is drawn in, in the coordinates of the space or block it is
   * in, by the object `edgeTexts` gave for it; undefined when it was not measured.
   */
  readonly textBox?: (key: object) => readonly Vec2[] | undefined;
}

export interface EdgeOptions {
  /** EDGEMODE 1: edges cut where they would if they went on. */
  readonly extend: boolean;
  /** Hatches cut with their boundaries (chosen as edges). */
  readonly hatches: boolean;
}

type Visit =
  | { readonly curve: Curve; readonly m: Matrix2D }
  | { readonly text: EdgeText; readonly key: object; readonly m: Matrix2D };

/**
 * The curves `e` cuts or bounds others with, in the coordinates of the space it is in: its own
 * curve (with EDGEMODE's extensions), or what it draws for block references, annotations, text,
 * regions, viewports and hatches.
 */
export function objectEdgeCurves(src: EdgeSource, e: Entity, o: EdgeOptions): Curve[] {
  const out: Curve[] = [];
  const add = (c: Curve, m: Matrix2D) => {
    if (m === IDENTITY) {
      out.push(c);
      return;
    }
    try {
      out.push(transformCurve(c, m, src.tol));
    } catch {
      // A polyline with arcs has no image as one under a nonuniform scale: its segments do.
      // Otherwise a degenerate curve or a singular block transform: nothing to cut with.
      if (c.kind !== 'LWPOLYLINE') return;
      try {
        for (const s of explodePolyline(c)) out.push(transformCurve(s, m, src.tol));
      } catch {
        // A singular transform.
      }
    }
  };
  const visit = (v: Visit) => {
    if ('curve' in v) {
      add(v.curve, v.m);
      return;
    }
    const corners = src.textBox?.(v.key);
    if (!corners || corners.length < 3) return;
    add(boxOf(corners), v.m);
  };
  walk(src.model, e.geom, IDENTITY, 0, o, visit, true, e.xdata);
  return out;
}

/**
 * The texts `e` cuts with, each with the object `objectEdgeCurves` asks `textBox` about, so a
 * command can have the canvas measure them first.
 */
export function edgeTexts(
  model: DocumentModel,
  e: Entity,
  o: EdgeOptions,
): { readonly key: object; readonly text: EdgeText }[] {
  const out: { key: object; text: EdgeText }[] = [];
  const visit = (v: Visit) => {
    if ('text' in v) out.push({ key: v.key, text: v.text });
  };
  walk(model, e.geom, IDENTITY, 0, o, visit, true, e.xdata);
  return out;
}

const boxOf = (corners: readonly Vec2[]): Polyline => ({
  kind: 'LWPOLYLINE',
  closed: true,
  vertices: corners.map((p) => ({ x: p.x, y: p.y, bulge: 0 })),
});

/** ATTMODE: whether an attribute with these flags shows (0 none, 1 normal, 2 all). */
function attributeShown(model: DocumentModel, flags: number): boolean {
  const mode = model.header.get('$ATTMODE');
  if (mode === 0) return false;
  return mode === 2 || (flags & INVISIBLE) === 0;
}

const attributeText = (a: InsertAttribute | Extract<EntityGeometry, { kind: 'ATTDEF' }>) =>
  a.mtext ?? ({ ...a, kind: 'TEXT' } as TextGeometry);

/**
 * What `g` cuts with, carried by `m` (block coordinates to the space the edge is in). `own`
 * is false for an annotation's parts, which EDGEMODE does not carry on.
 */
function walk(
  model: DocumentModel,
  g: EntityGeometry,
  m: Matrix2D,
  depth: number,
  o: EdgeOptions,
  visit: (v: Visit) => void,
  own = true,
  xdata?: Entity['xdata'],
  budget = { left: MAX_VISITS },
): void {
  const curve = (c: Curve) => visit({ curve: c, m });
  const block = (handle: string | undefined, inner: Matrix2D, ownParts: boolean) => {
    if (handle === undefined || depth + 1 > MAX_DEPTH || !model.hasBlock(handle)) return;
    const at = m === IDENTITY ? inner : inner === IDENTITY ? m : compose(inner, m);
    for (const id of model.blockEntities(handle)) {
      if (--budget.left < 0) return;
      const e = model.entity(id);
      if (!e || !e.visible) continue;
      const l = model.tables.layers.get(e.layer);
      if (l && (!l.on || l.frozen)) continue;
      if (e.geom.kind === 'ATTDEF') {
        // Only a constant definition shows through a reference, as its value.
        if (e.geom.flags & CONSTANT && attributeShown(model, e.geom.flags))
          visit({ text: attributeText(e.geom), key: e.geom, m: at });
        continue;
      }
      walk(model, e.geom, at, depth + 1, o, visit, ownParts, e.xdata, budget);
    }
  };
  switch (g.kind) {
    case 'TEXT':
    case 'MTEXT':
      visit({ text: g, key: g, m });
      return;
    case 'ATTDEF':
      // Outside a block an attribute definition shows its tag, on one line.
      visit({ text: { ...g, kind: 'TEXT', value: g.tag } as TextGeometry, key: g, m });
      return;
    case 'INSERT': {
      for (const a of g.attributes)
        if (attributeShown(model, a.flags)) visit({ text: attributeText(a), key: a, m });
      const def = model.blocks.get(g.block);
      if (!def) return;
      for (const t of insertMatrices(g, def.basePoint, MAX_CELLS)) block(g.block, t, own);
      return;
    }
    case 'DIMENSION':
    case 'ARC_DIMENSION':
    case 'LARGE_RADIAL_DIMENSION':
      // The `*D` block draws in the dimension's own coordinates.
      block(g.block, IDENTITY, false);
      return;
    case 'ACAD_TABLE': {
      if (g.block === undefined || !model.blocks.get(g.block)) return;
      // The `*T` block draws in the table's frame (M1-17): its origin at the insertion point.
      const { x: ax, y: ay } = tableAxes(g);
      const { x: bx, y: by } = model.blocks.get(g.block)!.basePoint;
      block(
        g.block,
        {
          a: ax.x,
          b: ax.y,
          c: ay.x,
          d: ay.y,
          e: g.position.x - bx * ax.x - by * ay.x,
          f: g.position.y - bx * ax.y - by * ay.y,
        },
        false,
      );
      return;
    }
    case 'LEADER':
      for (const p of leaderParts(g, xdata, model)) part(p.geom);
      return;
    case 'MULTILEADER':
      // Its text is laid out by the canvas each time it is drawn: no box to cut with.
      for (const p of multiLeaderParts(g, model)) if (p.geom.kind !== 'MTEXT') part(p.geom);
      return;
    case 'REGION':
      for (const l of g.loops) for (const c of l.edges) curve(c);
      return;
    case 'VIEWPORT': {
      // The layout's own view (id 1) has no frame; a clipped one's clip boundary is an object.
      if (g.id === 1 || g.clipBoundary !== undefined) return;
      const w = Math.abs(g.width) / 2;
      const h = Math.abs(g.height) / 2;
      const { x, y } = g.center;
      curve(
        boxOf([
          { x: x - w, y: y - h },
          { x: x + w, y: y - h },
          { x: x + w, y: y + h },
          { x: x - w, y: y + h },
        ]),
      );
      return;
    }
    case 'HATCH':
      if (o.hatches) for (const c of hatchBoundary(g)) curve(c);
      return;
    default:
      for (const c of edgeCurvesOf(g, o.extend && own)) curve(c);
  }

  /** An annotation's part: its curve as drawn, never carried on. */
  function part(p: EntityGeometry): void {
    if (p.kind === 'INSERT') {
      walk(model, p, m, depth, o, visit, false, undefined, budget);
      return;
    }
    for (const c of edgeCurvesOf(p, false)) curve(c);
  }
}

/** A hatch's boundary loops as curves: a polyline loop whole, an edge loop edge by edge. */
function hatchBoundary(g: HatchGeometry): Curve[] {
  const out: Curve[] = [];
  for (const loop of g.loops) {
    const p = loop.polyline;
    if (p && p.vertices.length >= 2) {
      out.push({
        kind: 'LWPOLYLINE',
        closed: true,
        vertices: p.vertices.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge ?? 0 })),
      });
    }
    for (const edge of loop.edges ?? []) {
      const c = hatchEdgeCurve(edge);
      if (c) out.push(c);
    }
  }
  return out;
}

/**
 * One edge of a hatch loop. A clockwise arc or ellipse edge stores its angles negated (DXF 73
 * = 0), so it sweeps counter-clockwise from −end to −start, as `hatchBounds` reads it.
 */
function hatchEdgeCurve(e: HatchEdge): Curve | undefined {
  switch (e.type) {
    case 'line':
      return e.start.x === e.end.x && e.start.y === e.end.y
        ? undefined
        : { kind: 'LINE', start: e.start, end: e.end };
    case 'arc': {
      const [s, t] = e.ccw ? [e.startAngle, e.endAngle] : [-e.endAngle, -e.startAngle];
      if (Math.abs(t - s) >= TAU - 1e-12)
        return { kind: 'CIRCLE', center: e.center, radius: e.radius };
      return { kind: 'ARC', center: e.center, radius: e.radius, startAngle: s, endAngle: t };
    }
    case 'ellipse': {
      const [s, t] = e.ccw ? [e.startAngle, e.endAngle] : [-e.endAngle, -e.startAngle];
      return {
        kind: 'ELLIPSE',
        center: e.center,
        majorAxis: e.majorAxis,
        ratio: e.ratio,
        startParam: s,
        endParam: t,
      };
    }
    case 'spline':
      return splineCurve(e);
  }
}
