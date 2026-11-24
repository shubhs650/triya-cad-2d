// A selected dimensional constraint's grips (M9-03 part 11). AutoCAD 2024 Help, "To Change the
// Value of a Dimensional Constraint": select the constraint, "click a triangular grip" and drag
// it, and the value and the geometry it drives follow; "About Applying Dimensional
// Constraints": the square grip moves its text and dimension line. The triangles sit where the
// dimension line or arc ends, pointing outward (a radius's where its leader meets the curve,
// a diameter's at both ends); the square at the text.
//
// The Help does not say which object a triangle moves. Triya moves the object at its side: the
// one at the second object's end sets the value as a value typed does (the second object
// adjusts), the one at the first's holds the second and lets the first adjust
// (`ConstraintSolver.setExpression`'s side). A radius has one side, its centre held.
//
// It does not say either what a triangle does to a reference constraint, which measures, or to
// a value that is an expression of other parameters (dragging would throw the expression
// away): Triya shows those only the square grip.
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { DimensionalConstraintObject } from '../model/types';
import { drawingUnits } from '../commands/units';
import { constraintDisplay, type ConstraintDisplay } from './constraint-display';
import { dimensionalConstraints } from './constraints';

/**
 * What a constraint grip does: `first` and `second` set the value from that object's side (a
 * triangle), `location` moves the text and dimension line (the square).
 */
export type ConstraintGripRole = 'first' | 'second' | 'location';

export interface ConstraintGrip {
  readonly point: Vec2;
  readonly role: ConstraintGripRole;
  /** A triangle's direction, a unit vector; the square has none. */
  readonly towards?: Vec2;
}

/** A plain number, as a value dragged or typed is kept (constraint-display.ts's test). */
const PLAIN_NUMBER = /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;

/** Whether the constraint's value can be dragged: a driving one holding a plain number. */
export function settableByGrip(c: DimensionalConstraintObject): boolean {
  return !c.reference && PLAIN_NUMBER.test(c.expression);
}

function placed(
  model: DocumentModel,
  handle: string,
): { c: DimensionalConstraintObject; d: ConstraintDisplay } | undefined {
  const c = dimensionalConstraints(model).find((x) => x.handle === handle);
  if (!c) return undefined;
  const lookup = (h: string) => model.entityByHandle(h);
  const d = constraintDisplay(c, lookup, drawingUnits(model.header), 2);
  return d && { c, d };
}

const unit = (v: Vec2): Vec2 | undefined => {
  const l = Math.hypot(v.x, v.y);
  return l === 0 ? undefined : { x: v.x / l, y: v.y / l };
};
const at = (c: Vec2, r: number, a: number): Vec2 => ({
  x: c.x + r * Math.cos(a),
  y: c.y + r * Math.sin(a),
});

/** The grips constraint `handle` shows when selected; none when it does not show. */
export function constraintGripsOf(model: DocumentModel, handle: string): ConstraintGrip[] {
  const p = placed(model, handle);
  if (!p) return [];
  const { c, d } = p;
  const square: ConstraintGrip = { point: d.textAt, role: 'location' };
  if (!settableByGrip(c)) return [square];
  const s = d.shape;
  switch (s.kind) {
    case 'linear': {
      const out = unit({ x: s.db.x - s.da.x, y: s.db.y - s.da.y });
      if (!out) return [square];
      return [
        { point: s.da, role: 'first', towards: { x: -out.x, y: -out.y } },
        { point: s.db, role: 'second', towards: out },
        square,
      ];
    }
    case 'angular': {
      const e = s.start + s.sweep;
      return [
        {
          point: at(s.center, s.radius, s.start),
          role: s.firstAtStart ? 'first' : 'second',
          towards: { x: Math.sin(s.start), y: -Math.cos(s.start) },
        },
        {
          point: at(s.center, s.radius, e),
          role: s.firstAtStart ? 'second' : 'first',
          towards: { x: -Math.sin(e), y: Math.cos(e) },
        },
        square,
      ];
    }
    case 'radial': {
      const u = { x: Math.cos(s.angle), y: Math.sin(s.angle) };
      const ends: ConstraintGrip[] = [
        { point: at(s.center, s.radius, s.angle), role: 'second', towards: u },
      ];
      if (s.diameter) {
        ends.push({
          point: at(s.center, -s.radius, s.angle),
          role: 'second',
          towards: { x: -u.x, y: -u.y },
        });
      }
      return [...ends, square];
    }
  }
}

/** The grip of the constraints `handles` nearest `p` within `within`, if any. */
export function constraintGripAt(
  model: DocumentModel,
  handles: readonly string[],
  p: Vec2,
  within: number,
): { readonly handle: string; readonly grip: ConstraintGrip } | undefined {
  let best: { handle: string; grip: ConstraintGrip } | undefined;
  let reach = within;
  for (const handle of handles) {
    for (const grip of constraintGripsOf(model, handle)) {
      const d = Math.hypot(grip.point.x - p.x, grip.point.y - p.y);
      if (d > reach) continue;
      best = { handle, grip };
      reach = d;
    }
  }
  return best;
}

/** `a` turned into [0, 2π). */
const ccw = (a: number): number => {
  const t = a % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
};

/**
 * The value a triangular grip of constraint `handle` dragged to `to` sets: a distance measured
 * along the dimension line from its other end (negative past it), an angle in degrees
 * counter-clockwise from the arc's other end, a radius (a diameter twice it) from the centre.
 * Undefined for the square grip, or a constraint gone.
 */
export function constraintGripValue(
  model: DocumentModel,
  handle: string,
  grip: ConstraintGrip,
  to: Vec2,
): number | undefined {
  if (grip.role === 'location') return undefined;
  const p = placed(model, handle);
  if (!p) return undefined;
  const s = p.d.shape;
  switch (s.kind) {
    case 'linear': {
      const dir = unit({ x: s.db.x - s.da.x, y: s.db.y - s.da.y });
      if (!dir) return undefined;
      const from = grip.role === 'second' ? s.da : s.db;
      const along = (to.x - from.x) * dir.x + (to.y - from.y) * dir.y;
      return grip.role === 'second' ? along : -along;
    }
    case 'angular': {
      const theta = Math.atan2(to.y - s.center.y, to.x - s.center.x);
      const atStart = (grip.role === 'first') === s.firstAtStart;
      const sweep = atStart ? ccw(s.start + s.sweep - theta) : ccw(theta - s.start);
      return (sweep * 180) / Math.PI;
    }
    case 'radial': {
      const r = Math.hypot(to.x - s.center.x, to.y - s.center.y);
      return s.diameter ? 2 * r : r;
    }
  }
}

/** Where constraint `handle`'s location goes when its square grip is dragged to `to`. */
export function movedConstraintLocation(
  model: DocumentModel,
  handle: string,
  grip: ConstraintGrip,
  to: Vec2,
): Vec2 | undefined {
  const c = dimensionalConstraints(model).find((x) => x.handle === handle);
  if (!c) return undefined;
  return {
    x: c.location.x + to.x - grip.point.x,
    y: c.location.y + to.y - grip.point.y,
  };
}
