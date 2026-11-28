// A flange drawn as 2D geometry (M8-01): its front (face) view, its side view (elevation) and a
// section on its axis, at a scale from the table's inches to drawing units.
//
// Placement: the base point is the centre of the gasket face (a raised face's top, a lap joint
// flange's front), where a flange mates with its pair or a nozzle neck's drawing. The side view
// and the section lie along +X, from the face at x = 0 to the hub's end; the front view looks
// at the face. Bolt holes straddle the centre lines, as B16.5 places them (no hole on a centre
// line), and the section shows two of them turned into the cutting plane on the bolt circle,
// as ASME Y14.3 draws aligned features in a section.
import type { EntityGeometry, HatchGeometry, PolylineVertex, Vec2 } from '@triya/engine';
import type { FlangeDimensions } from './b16-5';

export const FLANGE_VIEWS = ['front', 'side', 'section'] as const;
export type FlangeView = (typeof FLANGE_VIEWS)[number];

/**
 * What a part is drawn as: an outline, a hidden edge (HIDDEN linetype), a centre line (CENTER
 * linetype) or the section's hatch.
 */
export type PartRole = 'visible' | 'hidden' | 'center' | 'hatch';

export interface LibraryPart {
  readonly role: PartRole;
  readonly geom: EntityGeometry;
}

/** A corner of the flange's half profile: x along the axis from the face, y from the axis. */
type Corner = PolylineVertex;

const corner = (x: number, y: number, bulge = 0): Corner => ({ x, y, bulge });

/**
 * The flange's half profile above the axis: `outer` from the face out round the ring and hub
 * to the hub's end; `inner` (the bore, socket, thread or lap radius) from the hub's end back to
 * the face, empty for a blind flange.
 */
function halfProfile(d: FlangeDimensions): { outer: Corner[]; inner: Corner[] } {
  const h = d.raisedFace?.height ?? 0;
  const t = d.thickness;
  const back = h + t;
  const outer: Corner[] = [];
  if (d.raisedFace)
    outer.push(corner(0, d.raisedFace.diameter / 2), corner(h, d.raisedFace.diameter / 2));
  outer.push(corner(h, d.outsideDiameter / 2), corner(back, d.outsideDiameter / 2));
  const end = d.hub ? h + d.hub.length : back;
  if (d.hub) outer.push(corner(back, d.hub.baseDiameter / 2), corner(end, d.hub.endDiameter / 2));
  if (d.bore === undefined) return { outer, inner: [] };
  const b = d.bore / 2;
  if (d.socket) {
    const s = d.socket.diameter / 2;
    const bottom = end - d.socket.depth;
    return { outer, inner: [corner(end, s), corner(bottom, s), corner(bottom, b), corner(0, b)] };
  }
  if (d.thread) {
    // The counterbore as a 45° countersink from Q at the face down to the thread.
    const q = d.thread.counterbore / 2;
    return { outer, inner: [corner(end, b), corner(q - b, b), corner(0, q)] };
  }
  if (d.lapRadius) {
    // The bore's front corner rounded (a quarter arc, clockwise from the bore to the face).
    const r = d.lapRadius;
    return {
      outer,
      inner: [corner(end, b), corner(r, b, -Math.tan(Math.PI / 8)), corner(0, b + r)],
    };
  }
  return { outer, inner: [corner(end, b), corner(0, b)] };
}

/** The corners mirrored below the axis, in reverse order (so the path runs on round). */
function mirrored(corners: readonly Corner[]): Corner[] {
  // Reversed, each arc's bulge moves to the corner before it and turns the other way; mirrored,
  // it turns back. The first corner takes the closing segment's (the last corner's) bulge.
  return corners.map((c, i) => ({ x: c.x, y: -c.y, bulge: corners.at(i - 1)!.bulge })).reverse();
}

const closed = (vertices: readonly Corner[]): EntityGeometry => ({
  kind: 'LWPOLYLINE',
  vertices,
  closed: true,
});

const open = (vertices: readonly Corner[]): EntityGeometry => ({
  kind: 'LWPOLYLINE',
  vertices,
  closed: false,
});

const line = (a: Vec2, b: Vec2): EntityGeometry => ({ kind: 'LINE', start: a, end: b });

const circle = (r: number, center: Vec2 = { x: 0, y: 0 }): EntityGeometry => ({
  kind: 'CIRCLE',
  center,
  radius: r,
});

/** Lines across the axis at x, ±y, one per x (the largest y), for y > 0. */
function crossLines(at: readonly Corner[]): EntityGeometry[] {
  const byX = new Map<number, number>();
  for (const c of at) if (c.y > 0) byX.set(c.x, Math.max(byX.get(c.x) ?? 0, c.y));
  return [...byX].map(([x, y]) => line({ x, y: -y }, { x, y }));
}

/** The bolt holes' angles: n holes straddling the centre lines. */
function holeAngles(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (Math.PI * (2 * i + 1)) / count);
}

/** How far centre lines run past the outline. */
const overrun = (d: FlangeDimensions) => d.outsideDiameter / 16;

