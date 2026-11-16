// What a dimension's records add to its drawing (M4-02 part 4, DEC-064): DIMBREAK's gaps and
// DIMINSPECT's frame, drawn over the parts its type draws.
//
// Breaks (AutoCAD 2024 Help, "DIMBREAK (Command)", "About Dimension Breaks"): the dimension
// lines, extension lines and leader lines (the lines and arcs the dimension draws; arrowheads and
// text stay whole) are cut where an object of the record crosses them, a gap of the style's
// Break size (`ACAD_DSTYLE_DIMBREAK`, 0.125 by default) times DIMSCALE centred on the crossing.
// A manual break cuts what lies between its two points on a line or arc both points are on.
//
// Inspection (AutoCAD 2024 Help, "DIMINSPECT (Command)", "Inspection Dimension Dialog Box"):
// the label left of the value and the inspection rate right of it, the fields separated by
// vertical lines and framed with semicircles (Round) or 90° points (Angular) at both ends;
// None draws neither frame nor separators. The value stays where its rules put it, the label and
// rate beside it, padded by DIMGAP; the dimension's lines stay out of the frame as they do out
// of the text. AutoCAD's help shows the frame but not its proportions: those are Triya's.
import {
  breakingCurves,
  dimBreakOf,
  dimInspectOf,
  dimStyleXdataVars,
  intersect,
  toleranceForSize,
  type Curve,
  type DimBreak,
  type DimInspect,
  type DocumentModel,
  type Entity,
  type MTextGeometry,
  type TextMeasure,
  type Vec2,
} from '@triya/engine';
import {
  add,
  angleOf,
  arcPart,
  clipArc,
  clipSegment,
  dist,
  dot,
  fromAngle,
  linePart,
  normAngle,
  perp,
  sub,
  type DimPart,
  type TextBox,
} from './geometry';
import type { DimStyle, DimensionTables, PartProps } from './style';

/** The dimension as drawing it reads it: a stand-in (a preview) has no handle. */
export type RecordHolder = Partial<Pick<Entity, 'handle' | 'extDict' | 'owner'>> &
  Pick<Entity, 'xdata'>;

/** AutoCAD's Break size when the style states none. */
const DEFAULT_BREAK_SIZE = 0.125;

/** Whether the tables are a whole drawing, which records and breaking objects need. */
const isDrawing = (m: DimensionTables): m is DimensionTables & DocumentModel =>
  'objects' in m && typeof (m as DocumentModel).blockEntities === 'function';

function holder(e: RecordHolder): { handle: string; extDict: string; owner: string } | undefined {
  return e.handle !== undefined && e.extDict !== undefined && e.owner !== undefined
    ? { handle: e.handle, extDict: e.extDict, owner: e.owner }
    : undefined;
}

/** The size of a gap: the dimension's Break size override, else its style's, times DIMSCALE. */
function breakSize(e: RecordHolder, style: string, model: DimensionTables, s: DimStyle): number {
  const own = dimStyleXdataVars(model, e.xdata).DIMBREAK;
  const styled = dimStyleXdataVars(model, model.tables.dimStyles.get(style)?.xdata).DIMBREAK;
  const v = typeof own === 'number' ? own : typeof styled === 'number' ? styled : undefined;
  return (v !== undefined && v >= 0 ? v : DEFAULT_BREAK_SIZE) * s.scale;
}

/** `[from, to]` parameter intervals taken out of [0, 1] (or [0, sweep]). */
function remaining(intervals: [number, number][], end: number): [number, number][] {
  const cut = intervals
    .map(
      ([a, b]) => [Math.max(0, Math.min(a, b)), Math.min(end, Math.max(a, b))] as [number, number],
    )
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let at = 0;
  for (const [a, b] of cut) {
    if (a > at) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < end) out.push([at, end]);
  return out;
}

const propsOf = (p: DimPart): PartProps => {
  const { geom: _geom, defpoint: _d, textPosition: _t, ...props } = p;
  return props;
};

