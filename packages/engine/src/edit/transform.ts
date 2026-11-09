// Every entity kind carried by a similarity (M2-06): what MOVE, COPY, ROTATE, SCALE and MIRROR do
// to one object's geometry, in AutoCAD 2024's terms (MIRROR, MIRRTEXT, MIRRHATCH help pages).
//
// - Points are carried, lengths (radii, heights, widths, thickness, elevation) scaled, absolute
//   angles turned, or mirrored under a reflection, in which arcs and bulges run the other way.
// - Text keeps reading the right way round when MIRRTEXT is 0 (AutoCAD's default): it lands
//   where its mirror image would, with its justification swapped so the text covers the same
//   place (`upright`). With MIRRTEXT 1 TEXT, ATTDEF and ATTRIB are mirrored (backward or upside
//   down). MTEXT, TOLERANCE and multileader text have no mirrored form and always stay readable
//   (AutoCAD documents MIRRTEXT for MTEXT without saying how a mirrored MTEXT shows; no flag
//   of the format can show it).
// - Block references are mirrored as AutoCAD mirrors them, by a negative X scale.
// - A hatch's pattern keeps its direction under MIRRHATCH 0 (the default); only its origin is
//   mirrored. MIRRHATCH 1 mirrors the pattern lines too.
// - Raster images and PDF underlays cannot show a mirrored picture: they move to their mirror
//   image's place and stay readable. A WIPEOUT, having no picture, takes its mirrored shape.
// - A dimension's or table's stored block is carried by the caller (`edit.ts`), not here.
import type { Vec2 } from '../geom/types';
import type {
  AnnotativeData,
  DimensionGeometry,
  EntityGeometry,
  HatchEdge,
  HatchGeometry,
  ImageGeometry,
  InsertAttribute,
  MTextGeometry,
  MultiLeaderGeometry,
  PlanarProps,
  PolylineVertex,
  TextFields,
  TextRepresentation,
} from '../model/types';
import { normalizeAngle } from '../geom/angle';
import { arcSweep, ellipseSweep } from '../geom/eval';
import { add, fromAngle, scale } from '../geom/vec';
import { angle, direction, point, upright, vector, type Similarity } from './similarity';

export interface TransformOptions {
  /** MIRRTEXT: 1 mirrors TEXT, ATTDEF and ATTRIB; 0 (the default) keeps them readable. */
  readonly mirrorText?: boolean;
  /** MIRRHATCH: 1 mirrors hatch patterns; 0 (the default) keeps their direction. */
  readonly mirrorHatch?: boolean;
}

const len = (t: Similarity, v: number): number => (t.scale === 1 ? v : v * t.scale);

/** Elevation and thickness scaled (SCALE scales in Z too, about a base point at Z 0). */
function sizes(t: Similarity, g: PlanarProps): PlanarProps {
  if (t.scale === 1) return {};
  return {
    ...(g.elevation !== undefined ? { elevation: g.elevation * t.scale } : {}),
    ...(g.thickness !== undefined ? { thickness: g.thickness * t.scale } : {}),
  };
}

function planar<G extends PlanarProps>(t: Similarity, g: G): G {
  return t.scale === 1 ? g : { ...g, ...sizes(t, g) };
}

const bulge = (t: Similarity, b: number): number => (t.reflect && b !== 0 ? -b : b);

function vertex<V extends PolylineVertex>(t: Similarity, v: V): V {
  const p = point(t, v);
  return {
    ...v,
    x: p.x,
    y: p.y,
    bulge: bulge(t, v.bulge),
    ...(v.startWidth !== undefined ? { startWidth: len(t, v.startWidth) } : {}),
    ...(v.endWidth !== undefined ? { endWidth: len(t, v.endWidth) } : {}),
  };
}

/** An arc's start and end angles carried along; a reflection swaps them to stay CCW. */
function arcAngles(t: Similarity, start: number, end: number): [number, number] {
  if (!t.reflect) return [angle(t, start), angle(t, end)];
  const sweep = arcSweep({
    kind: 'ARC',
    center: { x: 0, y: 0 },
    radius: 1,
    startAngle: start,
    endAngle: end,
  });
  const s = angle(t, start + sweep);
  return [s, normalizeAngle(s + sweep)];
}

