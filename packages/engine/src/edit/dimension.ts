// New dimensions (M2-11): where DIMLINEAR, DIMALIGNED, DIMRADIUS, DIMDIAMETER, DIMANGULAR,
// DIMCONTINUE and DIMBASELINE put a dimension's definition points for the dimension line
// location the drafter gives, as AutoCAD 2024 documents those commands (AutoCAD 2024 Help,
// "DIMLINEAR (Command)" and the others). The same function places the dimension while it is
// dragged (`DragPreview` kind `dimension`) and when the location is given, so what is drawn
// under the cursor is what the click makes.
//
// The dimension's DXF fields are written as AutoCAD writes them (DXF reference, DIMENSION):
// - linear (rotated) and aligned: 13/14 the extension line origins, 10 the dimension line's
//   end on the second extension line; DIMLINEAR picks horizontal or vertical from where the
//   location is: above or below the origins' box horizontal, left or right of it vertical,
//   inside it (AutoCAD keeps the last orientation it showed, which a command line answer
//   does not have) the longer of the two spans;
// - radius: 10 the centre, 15 the chord point; diameter: 10 and 15 the diameter's ends, the
//   chord point toward the location; the text goes where the location is, as DIMRADIUS
//   places it, kept there by DXF 70 bit 128 so a regeneration does not move it;
// - angular: three-point (15 the vertex, 13 and 14 the ends, 10 on the arc) or two-line (13→14
//   and 15→10, 16 on the arc); the location says which angle is dimensioned.
// The text the engine places (DXF 11) is a stand-in until the dimension is regenerated.
import type { Vec2 } from '../geom/types';
import { add, cross, distance, dot, fromAngle, length, perp, scale, sub } from '../geom/vec';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { DimStyleRecord, DimensionFields, DimensionGeometry } from '../model/types';
import { dimNum, dimVars } from '../annotation/leader';

/** The fields every new dimension starts with, beyond its points. */
export type NewDimension = Omit<
  DimensionFields,
  'definitionPoint' | 'textPosition' | 'block' | 'normal' | 'elevation' | 'thickness'
>;

export type DimPlacement =
  /** DIMLINEAR: `rotation` fixed (Horizontal, Vertical, Rotated) or chosen by the location. */
  | {
      readonly kind: 'linear';
      readonly first: Vec2;
      readonly second: Vec2;
      readonly rotation?: number;
      readonly base: NewDimension;
    }
  | {
      readonly kind: 'aligned';
      readonly first: Vec2;
      readonly second: Vec2;
      readonly base: NewDimension;
    }
  | {
      readonly kind: 'radius' | 'diameter';
      readonly center: Vec2;
      readonly radius: number;
      readonly base: NewDimension;
    }
  | {
      readonly kind: 'angular3pt';
      readonly vertex: Vec2;
      readonly first: Vec2;
      readonly second: Vec2;
      readonly base: NewDimension;
    }
  | {
      readonly kind: 'angular';
      readonly line1: readonly [Vec2, Vec2];
      readonly line2: readonly [Vec2, Vec2];
      readonly base: NewDimension;
    };

/** The current dimension style (DIMSTYLE): `$DIMSTYLE`'s, else STANDARD, else the first. */
export function currentDimStyle(model: DocumentModel): DimStyleRecord | undefined {
  const name = model.header.get('$DIMSTYLE');
  const styles = [...model.tables.dimStyles.values()];
  const named = (n: string) => styles.find((s) => s.name.toUpperCase() === n.toUpperCase());
  return (typeof name === 'string' ? named(name) : undefined) ?? named('Standard') ?? styles[0];
}

/** A new dimension's fields in style `style`: the measurement as its text, unrotated. */
export function newDimension(style: Handle): NewDimension {
  return {
    style,
    textUserPositioned: false,
    text: '',
    textRotation: 0,
    horizontalDirection: 0,
    attachment: 5,
    lineSpacingStyle: 1,
    lineSpacing: 1,
  };
}

/** DIMLINEAR's orientation for a location `at`: horizontal (0) or vertical (π/2). */
export function linearRotation(first: Vec2, second: Vec2, at: Vec2): number {
  const within = (v: number, a: number, b: number) => v >= Math.min(a, b) && v <= Math.max(a, b);
  const inX = within(at.x, first.x, second.x);
  const inY = within(at.y, first.y, second.y);
  if (inX && !inY) return 0;
  if (inY && !inX) return Math.PI / 2;
  if (!inX && !inY) {
    // Off a corner of the box: the side it is further beyond.
    const dx = Math.min(Math.abs(at.x - first.x), Math.abs(at.x - second.x));
    const dy = Math.min(Math.abs(at.y - first.y), Math.abs(at.y - second.y));
    return dy >= dx ? 0 : Math.PI / 2;
  }
  return Math.abs(second.x - first.x) >= Math.abs(second.y - first.y) ? 0 : Math.PI / 2;
}