/** A part breaks when it is one of the lines or arcs a dimension draws. */
const breakable = (p: DimPart): boolean =>
  !p.defpoint && (p.geom.kind === 'LINE' || p.geom.kind === 'ARC');

/** The parts with the record's gaps cut out of their lines and arcs. */
function broken(
  parts: DimPart[],
  record: DimBreak,
  curves: readonly Curve[],
  size: number,
): DimPart[] {
  const out: DimPart[] = [];
  for (const p of parts) {
    const g = p.geom;
    if (!breakable(p) || (g.kind !== 'LINE' && g.kind !== 'ARC')) {
      out.push(p);
      continue;
    }
    const scale = Math.max(
      1,
      ...[g.kind === 'LINE' ? g.start : g.center].flatMap((v) => [Math.abs(v.x), Math.abs(v.y)]),
    );
    const tol = toleranceForSize(scale * 10);
    const near = 1e-6 * scale;
    if (g.kind === 'LINE') {
      const len = dist(g.start, g.end);
      if (!(len > 0)) {
        out.push(p);
        continue;
      }
      const u = { x: (g.end.x - g.start.x) / len, y: (g.end.y - g.start.y) / len };
      const along = (q: Vec2) => dot(sub(q, g.start), u);
      const off = (q: Vec2) => Math.abs(dot(sub(q, g.start), perp(u)));
      const cuts: [number, number][] = [];
      for (const c of curves) {
        for (const x of intersect({ kind: 'LINE', start: g.start, end: g.end }, c, tol)) {
          const t = along(x.point);
          cuts.push([t - size / 2, t + size / 2]);
        }
      }
      for (const [a, b] of record.manual) {
        if (off(a) <= near && off(b) <= near) cuts.push([along(a), along(b)]);
      }
      if (cuts.length === 0) {
        out.push(p);
        continue;
      }
      for (const [a, b] of remaining(cuts, len)) {
        out.push(linePart(add(g.start, u, a), add(g.start, u, b), propsOf(p)));
      }
      continue;
    }
    const sweep = normAngle(g.endAngle - g.startAngle) || 2 * Math.PI;
    const along = (q: Vec2) => normAngle(angleOf(sub(q, g.center)) - g.startAngle);
    const cuts: [number, number][] = [];
    for (const c of curves) {
      for (const x of intersect(g, c, tol)) {
        const t = along(x.point);
        const h = size / 2 / g.radius;
        cuts.push([t - h, t + h]);
        // A gap across the start runs on from the end.
        if (t - h < 0 && sweep >= 2 * Math.PI - 1e-12) cuts.push([t - h + sweep, sweep]);
      }
    }
    for (const [a, b] of record.manual) {
      const on = (q: Vec2) => Math.abs(dist(q, g.center) - g.radius) <= near;
      if (on(a) && on(b)) cuts.push([along(a), along(b)]);
    }
    if (cuts.length === 0) {
      out.push(p);
      continue;
    }
    for (const [a, b] of remaining(cuts, sweep)) {
      out.push(arcPart(g.center, g.radius, g.startAngle + a, g.startAngle + b, propsOf(p)));
    }
  }
  return out;
}

/** The parts with the dimension's breaks, when it has a record of them. */
export function withBreaks(
  parts: DimPart[],
  e: RecordHolder,
  style: string,
  model: DimensionTables,
  s: DimStyle,
): DimPart[] {
  const h = holder(e);
  if (!h || !isDrawing(model)) return parts;
  const record = dimBreakOf(model, h);
  if (!record || (record.objects.length === 0 && record.manual.length === 0)) return parts;
  const tol = toleranceForSize(1);
  const curves = breakingCurves(model, h, record, tol);
  return broken(parts, record, curves, breakSize(e, style, model, s));
}

