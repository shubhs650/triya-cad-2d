// The PlaneGCS solver (FreeCAD, LGPL-2.1+; DEC-018, DEC-080), built to WebAssembly by
// third_party/planegcs/build.sh and loaded on first use as a separate module. This file is
// Triya's typed front to the module's embind interface (third_party/planegcs/bindings/
// sketch.cpp): parameters, the points, lines, circles and arcs built from them, constraints
// by kind with caller-chosen tags, solve, and diagnosis (degrees of freedom, conflicting and
// redundant constraints).
//
// The module never fetches anything: the caller hands over the .wasm bytes (Node reads the
// file, the browser fetches the app's own asset), so this package stays free of DOM and
// network APIs (CLAUDE.md, no DOM in the engine).

/**
 * Constraint kinds, numbered as `ConstraintCode` in sketch.cpp. Append only: the numbers are
 * the module's interface. `ARGS` below lists what each kind takes.
 */
export const ConstraintKind = {
  Coincident: 0,
  PointOnLine: 1,
  PointOnCircle: 2,
  PointOnArc: 3,
  Parallel: 4,
  Perpendicular: 5,
  Horizontal: 6,
  Vertical: 7,
  HorizontalPoints: 8,
  VerticalPoints: 9,
  EqualLength: 10,
  EqualRadiusCC: 11,
  EqualRadiusCA: 12,
  EqualRadiusAA: 13,
  TangentLC: 14,
  TangentLA: 15,
  TangentCC: 16,
  TangentAA: 17,
  TangentCA: 18,
  SymmetricLine: 19,
  SymmetricPoint: 20,
  ArcRules: 21,
  P2PDistance: 22,
  P2LDistance: 23,
  Difference: 24,
  Equal: 25,
  CircleRadius: 26,
  ArcRadius: 27,
  CircleDiameter: 28,
  ArcDiameter: 29,
  L2LAngle: 30,
  CoordinateX: 31,
  CoordinateY: 32,
  MidpointOnLine: 33,
  /**
   * Beware: the overload of `addConstraintP2PAngle` the module calls (the one without an
   * angle increment, FreeCAD 1.1.4 GCS.cpp) ignores its tag and adds the constraint with tag
   * 0, so it cannot be removed or diagnosed by tag. The constraint model uses lines and
   * L2LAngle instead.
   */
  P2PAngle: 34,
  PointOnPerpBisector: 35,
} as const;
export type ConstraintKind = (typeof ConstraintKind)[keyof typeof ConstraintKind];

type Arg = 'point' | 'line' | 'circle' | 'arc' | 'param';

/** What each kind takes, in order (sketch.cpp's comments). */
const ARGS: Record<ConstraintKind, readonly Arg[]> = {
  [ConstraintKind.Coincident]: ['point', 'point'],
  [ConstraintKind.PointOnLine]: ['point', 'line'],
  [ConstraintKind.PointOnCircle]: ['point', 'circle'],
  [ConstraintKind.PointOnArc]: ['point', 'arc'],
  [ConstraintKind.Parallel]: ['line', 'line'],
  [ConstraintKind.Perpendicular]: ['line', 'line'],
  [ConstraintKind.Horizontal]: ['line'],
  [ConstraintKind.Vertical]: ['line'],
  [ConstraintKind.HorizontalPoints]: ['point', 'point'],
  [ConstraintKind.VerticalPoints]: ['point', 'point'],
  [ConstraintKind.EqualLength]: ['line', 'line'],
  [ConstraintKind.EqualRadiusCC]: ['circle', 'circle'],
  [ConstraintKind.EqualRadiusCA]: ['circle', 'arc'],
  [ConstraintKind.EqualRadiusAA]: ['arc', 'arc'],
  [ConstraintKind.TangentLC]: ['line', 'circle'],
  [ConstraintKind.TangentLA]: ['line', 'arc'],
  [ConstraintKind.TangentCC]: ['circle', 'circle'],
  [ConstraintKind.TangentAA]: ['arc', 'arc'],
  [ConstraintKind.TangentCA]: ['circle', 'arc'],
  [ConstraintKind.SymmetricLine]: ['point', 'point', 'line'],
  [ConstraintKind.SymmetricPoint]: ['point', 'point', 'point'],
  [ConstraintKind.ArcRules]: ['arc'],
  [ConstraintKind.P2PDistance]: ['point', 'point', 'param'],
  [ConstraintKind.P2LDistance]: ['point', 'line', 'param'],
  [ConstraintKind.Difference]: ['param', 'param', 'param'],
  [ConstraintKind.Equal]: ['param', 'param'],
  [ConstraintKind.CircleRadius]: ['circle', 'param'],
  [ConstraintKind.ArcRadius]: ['arc', 'param'],
  [ConstraintKind.CircleDiameter]: ['circle', 'param'],
  [ConstraintKind.ArcDiameter]: ['arc', 'param'],
  [ConstraintKind.L2LAngle]: ['line', 'line', 'param'],
  [ConstraintKind.CoordinateX]: ['point', 'param'],
  [ConstraintKind.CoordinateY]: ['point', 'param'],
  [ConstraintKind.MidpointOnLine]: ['line', 'line'],
  [ConstraintKind.P2PAngle]: ['point', 'point', 'param'],
  [ConstraintKind.PointOnPerpBisector]: ['point', 'line'],
};

