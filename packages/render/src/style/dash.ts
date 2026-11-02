// Fits a linetype pattern to a path the way AutoCAD does, giving explicit dashes, dots and
// embedded text/shape placements in drawing units. The renderer strokes these as solid lines,
// so the result does not depend on any canvas dash API.
//
// AutoCAD ("About Simple Custom Linetypes"): "the application uses the first pattern
// descriptor for the starting and ending dashes. Between the starting and ending dashes, the
// pattern dash specifications are drawn sequentially … The pattern fits the line so that at
// least half of the first dash begins and ends the line. If necessary, the first and last
// dashes are lengthened." "If a line is too short to hold even one dash-dot sequence, a
// continuous line between the endpoints is drawn." Arcs follow the same rule along their
// length. For circles AutoCAD only promises "a reasonable display"; a closed path here is
// fitted like an open one from its start point, and the end and start half-dashes join into
// one dash there (our reading; noted in the PR).

import type { Vec2 } from '@triya/engine';
import type { LinePattern, PatternEmbed } from './pattern';

export interface EmbedPlacement {
  readonly embed: PatternEmbed;
  /** Insertion point, with the `X=`/`Y=` offset applied along and across the path. */
  readonly at: Vec2;
  /** Radians, after the relative, absolute or upright rule. */
  readonly angle: number;
  /** `S=` times the linetype scale; a text renderer multiplies in the style's fixed height. */
  readonly scale: number;
}

export interface DashedPath {
  /** True when the path is drawn continuous (no pattern, too short, or below the LOD limit). */
  readonly solid: boolean;
  /** Pen-down runs, each a polyline. A solid path is one run (closed paths repeat the start). */
  readonly dashes: readonly (readonly Vec2[])[];
  readonly dots: readonly Vec2[];
  readonly embeds: readonly EmbedPlacement[];
  /**
   * The pen-down runs as [start, end] distances along the path (M1-66, for drawing them on a
   * wide polyline). A closed path's joint run is two spans: the one up to its end, then the
   * one from its start. A continuous path is one span from 0 to its length.
   */
  readonly spans: readonly (readonly [number, number])[];
  /** The dots as distances along the path. */
  readonly dotsAt: readonly number[];
}

export interface DashOptions {
  /** Treat the path as closed: the last point joins the first. */
  readonly closed?: boolean;
  /**
   * Screen pixels per drawing unit. A pattern shorter than one pixel draws solid
   * (ARCHITECTURE.md §7.2 LOD: "dashed linetypes below 1 px per pattern unit → solid").
   */
  readonly pixelsPerUnit?: number;
}

/** Applies `pattern`, scaled by `scale` (see `linetypeScale`), to the polyline `points`. */
export function dashPath(
  points: readonly Vec2[],
  pattern: LinePattern,
  scale: number,
  options: DashOptions = {},
): DashedPath {
  const closed = options.closed === true && points.length > 2;
  const path = new Measured(closed ? [...points, points[0]!] : points);
  const L = path.length;
  const lens = pattern.elements.map((e) => e.length * scale);
  const P = lens.reduce((s, v) => s + Math.abs(v), 0);
  const solid = (): DashedPath => ({
    solid: true,
    dashes: [path.points],
    dots: [],
    embeds: [],
    spans: L > 0 ? [[0, L]] : [],
    dotsAt: [],
  });
  if (lens.length === 0 || !(P > 0) || L === 0) return solid();
  if (options.pixelsPerUnit !== undefined && P * options.pixelsPerUnit < 1) return solid();
  const eps = 1e-9 * Math.max(L, P);
  if (L + eps < P) return solid();

  const d0 = Math.max(0, lens[0]!);
  const N = Math.floor((L + eps) / P);
  const r = Math.max(0, L - N * P);
  // Phase of the first full period: its first dash is centred so that half of it, plus half
  // of the leftover length, starts the path.
  const phase = r / 2 - d0 / 2;

  const dashes: Vec2[][] = [];
  const dots: Vec2[] = [];
  const embeds: EmbedPlacement[] = [];
  const spans: [number, number][] = [];
  const dotsAt: number[] = [];
  const dot = (a: number) => {
    dots.push(path.at(a));
    dotsAt.push(a);
  };
  const run = (a: number, b: number) => {
    if (b - a <= eps) return dot(a);
    dashes.push(path.slice(a, b));
    spans.push([a, b]);
  };
  const place = (embed: PatternEmbed, s: number) => embeds.push(path.place(embed, s, scale));

  const startEnd = phase + d0;
  const endStart = phase + N * P;
  if (closed) {
    // The end and start dashes meet at the start point and draw as one.
    if (d0 + r <= eps) dot(0);
    else {
      dashes.push([...path.slice(endStart, L), ...path.slice(0, startEnd).slice(1)]);
      spans.push([endStart, L], [0, startEnd]);
    }
  } else {
    run(0, startEnd);
  }
  for (let k = 0; k < N; k++) {
    let s = phase + k * P;
    if (k > 0) run(s, s + d0);
    s += d0;
    const e0 = pattern.elements[0]!.embed;
    if (e0) place(e0, s);
    for (let j = 1; j < lens.length; j++) {
      const len = lens[j]!;
      const next = s + Math.abs(len);
      if (len >= 0) run(s, next);
      const e = pattern.elements[j]!.embed;
      if (e) place(e, next);
      s = next;
    }
  }
  if (!closed) run(endStart, L);
  return { solid: false, dashes, dots, embeds, spans, dotsAt };
}