/**
 * An ellipse (centre, major axis, parameters) carried along. Under a reflection the parameter
 * runs backwards (u → −u), so the CCW range [a, b] becomes [−b, −a].
 */
function ellipseParams(t: Similarity, start: number, end: number): [number, number] {
  if (!t.reflect) return [start, end];
  const sweep = ellipseSweep({
    kind: 'ELLIPSE',
    center: { x: 0, y: 0 },
    majorAxis: { x: 1, y: 0 },
    ratio: 1,
    startParam: start,
    endParam: end,
  });
  const s = normalizeAngle(-(start + sweep));
  return [s, s + sweep];
}

// ── Text ────────────────────────────────────────────────────────────────────────────────────

/** Left ↔ right (TEXT DXF 72): left and right swap, aligned and fit swap their two points. */
const SWAP_H: Record<number, number> = { 0: 2, 2: 0 };
/** Baseline or bottom ↔ top (TEXT DXF 73): the text's height lies on the other side. */
const SWAP_V: Record<number, number> = { 0: 3, 1: 3, 3: 0 };

/** Whether the renderer and AutoCAD place the text by its alignment point (DXF 11). */
const byAlignment = (h: number, v: number): boolean => h !== 0 || v !== 0;

interface TextPlace {
  readonly position: Vec2;
  readonly alignmentPoint?: Vec2;
  readonly rotation: number;
  readonly halign: number;
  readonly valign: number;
  readonly backward: boolean;
  readonly upsideDown: boolean;
}

/**
 * A TEXT-like placement carried along. Under a reflection the text is mirrored (MIRRTEXT 1:
 * backward or upside down) or set upright in its mirror image's place (MIRRTEXT 0), its
 * justification swapped so it covers the same ground.
 */
function textPlace(t: Similarity, g: TextPlace, height: number, o: TransformOptions): TextPlace {
  const position = point(t, g.position);
  const alignmentPoint = g.alignmentPoint && point(t, g.alignmentPoint);
  if (!t.reflect) {
    return {
      ...g,
      position,
      ...(alignmentPoint ? { alignmentPoint } : {}),
      rotation: angle(t, g.rotation),
    };
  }
  const u = upright(t, g.rotation);
  if (o.mirrorText) {
    return {
      ...g,
      position,
      ...(alignmentPoint ? { alignmentPoint } : {}),
      rotation: u.rotation,
      ...(u.flip === 'x' ? { backward: !g.backward } : { upsideDown: !g.upsideDown }),
    };
  }
  const fitted = g.halign === 3 || g.halign === 5;
  if (fitted && alignmentPoint) {
    if (u.flip === 'x') {
      // The text runs back from the far end: swap the ends.
      return { ...g, position: alignmentPoint, alignmentPoint: position, rotation: u.rotation };
    }
    // Its height lies on the other side of the baseline: move the baseline across.
    const up = scale(fromAngle(u.rotation + Math.PI / 2), -len(t, height));
    return {
      ...g,
      position: add(position, up),
      alignmentPoint: add(alignmentPoint, up),
      rotation: u.rotation,
    };
  }
  const halign = u.flip === 'x' ? (SWAP_H[g.halign] ?? g.halign) : g.halign;
  const valign = u.flip === 'y' && g.halign !== 4 ? (SWAP_V[g.valign] ?? g.valign) : g.valign;
  // The point the text hangs from stays where its mirror image is; only the field that holds
  // it changes with the justification.
  const anchor = byAlignment(g.halign, g.valign) && alignmentPoint ? alignmentPoint : position;
  // A left, baseline text has no alignment point (DXF 11 is read only for the others).
  const { alignmentPoint: _dropped, ...rest } = g;
  return byAlignment(halign, valign)
    ? { ...g, halign, valign, rotation: u.rotation, position, alignmentPoint: anchor }
    : { ...rest, halign, valign, rotation: u.rotation, position: anchor };
}

