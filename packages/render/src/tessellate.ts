// Entity geometry → render primitives (ARCHITECTURE.md §7.2 "Scene cache"). Runs once per
// change, never per frame. Lines, arcs, circles, ellipses and bulge polylines stay exact
// (the canvas draws arcs natively, so they are smooth at any zoom); splines are flattened
// once, finely enough for deep zoom.
//
// A paint with a linetype (M1-13) turns the stroke into explicit dashes and dots in world
// units, fitted by `dashPath`/`dashPolyline` on the curve flattened as finely as a spline. The
// dashed stroke keeps the exact continuous path beside it, which the renderer draws once a
// pattern is under a pixel and measures for picking, so a click in a gap still selects.
// Text and shapes inside complex linetypes draw in their gaps through the text engine and SHX
// shapes (M1-45, `linetypeEmbedPrimitives`) when fonts are passed.
//
// INSERT, DIMENSION, ACAD_TABLE and MULTILEADER yield nothing here: the renderer draws them
// from their blocks or parts (`expandInsert`, M1-14, M1-15, M1-17 and M1-52). Kinds drawn by later tasks yield nothing
// either, each noted where it falls through:
// attributes (M1-14) and the MTEXT background mask (M1-41 part 2). IMAGE
// and WIPEOUT come from `imagePrimitives` (M1-19), PDFUNDERLAY from `underlayPrimitives` (M1-20). TEXT and MTEXT draw their glyphs (`textPrimitives`, M1-41)
// when the caller passes the loaded fonts, and nothing without them.

import {
  bundledPatterns,
  gradientRamp,
  hatchLines,
  hatchPattern,
  type PatternLibrary,
} from '@triya/hatch';
import {
  VIEWPORT_NON_RECT_CLIP,
  viewportFrame,
  bulgeArc,
  flatten,
  type EntityGeometry,
  type HatchEdge,
  type HatchLoop,
  type PolylineVertex,
  polylineWidths,
  splineCurve,
  wideCross,
  wideOutlines,
  widePiece,
  wideSegments,
  type SplineData,
  type WideSegment,
  type WideVertex,
  type Vec2,
} from '@triya/engine';
import {
  PATH_A,
  PATH_E,
  PATH_L,
  PATH_M,
  PATH_Z,
  type PrimitiveColor,
  type RenderPrimitive,
} from './types';
import { dashPath, dashPolyline, type DashedPath } from './style/dash';
import { colorValue } from './style/resolve';
import { patternLength, type LinePattern } from './style/pattern';
import { linetypeEmbedPrimitives, textPrimitives, type TextContext } from './text';
import { imagePrimitives, type ImageFrames } from './image';
import { underlayPrimitives } from './underlay';

/** What tessellating some kinds needs beyond the geometry and paint. */
export interface TessellateContext {
  /** Loaded fonts and text styles; without them TEXT and MTEXT draw nothing. */
  readonly text?: TextContext;
  /** IMAGEFRAME and WIPEOUTFRAME; both on (AutoCAD's initial values) when absent. */
  readonly frames?: ImageFrames;
  /**
   * The name an IMAGE shows while the app has no bitmap for its definition (`imageLabel`,
   * M1-109); undefined for an unloaded or unknown definition, which shows its frame alone.
   */
  readonly imageName?: (definition: string) => string | undefined;
  /** FILLMODE: false outlines wide polyline segments instead of filling them; on when absent. */
  readonly fill?: boolean;
  /**
   * Where a hatch stored without its pattern lines finds them: the bundled patterns and the
   * user's .pat files (`patternLibrary`, M1-50). Defaults to the bundled patterns alone.
   */
  readonly patterns?: PatternLibrary;
  /**
   * ATTMODE (ATTDISP, M1-14 part 2): which attributes a block reference shows (0 none,
   * 1 the visible ones, 2 all); 1, AutoCAD's initial value, when absent.
   */
  readonly attributeMode?: number | undefined;
}

