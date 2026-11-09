// STRETCH (M2-06 part 2): what moving the points of an object that lie inside a window does to
// its geometry, as AutoCAD 2024 documents it (AutoCAD 2024 Help, "STRETCH (Command)"):
//
// - "STRETCH moves only the vertices and endpoints that lie inside the crossing selection,
//   leaving those outside unchanged": lines, arcs, polylines, splines, solids, traces, 3D faces
//   and leaders take their points inside along, the rest stay.
// - "Points, circles, text and blocks are moved only if their insertion or centre point is
//   inside": every object placed by one point (ellipses, tables, images, underlays,
//   tolerances, xlines and rays too) moves whole or not at all.
// - An arc keeps its chord height: AutoCAD says it stretches the endpoints of arcs without
//   saying what of the arc stays. The chord height (the bulge's sagitta) is what AutoCAD
//   keeps in practice and what a drafter expects; the centre and radius follow from it.
// - A spline's control points move; its fit data goes, as AutoCAD drops it when control points
//   are edited. A spline kept only as fit points moves those.
// - Dimensions, hatches, multilines, multileaders, regions, viewports and curve-fit polylines
//   need their regeneration (M2-10, M4-07) to follow a stretched point: Triya moves them when
//   the window holds all of them and leaves them otherwise, saying so.
// - Dimensions are regenerated once a dimension engine is at hand (`dimensions`, M2-10 part 3):
//   their definition points inside move, as AutoCAD 2024 stretches an associative dimension's
//   definition points, and the dimension is drawn afresh. Text moved on its own (its DXF 11
//   the only point inside) becomes text the user placed (DXF 70 bit 128), as dragging it does;
//   text that moves with other points keeps its flag, so text the engine places is placed
//   again (AutoCAD does not say which; this keeps a stretched dimension's text centred, the
//   common drafter expectation).
import { ccwSweep } from '../geom/angle';
import { bulgeArc } from '../geom/eval';
import type { Vec2 } from '../geom/types';
import { add, angleOf, distance, fromAngle, sub } from '../geom/vec';
import type { EntityGeometry } from '../model/types';

/** What stretching an object does: nothing, move it whole, or a new shape. */
export type StretchResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'move' }
  | { readonly kind: 'shape'; readonly geom: EntityGeometry }
  /** Some of its points are inside, but a kind that only moves whole: left, with the reason. */
  | { readonly kind: 'whole'; readonly reason: string };

const NONE: StretchResult = { kind: 'none' };
const MOVE: StretchResult = { kind: 'move' };

/** Kinds that move whole or not at all, and how the refusal names them. */
const WHOLE: Partial<Record<EntityGeometry['kind'], string>> = {
  DIMENSION: 'a dimension',
  ARC_DIMENSION: 'a dimension',
  LARGE_RADIAL_DIMENSION: 'a dimension',
  HATCH: 'a hatch',
  MLINE: 'a multiline',
  MULTILEADER: 'a multileader',
  REGION: 'a region',
  VIEWPORT: 'a viewport',
  OLE2FRAME: 'an OLE object',
  ACAD_PROXY_ENTITY: 'a proxy object',
};

const wholeReason = (what: string) => `${what} is only moved, with all of it in the window`;

/** The points that decide whether a whole-only kind is in the window. */
function wholePoints(g: EntityGeometry): readonly Vec2[] {
  switch (g.kind) {
    case 'DIMENSION':
    case 'ARC_DIMENSION':
    case 'LARGE_RADIAL_DIMENSION': {
      const pts: Vec2[] = [];
      for (const v of Object.values(g)) {
        if (v && typeof v === 'object' && 'x' in v && 'y' in v && !('z' in v)) pts.push(v as Vec2);
      }
      return pts;
    }
    case 'HATCH':
      return g.loops.flatMap((l): readonly Vec2[] =>
        l.polyline
          ? l.polyline.vertices
          : (l.edges ?? []).flatMap((e) =>
              e.type === 'line'
                ? [e.start, e.end]
                : e.type === 'spline'
                  ? e.controlPoints
                  : [e.center],
            ),
      );
    case 'MLINE':
      return g.vertices.map((v) => v.position);
    case 'MULTILEADER':
      return [
        g.contentBase,
        ...g.branches.flatMap((b) => [b.connection, ...b.lines.flatMap((l) => l.vertices)]),
      ];
    case 'REGION':
      return g.loops.flatMap((l) => l.edges.map((e) => (e.kind === 'LINE' ? e.start : e.center)));
    case 'VIEWPORT':
      return [g.center];
    case 'POLYLINE':
      return g.frame ?? g.vertices;
    default:
      return [];
  }
}

/** The one point a placed object moves by. */
function placement(g: EntityGeometry): Vec2 | undefined {
  switch (g.kind) {
    case 'CIRCLE':
    case 'ELLIPSE':
      return g.center;
    case 'POINT':
      return g.position;
    case 'XLINE':
    case 'RAY':
      return g.base;
    case 'TEXT':
    case 'ATTDEF':
      // Justified text is placed by its alignment point (DXF 11), left-baseline text by DXF 10.
      return (g.halign !== 0 || g.valign !== 0) && g.alignmentPoint ? g.alignmentPoint : g.position;
    case 'MTEXT':
    case 'INSERT':
    case 'TOLERANCE':
    case 'ACAD_TABLE':
    case 'IMAGE':
    case 'WIPEOUT':
    case 'PDFUNDERLAY':
      return g.position;
    default:
      return undefined;
  }
}