function textFields<T extends TextFields>(t: Similarity, g: T, o: TransformOptions): T {
  const placed = textPlace(t, g, g.height, o);
  // The placement decides whether there is an alignment point.
  const { alignmentPoint: _replaced, ...base } = planar(t, g);
  return { ...base, ...placed, height: len(t, g.height) } as T;
}

/** An annotative text's representations follow the text (each has its own placement). */
export function annotativeData(
  t: Similarity,
  a: AnnotativeData,
  g: TextFields,
  o: TransformOptions,
): AnnotativeData {
  return {
    ...a,
    representations: a.representations.map((r) => {
      if (!r.text) return r;
      const placed = textPlace(t, { ...g, ...r.text, valign: g.valign }, g.height, o);
      const text: TextRepresentation = {
        position: placed.position,
        alignmentPoint: placed.alignmentPoint ?? placed.position,
        rotation: placed.rotation,
        halign: placed.halign,
      };
      return { ...r, text };
    }),
  };
}

/** MTEXT attachment (1–9, top-left to bottom-right) with its columns or rows swapped. */
const swapAttachment = (a: number, flip: 'x' | 'y'): number => {
  if (a < 1 || a > 9) return a;
  const row = Math.floor((a - 1) / 3);
  const col = (a - 1) % 3;
  return flip === 'x' ? row * 3 + (2 - col) + 1 : (2 - row) * 3 + col + 1;
};

function mtext(t: Similarity, g: MTextGeometry): MTextGeometry {
  const u = t.reflect ? upright(t, g.rotation) : undefined;
  return {
    ...planar(t, g),
    position: point(t, g.position),
    rotation: u ? u.rotation : angle(t, g.rotation),
    attachment: u ? swapAttachment(g.attachment, u.flip) : g.attachment,
    height: len(t, g.height),
    width: len(t, g.width),
    ...(g.definedHeight !== undefined ? { definedHeight: len(t, g.definedHeight) } : {}),
    ...(g.columns
      ? {
          columns: {
            ...g.columns,
            width: len(t, g.columns.width),
            gutter: len(t, g.columns.gutter),
            heights: g.columns.heights.map((h) => len(t, h)),
          },
        }
      : {}),
  };
}

function attribute(t: Similarity, a: InsertAttribute, o: TransformOptions): InsertAttribute {
  const out = textFields(t, a, o);
  return {
    ...out,
    ...(a.mtext ? { mtext: mtext(t, a.mtext) } : {}),
    ...(a.annotative ? { annotative: annotativeData(t, a.annotative, a, o) } : {}),
  };
}

// ── Block references ────────────────────────────────────────────────────────────────────────

/**
 * A reference's rotation and X/Y scale carried along. A reflection is a negative X scale, as
 * AutoCAD's MIRROR leaves a block (or a negative Y scale turned half a turn, whichever keeps the
 * rotation nearer the original: the same drawing either way).
 */
function reference(
  t: Similarity,
  rotation: number,
  sx: number,
  sy: number,
): { rotation: number; sx: number; sy: number } {
  if (!t.reflect) return { rotation: angle(t, rotation), sx: len(t, sx), sy: len(t, sy) };
  const u = upright(t, rotation);
  return u.flip === 'x'
    ? { rotation: u.rotation, sx: -len(t, sx), sy: len(t, sy) }
    : { rotation: u.rotation, sx: len(t, sx), sy: -len(t, sy) };
}

// ── Annotations ─────────────────────────────────────────────────────────────────────────────

