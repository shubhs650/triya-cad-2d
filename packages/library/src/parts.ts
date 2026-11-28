// The pieces every library generator draws with (M8-01, M8-02): parts tagged with what they are
// drawn as, and the few shapes they are made of.
import type { EntityGeometry, HatchGeometry, PolylineVertex, Vec2 } from '@triya/engine';

/**
 * What a part is drawn as: an outline, a hidden edge (HIDDEN linetype), a centre line (CENTER
 * linetype) or a section's hatch.
 */
export type PartRole = 'visible' | 'hidden' | 'center' | 'hatch';

export interface LibraryPart {
  readonly role: PartRole;
  readonly geom: EntityGeometry;
}

/** A polyline corner: x and y, and the bulge of the segment that leaves it. */
export type Corner = PolylineVertex;

export const corner = (x: number, y: number, bulge = 0): Corner => ({ x, y, bulge });

export const closed = (vertices: readonly Corner[]): EntityGeometry => ({
  kind: 'LWPOLYLINE',
  vertices,
  closed: true,
});

export const open = (vertices: readonly Corner[]): EntityGeometry => ({
  kind: 'LWPOLYLINE',
  vertices,
  closed: false,
});

export const line = (a: Vec2, b: Vec2): EntityGeometry => ({ kind: 'LINE', start: a, end: b });

export const circle = (r: number, center: Vec2 = { x: 0, y: 0 }): EntityGeometry => ({
  kind: 'CIRCLE',
  center,
  radius: r,
});

/** The closed rectangle from (x0, y0) to (x1, y1), counter-clockwise. */
export const rect = (x0: number, y0: number, x1: number, y1: number): Corner[] => [
  corner(Math.min(x0, x1), Math.min(y0, y1)),
  corner(Math.max(x0, x1), Math.min(y0, y1)),
  corner(Math.max(x0, x1), Math.max(y0, y1)),
  corner(Math.min(x0, x1), Math.max(y0, y1)),
];

/**
 * A user-defined hatch of lines at `angle` (radians), `spacing` apart, over the loops (DXF 76 =
 * 0): ASME Y14.3's general-use section lining.
 */
export function hatch(
  loops: readonly Corner[][],
  spacing: number,
  angle = Math.PI / 4,
): HatchGeometry {
  return {
    kind: 'HATCH',
    pattern: '_USER',
    solid: false,
    associative: false,
    style: 0,
    patternType: 0,
    patternAngle: angle,
    patternScale: spacing,
    double: false,
    // DXF 92: 1 external, 2 polyline.
    loops: loops.map((vertices) => ({ flags: 3, polyline: { vertices, closed: true } })),
    patternLines: [
      {
        angle,
        base: { x: 0, y: 0 },
        offset: { x: -Math.sin(angle) * spacing, y: Math.cos(angle) * spacing },
        dashes: [],
      },
    ],
    seedPoints: [],
  };
}

/** A solid fill over the loops (a weld's section). */
export function solid(loops: readonly Corner[][]): HatchGeometry {
  return {
    kind: 'HATCH',
    pattern: 'SOLID',
    solid: true,
    associative: false,
    style: 0,
    patternType: 1,
    patternAngle: 0,
    patternScale: 1,
    double: false,
    loops: loops.map((vertices) => ({ flags: 3, polyline: { vertices, closed: true } })),
    patternLines: [],
    seedPoints: [],
  };
}

/** Corners mirrored about the Y axis, in reverse order (so a closed loop keeps its turn). */
export const mirroredX = (corners: readonly Corner[]): Corner[] =>
  corners.map((c, i) => ({ x: -c.x, y: c.y, bulge: corners.at(i - 1)!.bulge })).reverse();

/** Scales a part's geometry by `s` about the base point. */
export function scaled(g: EntityGeometry, s: number): EntityGeometry {
  const p = (v: Vec2): Vec2 => ({ x: v.x * s, y: v.y * s });
  const vs = (v: readonly Corner[]) => v.map((c) => ({ ...c, x: c.x * s, y: c.y * s }));
  switch (g.kind) {
    case 'LINE':
      return { ...g, start: p(g.start), end: p(g.end) };
    case 'CIRCLE':
      return { ...g, center: p(g.center), radius: g.radius * s };
    case 'LWPOLYLINE':
      return { ...g, vertices: vs(g.vertices) };
    case 'HATCH':
      return {
        ...g,
        patternScale: g.patternScale * s,
        loops: g.loops.map((l) => ({
          ...l,
          polyline: { ...l.polyline!, vertices: vs(l.polyline!.vertices) },
        })),
        patternLines: g.patternLines.map((pl) => ({
          ...pl,
          base: p(pl.base),
          offset: p(pl.offset),
        })),
      };
    default:
      return g;
  }
}