/** What every primitive of one entity shares, resolved from the entity and its layer. */
export interface Paint {
  readonly color: PrimitiveColor;
  /** Millimetres; undefined is the default lineweight. */
  readonly lineweight?: number;
  /** The linetype and its scale (`linetypeScale`); absent for Continuous. */
  readonly linetype?: { readonly pattern: LinePattern; readonly scale: number };
  /** Object transparency as an opacity below 1 (M1-108); absent is opaque. */
  readonly opacity?: number;
}

/**
 * Spline flattening deviation as a fraction of the curve's size: 1e-4 keeps chords under a
 * pixel until the curve spans 10 000 px on screen.
 */
const SPLINE_DEVIATION = 1e-4;

/**
 * Arc flattening for dashing: the chord angle whose sagitta is 1e-4 of the radius, the same
 * relative deviation as splines.
 */
const ARC_STEP = 2 * Math.acos(1 - SPLINE_DEVIATION);

/**
 * The most pattern repetitions fitted to one entity. Past it the entity draws continuous, as
 * it would look at any zoom that shows all of it; this keeps the scene cache bounded when a
 * drawing's LTSCALE is far too small. AutoCAD documents no such limit; ours.
 */
const MAX_PERIODS = 20_000;

/** The bundled patterns (M1-16 part 3), for a context that brings no library of its own. */
const PATTERNS = bundledPatterns();

/**
 * The library hatches draw from (M1-50): the bundled patterns, then the user's .pat sources in
 * the order added, a later one winning on a shared name (AutoCAD matches names without regard
 * to case). A source holding no valid pattern adds nothing.
 */
export function patternLibrary(sources: readonly string[]): PatternLibrary {
  const library = bundledPatterns();
  for (const s of sources) library.add(s);
  return library;
}

type PathPrimitive = Extract<RenderPrimitive, { readonly path: readonly number[] }>;

const stroke = (path: number[], paint: Paint): PathPrimitive => ({
  kind: 'stroke',
  path,
  color: paint.color,
  ...(paint.lineweight === undefined ? {} : { lineweight: paint.lineweight }),
});

/** Appends a polyline's segments (with bulge arcs) to a path, starting with a move. */
function polylinePath(path: number[], vertices: readonly PolylineVertex[], closed: boolean): void {
  if (vertices.length === 0) return;
  const first = vertices[0]!;
  path.push(PATH_M, first.x, first.y);
  const n = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < n; i++) {
    const v = vertices[i]!;
    const w = vertices[(i + 1) % vertices.length]!;
    if (v.bulge === 0 || (v.x === w.x && v.y === w.y)) {
      path.push(PATH_L, w.x, w.y);
    } else {
      const a = bulgeArc(v, w, v.bulge);
      path.push(
        PATH_A,
        a.center.x,
        a.center.y,
        a.radius,
        a.startAngle,
        a.startAngle + a.sweep,
        a.sweep > 0 ? 1 : 0,
      );
    }
  }
  if (closed) path.push(PATH_Z);
}