/** PlaneGCS's `SolveStatus`. Parameters change only on Success or Converged. */
export const SolveStatus = {
  Success: 0,
  Converged: 1,
  Failed: 2,
  SuccessfulSolutionInvalid: 3,
} as const;
export type SolveStatus = (typeof SolveStatus)[keyof typeof SolveStatus];

/** PlaneGCS's solver algorithms; DogLeg is FreeCAD's default and ours. */
export const Algorithm = { BFGS: 0, LevenbergMarquardt: 1, DogLeg: 2 } as const;
export type Algorithm = (typeof Algorithm)[keyof typeof Algorithm];

/**
 * A parameter the solver may change (`unknown`), one it must keep (`fixed`: a Fix
 * constraint, or a driving dimension's value), or one it computes (`driven`: a reference
 * dimension's value).
 */
export type ParamKind = 'unknown' | 'fixed' | 'driven';
const PARAM_KIND: Record<ParamKind, number> = { unknown: 0, fixed: 1, driven: 2 };

export interface Diagnosis {
  /** Degrees of freedom left. */
  dofs: number;
  /** Tags of constraints that contradict each other (the sketch is over-constrained). */
  conflicting: number[];
  /** Tags of constraints the others already imply. */
  redundant: number[];
  /** Tags of constraints only partly implied by the others. */
  partiallyRedundant: number[];
}

export interface CircleIds {
  id: number;
  center: number;
  /** The radius parameter. */
  radius: number;
}

export interface ArcIds extends CircleIds {
  startAngle: number;
  endAngle: number;
  /** The arc's start and end points, kept on it by its ArcRules constraint. */
  start: number;
  end: number;
}

/**
 * The tag of the ArcRules constraint `arc()` adds to each arc. It belongs to the geometry,
 * not to anything the user made, so `diagnose()` leaves it out of its lists.
 */
export const ARC_RULES_TAG = 0x7fffffff;

/** The embind `Sketch` class (sketch.cpp). */
interface NativeSketch {
  addParam(value: number, kind: number): number;
  getParam(i: number): number;
  setParam(i: number, value: number): void;
  setParamKind(i: number, kind: number): void;
  getParams(): number[];
  paramCount(): number;
  addPoint(x: number, y: number): number;
  addLine(p1: number, p2: number): number;
  addCircle(center: number, radius: number): number;
  addArc(
    center: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    start: number,
    end: number,
  ): number;
  addConstraint(code: number, ids: number[], tag: number, driving: boolean): number;
  removeTag(tag: number): void;
  clearConstraints(): void;
  solve(algorithm: number): number;
  diagnose(algorithm: number): number;
  conflicting(): number[];
  redundant(): number[];
  partiallyRedundant(): number[];
  delete(): void;
}

interface NativeModule {
  Sketch: new () => NativeSketch;
}