/** The frame's outline: its long sides, its ends, and the separators between the fields. */
function frameParts(
  r: DimInspect,
  at: (x: number, y: number) => Vec2,
  rotation: number,
  left: number,
  right: number,
  hw: number,
  half: number,
  props: PartProps,
): DimPart[] {
  if (r.shape === 'none') return [];
  const out: DimPart[] = [
    linePart(at(left, half), at(right, half), props),
    linePart(at(left, -half), at(right, -half), props),
  ];
  if (r.label !== undefined) out.push(linePart(at(-hw, -half), at(-hw, half), props));
  if (r.rate !== undefined) out.push(linePart(at(hw, -half), at(hw, half), props));
  if (r.shape === 'round') {
    const up = rotation + Math.PI / 2;
    out.push(arcPart(at(left, 0), half, up, up + Math.PI, props));
    out.push(arcPart(at(right, 0), half, up + Math.PI, up + 2 * Math.PI, props));
  } else {
    out.push(linePart(at(left, half), at(left - half, 0), props));
    out.push(linePart(at(left - half, 0), at(left, -half), props));
    out.push(linePart(at(right, half), at(right + half, 0), props));
    out.push(linePart(at(right + half, 0), at(right, -half), props));
  }
  return out;
}

/**
 * The parts with the dimension's inspection label, rate and frame, when it is an inspection
 * dimension; undefined while `measure` cannot measure a text.
 */
export function withInspection(
  parts: DimPart[],
  e: RecordHolder,
  model: DimensionTables,
  s: DimStyle,
  measure: TextMeasure,
): DimPart[] | undefined {
  const h = holder(e);
  if (!h || !isDrawing(model)) return parts;
  const r = dimInspectOf(model, h);
  const text = parts.find((p) => p.geom.kind === 'MTEXT' && !p.defpoint);
  if (!r || !text || text.geom.kind !== 'MTEXT') return parts;
  const value = text.geom;
  const field = (contents: string): MTextGeometry => ({ ...value, contents });
  const width = measure(value);
  const labelWidth = r.label === undefined ? 0 : measure(field(r.label));
  const rateWidth = r.rate === undefined ? 0 : measure(field(r.rate));
  if (width === undefined || labelWidth === undefined || rateWidth === undefined) return undefined;
  const pad = s.gap;
  const dir = fromAngle(value.rotation);
  const at = (x: number, y: number): Vec2 => add(add(value.position, dir, x), perp(dir), y);
  const hw = width / 2 + pad;
  const half = s.textHeight / 2 + pad;
  const left = r.label === undefined ? -hw : -hw - labelWidth - 2 * pad;
  const right = r.rate === undefined ? hw : hw + rateWidth + 2 * pad;
  const ends = r.shape === 'none' ? 0 : half;
  const box: TextBox = {
    center: at((left + right) / 2, 0),
    dir,
    halfWidth: (right - left) / 2 + ends,
    halfHeight: half,
  };
  const out: DimPart[] = [];
  for (const p of parts) {
    const g = p.geom;
    if (p === text || p.defpoint) out.push(p);
    else if (g.kind === 'LINE') {
      for (const [a, b] of clipSegment(g.start, g.end, box)) out.push(linePart(a, b, propsOf(p)));
    } else if (g.kind === 'ARC') {
      for (const [a, b] of clipArc(g.center, g.radius, g.startAngle, g.endAngle, box))
        out.push(arcPart(g.center, g.radius, a, b, propsOf(p)));
    } else out.push(p);
  }
  const textProps = propsOf(text);
  if (r.label !== undefined) {
    const geom = { ...field(r.label), position: at(-hw - pad - labelWidth / 2, 0) };
    out.push({ ...textProps, geom });
  }
  if (r.rate !== undefined) {
    const geom = { ...field(r.rate), position: at(hw + pad + rateWidth / 2, 0) };
    out.push({ ...textProps, geom });
  }
  const { linetype: _lt, ...frame } = s.dimLine;
  out.push(...frameParts(r, at, value.rotation, left, right, hw, half, frame));
  return out;
}