function size(points: readonly Vec2[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return Math.max(maxX - minX, maxY - minY);
}

/** A SPLINE or spline edge: its NURBS, or the interpolation of its fit points (M1-47). */
function splinePath(path: number[], data: SplineData, move: boolean): void {
  const s = splineCurve(data);
  if (!s || s.controlPoints.length < 2) return;
  const dev = Math.max(size(s.controlPoints) * SPLINE_DEVIATION, Number.MIN_VALUE);
  const { points } = flatten(s, dev);
  points.forEach((p, i) => path.push(i === 0 && move ? PATH_M : PATH_L, p.x, p.y));
}

/** A hatch boundary edge appended to the current loop. */
function edgePath(path: number[], e: HatchEdge, first: boolean): void {
  switch (e.type) {
    case 'line':
      if (first) path.push(PATH_M, e.start.x, e.start.y);
      path.push(PATH_L, e.end.x, e.end.y);
      return;
    case 'arc': {
      // A clockwise edge stores its angles negated (DXF HATCH boundary data).
      const a0 = e.ccw ? e.startAngle : -e.startAngle;
      const a1 = e.ccw ? e.endAngle : -e.endAngle;
      if (first)
        path.push(
          PATH_M,
          e.center.x + e.radius * Math.cos(a0),
          e.center.y + e.radius * Math.sin(a0),
        );
      path.push(PATH_A, e.center.x, e.center.y, e.radius, a0, a1, e.ccw ? 1 : 0);
      return;
    }
    case 'ellipse': {
      const rx = Math.hypot(e.majorAxis.x, e.majorAxis.y);
      const rot = Math.atan2(e.majorAxis.y, e.majorAxis.x);
      const a0 = e.ccw ? e.startAngle : -e.startAngle;
      const a1 = e.ccw ? e.endAngle : -e.endAngle;
      if (first) {
        const ux = Math.cos(a0) * rx;
        const uy = Math.sin(a0) * rx * e.ratio;
        path.push(
          PATH_M,
          e.center.x + ux * Math.cos(rot) - uy * Math.sin(rot),
          e.center.y + ux * Math.sin(rot) + uy * Math.cos(rot),
        );
      }
      path.push(PATH_E, e.center.x, e.center.y, rx, rx * e.ratio, rot, a0, a1, e.ccw ? 1 : 0);
      return;
    }
    case 'spline':
      splinePath(path, e, first);
      return;
  }
}

function loopPath(path: number[], loop: HatchLoop): void {
  if (loop.polyline) {
    polylinePath(path, loop.polyline.vertices, true);
    return;
  }
  const edges = loop.edges ?? [];
  edges.forEach((e, i) => edgePath(path, e, i === 0));
  if (edges.length) path.push(PATH_Z);
}

/** The primitives that draw one entity's geometry, each carrying the paint's opacity. */
export function tessellate(
  g: EntityGeometry,
  paint: Paint,
  ctx: TessellateContext = {},
): RenderPrimitive[] {
  const prims = geometryPrimitives(g, paint, ctx);
  const opacity = paint.opacity;
  if (opacity === undefined || opacity >= 1) return prims;
  // Copied, not tagged in place: text and pattern primitives may be shared between entities.
  return prims.map((p) => ({ ...p, opacity }));
}

function geometryPrimitives(
  g: EntityGeometry,
  paint: Paint,
  ctx: TessellateContext,
): RenderPrimitive[] {
  // Text takes no linetype: AutoCAD draws glyphs continuous.
  if (g.kind === 'TEXT' || g.kind === 'MTEXT')
    return ctx.text ? textPrimitives(g, paint, ctx.text) : [];
  // An attribute definition outside a block shows its tag, on one line even when multiline
  // (M1-14 part 2); inside a reference `expandInsert` decides what it shows.
  if (g.kind === 'ATTDEF')
    return ctx.text ? textPrimitives({ ...g, kind: 'TEXT', value: g.tag }, paint, ctx.text) : [];
  // Image frames are drawn continuous: a frame is a display aid, not linework (ours).
  if (g.kind === 'IMAGE' || g.kind === 'WIPEOUT') {
    const name = g.kind === 'IMAGE' && g.definition ? ctx.imageName?.(g.definition) : undefined;
    const label = name && ctx.text ? { name, text: ctx.text } : undefined;
    return imagePrimitives(g, paint, ctx.frames, label);
  }
  if (g.kind === 'PDFUNDERLAY') return underlayPrimitives(g, paint);
  if (g.kind === 'LWPOLYLINE' || g.kind === 'POLYLINE') {
    const widths = polylineWidths(g);
    if (widths) {
      const dashed = paint.linetype && dashedWidePolyline(g, widths, paint, ctx);
      return dashed || widePolyline(g.vertices, g.closed, widths, paint, ctx.fill ?? true);
    }
  }
  const prims = exact(g, paint, ctx.patterns ?? PATTERNS);
  const lt = paint.linetype;
  const first = prims[0];
  if (!lt || prims.length !== 1) return prims;
  const P = patternLength(lt.pattern) * lt.scale;
  if (!(P > 0)) return prims;
  // XLINE and RAY have no ends to fit the pattern between: the renderer lays it out from the
  // base point over the part on screen (M1-45 part 2). Their text and shapes are not drawn.
  if (first?.kind === 'infinite') {
    const lengths = lt.pattern.elements.map((e) => e.length * lt.scale);
    return [{ ...first, dashes: { lengths, period: P } }];
  }
  if (first?.kind !== 'stroke') return prims;
  const dashed = dashGeometry(g, lt.pattern, lt.scale, P);
  if (!dashed || dashed.solid) return prims;
  const path: number[] = [];
  for (const run of dashed.dashes)
    run.forEach((p, i) => path.push(i === 0 ? PATH_M : PATH_L, p.x, p.y));
  // A zero-length segment: the round cap draws it as a dot as wide as the line.
  for (const p of dashed.dots) path.push(PATH_M, p.x, p.y, PATH_L, p.x, p.y);
  const out: RenderPrimitive[] = [
    { ...stroke(path, paint), continuous: first.path, patternLength: P },
  ];
  // Text and shapes in the gaps (M1-45), drawn with the dashes and only with them: once the
  // pattern is under a pixel the renderer draws the continuous stroke alone.
  if (dashed.embeds.length > 0 && ctx.text) {
    const { linetype: _, ...plain } = paint;
    out.push(...linetypeEmbedPrimitives(dashed.embeds, plain, ctx.text));
  }
  return out;
}

/**
 * A polyline with widths (M1-46): each wide segment's outline (`wideOutlines`) filled, or
 * outlined with FILLMODE off, and the zero-width segments as the thin line.
 */
function widePolyline(
  vertices: readonly PolylineVertex[],
  closed: boolean,
  widths: readonly WideVertex[],
  paint: Paint,
  fill: boolean,
): RenderPrimitive[] {
  const { outlines, thin } = wideParts(vertices, closed, widths, paint, fill);
  return [outlines, thin].filter((x): x is PathPrimitive => x !== undefined);
}

/** `widePolyline`'s two primitives: the wide outlines and the thin segments, when any. */
function wideParts(
  vertices: readonly PolylineVertex[],
  closed: boolean,
  widths: readonly WideVertex[],
  paint: Paint,
  fill: boolean,
): { outlines?: PathPrimitive; thin?: PathPrimitive } {
  const { fills, thin } = wideOutlines(widths, closed);
  const out: { outlines?: PathPrimitive; thin?: PathPrimitive } = {};
  if (fills.length > 0) {
    const path: number[] = [];
    for (const f of fills) {
      f.forEach((p, i) => path.push(i === 0 ? PATH_M : PATH_L, p.x, p.y));
      path.push(PATH_Z);
    }
    // Each outline is counter-clockwise, so overlapping mitres add up under nonzero.
    out.outlines = fill ? { kind: 'fill', path, color: paint.color } : stroke(path, paint);
  }
  if (thin.length > 0) {
    const path: number[] = [];
    let last = -2;
    for (const i of thin) {
      const v = vertices[i]!;
      const w = vertices[(i + 1) % vertices.length]!;
      const seg = [v, { ...w, bulge: 0 }];
      const sub: number[] = [];
      polylinePath(sub, seg, false);
      // Consecutive thin segments continue one subpath.
      path.push(...(i === last + 1 ? sub.slice(3) : sub));
      last = i;
    }
    out.thin = stroke(path, paint);
  }
  return out;
}

/**
 * A wide polyline with a linetype (M1-66). AutoCAD fits the pattern to the centre line as it
 * would the thin polyline (PLINEGEN through the vertices or per segment) and draws each dash
 * as that stretch of the segment's tapered outline (`widePiece`), mitred where the dash runs
 * through a vertex; on zero-width segments the dashes are thin. A dot is drawn as the cut
 * across the width (AutoCAD documents neither; a zero-length piece of a filled outline is
 * that cut, our reading). The whole outline stays beside the dashes as `continuous`, for
 * picking in a gap and for the level of detail. Undefined when the polyline draws
 * continuous (too short for one pattern, or past MAX_PERIODS).
 */
function dashedWidePolyline(
  g: Extract<EntityGeometry, { kind: 'LWPOLYLINE' | 'POLYLINE' }>,
  widths: readonly WideVertex[],
  paint: Paint,
  ctx: TessellateContext,
): RenderPrimitive[] | undefined {
  const lt = paint.linetype!;
  const P = patternLength(lt.pattern) * lt.scale;
  const segments = wideSegments(widths, g.closed);
  const total = segments.reduce((s, x) => s + x.length, 0);
  if (!(P > 0) || segments.length === 0 || total / P > MAX_PERIODS) return undefined;
  const dashed = dashPolyline(
    segments.map((x) => x.centre),
    lt.pattern,
    lt.scale,
    { closed: g.closed, plinegen: g.plinegen ?? false },
  );
  if (dashed.solid) return undefined;
  const { linetype: _, ...plain } = paint;
  const fill = ctx.fill ?? true;
  const starts: number[] = [];
  segments.reduce((o, x) => (starts.push(o), o + x.length), 0);
  const eps = 1e-9 * total;
  const wide: number[] = [];
  const thin: number[] = [];
  for (const [a, b] of dashed.spans) {
    let open = false;
    segments.forEach((seg, i) => {
      const lo = Math.max(a, starts[i]!);
      const hi = Math.min(b, starts[i]! + seg.length);
      if (hi - lo <= eps) return;
      if (seg.wide) {
        widePiece(seg, lo - starts[i]!, hi - starts[i]!).forEach((p, k) =>
          wide.push(k === 0 ? PATH_M : PATH_L, p.x, p.y),
        );
        wide.push(PATH_Z);
        open = false;
        return;
      }
      // A dash running on through a vertex between thin segments stays one subpath.
      centreSlice(seg, lo - starts[i]!, hi - starts[i]!).forEach((p, k) => {
        if (k === 0 && open) return;
        thin.push(k === 0 ? PATH_M : PATH_L, p.x, p.y);
      });
      open = true;
    });
  }
  for (const d of dashed.dotsAt) {
    // The last segment with a length starting at or before the dot.
    let i = 0;
    segments.forEach((x, k) => {
      if (x.length > 0 && starts[k]! <= d) i = k;
    });
    const seg = segments[i]!;
    const cut = wideCross(seg, d - starts[i]!);
    // The round cap draws a zero-length segment as a dot as wide as the line.
    const [p, q] = cut ?? [centreSlice(seg, d - starts[i]!, d - starts[i]!)[0]!];
    thin.push(PATH_M, p!.x, p!.y, PATH_L, (q ?? p)!.x, (q ?? p)!.y);
  }
  const whole = wideParts(g.vertices, g.closed, widths, plain, fill);
  const out: RenderPrimitive[] = [];
  if (wide.length > 0 && whole.outlines) {
    const dashes: PathPrimitive = fill
      ? { kind: 'fill', path: wide, color: paint.color }
      : stroke(wide, plain);
    out.push({ ...dashes, continuous: whole.outlines.path, patternLength: P });
  }
  if (thin.length > 0) {
    // Dots across wide segments ride here too; with no thin segment the continuous stroke is
    // empty, and the outlines above draw and pick the whole polyline.
    out.push({ ...stroke(thin, plain), continuous: whole.thin?.path ?? [], patternLength: P });
  }
  if (dashed.embeds.length > 0 && ctx.text)
    out.push(...linetypeEmbedPrimitives(dashed.embeds, plain, ctx.text));
  return out;
}

/** The centre line of a segment between two distances along it. */
function centreSlice(seg: WideSegment, a: number, b: number): Vec2[] {
  const at = (d: number): Vec2 => {
    let k = 0;
    while (k < seg.at.length - 2 && seg.at[k + 1]! < d) k++;
    const span = seg.at[k + 1]! - seg.at[k]!;
    const t = span > 0 ? Math.max(0, Math.min(1, (d - seg.at[k]!) / span)) : 0;
    const p = seg.centre[k]!;
    const q = seg.centre[k + 1]!;
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  };
  const out = [at(a)];
  for (let k = 1; k < seg.centre.length - 1; k++) {
    if (seg.at[k]! > a && seg.at[k]! < b) out.push(seg.centre[k]!);
  }
  out.push(at(b));
  return out;
}

/** Points along an elliptical arc (a circle when rx = ry), first to last inclusive. */
function curvePoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
  a0: number,
  a1: number,
): Vec2[] {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / ARC_STEP));
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + ((a1 - a0) * i) / n;
    const ux = rx * Math.cos(t);
    const uy = ry * Math.sin(t);
    out.push({ x: cx + ux * cos - uy * sin, y: cy + ux * sin + uy * cos });
  }
  return out;
}