/** A loaded solver module. */
export interface PlaneGcs {
  sketch(): PlaneGcsSketch;
}

/**
 * One constraint system. Ids are per kind: points, lines, circles, arcs and parameters are
 * each numbered from 0 in the order they were added. Call `dispose()` when done: the
 * system lives in the module's memory.
 */
export class PlaneGcsSketch {
  readonly #native: NativeSketch;
  /** Each point's x and y parameters. */
  readonly #points: [number, number][] = [];
  #lines = 0;
  #circles = 0;
  #arcs = 0;
  #params = 0;
  #constraints = 0;
  /** How many PlaneGCS constraints each tag added (Symmetric adds two). */
  readonly #byTag = new Map<number, number>();
  #disposed = false;

  constructor(native: NativeSketch) {
    this.#native = native;
  }

  /** How many PlaneGCS constraints the system holds (some kinds add two). */
  get constraintCount(): number {
    return this.#constraints;
  }

  param(value: number, kind: ParamKind = 'unknown'): number {
    this.#params = this.#live().addParam(value, PARAM_KIND[kind]) + 1;
    return this.#params - 1;
  }

  value(param: number): number {
    return this.#live().getParam(this.#check('param', param));
  }

  setValue(param: number, value: number): void {
    this.#live().setParam(this.#check('param', param), value);
  }

  setParamKind(param: number, kind: ParamKind): void {
    this.#live().setParamKind(this.#check('param', param), PARAM_KIND[kind]);
  }

  fixParam(param: number): void {
    this.setParamKind(param, 'fixed');
  }

  /** Every parameter's value, by id. */
  values(): number[] {
    return this.#live().getParams();
  }

  point(x: number, y: number): number {
    const px = this.param(x);
    const py = this.param(y);
    this.#points.push([px, py]);
    return this.#live().addPoint(px, py);
  }

  /** A point's x and y parameters (to pin them, or read them in `values()`). */
  pointParams(point: number): readonly [number, number] {
    return this.#points[this.#check('point', point)]!;
  }

  pointAt(point: number): { x: number; y: number } {
    const [px, py] = this.#points[this.#check('point', point)]!;
    return { x: this.value(px), y: this.value(py) };
  }

  /** Fixes a point where it is (AutoCAD's Fix constraint on a point). */
  fix(point: number): void {
    const [px, py] = this.#points[this.#check('point', point)]!;
    this.fixParam(px);
    this.fixParam(py);
  }

  line(p1: number, p2: number): number {
    this.#lines = this.#live().addLine(this.#check('point', p1), this.#check('point', p2)) + 1;
    return this.#lines - 1;
  }