function dimension(t: Similarity, g: DimensionGeometry): DimensionGeometry {
  const p = (q: Vec2) => point(t, q);
  const shared = {
    ...sizes(t, g),
    definitionPoint: p(g.definitionPoint),
    textPosition: p(g.textPosition),
    horizontalDirection: angle(t, g.horizontalDirection),
  };
  switch (g.dimType) {
    case 'linear':
    case 'aligned':
      return {
        ...g,
        ...shared,
        first: p(g.first),
        second: p(g.second),
        ...(g.rotation !== undefined ? { rotation: angle(t, g.rotation) } : {}),
        ...(g.oblique !== undefined && g.oblique !== 0 ? { oblique: angle(t, g.oblique) } : {}),
      };
    case 'angular':
      return {
        ...g,
        ...shared,
        line1Start: p(g.line1Start),
        line1End: p(g.line1End),
        line2Start: p(g.line2Start),
        arcPoint: p(g.arcPoint),
      };
    case 'angular3pt':
      return { ...g, ...shared, vertex: p(g.vertex), first: p(g.first), second: p(g.second) };
    case 'radius':
    case 'diameter':
      return { ...g, ...shared, chordPoint: p(g.chordPoint), leaderLength: len(t, g.leaderLength) };
    case 'ordinate':
      return { ...g, ...shared, feature: p(g.feature), leaderEnd: p(g.leaderEnd) };
    case 'jogged':
      return {
        ...g,
        ...shared,
        chordPoint: p(g.chordPoint),
        overrideCenter: p(g.overrideCenter),
        jogPoint: p(g.jogPoint),
        leaderLength: len(t, g.leaderLength),
      };
    case 'arc': {
      // A reflection runs the arc the other way: its ends (and their extension lines) swap.
      const [startAngle, endAngle] = arcAngles(t, g.startAngle, g.endAngle);
      const [first, second] = t.reflect ? [g.second, g.first] : [g.first, g.second];
      return {
        ...g,
        ...shared,
        first: p(first),
        second: p(second),
        center: p(g.center),
        startAngle,
        endAngle,
        ...(g.leader ? { leader: [p(g.leader[0]), p(g.leader[1])] as const } : {}),
      };
    }
  }
}

function multiLeader(t: Similarity, g: MultiLeaderGeometry): MultiLeaderGeometry {
  const p = (q: Vec2) => point(t, q);
  const text = g.text;
  const block = g.block;
  const u = text && t.reflect ? upright(t, text.rotation) : undefined;
  return {
    ...planar(t, g),
    contentBase: p(g.contentBase),
    scale: len(t, g.scale),
    doglegLength: len(t, g.doglegLength),
    landingGap: len(t, g.landingGap),
    arrowheadSize: len(t, g.arrowheadSize),
    ...(g.drawnArrowheadSize !== undefined
      ? { drawnArrowheadSize: len(t, g.drawnArrowheadSize) }
      : {}),
    ...(text
      ? {
          text: {
            ...text,
            position: p(text.position),
            rotation: u ? u.rotation : angle(t, text.rotation),
            height: len(t, text.height),
            width: len(t, text.width),
            boundaryHeight: len(t, text.boundaryHeight),
          },
        }
      : {}),
    ...(block
      ? {
          block: (() => {
            const r = reference(t, block.rotation, block.scale.x, block.scale.y);
            return {
              ...block,
              position: p(block.position),
              rotation: r.rotation,
              scale: { x: r.sx, y: r.sy, z: len(t, block.scale.z) },
            };
          })(),
        }
      : {}),
    branches: g.branches.map((b) => ({
      ...b,
      connection: p(b.connection),
      direction: direction(t, b.direction),
      doglegLength: len(t, b.doglegLength),
      lines: b.lines.map((l) => ({
        ...l,
        vertices: l.vertices.map(p),
        ...(l.overrides?.arrowheadSize !== undefined
          ? { overrides: { ...l.overrides, arrowheadSize: len(t, l.overrides.arrowheadSize) } }
          : {}),
      })),
    })),
  };
}

// ── Hatches ─────────────────────────────────────────────────────────────────────────────────

/**
 * A boundary edge carried along. Arc and ellipse angles keep the DXF convention (a clockwise
 * edge stores its angles negated); a reflection turns a CCW edge into a clockwise one and back
 * (so each loop keeps its edge order), which leaves an ellipse edge's stored values as they are
 * and mirrors an arc's.
 */