/** A polyline's segments, each one chord or the chords of its bulge arc. */
function polylineSegments(vertices: readonly PolylineVertex[], closed: boolean): Vec2[][] {
  const out: Vec2[][] = [];
  const n = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < n; i++) {
    const v = vertices[i]!;
    const w = vertices[(i + 1) % vertices.length]!;
    if (v.bulge === 0 || (v.x === w.x && v.y === w.y)) {
      out.push([v, w]);
    } else {
      const a = bulgeArc(v, w, v.bulge);
      const pts = curvePoints(
        a.center.x,
        a.center.y,
        a.radius,
        a.radius,
        0,
        a.startAngle,
        a.startAngle + a.sweep,
      );
      // End exactly on the vertices, so PLINEGEN joins and per-segment fits meet.
      pts[0] = { x: v.x, y: v.y };
      pts[pts.length - 1] = { x: w.x, y: w.y };
      out.push(pts);
    }
  }
  return out;
}

function pathLength(points: readonly Vec2[]): number {
  let L = 0;
  for (let i = 1; i < points.length; i++)
    L += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return L;
}

/** A closed run without its repeated end point; `dashPath` closes it itself. */
const open = (points: Vec2[]): Vec2[] => points.slice(0, -1);

/**
 * The linetype fitted to a stroked entity, or undefined when the kind takes no linetype here
 * (fills, points, and XLINE/RAY, which have no ends to fit from) or the pattern is too dense.
 */
