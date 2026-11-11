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
//   and 15→10, 16 on the arc); the location says which angle is dimensioned, unless the
//   Quadrant option fixed it (M2-31): "the dimension line is extended past the extension line
//   when the dimension text is positioned outside of the angular dimension" (AutoCAD 2024 Help,
//   "DIMANGULAR (Command)", Quadrant), so the arc point goes into the quadrant at the
//   location's radius and the text stays at the location, kept there by DXF 70 bit 128;
// - a circle picked for DIMLINEAR (M2-31): the ends of its diameter across the dimension line.
//   "When the point used to select the circle is close to the north or south quadrant point, a
//   horizontal dimension is drawn. When the point used to select the circle is close to the
//   east or west quadrant point, a vertical dimension is drawn" (AutoCAD Help, DIMLINEAR,
//   Object Selection); the location still switches it as it does for two origins (above or
//   below the circle horizontal, beside it vertical), as drafters drag it, and the pick decides
//   only inside the circle's box, where the location does not.
// The text the engine places (DXF 11) is a stand-in until the dimension is regenerated.
import type { Vec2 } from '../geom/types';
import { normalizeAngle } from '../geom/angle';
import {
  add,
  angleOf,
  cross,
  distance,
  dot,
  fromAngle,
  length,
  perp,
  scale,
  sub,
} from '../geom/vec';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type {
  DimStyleRecord,
  DimVarValue,
  DimensionFields,
  DimensionGeometry,
  Xdata,
} from '../model/types';
import { dimNum, dimVars } from '../annotation/leader';
import { DIMVAR_BY_CODE } from '../annotation/dimvars';
import { withDimvarOverride } from '../annotation/dstyle';

/** The fields every new dimension starts with, beyond its points. */
export type NewDimension = Omit<
  DimensionFields,
  'definitionPoint' | 'textPosition' | 'block' | 'normal' | 'elevation' | 'thickness'
>;

