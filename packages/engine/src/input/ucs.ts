// The user coordinate system in plan (M3-06 part 7, 2D only). AutoCAD 2024 Help, "UCS (Command)",
// "UCSORG", "UCSXDIR", "UCSYDIR", "UCSNAME": the current UCS of model space is the header's
// $UCSORG, $UCSXDIR, $UCSYDIR and $UCSNAME (paper space's the $PUCS* ones), and typed coordinates,
// angles, ORTHO, the grid and snap follow it. Triya draws in plan (PRD: 2D), so a UCS here is an
// origin and the angle of its X axis in the world XY plane, its Z axis the world's. A UCS whose XY
// plane is not the world's (a 3D UCS a file brings, whose Z axis is not world +Z) cannot be drawn
// in plan: input then reads as in the WCS, and the file keeps the UCS as it was.
import type { HeaderValue, ViewportGeometry } from '../model/types';
import type { Vec2, Vec3 } from '../geom/types';

export interface PlanUcs {
  readonly origin: Vec2;
  /** The X axis's angle, radians counter-clockwise from world +X. */
  readonly angle: number;
}

export const WORLD_UCS: PlanUcs = { origin: { x: 0, y: 0 }, angle: 0 };

/** The header variables a space's current UCS is kept in. */
export const UCS_VARIABLES = {
  model: { origin: '$UCSORG', xAxis: '$UCSXDIR', yAxis: '$UCSYDIR', name: '$UCSNAME' },
  paper: { origin: '$PUCSORG', xAxis: '$PUCSXDIR', yAxis: '$PUCSYDIR', name: '$PUCSNAME' },
} as const;

const TAU = 2 * Math.PI;
const EPS = 1e-9;

const norm = (a: number): number => {
  const r = ((a % TAU) + TAU) % TAU;
  return TAU - r < EPS ? 0 : r;
};

/** A unit vector at `a`, exact on the axes (no stray 1e-17 for 90°). */
export function unitAt(a: number): Vec2 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: Math.abs(c) < 1e-15 ? 0 : c, y: Math.abs(s) < 1e-15 ? 0 : s };
}

const vec3 = (v: HeaderValue | undefined): Vec3 | undefined =>
  typeof v === 'object' && v !== null ? { x: v.x, y: v.y, z: 'z' in v ? v.z : 0 } : undefined;

/**
 * The UCS whose origin and axes are given, in plan; undefined when its XY plane is not the
 * world's (Z not world +Z), which Triya cannot draw in.
 */
export function planUcs(origin: Vec3, xAxis: Vec3, yAxis: Vec3): PlanUcs | undefined {
  const xl = Math.hypot(xAxis.x, xAxis.y, xAxis.z);
  const yl = Math.hypot(yAxis.x, yAxis.y, yAxis.z);
  if (!(xl > EPS && yl > EPS)) return undefined;
  // Z = X × Y must be world +Z: both axes in the XY plane, Y counter-clockwise from X.
  const z = (xAxis.x * yAxis.y - xAxis.y * yAxis.x) / (xl * yl);
  if (Math.abs(xAxis.z) / xl > 1e-6 || Math.abs(yAxis.z) / yl > 1e-6 || z < 1 - 1e-6)
    return undefined;
  return { origin: { x: origin.x, y: origin.y }, angle: norm(Math.atan2(xAxis.y, xAxis.x)) };
}

/** The current UCS of model space (or paper space) as the header keeps it; the WCS without one. */
export function ucsOf(header: ReadonlyMap<string, unknown>, paper = false): PlanUcs {
  const names = paper ? UCS_VARIABLES.paper : UCS_VARIABLES.model;
  const get = (n: string) => vec3(header.get(n) as HeaderValue | undefined);
  const origin = get(names.origin);
  const xAxis = get(names.xAxis);
  const yAxis = get(names.yAxis);
  if (!origin || !xAxis || !yAxis) return WORLD_UCS;
  return planUcs(origin, xAxis, yAxis) ?? WORLD_UCS;
}

/**
 * The UCS a layout viewport shows (M3-15; AutoCAD 2024 Help, "UCSVP"): its own, kept in it
 * (DXF 110/111/112), while its UCSVP is 1 (DXF 71), else model space's current UCS `current`,
 * which a viewport with UCSVP 0 follows. Its own reads as the WCS when it is not in plan. What the
 * viewport's UCS icon shows, and what typed input will read in it once a viewport can be made
 * current (MSPACE, M6-02).
 */
export function viewportUcs(vp: ViewportGeometry, current: PlanUcs): PlanUcs {
  if (!vp.ucsPerViewport) return current;
  const u = vp.ucs;
  return (u && planUcs(u.origin, u.xAxis, u.yAxis)) ?? WORLD_UCS;
}

export const isWorld = (u: PlanUcs): boolean =>
  u.angle === 0 && u.origin.x === 0 && u.origin.y === 0;

/** A UCS point in world coordinates. */
export function toWorld(u: PlanUcs, p: Vec2): Vec2 {
  if (isWorld(u)) return p;
  const v = turnToWorld(u, p);
  return { x: clean(u.origin.x + v.x), y: clean(u.origin.y + v.y) };
}

/** A world point in the UCS's coordinates. */
export function toUcs(u: PlanUcs, p: Vec2): Vec2 {
  if (isWorld(u)) return p;
  return turnToUcs(u, { x: p.x - u.origin.x, y: p.y - u.origin.y });
}

/** A displacement along the UCS's axes as a world one. */
export function turnToWorld(u: PlanUcs, v: Vec2): Vec2 {
  if (u.angle === 0) return v;
  const { x: c, y: s } = unitAt(u.angle);
  return { x: clean(v.x * c - v.y * s), y: clean(v.x * s + v.y * c) };
}

/** A world displacement along the UCS's axes. */
export function turnToUcs(u: PlanUcs, v: Vec2): Vec2 {
  if (u.angle === 0) return v;
  const { x: c, y: s } = unitAt(u.angle);
  return { x: clean(v.x * c + v.y * s), y: clean(-v.x * s + v.y * c) };
}

// 15 significant digits, as `snapToGrid` rounds: a point typed in a UCS turned by 90° lands on
// the whole numbers it names, not 1e-16 beside them.
const clean = (v: number): number => (Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(15));

/** The UCS's origin and axes as the header and the VPORT keep them (Z 0, Z axis world +Z). */
export function ucsAxes(u: PlanUcs): { origin: Vec3; xAxis: Vec3; yAxis: Vec3 } {
  const x = unitAt(u.angle);
  return {
    origin: { x: u.origin.x, y: u.origin.y, z: 0 },
    xAxis: { x: x.x, y: x.y, z: 0 },
    yAxis: { x: -x.y, y: x.x, z: 0 },
  };
}

/** The header entries that make `u` the space's current UCS, named `name` ('' unnamed). */
export function ucsHeaderEntries(u: PlanUcs, name: string, paper = false): [string, HeaderValue][] {
  const names = paper ? UCS_VARIABLES.paper : UCS_VARIABLES.model;
  const a = ucsAxes(u);
  return [
    [names.origin, a.origin],
    [names.xAxis, a.xAxis],
    [names.yAxis, a.yAxis],
    [names.name, name],
  ];
}

export const sameUcs = (a: PlanUcs, b: PlanUcs): boolean =>
  Math.abs(norm(a.angle - b.angle + Math.PI) - Math.PI) < EPS &&
  Math.abs(a.origin.x - b.origin.x) < EPS &&
  Math.abs(a.origin.y - b.origin.y) < EPS;

/** Normalised to [0, 2π). */
export const normAngle = norm;