function dashGeometry(
  g: EntityGeometry,
  pattern: LinePattern,
  scale: number,
  P: number,
): DashedPath | undefined {
  const TAU = 2 * Math.PI;
  // A closed run comes in with its end point repeating its start.
  const fit = (points: Vec2[], closed = false): DashedPath | undefined =>
    pathLength(points) / P > MAX_PERIODS
      ? undefined
      : dashPath(closed ? open(points) : points, pattern, scale, { closed });
  const fitSegments = (segments: Vec2[][], closed: boolean, plinegen: boolean) =>
    segments.reduce((s, seg) => s + pathLength(seg), 0) / P > MAX_PERIODS
      ? undefined
      : dashPolyline(segments, pattern, scale, { closed, plinegen });
  switch (g.kind) {
    case 'LINE':
      return fit([g.start, g.end]);
    case 'CIRCLE':
      return fit(curvePoints(g.center.x, g.center.y, g.radius, g.radius, 0, 0, TAU), true);
    case 'ARC': {
      let end = g.endAngle;
      while (end <= g.startAngle) end += TAU;
      return fit(curvePoints(g.center.x, g.center.y, g.radius, g.radius, 0, g.startAngle, end));
    }
    case 'ELLIPSE': {
      const rx = Math.hypot(g.majorAxis.x, g.majorAxis.y);
      const rot = Math.atan2(g.majorAxis.y, g.majorAxis.x);
      let end = g.endParam;
      while (end <= g.startParam) end += TAU;
      const full = end - g.startParam >= TAU - 1e-12;
      const pts = curvePoints(g.center.x, g.center.y, rx, rx * g.ratio, rot, g.startParam, end);
      return fit(pts, full);
    }
    case 'LWPOLYLINE':
    case 'POLYLINE':
      if (g.vertices.length < 2) return undefined;
      return fitSegments(polylineSegments(g.vertices, g.closed), g.closed, g.plinegen ?? false);
    case 'SPLINE': {
      const curve = splineCurve(g);
      if (!curve || curve.controlPoints.length < 2) return undefined;
      const dev = Math.max(size(curve.controlPoints) * SPLINE_DEVIATION, Number.MIN_VALUE);
      const pts = [...flatten(curve, dev).points];
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      // A closed spline ends where it starts; fit it closed only if the flattening agrees.
      const closed = g.closed && Math.hypot(a.x - b.x, a.y - b.y) <= dev;
      return fit(pts, closed);
    }
    case '3DFACE': {
      // Each visible edge is fitted on its own, like a polyline without PLINEGEN.
      const edges: Vec2[][] = [];
      for (let i = 0; i < 4; i++)
        if (!(g.hiddenEdges & (1 << i))) edges.push([g.corners[i]!, g.corners[(i + 1) % 4]!]);
      return fitSegments(edges, false, false);
    }
    default:
      return undefined;
  }
}