function hatchEdge(t: Similarity, e: HatchEdge): HatchEdge {
  switch (e.type) {
    case 'line':
      return { ...e, start: point(t, e.start), end: point(t, e.end) };
    case 'arc': {
      if (!t.reflect) {
        // A clockwise edge's stored angles are its angles negated, so they turn the other way.
        const turn = (a: number) => (e.ccw ? a + t.angle : a - t.angle);
        const keep = t.angle === 0;
        return {
          ...e,
          center: point(t, e.center),
          radius: len(t, e.radius),
          startAngle: keep ? e.startAngle : turn(e.startAngle),
          endAngle: keep ? e.endAngle : turn(e.endAngle),
        };
      }
      // CCW at world angles a: CW at φ − a, stored a − φ. CW stored s (world −s): CCW at φ + s.
      const f = (a: number) => (e.ccw ? a - t.angle : a + t.angle);
      return {
        ...e,
        center: point(t, e.center),
        radius: len(t, e.radius),
        startAngle: f(e.startAngle),
        endAngle: f(e.endAngle),
        ccw: !e.ccw,
      };
    }
    case 'ellipse':
      return {
        ...e,
        center: point(t, e.center),
        majorAxis: vector(t, e.majorAxis),
        ...(t.reflect ? { ccw: !e.ccw } : {}),
      };
    case 'spline':
      return {
        ...e,
        controlPoints: e.controlPoints.map((q) => point(t, q)),
        ...(e.fitPoints ? { fitPoints: e.fitPoints.map((q) => point(t, q)) } : {}),
        ...(e.startTangent ? { startTangent: vector(t, e.startTangent) } : {}),
        ...(e.endTangent ? { endTangent: vector(t, e.endTangent) } : {}),
      };
  }
}

function hatch(t: Similarity, g: HatchGeometry, o: TransformOptions): HatchGeometry {
  // MIRRHATCH 0: under a reflection the pattern keeps its direction (its lines keep their
  // angles, their offsets and dashes only scale) and its origin moves to its mirror image.
  const keepPattern = t.reflect && !o.mirrorHatch;
  // A solid fill has no pattern to turn (AutoCAD keeps its 52 at 0).
  const patternAngle = keepPattern || g.solid ? g.patternAngle : angle(t, g.patternAngle);
  return {
    ...planar(t, g),
    loops: g.loops.map((l) => ({
      ...l,
      ...(l.polyline
        ? { polyline: { ...l.polyline, vertices: l.polyline.vertices.map((v) => vertex(t, v)) } }
        : {}),
      ...(l.edges ? { edges: l.edges.map((e) => hatchEdge(t, e)) } : {}),
    })),
    seedPoints: g.seedPoints.map((q) => point(t, q)),
    patternAngle,
    patternScale: g.solid ? g.patternScale : len(t, g.patternScale),
    patternLines: g.patternLines.map((pl) =>
      keepPattern
        ? {
            ...pl,
            base: point(t, pl.base),
            dashes: pl.dashes.map((d) => len(t, d)),
            offset: scale(pl.offset, t.scale),
          }
        : {
            ...pl,
            angle: angle(t, pl.angle),
            base: point(t, pl.base),
            offset: vector(t, pl.offset),
            dashes: pl.dashes.map((d) => len(t, d)),
          },
    ),
    ...(g.gradient && !keepPattern
      ? { gradient: { ...g.gradient, angle: angle(t, g.gradient.angle) } }
      : {}),
  };
}

// ── Images ──────────────────────────────────────────────────────────────────────────────────

/**
 * An image or wipeout carried along. Its frame (corner, U and V pixel vectors) must stay
 * right-handed (a DXF IMAGE's normal is U × V), so a reflection sets it upright over its mirror
 * image's place; a WIPEOUT's clip (in pixel coordinates, (−0.5, −0.5) the corner) is mirrored
 * in the picture so its shape is the mirror image, an IMAGE's clip stays on the same pixels.
 */
