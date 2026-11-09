// Length and area of a bulged polyline, as the Properties palette shows them (M2-21). AutoCAD
// measures an open polyline's area as if a straight segment closed it (AREA Object does too).
import type { Polyline } from '../geom/curves';

interface Segment {
  readonly chord: number;
  /** Included angle, signed (> 0 counter-clockwise); 0 straight. */
  readonly theta: number;
}

function segments(p: Polyline, closing: boolean): Segment[] {
  const v = p.vertices;
  const n = v.length;
  const out: Segment[] = [];
  const count = closing ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = v[i]!;
    const b = v[(i + 1) % n]!;
    out.push({ chord: Math.hypot(b.x - a.x, b.y - a.y), theta: 4 * Math.atan(a.bulge) });
  }
  return out;
}

const arcLength = (s: Segment): number =>
  s.theta === 0 || s.chord === 0
    ? s.chord
    : (s.chord / (2 * Math.sin(Math.abs(s.theta) / 2))) * Math.abs(s.theta);

export function polylineLength(p: Polyline): number {
  if (p.vertices.length < 2) return 0;
  return segments(p, p.closed).reduce((sum, s) => sum + arcLength(s), 0);
}

export function polylineArea(p: Polyline): number {
  const v = p.vertices;
  const n = v.length;
  if (n < 2) return 0;
  let twice = 0;
  for (let i = 0; i < n; i++) {
    const a = v[i]!;
    const b = v[(i + 1) % n]!;
    twice += a.x * b.y - b.x * a.y;
  }
  let area = twice / 2;
  // Each arc adds (or, bulging inwards, takes away) the circular segment between it and its
  // chord; an open polyline's closing segment is straight whatever its last bulge says.
  for (const s of segments(p, p.closed)) {
    if (s.theta === 0 || s.chord === 0) continue;
    const r = s.chord / (2 * Math.sin(Math.abs(s.theta) / 2));
    const seg = ((r * r) / 2) * (Math.abs(s.theta) - Math.sin(Math.abs(s.theta)));
    area += Math.sign(s.theta) * seg;
  }
  return Math.abs(area);
}