/** Where the line through `p` along `d` meets the line through `q` along `e`. */
function meet(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | undefined {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-12 * Math.max(length(d) * length(e), 1e-300)) return undefined;
  return add(p, scale(d, cross(sub(q, p), e) / den));
}

const unitOf = (v: Vec2): Vec2 | undefined => {
  const l = length(v);
  return l > 0 ? scale(v, 1 / l) : undefined;
};

/**
 * The dimension `p` makes with its dimension line (or arc, or text) at `at`; undefined where it
 * makes none (zero-length, parallel lines).
 */
export function placeDimension(p: DimPlacement, at: Vec2): DimensionGeometry | undefined {
  const fields = { ...p.base, textPosition: at };
  switch (p.kind) {
    case 'linear':
    case 'aligned': {
      const rotation =
        p.kind === 'linear' ? (p.rotation ?? linearRotation(p.first, p.second, at)) : undefined;
      const u = rotation !== undefined ? fromAngle(rotation) : unitOf(sub(p.second, p.first));
      if (!u || distance(p.first, p.second) === 0) return undefined;
      // DXF 10: on the dimension line through `at`, at the second extension line.
      const definitionPoint = add(at, scale(u, dot(sub(p.second, at), u)));
      return {
        kind: 'DIMENSION',
        ...fields,
        dimType: p.kind,
        first: p.first,
        second: p.second,
        definitionPoint,
        ...(rotation !== undefined && { rotation }),
      };
    }
    case 'radius':
    case 'diameter': {
      if (!(p.radius > 0)) return undefined;
      const v = unitOf(sub(at, p.center)) ?? fromAngle(0);
      const chordPoint = add(p.center, scale(v, p.radius));
      const outside = Math.max(0, distance(at, p.center) - p.radius);
      return {
        kind: 'DIMENSION',
        ...fields,
        dimType: p.kind,
        textUserPositioned: true,
        chordPoint,
        definitionPoint: p.kind === 'radius' ? p.center : sub(p.center, scale(v, p.radius)),
        leaderLength: outside,
      };
    }
    case 'angular3pt': {
      if (distance(p.vertex, p.first) === 0 || distance(p.vertex, p.second) === 0) return undefined;
      if (distance(at, p.vertex) === 0) return undefined;
      return {
        kind: 'DIMENSION',
        ...fields,
        dimType: 'angular3pt',
        vertex: p.vertex,
        first: p.first,
        second: p.second,
        definitionPoint: at,
      };
    }
    case 'angular': {
      const [a, b] = p.line1;
      const [c, d] = p.line2;
      const centre = meet(a, sub(b, a), c, sub(d, c));
      if (!centre || distance(at, centre) === 0) return undefined;
      return {
        kind: 'DIMENSION',
        ...fields,
        dimType: 'angular',
        line1Start: a,
        line1End: b,
        line2Start: c,
        definitionPoint: d,
        arcPoint: at,
      };
    }
  }
}

/** DIMDLI (baseline spacing) of a dimension, times DIMSCALE; AutoCAD's imperial default. */
export function baselineSpacing(
  model: DocumentModel,
  g: Pick<DimensionFields, 'style'>,
  xdata?: Parameters<typeof dimVars>[1],
): number {
  const vars = dimVars(g.style, xdata, model);
  const k = dimNum(vars.DIMSCALE, 1) || 1;
  return dimNum(vars.DIMDLI, 0.38) * k;
}

/** The text height a dimension's text editor opens at: DIMTXT times DIMSCALE. */
export function dimensionTextHeight(
  model: DocumentModel,
  g: Pick<DimensionFields, 'style'>,
  xdata?: Parameters<typeof dimVars>[1],
): number {
  const vars = dimVars(g.style, xdata, model);
  const k = dimNum(vars.DIMSCALE, 1) || 1;
  return dimNum(vars.DIMTXT, 0.18) * k;
}

type Linear = Extract<DimensionGeometry, { dimType: 'linear' | 'aligned' }>;

/** A linear or aligned dimension's direction along its dimension line. */
export function dimensionDirection(g: Linear): Vec2 {
  return g.dimType === 'aligned'
    ? (unitOf(sub(g.second, g.first)) ?? fromAngle(0))
    : fromAngle(g.rotation ?? 0);
}

/** The ends of a linear or aligned dimension's dimension line, on its extension lines. */
export function dimensionLineEnds(g: Linear): [Vec2, Vec2] {
  const u = dimensionDirection(g);
  const ext = g.oblique !== undefined && g.oblique !== 0 ? fromAngle(g.oblique) : perp(u);
  return [
    meet(g.first, ext, g.definitionPoint, u) ?? g.first,
    meet(g.second, ext, g.definitionPoint, u) ?? g.definitionPoint,
  ];
}