export type DimPlacement =
  /**
   * DIMLINEAR: `rotation` fixed (Horizontal, Vertical, Rotated) or chosen by the location. With
   * `circle` (a circle selected) the origins are its diameter's ends across the dimension line,
   * `first` and `second` stand-ins; `vertical` is what the pick said (east or west quadrant).
   */
  | {
      readonly kind: 'linear';
      readonly first: Vec2;
      readonly second: Vec2;
      readonly rotation?: number;
      readonly circle?: {
        readonly center: Vec2;
        readonly radius: number;
        readonly vertical: boolean;
      };
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
  /** `quadrant`: DIMANGULAR's Quadrant, a point in the angle measured whatever the location. */
  | {
      readonly kind: 'angular3pt';
      readonly vertex: Vec2;
      readonly first: Vec2;
      readonly second: Vec2;
      readonly quadrant?: Vec2;
      readonly base: NewDimension;
    }
  | {
      readonly kind: 'angular';
      readonly line1: readonly [Vec2, Vec2];
      readonly line2: readonly [Vec2, Vec2];
      readonly quadrant?: Vec2;
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

/** DIMLINEAR's orientation on a circle: by the location as for two origins, else the pick. */
function circleRotation(c: Vec2, r: number, vertical: boolean, at: Vec2): number {
  const dx = Math.abs(at.x - c.x) - r;
  const dy = Math.abs(at.y - c.y) - r;
  if (dx <= 0 && dy <= 0) return vertical ? Math.PI / 2 : 0;
  if (dx <= 0) return 0;
  if (dy <= 0) return Math.PI / 2;
  return dy >= dx ? 0 : Math.PI / 2;
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

/** The point `r` from `from` towards `to` (distinct points). */
const towards = (from: Vec2, to: Vec2, r: number): Vec2 =>
  add(from, scale(unitOf(sub(to, from))!, r));

/**
 * The dimension `p` makes with its dimension line (or arc, or text) at `at`; undefined where it
 * makes none (zero-length, parallel lines).
 */
export function placeDimension(p: DimPlacement, at: Vec2): DimensionGeometry | undefined {
  const fields = { ...p.base, textPosition: at };
  switch (p.kind) {
    case 'linear':
    case 'aligned': {
      const circle = p.kind === 'linear' ? p.circle : undefined;
      const rotation =
        p.kind !== 'linear'
          ? undefined
          : (p.rotation ??
            (circle
              ? circleRotation(circle.center, circle.radius, circle.vertical, at)
              : linearRotation(p.first, p.second, at)));
      const u = rotation !== undefined ? fromAngle(rotation) : unitOf(sub(p.second, p.first));
      const [first, second] = circle
        ? [
            sub(circle.center, scale(u!, circle.radius)),
            add(circle.center, scale(u!, circle.radius)),
          ]
        : [p.first, p.second];
      if (!u || distance(first, second) === 0) return undefined;
      // DXF 10: on the dimension line through `at`, at the second extension line.
      const definitionPoint = add(at, scale(u, dot(sub(second, at), u)));
      return {
        kind: 'DIMENSION',
        ...fields,
        dimType: p.kind,
        first,
        second,
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
      // Inside the angle running counter-clockwise from the first end to the second, or not.
      const a0 = angleOf(sub(p.first, p.vertex));
      const sweep = normalizeAngle(angleOf(sub(p.second, p.vertex)) - a0);
      const side = (q: Vec2) => normalizeAngle(angleOf(sub(q, p.vertex)) - a0) <= sweep;
      const q = p.quadrant;
      const locked = q !== undefined && distance(q, p.vertex) > 0 && side(q) !== side(at);
      return {
        kind: 'DIMENSION',
        ...fields,
        ...(locked && { textUserPositioned: true }),
        dimType: 'angular3pt',
        vertex: p.vertex,
        first: p.first,
        second: p.second,
        definitionPoint: locked ? towards(p.vertex, q, distance(at, p.vertex)) : at,
      };
    }
    case 'angular': {
      const [a, b] = p.line1;
      const [c, d] = p.line2;
      const centre = meet(a, sub(b, a), c, sub(d, c));
      if (!centre || distance(at, centre) === 0) return undefined;
      // The two lines through the centre part the plane into four angles; the sides of each
      // line a point is on say which of them it is in.
      const wedge = (pt: Vec2) =>
        `${Math.sign(cross(sub(b, a), sub(pt, centre)))}${Math.sign(cross(sub(d, c), sub(pt, centre)))}`;
      const q = p.quadrant;
      const locked = q !== undefined && distance(q, centre) > 0 && wedge(q) !== wedge(at);
      return {
        kind: 'DIMENSION',
        ...fields,
        ...(locked && { textUserPositioned: true }),
        dimType: 'angular',
        line1Start: a,
        line1End: b,
        line2Start: c,
        definitionPoint: d,
        arcPoint: locked ? towards(centre, q, distance(at, centre)) : at,
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

type Angular2 = Extract<DimensionGeometry, { dimType: 'angular' }>;
type Angular3 = Extract<DimensionGeometry, { dimType: 'angular3pt' }>;

/**
 * A two-line angular dimension as the three-point one measuring the same angle (M2-31): the
 * lines' meeting point its vertex, its ends where the angle's sides leave the lines (each
 * line's end furthest along its side), its arc point kept. DIMCONTINUE and DIMBASELINE go on
 * from it as from a three-point one; undefined for parallel lines.
 */
export function angularAsThreePoint(g: Angular2): Angular3 | undefined {
  const u = unitOf(sub(g.line1End, g.line1Start));
  const v = unitOf(sub(g.definitionPoint, g.line2Start));
  if (!u || !v) return undefined;
  const c = meet(g.line1Start, u, g.line2Start, v);
  if (!c) return undefined;
  // The arc point is α·u + β·v from the centre: the signs say which sides the angle has.
  const p = sub(g.arcPoint, c);
  const den = cross(u, v);
  const a = cross(p, v) / den < 0 ? scale(u, -1) : u;
  const b = cross(u, p) / den < 0 ? scale(v, -1) : v;
  const r = length(p);
  const end = (dir: Vec2, s: Vec2, e: Vec2) => {
    const t = Math.max(dot(sub(s, c), dir), dot(sub(e, c), dir));
    return add(c, scale(dir, t > 0 ? t : r));
  };
  const { line1Start: _1, line1End: _2, line2Start: _3, arcPoint: _4, ...fields } = g;
  return {
    ...fields,
    dimType: 'angular3pt',
    vertex: c,
    first: end(a, g.line1Start, g.line1End),
    second: end(b, g.line2Start, g.definitionPoint),
    definitionPoint: g.arcPoint,
  };
}

/** DIMVARs AutoCAD no longer uses: DIMFIT (now DIMATFIT, DIMTMOVE), DIMUNIT (DIMLUNIT, DIMFRAC). */
const OBSOLETE = new Set(['DIMFIT', 'DIMUNIT']);

/** The records a DIMVAR naming one (DXF 340–347) names, and whether ByBlock is its default. */
function namedRecords(
  model: DocumentModel,
  code: number,
): { records: readonly { handle: Handle; name: string }[]; byBlock: boolean } | undefined {
  if (code === 340) return { records: [...model.tables.textStyles.values()], byBlock: false };
  if (code >= 341 && code <= 344) return { records: [...model.blocks.values()], byBlock: false };
  if (code >= 345 && code <= 347) {
    return { records: [...model.tables.linetypes.values()], byBlock: true };
  }
  return undefined;
}

/**
 * What the header's DIMVAR `name` (DXF code `code`) overrides the style's `styled` with;
 * undefined when it says the same, or when what it says cannot be told apart from the style.
 */
function headerOverride(
  model: DocumentModel,
  code: number,
  name: string,
  header: string | number | boolean,
  styled: DimVarValue | undefined,
): DimVarValue | undefined {
  const named = namedRecords(model, code);
  if (named) {
    // The header names the record (DXF writes the name); the style holds its handle. No name,
    // or ByBlock for a linetype, is the default a style states by holding none.
    const key = (n: string) => {
      const k = n.toUpperCase();
      return named.byBlock && k === 'BYBLOCK' ? '' : k;
    };
    if (typeof header !== 'string') return undefined;
    const wanted = key(header);
    const held =
      styled === undefined || styled === '' || styled === '0'
        ? ''
        : named.records.find((r) => r.handle === styled)?.name;
    if (held === undefined || key(held) === wanted || wanted === '') return undefined;
    return named.records.find((r) => key(r.name) === wanted)?.handle;
  }
  if (styled === undefined) return undefined;
  if (name === 'DIMDSEP') {
    // The header holds the separator's character code, a style its character.
    const char = (v: DimVarValue) => (typeof v === 'number' ? String.fromCharCode(v) : String(v));
    return char(header) === char(styled) ? undefined : char(header).charCodeAt(0);
  }
  if (typeof header === 'string' || typeof styled === 'string') {
    return String(header) === String(styled) ? undefined : String(header);
  }
  const h = Number(header);
  const v = Number(styled);
  // Equal as DXF's 16 significant digits carry them.
  return Math.abs(h - v) <= 1e-12 * Math.max(1, Math.abs(h)) ? undefined : h;
}

/**
 * A new dimension's `DSTYLE` overrides (M2-31): the DIMVARs the drawing's header sets other
 * than its current style, as AutoCAD gives a dimension made while DIMVARs are set without
 * saving them to a style ("<style overrides>"; AutoCAD 2024 Help, "About Overriding Dimension
 * Styles"). Only when the header's `$DIMSTYLE` is that style: what the header says of another
 * style says nothing of this one. Undefined when nothing differs, or when the drawing has no
 * ACAD application to file overrides under.
 */
export function headerDimensionXdata(
  model: DocumentModel,
  style: DimStyleRecord,
): Xdata | undefined {
  const current = model.header.get('$DIMSTYLE');
  if (typeof current !== 'string' || current.toUpperCase() !== style.name.toUpperCase()) {
    return undefined;
  }
  let e: { readonly xdata?: Xdata } = {};
  for (const [code, name] of Object.entries(DIMVAR_BY_CODE)) {
    if (OBSOLETE.has(name)) continue;
    const header = model.header.get(`$${name}`);
    if (header === undefined || typeof header === 'object') continue;
    const value = headerOverride(model, Number(code), name, header, style.vars[name]);
    if (value === undefined) continue;
    const xdata = withDimvarOverride(e, style.handle, model, name, value);
    if (xdata === 'no-acad') return undefined;
    e = xdata === undefined ? {} : { xdata };
  }
  return e.xdata;
}