function image(t: Similarity, g: ImageGeometry): ImageGeometry {
  const position = point(t, g.position);
  const u = vector(t, g.u);
  const v = vector(t, g.v);
  // A −Z image states its plane as the raw U × V (the mapping's normal), which the save checks.
  const normal = (u: Vec2, v: Vec2) =>
    g.normal ? { normal: { ...g.normal, z: u.x * v.y - u.y * v.x } } : {};
  if (!t.reflect) return { ...planar(t, g), position, u, v, ...normal(u, v) };
  const flip = upright(t, Math.atan2(g.u.y, g.u.x)).flip;
  const frame =
    flip === 'x'
      ? { position: add(position, scale(u, g.size.x)), u: scale(u, -1), v }
      : { position: add(position, scale(v, g.size.y)), u, v: scale(v, -1) };
  if (g.kind !== 'WIPEOUT') return { ...planar(t, g), ...frame, ...normal(frame.u, frame.v) };
  const mirrored = g.clip.vertices.map((q) =>
    flip === 'x' ? { x: g.size.x - 1 - q.x, y: q.y } : { x: q.x, y: g.size.y - 1 - q.y },
  );
  const vertices =
    g.clip.type === 'rectangle' && mirrored.length === 2
      ? [
          {
            x: Math.min(mirrored[0]!.x, mirrored[1]!.x),
            y: Math.min(mirrored[0]!.y, mirrored[1]!.y),
          },
          {
            x: Math.max(mirrored[0]!.x, mirrored[1]!.x),
            y: Math.max(mirrored[0]!.y, mirrored[1]!.y),
          },
        ]
      : mirrored.reverse();
  return { ...planar(t, g), ...frame, ...normal(frame.u, frame.v), clip: { ...g.clip, vertices } };
}

// ── All kinds ───────────────────────────────────────────────────────────────────────────────

/** Kinds no edit can carry: Triya cannot write their geometry back (M1-40). */
export const FIXED_KINDS: ReadonlySet<EntityGeometry['kind']> = new Set([
  'OLE2FRAME',
  'ACAD_PROXY_ENTITY',
]);

/** Why `g` cannot be carried by `t`, or undefined when it can. */
export function transformProblem(g: EntityGeometry, t: Similarity): string | undefined {
  if (FIXED_KINDS.has(g.kind)) return 'OLE and proxy objects cannot be edited';
  // Geometry is the plan view (DEC-039): turning or mirroring an object whose plane is not
  // the XY plane would need its 3D plane turned too.
  const n = 'normal' in g ? g.normal : undefined;
  if (n && (n.x !== 0 || n.y !== 0) && (t.reflect || t.angle !== 0)) {
    return 'an object outside the XY plane can only be moved or scaled';
  }
  if (g.kind === 'REGION' && t.reflect) return 'a region cannot be mirrored';
  if (g.kind === 'VIEWPORT') {
    if (g.id === 1) return 'the paper space viewport cannot be edited';
    if (t.reflect) return 'a viewport cannot be mirrored';
    const quarter = (t.angle / (Math.PI / 2)) % 1;
    if (Math.min(quarter, 1 - quarter) > 1e-9) return 'a viewport turns by right angles only';
  }
  return undefined;
}

/**
 * `g` carried by `t`. Throws for what `transformProblem` refuses. The caller carries what the
 * geometry refers to: a dimension's or table's block, an associative hatch's boundary, a
 * viewport's clip boundary.
 */