/**
 * A polyline's segments with PLINEGEN: on, the pattern runs on through the vertices; off, it
 * is fitted to each segment ("start and end with a dash at each vertex of the polyline").
 * Each segment is the flattened run between two vertices (one chord, or a bulge arc's chords).
 */
export function dashPolyline(
  segments: readonly (readonly Vec2[])[],
  pattern: LinePattern,
  scale: number,
  options: DashOptions & { readonly plinegen: boolean },
): DashedPath {
  if (options.plinegen) {
    const joined: Vec2[] = [];
    for (const seg of segments) joined.push(...(joined.length ? seg.slice(1) : seg));
    // A closed polyline's last segment already returns to the start point.
    if (options.closed && joined.length > 1) joined.pop();
    return dashPath(joined, pattern, scale, options);
  }
  const parts = segments.map((seg) => dashPath(seg, pattern, scale, { ...options, closed: false }));
  // Spans and dots measured along the whole polyline, each segment from where it starts.
  const spans: (readonly [number, number])[] = [];
  const dotsAt: number[] = [];
  let offset = 0;
  parts.forEach((p, i) => {
    for (const [a, b] of p.spans) spans.push([offset + a, offset + b]);
    for (const d of p.dotsAt) dotsAt.push(offset + d);
    offset += new Measured(segments[i]!).length;
  });
  return {
    solid: parts.every((p) => p.solid),
    dashes: parts.flatMap((p) => p.dashes),
    dots: parts.flatMap((p) => p.dots),
    embeds: parts.flatMap((p) => p.embeds),
    spans,
    dotsAt,
  };
}

/** A polyline with cumulative lengths, for positions along it. */
class Measured {
  readonly length: number;
  readonly #cum: number[];

  constructor(readonly points: readonly Vec2[]) {
    this.#cum = [0];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      this.#cum.push(this.#cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
    }
    this.length = this.#cum[this.#cum.length - 1]!;
  }

  /** Index of the segment holding distance `s` (clamped to the path). */
  #segment(s: number): number {
    let lo = 0;
    let hi = this.points.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.#cum[mid]! <= s) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  at(s: number): Vec2 {
    if (this.points.length === 1) return this.points[0]!;
    const i = this.#segment(s);
    const a = this.points[i]!;
    const b = this.points[i + 1]!;
    const len = this.#cum[i + 1]! - this.#cum[i]!;
    const t = len > 0 ? Math.min(1, Math.max(0, (s - this.#cum[i]!) / len)) : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  /** Unit direction at `s`; at a vertex, the direction of the segment that starts there. */
  direction(s: number): Vec2 {
    let i = this.#segment(s);
    // Skip zero-length segments so a repeated vertex still has a direction.
    while (i < this.points.length - 2 && this.#cum[i + 1]! - this.#cum[i]! === 0) i++;
    const a = this.points[i]!;
    const b = this.points[i + 1] ?? a;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return len > 0 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 1, y: 0 };
  }

  /** The points from distance `a` to `b`, with every vertex in between. */
  slice(a: number, b: number): Vec2[] {
    const out = [this.at(a)];
    for (let i = this.#segment(a) + 1; i < this.points.length && this.#cum[i]! < b; i++) {
      if (this.#cum[i]! > a) out.push(this.points[i]!);
    }
    out.push(this.at(b));
    return out;
  }

  place(embed: PatternEmbed, s: number, scale: number): EmbedPlacement {
    const p = this.at(s);
    const d = this.direction(s);
    const ox = embed.offset.x * scale;
    const oy = embed.offset.y * scale;
    const along = Math.atan2(d.y, d.x);
    let angle = embed.rotationMode === 'absolute' ? embed.rotation : along + embed.rotation;
    // Upright: turn half a turn when the text would otherwise read right to left. AutoCAD
    // does not say where the turn pivots; it turns about the insertion point here.
    if (embed.rotationMode === 'upright' && Math.cos(angle) < -1e-12) angle += Math.PI;
    return {
      embed,
      at: { x: p.x + d.x * ox - d.y * oy, y: p.y + d.y * ox + d.x * oy },
      angle: normalize(angle),
      scale: embed.scale * scale,
    };
  }
}

function normalize(a: number): number {
  const t = a % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
}