function exact(g: EntityGeometry, paint: Paint, patterns: PatternLibrary): RenderPrimitive[] {
  switch (g.kind) {
    case 'LINE':
      return [stroke([PATH_M, g.start.x, g.start.y, PATH_L, g.end.x, g.end.y], paint)];
    case 'XLINE':
    case 'RAY':
      return [
        {
          kind: 'infinite',
          base: g.base,
          direction: g.direction,
          both: g.kind === 'XLINE',
          color: paint.color,
          ...(paint.lineweight === undefined ? {} : { lineweight: paint.lineweight }),
        },
      ];
    case 'CIRCLE':
      return [
        stroke(
          [
            PATH_M,
            g.center.x + g.radius,
            g.center.y,
            PATH_A,
            g.center.x,
            g.center.y,
            g.radius,
            0,
            2 * Math.PI,
            1,
            PATH_Z,
          ],
          paint,
        ),
      ];
    case 'ARC': {
      let end = g.endAngle;
      while (end <= g.startAngle) end += 2 * Math.PI;
      const sx = g.center.x + g.radius * Math.cos(g.startAngle);
      const sy = g.center.y + g.radius * Math.sin(g.startAngle);
      return [
        stroke(
          [PATH_M, sx, sy, PATH_A, g.center.x, g.center.y, g.radius, g.startAngle, end, 1],
          paint,
        ),
      ];
    }
    case 'ELLIPSE': {
      const rx = Math.hypot(g.majorAxis.x, g.majorAxis.y);
      const rot = Math.atan2(g.majorAxis.y, g.majorAxis.x);
      let end = g.endParam;
      while (end <= g.startParam) end += 2 * Math.PI;
      const ux = Math.cos(g.startParam) * rx;
      const uy = Math.sin(g.startParam) * rx * g.ratio;
      const sx = g.center.x + ux * Math.cos(rot) - uy * Math.sin(rot);
      const sy = g.center.y + ux * Math.sin(rot) + uy * Math.cos(rot);
      return [
        stroke(
          [
            PATH_M,
            sx,
            sy,
            PATH_E,
            g.center.x,
            g.center.y,
            rx,
            rx * g.ratio,
            rot,
            g.startParam,
            end,
            1,
          ],
          paint,
        ),
      ];
    }
    case 'POINT':
      return [{ kind: 'point', x: g.position.x, y: g.position.y, color: paint.color }];
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      // Widths draw as centre lines until polyline widths (M1-46).
      const path: number[] = [];
      polylinePath(path, g.vertices, g.closed);
      return path.length ? [stroke(path, paint)] : [];
    }
    case 'SPLINE': {
      const path: number[] = [];
      splinePath(path, g, true);
      return path.length ? [stroke(path, paint)] : [];
    }
    case 'VIEWPORT': {
      // The frame on the sheet (M1-18). The layout's own paper-space viewport has none, and a
      // viewport clipped by an entity shows that entity as its frame instead.
      if (g.id === 1 || (g.flags & VIEWPORT_NON_RECT_CLIP) !== 0) return [];
      const { minX, minY, maxX, maxY } = viewportFrame(g);
      if (!(maxX > minX && maxY > minY)) return [];
      return [
        stroke(
          [PATH_M, minX, minY, PATH_L, maxX, minY, PATH_L, maxX, maxY, PATH_L, minX, maxY, PATH_Z],
          paint,
        ),
      ];
    }
    case 'SOLID':
    case 'TRACE': {
      // DXF corner order: the outline runs 1–2–4–3.
      const [a, b, c, d] = g.corners;
      return [
        {
          kind: 'fill',
          path: [PATH_M, a.x, a.y, PATH_L, b.x, b.y, PATH_L, d.x, d.y, PATH_L, c.x, c.y, PATH_Z],
          color: paint.color,
        },
      ];
    }
    case '3DFACE': {
      const path: number[] = [];
      const c = g.corners;
      for (let i = 0; i < 4; i++) {
        if (g.hiddenEdges & (1 << i)) continue;
        const p = c[i]!;
        const q = c[(i + 1) % 4]!;
        path.push(PATH_M, p.x, p.y, PATH_L, q.x, q.y);
      }
      return path.length ? [stroke(path, paint)] : [];
    }
    case 'HATCH': {
      const area: number[] = [];
      for (const loop of g.loops) loopPath(area, loop);
      if (area.length === 0) return [];
      // Style 2 (ignore) fills only the outermost loop; normal and outer use odd parity.
      const evenOdd = g.style !== 2;
      const fill = (color: PrimitiveColor): PathPrimitive => ({
        kind: 'fill',
        path: area,
        color,
        evenOdd,
      });
      if (g.gradient) {
        // A gradient shows its own colours, not the hatch's (M1-16 part 2).
        const ramp = gradientRamp({ loops: g.loops, gradient: g.gradient });
        if (!ramp) return [];
        const [c1, c2] = g.gradient.colors;
        const color1 = c1 ? colorValue(c1.color) : paint.color;
        const color2 = c2 ? colorValue(c2.color) : color1;
        return [
          {
            ...fill(color1),
            gradient: {
              ...ramp,
              colors: [color1, g.gradient.singleColor ? color1 : color2],
              ...(g.gradient.singleColor ? { tint: g.gradient.tint } : {}),
            },
          },
        ];
      }
      if (g.solid) return [fill(paint.color)];
      // A pattern AutoCAD would not generate (HPMAXLINES) shows as its filled area, which is
      // what so dense a pattern looks like at any zoom that shows the whole of it.
      const pattern = hatchPattern({ ...g, patternLines: hatchLines(g, patterns) });
      if (pattern.kind === 'too-dense') return [fill(paint.color)];
      // One stroke per family, so each switches to its tint at its own spacing (LOD).
      return pattern.families.map((f) => {
        const path: number[] = [];
        const s = f.segments;
        for (let i = 0; i < s.length; i += 4)
          path.push(PATH_M, s[i]!, s[i + 1]!, PATH_L, s[i + 2]!, s[i + 3]!);
        const d = f.dots;
        for (let i = 0; i < d.length; i += 2)
          path.push(PATH_M, d[i]!, d[i + 1]!, PATH_L, d[i]!, d[i + 1]!);
        return {
          ...stroke(path, paint),
          hatch: {
            area,
            evenOdd,
            spacing: f.spacing,
            period: f.period,
            dashLength: f.dashLength,
            marks: f.marks,
          },
        };
      });
    }
    default:
      return [];
  }
}