  circle(center: number, radius: number): CircleIds {
    const r = this.param(radius);
    this.#circles = this.#live().addCircle(this.#check('point', center), r) + 1;
    return { id: this.#circles - 1, center, radius: r };
  }

  /**
   * An arc from its centre, radius and angles (radians, counter-clockwise). Its start and
   * end points are added too, or are `ends` when given (a polyline's vertices), and are held
   * on it by an ArcRules constraint (`ARC_RULES_TAG`).
   */
  arc(
    center: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    ends?: { readonly start: number; readonly end: number },
  ): ArcIds {
    const c = this.pointAt(center);
    const start = ends
      ? this.#check('point', ends.start)
      : this.point(c.x + radius * Math.cos(startAngle), c.y + radius * Math.sin(startAngle));
    const end = ends
      ? this.#check('point', ends.end)
      : this.point(c.x + radius * Math.cos(endAngle), c.y + radius * Math.sin(endAngle));
    const r = this.param(radius);
    const a0 = this.param(startAngle);
    const a1 = this.param(endAngle);
    const id = this.#live().addArc(center, r, a0, a1, start, end);
    this.#arcs = id + 1;
    this.constrain(ConstraintKind.ArcRules, [id], ARC_RULES_TAG);
    return { id, center, radius: r, startAngle: a0, endAngle: a1, start, end };
  }

  /**
   * Adds a constraint. `ids` are the point, line, circle, arc or parameter ids the kind
   * takes (`ARGS`); `tag` (>= 1) names it in `diagnose()` and `remove()`. A non-driving
   * constraint computes its value parameter (declare it `driven`) instead of imposing it.
   */
  constrain(
    kind: ConstraintKind,
    ids: readonly number[],
    tag: number,
    options: { driving?: boolean } = {},
  ): void {
    const args = ARGS[kind];
    if (!args) throw new RangeError(`unknown constraint kind ${kind}`);
    if (ids.length !== args.length) {
      throw new RangeError(`constraint kind ${kind} takes ${args.length} ids, got ${ids.length}`);
    }
    if (!Number.isInteger(tag) || tag < 1 || tag > ARC_RULES_TAG) {
      throw new RangeError(`constraint tag ${tag} must be an integer from 1`);
    }
    args.forEach((arg, i) => this.#check(arg, ids[i]!));
    const last = this.#live().addConstraint(kind, [...ids], tag, options.driving ?? true);
    if (last < 0) throw new RangeError(`the solver refused constraint kind ${kind}`);
    this.#byTag.set(tag, (this.#byTag.get(tag) ?? 0) + last + 1 - this.#constraints);
    this.#constraints = last + 1;
  }

  /** Removes every constraint carrying `tag`. */
  remove(tag: number): void {
    this.#live().removeTag(tag);
    this.#constraints -= this.#byTag.get(tag) ?? 0;
    this.#byTag.delete(tag);
  }

  solve(algorithm: Algorithm = Algorithm.DogLeg): SolveStatus {
    return this.#live().solve(algorithm) as SolveStatus;
  }

  /**
   * Degrees of freedom and the constraints in the way. PlaneGCS works from the Jacobian at
   * the current values, so a constraint that other constraints imply shows as redundant
   * only once they hold: diagnose after a successful solve (as FreeCAD's Sketcher does).
   */
  diagnose(algorithm: Algorithm = Algorithm.DogLeg): Diagnosis {
    const native = this.#live();
    const dofs = native.diagnose(algorithm);
    const user = (tags: number[]) =>
      [...new Set(tags)].filter((t) => t !== ARC_RULES_TAG).sort((a, b) => a - b);
    return {
      dofs,
      conflicting: user(native.conflicting()),
      redundant: user(native.redundant()),
      partiallyRedundant: user(native.partiallyRedundant()),
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#native.delete();
  }

  #live(): NativeSketch {
    if (this.#disposed) throw new Error('this sketch was disposed');
    return this.#native;
  }

  #check(arg: Arg, id: number): number {
    const count = {
      point: this.#points.length,
      line: this.#lines,
      circle: this.#circles,
      arc: this.#arcs,
      param: this.#params,
    }[arg];
    if (!Number.isInteger(id) || id < 0 || id >= count) {
      throw new RangeError(`there is no ${arg} ${id} in this sketch`);
    }
    return id;
  }
}

/** The module's .wasm bytes: Node reads the file, the browser fetches the app's asset. */
export type WasmSource = () => Promise<ArrayBuffer | Uint8Array>;

let cached: Promise<PlaneGcs> | undefined;

/**
 * Loads the solver module the first time it is asked for (the glue is a dynamic import, so
 * bundles split it off and nothing is loaded until a sketch needs solving) and reuses it
 * after. A failed load is not kept, so the next call tries again.
 */
export function loadPlaneGcs(
  wasm: WasmSource,
  options: { cache?: boolean } = {},
): Promise<PlaneGcs> {
  const useCache = options.cache ?? true;
  if (useCache && cached) return cached;
  const loading = (async (): Promise<PlaneGcs> => {
    const [{ default: createPlaneGcs }, bytes] = await Promise.all([
      import('../wasm/planegcs.mjs'),
      wasm(),
    ]);
    const native = (await createPlaneGcs({ wasmBinary: bytes })) as NativeModule;
    return { sketch: () => new PlaneGcsSketch(new native.Sketch()) };
  })();
  if (useCache) {
    cached = loading;
    loading.catch(() => {
      if (cached === loading) cached = undefined;
    });
  }
  return loading;
}