function front(d: FlangeDimensions): LibraryPart[] {
  const parts: LibraryPart[] = [{ role: 'visible', geom: circle(d.outsideDiameter / 2) }];
  if (d.raisedFace) parts.push({ role: 'visible', geom: circle(d.raisedFace.diameter / 2) });
  // The bore as the face shows it: going in from the face, an edge no wider than every edge
  // before it is seen; a wider one (a socket behind the bore) is hidden.
  const { inner } = halfProfile(d);
  let narrowest = Infinity;
  const seen = new Map<number, PartRole>();
  for (const c of [...inner].reverse()) {
    if (seen.has(c.y)) continue;
    seen.set(c.y, c.y <= narrowest ? 'visible' : 'hidden');
    narrowest = Math.min(narrowest, c.y);
  }
  for (const [r, role] of seen) parts.push({ role, geom: circle(r) });
  const { count, holeDiameter, circleDiameter } = d.bolting;
  for (const a of holeAngles(count)) {
    const at = { x: (circleDiameter / 2) * Math.cos(a), y: (circleDiameter / 2) * Math.sin(a) };
    parts.push({ role: 'visible', geom: circle(holeDiameter / 2, at) });
  }
  parts.push({ role: 'center', geom: circle(circleDiameter / 2) });
  const e = d.outsideDiameter / 2 + overrun(d);
  parts.push(
    { role: 'center', geom: line({ x: -e, y: 0 }, { x: e, y: 0 }) },
    { role: 'center', geom: line({ x: 0, y: -e }, { x: 0, y: e }) },
  );
  return parts;
}

/** The ring's front and back along the axis, where the bolt holes run. */
function ring(d: FlangeDimensions): [number, number] {
  const h = d.raisedFace?.height ?? 0;
  return [h, h + d.thickness];
}

function axis(d: FlangeDimensions, outer: readonly Corner[]): LibraryPart {
  const m = overrun(d);
  const end = outer[outer.length - 1]!.x;
  return { role: 'center', geom: line({ x: -m, y: 0 }, { x: end + m, y: 0 }) };
}

function side(d: FlangeDimensions): LibraryPart[] {
  const { outer, inner } = halfProfile(d);
  const parts: LibraryPart[] = [{ role: 'visible', geom: closed([...outer, ...mirrored(outer)]) }];
  // Where the outline steps (raised face to ring, ring to hub), the face between is edge on.
  for (let i = 1; i < outer.length; i++) {
    const [a, b] = [outer[i - 1]!, outer[i]!];
    const y = Math.min(a.y, b.y);
    if (a.x === b.x) parts.push({ role: 'visible', geom: line({ x: a.x, y: -y }, { x: a.x, y }) });
  }
  if (inner.length > 0) {
    parts.push(
      { role: 'hidden', geom: open(inner) },
      { role: 'hidden', geom: open(mirrored(inner)) },
    );
    for (const g of crossLines(inner.slice(1, -1))) parts.push({ role: 'hidden', geom: g });
  }
  const [x0, x1] = ring(d);
  const { count, holeDiameter, circleDiameter } = d.bolting;
  const across = new Set(holeAngles(count).map((a) => round((circleDiameter / 2) * Math.sin(a))));
  for (const y of [...across].sort((p, q) => p - q)) {
    for (const edge of [y - holeDiameter / 2, y + holeDiameter / 2]) {
      parts.push({ role: 'hidden', geom: line({ x: x0, y: edge }, { x: x1, y: edge }) });
    }
  }
  parts.push(axis(d, outer));
  const top = Math.max(...across);
  const m = overrun(d);
  for (const y of [top, -top]) {
    parts.push({ role: 'center', geom: line({ x: x0 - m, y }, { x: x1 + m, y }) });
  }
  return parts;
}

/** Twelve decimals: hole positions that agree but for rounding are one. */
const round = (v: number) => Math.round(v * 1e12) / 1e12;

function section(d: FlangeDimensions): LibraryPart[] {
  const { outer, inner } = halfProfile(d);
  const [x0, x1] = ring(d);
  const holeIn = (d.bolting.circleDiameter - d.bolting.holeDiameter) / 2;
  const holeOut = (d.bolting.circleDiameter + d.bolting.holeDiameter) / 2;
  const o = d.outsideDiameter / 2;
  // The ring cut through the hole: the metal inside the hole (with the face and hub) and the
  // rim outside it.
  const within = outer.map((c) => (c.y === o ? { ...c, y: holeIn } : c));
  const rim = [corner(x0, holeOut), corner(x0, o), corner(x1, o), corner(x1, holeOut)];
  const loops: Corner[][] = [rim, rim.map((c) => ({ ...c, y: -c.y })).reverse()];
  if (inner.length === 0) loops.push([...within, ...mirrored(within)]);
  else loops.push([...within, ...inner], mirrored([...within, ...inner]));
  const parts: LibraryPart[] = loops.map((l) => ({ role: 'visible', geom: closed(l) }));
  // Beyond the cut, the bore's edges and steps are seen edge on across the axis.
  for (const g of crossLines(inner)) parts.push({ role: 'visible', geom: g });
  parts.push({ role: 'hatch', geom: hatch(loops, d.outsideDiameter / 40) });
  parts.push(axis(d, outer));
  const m = overrun(d);
  for (const y of [d.bolting.circleDiameter / 2, -d.bolting.circleDiameter / 2]) {
    parts.push({ role: 'center', geom: line({ x: x0 - m, y }, { x: x1 + m, y }) });
  }
  return parts;
}

/** A user-defined hatch of lines at 45°, `spacing` apart, over the loops (DXF 76 = 0). */
function hatch(loops: readonly Corner[][], spacing: number): HatchGeometry {
  const angle = Math.PI / 4;
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

/** Scales a part's geometry from inches by `s` (about the base point). */
function scaled(g: EntityGeometry, s: number): EntityGeometry {
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

/**
 * Flange `d` drawn as `view`, scaled from the table's inches by `scale` (25.4 for a drawing in
 * millimetres).
 */
export function flangeParts(d: FlangeDimensions, view: FlangeView, scale = 1): LibraryPart[] {
  const parts = view === 'front' ? front(d) : view === 'side' ? side(d) : section(d);
  return scale === 1 ? parts : parts.map((part) => ({ ...part, geom: scaled(part.geom, scale) }));
}