export function transformGeometry(
  g: EntityGeometry,
  t: Similarity,
  o: TransformOptions = {},
): EntityGeometry {
  const problem = transformProblem(g, t);
  if (problem) throw new Error(problem);
  const p = (q: Vec2) => point(t, q);
  switch (g.kind) {
    case 'LINE':
      return { ...planar(t, g), start: p(g.start), end: p(g.end) };
    case 'XLINE':
    case 'RAY':
      return { ...g, base: p(g.base), direction: direction(t, g.direction) };
    case 'CIRCLE':
      return { ...planar(t, g), center: p(g.center), radius: len(t, g.radius) };
    case 'ARC': {
      const [startAngle, endAngle] = arcAngles(t, g.startAngle, g.endAngle);
      return {
        ...planar(t, g),
        center: p(g.center),
        radius: len(t, g.radius),
        startAngle,
        endAngle,
      };
    }
    case 'ELLIPSE': {
      const [startParam, endParam] = ellipseParams(t, g.startParam, g.endParam);
      return {
        ...planar(t, g),
        center: p(g.center),
        majorAxis: vector(t, g.majorAxis),
        startParam,
        endParam,
      };
    }
    case 'POINT':
      return {
        ...planar(t, g),
        position: p(g.position),
        ...(g.xAxisAngle !== undefined ? { xAxisAngle: angle(t, g.xAxisAngle) } : {}),
      };
    case 'LWPOLYLINE':
      return {
        ...planar(t, g),
        vertices: g.vertices.map((v) => vertex(t, v)),
        ...(g.constantWidth !== undefined ? { constantWidth: len(t, g.constantWidth) } : {}),
      };
    case 'POLYLINE':
      return {
        ...planar(t, g),
        vertices: g.vertices.map((v) => vertex(t, v)),
        ...(g.frame ? { frame: g.frame.map(p) } : {}),
        ...(g.startWidth !== undefined ? { startWidth: len(t, g.startWidth) } : {}),
        ...(g.endWidth !== undefined ? { endWidth: len(t, g.endWidth) } : {}),
      };
    case 'SPLINE':
      return {
        ...g,
        controlPoints: g.controlPoints.map(p),
        ...(g.fitPoints ? { fitPoints: g.fitPoints.map(p) } : {}),
        ...(g.startTangent ? { startTangent: direction(t, g.startTangent) } : {}),
        ...(g.endTangent ? { endTangent: direction(t, g.endTangent) } : {}),
      };
    case 'SOLID':
    case 'TRACE': {
      const [a, b, c, d] = g.corners;
      return { ...planar(t, g), corners: [p(a), p(b), p(c), p(d)] };
    }
    case '3DFACE': {
      const [a, b, c, d] = g.corners;
      return { ...g, corners: [p(a), p(b), p(c), p(d)] };
    }
    case 'TEXT':
    case 'ATTDEF':
      return textFields(t, g, o);
    case 'MTEXT':
      return mtext(t, g);
    case 'INSERT': {
      const r = reference(t, g.rotation, g.scale.x, g.scale.y);
      return {
        ...planar(t, g),
        position: p(g.position),
        rotation: r.rotation,
        scale: { x: r.sx, y: r.sy, z: len(t, g.scale.z) },
        ...(g.array
          ? {
              array: {
                ...g.array,
                columnSpacing: len(t, g.array.columnSpacing),
                rowSpacing: len(t, g.array.rowSpacing),
              },
            }
          : {}),
        // Variable attributes follow MIRRTEXT; the block's own text is mirrored with it.
        attributes: g.attributes.map((a) => attribute(t, a, o)),
      };
    }
    case 'DIMENSION':
    case 'ARC_DIMENSION':
    case 'LARGE_RADIAL_DIMENSION':
      return dimension(t, g);
    case 'LEADER':
      return {
        ...planar(t, g),
        vertices: g.vertices.map(p),
        textHeight: len(t, g.textHeight),
        textWidth: len(t, g.textWidth),
        horizontalDirection: direction(t, g.horizontalDirection),
        blockOffset: vector(t, g.blockOffset),
        annotationOffset: vector(t, g.annotationOffset),
      };
    case 'TOLERANCE': {
      const u = t.reflect ? upright(t, g.rotation) : undefined;
      return {
        ...planar(t, g),
        position: p(g.position),
        rotation: u ? u.rotation : angle(t, g.rotation),
      };
    }
    case 'MULTILEADER':
      return multiLeader(t, g);
    case 'HATCH':
      return hatch(t, g, o);
    case 'ACAD_TABLE': {
      const dir = { x: g.direction.x, y: g.direction.y };
      const position = p(g.position);
      if (!t.reflect)
        return { ...planar(t, g), position, direction: direction(t, dir), ...tableSizes(t, g) };
      // Upright over its mirror image: the table spans x 0 → width and y −height → 0.
      const theta = Math.atan2(dir.y, dir.x);
      const u = upright(t, theta);
      const x = direction(t, dir);
      const y = direction(t, { x: -dir.y, y: dir.x });
      const width = g.columnWidths.reduce((a, w) => a + w, 0) * t.scale;
      const height = g.rowHeights.reduce((a, h) => a + h, 0) * t.scale;
      const corner =
        u.flip === 'x' ? add(position, scale(x, width)) : add(position, scale(y, -height));
      return {
        ...planar(t, g),
        position: corner,
        direction: fromAngle(u.rotation),
        ...tableSizes(t, g),
      };
    }
    case 'IMAGE':
    case 'WIPEOUT':
      return image(t, g);
    case 'PDFUNDERLAY': {
      // No picture can show mirrored: it moves to its mirror image's insertion point, upright.
      const u = t.reflect ? upright(t, g.rotation) : undefined;
      return {
        ...planar(t, g),
        position: p(g.position),
        rotation: u ? u.rotation : angle(t, g.rotation),
        scale: { x: len(t, g.scale.x), y: len(t, g.scale.y), z: len(t, g.scale.z) },
      };
    }
    case 'MLINE':
      return {
        ...planar(t, g),
        scale: len(t, g.scale),
        start: p(g.start),
        vertices: g.vertices.map((v) => ({
          ...v,
          position: p(v.position),
          direction: direction(t, v.direction),
          miter: direction(t, v.miter),
          elements: v.elements.map((el) => ({
            parameters: el.parameters.map((x) => len(t, x)),
            fillParameters: el.fillParameters.map((x) => len(t, x)),
          })),
        })),
      };
    case 'REGION':
      return {
        ...planar(t, g),
        loops: g.loops.map((l) => ({
          ...l,
          edges: l.edges.map((e) => {
            switch (e.kind) {
              case 'LINE':
                return { ...e, start: p(e.start), end: p(e.end) };
              case 'CIRCLE':
                return { ...e, center: p(e.center), radius: len(t, e.radius) };
              case 'ARC': {
                const [startAngle, endAngle] = arcAngles(t, e.startAngle, e.endAngle);
                return {
                  ...e,
                  center: p(e.center),
                  radius: len(t, e.radius),
                  startAngle,
                  endAngle,
                };
              }
              case 'ELLIPSE':
                return { ...e, center: p(e.center), majorAxis: vector(t, e.majorAxis) };
            }
          }),
        })),
      };
    case 'VIEWPORT': {
      // The frame moves and scales with the sheet, and turns by right angles with its view
      // (VPROTATEASSOC 1, AutoCAD's default); the view shows the same part of the model.
      const quarterTurns = Math.round(t.angle / (Math.PI / 2)) % 2 !== 0;
      return {
        ...g,
        center: p(g.center),
        width: len(t, quarterTurns ? g.height : g.width),
        height: len(t, quarterTurns ? g.width : g.height),
        // The model shows at the same zoom on a frame the scale made larger, so it grows too.
        viewHeight: quarterTurns ? (g.viewHeight * g.width) / g.height : g.viewHeight,
        twist: t.angle === 0 ? g.twist : normalizeAngle(g.twist + t.angle),
      };
    }
    case 'OLE2FRAME':
    case 'ACAD_PROXY_ENTITY':
      break;
  }
  throw new Error(`${g.kind} cannot be transformed`);
}

const tableSizes = (
  t: Similarity,
  g: { rowHeights: readonly number[]; columnWidths: readonly number[] },
) =>
  t.scale === 1
    ? {}
    : {
        rowHeights: g.rowHeights.map((h) => h * t.scale),
        columnWidths: g.columnWidths.map((w) => w * t.scale),
      };