/**
 * Moves each of `points` that `inside` takes by `d`: undefined when none is, 'all' when every
 * one is.
 */
function movePoints<P extends Vec2>(
  points: readonly P[],
  inside: (p: Vec2) => boolean,
  d: Vec2,
): P[] | 'all' | undefined {
  let moved = 0;
  const out = points.map((p) => {
    if (!inside(p)) return p;
    moved++;
    return { ...p, x: p.x + d.x, y: p.y + d.y };
  });
  if (moved === 0) return undefined;
  return moved === points.length ? 'all' : out;
}

/** An arc with one end moved, keeping its chord height. Undefined when the ends meet. */
function stretchArc(
  center: Vec2,
  radius: number,
  startAngle: number,
  endAngle: number,
  from: Vec2,
  to: Vec2,
): { center: Vec2; radius: number; startAngle: number; endAngle: number } | undefined {
  const sweep = ccwSweep(startAngle, endAngle);
  const chord = distance(
    add(center, fromAngle(startAngle, radius)),
    add(center, fromAngle(endAngle, radius)),
  );
  const newChord = distance(from, to);
  if (!(newChord > 0) || !(chord > 0)) return undefined;
  // bulge = 2h / chord, so the same height h on the new chord is bulge · chord / newChord.
  const bulge = (Math.tan(sweep / 4) * chord) / newChord;
  const a = bulgeArc(from, to, bulge);
  return {
    center: a.center,
    radius: a.radius,
    startAngle: a.startAngle,
    endAngle: angleOf(sub(to, a.center)),
  };
}

/** What stretching may do beyond the geometry alone. */
export interface StretchOptions {
  /** Dimensions can be regenerated, so their points stretch (M2-10 part 3). */
  readonly dimensions?: boolean;
}

const isDimension = (g: EntityGeometry): boolean =>
  g.kind === 'DIMENSION' || g.kind === 'ARC_DIMENSION' || g.kind === 'LARGE_RADIAL_DIMENSION';

/** A dimension with its definition points that `inside` takes moved by `d`. */
function stretchDimension(g: EntityGeometry, inside: (p: Vec2) => boolean, d: Vec2): StretchResult {
  const out: Record<string, unknown> = { ...g };
  let moved = 0;
  let total = 0;
  let textOnly = true;
  for (const [k, v] of Object.entries(g)) {
    if (!v || typeof v !== 'object' || !('x' in v) || !('y' in v) || 'z' in v) continue;
    total++;
    if (!inside(v as Vec2)) continue;
    moved++;
    if (k !== 'textPosition') textOnly = false;
    out[k] = add(v as Vec2, d);
  }
  if (moved === 0) return NONE;
  if (moved === total) return MOVE;
  if (textOnly) out.textUserPositioned = true;
  return { kind: 'shape', geom: out as unknown as EntityGeometry };
}

/** `g` with its points that `inside` takes moved by `d`. */
export function stretchGeometry(
  g: EntityGeometry,
  inside: (p: Vec2) => boolean,
  d: Vec2,
  options: StretchOptions = {},
): StretchResult {
  if (options.dimensions && isDimension(g)) return stretchDimension(g, inside, d);
  const whole =
    WHOLE[g.kind] ?? (g.kind === 'POLYLINE' && g.fit ? 'a curve-fit polyline' : undefined);
  if (whole) {
    const pts = wholePoints(g);
    const n = pts.filter(inside).length;
    if (n === 0) return NONE;
    return n === pts.length ? MOVE : { kind: 'whole', reason: wholeReason(whole) };
  }
  const place = placement(g);
  if (place) return inside(place) ? MOVE : NONE;
  const shape = (m: object | 'all' | undefined): StretchResult =>
    m === undefined
      ? NONE
      : m === 'all'
        ? MOVE
        : { kind: 'shape', geom: { ...g, ...m } as EntityGeometry };
  switch (g.kind) {
    case 'LINE': {
      const m = movePoints([g.start, g.end], inside, d);
      return shape(m && m !== 'all' ? { start: m[0], end: m[1] } : m);
    }
    case 'ARC': {
      const s = add(g.center, fromAngle(g.startAngle, g.radius));
      const e = add(g.center, fromAngle(g.endAngle, g.radius));
      const m = movePoints([s, e], inside, d);
      if (m === undefined || m === 'all') return shape(m);
      const arc = stretchArc(g.center, g.radius, g.startAngle, g.endAngle, m[0]!, m[1]!);
      return arc ? shape(arc) : NONE;
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const m = movePoints(g.vertices, inside, d);
      return shape(m && m !== 'all' ? { vertices: m } : m);
    }
    case 'SPLINE': {
      if (g.controlPoints.length === 0 && g.fitPoints) {
        const m = movePoints(g.fitPoints, inside, d);
        return shape(m && m !== 'all' ? { fitPoints: m } : m);
      }
      const m = movePoints(g.controlPoints, inside, d);
      if (m === undefined || m === 'all') return shape(m);
      const {
        fitPoints: _f,
        startTangent: _s,
        endTangent: _e,
        knotParameterization: _k,
        ...rest
      } = g;
      return { kind: 'shape', geom: { ...rest, controlPoints: m } };
    }
    case 'SOLID':
    case 'TRACE':
    case '3DFACE': {
      const m = movePoints(g.corners, inside, d);
      return shape(m && m !== 'all' ? { corners: m as unknown as typeof g.corners } : m);
    }
    case 'LEADER': {
      const m = movePoints(g.vertices, inside, d);
      return shape(m && m !== 'all' ? { vertices: m } : m);
    }
    default:
      return NONE;
  }
}
