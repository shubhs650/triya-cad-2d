// The grips of a center mark or centerline Triya made (M4-24; AutoCAD 2024 Help, "To Modify
// Center Marks and Centerlines"): a center mark shows its centre, which moves it, and the end of
// each extension line it draws; a centerline its two ends and its middle, which moves it. An
// end's grip stretches that extension: the extension grows by how far the grip is dragged along
// the line (whatever it is dragged across it), and is never less than nothing, a length past the
// object. The mark is then drawn again as CENTERRESET draws it (`redrawCenterMark`): from its
// objects when it has them, else from its own lines.
//
// AutoCAD's help shows these grips without saying what a drag across the line does or whether
// an extension may be negative: Triya takes the drag along the line, the common drafter
// expectation, and keeps extensions at zero or more, as CENTEREXE's are.
import { applyPoint, applyVector, type Matrix2D } from '../geom/transform';
import type { Vec2 } from '../geom/types';
import { add, cross, dot, length, normalize, scale, sub } from '../geom/vec';
import type { DocumentModel } from '../model/document';
import type { CenterMark, Entity } from '../model/types';
import { insertMatrix } from './assoc-array';
import { centerMarkOf } from './center-marks';
import type { Grip } from './grips';

/** The grips of a mark, with its record (`gripInfoOf`, as an array's). */
export interface CenterMarkGrips {
  readonly centerMark: CenterMark;
  readonly grips: readonly Grip[];
}

type Segment = readonly [Vec2, Vec2];

/** A center mark's own axes, in its block: left, right, top, bottom (the record's order). */
const AXES: readonly Vec2[] = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** What one extension grip stretches, in the drawing. */
interface ExtensionLine {
  /** The record's extension index. */
  readonly index: number;
  /** The end that stays. */
  readonly from: Vec2;
  /** The end the grip is at. */
  readonly end: Vec2;
  /** The way the extension grows, a unit vector. */
  readonly towards: Vec2;
}

/** The mark's lines in the drawing, and the extension lines its grips stretch. */
interface MarkShape {
  readonly lines: readonly Segment[];
  readonly extensions: readonly ExtensionLine[];
  readonly center: Vec2;
}

/** The lines of `insert`'s block, in the drawing. */
function drawnLines(model: DocumentModel, insert: Entity, m: Matrix2D): Segment[] {
  if (insert.geom.kind !== 'INSERT') return [];
  const out: Segment[] = [];
  for (const id of model.blockEntities(insert.geom.block)) {
    const g = model.entity(id)?.geom;
    if (g?.kind === 'LINE') out.push([applyPoint(m, g.start), applyPoint(m, g.end)]);
  }
  return out;
}

function shapeOf(model: DocumentModel, insert: Entity, r: CenterMark): MarkShape | undefined {
  if (insert.geom.kind !== 'INSERT') return undefined;
  const block = model.blocks.get(insert.geom.block);
  const m = insertMatrix(insert.geom, block?.basePoint ?? { x: 0, y: 0 });
  const lines = drawnLines(model, insert, m);
  const center = insert.geom.position;
  const extensions: ExtensionLine[] = [];
  if (r.kind === 'line') {
    // One line, the start (first object's start side) first.
    const [s, e] = lines[0] ?? [];
    const u = s && e ? normalize(sub(e, s)) : undefined;
    if (!s || !e || !u || length(u) === 0) return { lines, extensions, center };
    extensions.push({ index: 0, from: e, end: s, towards: scale(u, -1) });
    extensions.push({ index: 1, from: s, end: e, towards: u });
    return { lines, extensions, center };
  }
  if (!r.showExtensions) return { lines, extensions, center };
  // Each axis's extension line: the line along it that does not cross the centre (the cross's
  // arms do), its far end the grip.
  AXES.forEach((axis, index) => {
    const u = normalize(applyVector(m, axis));
    if (length(u) === 0) return;
    let best: ExtensionLine | undefined;
    let far = -Infinity;
    for (const [p, q] of lines) {
      const a = sub(p, center);
      const b = sub(q, center);
      const size = Math.max(length(a), length(b));
      const on = (v: Vec2) => Math.abs(cross(u, v)) <= 1e-9 * Math.max(1, size);
      if (!on(a) || !on(b) || dot(a, u) <= 0 || dot(b, u) <= 0) continue;
      const [near, end] = dot(a, u) < dot(b, u) ? [p, q] : [q, p];
      if (dot(sub(end, center), u) > far) {
        far = dot(sub(end, center), u);
        best = { index, from: near, end, towards: u };
      }
    }
    if (best) extensions.push(best);
  });
  return { lines, extensions, center };
}

/** The grips of the mark `e` is, if it is a center mark or centerline Triya made. */
export function centerMarkGripsOf(model: DocumentModel, e: Entity): CenterMarkGrips | undefined {
  if (e.geom.kind !== 'INSERT') return undefined;
  const centerMark = centerMarkOf(model, e);
  const shape = centerMark && shapeOf(model, e, centerMark);
  if (!centerMark || !shape) return undefined;
  const ends = shape.extensions.map((x): Grip => ({
    point: x.end,
    kind: 'centerMark',
    centerMark: x.index,
  }));
  const move: Grip = { point: shape.center, kind: 'move' };
  // A centerline's grips run start, middle, end; a mark's centre comes first.
  const grips = centerMark.kind === 'line' ? [ends[0]!, move, ends[1]!] : [move, ...ends];
  return { centerMark, grips: grips.filter((g) => g !== undefined) };
}

/** The extension that dragging line `x`'s grip to `to` gives (`extension` its length now). */
const stretched = (
  x: Pick<ExtensionLine, 'end' | 'towards'>,
  extension: number,
  to: Vec2,
): number => Math.max(0, extension + dot(sub(to, x.end), x.towards));

/**
 * What a drag of the mark's grip for one extension draws (`DragPreview`'s `centerMark`): plain
 * data, as prompts cross from the engine's worker to the app (M1-67).
 */
export interface CenterMarkDrag {
  /** The mark's lines that stay as they are, in the drawing. */
  readonly fixed: readonly Segment[];
  /** The extension line stretched, as `ExtensionLine`. */
  readonly from: Vec2;
  readonly end: Vec2;
  readonly towards: Vec2;
  /** Its extension now. */
  readonly extension: number;
}

/** The extension line of `index`, from the mark's lines, or undefined. */
function extensionLine(model: DocumentModel, insert: Entity, r: CenterMark, index: number) {
  const shape = shapeOf(model, insert, r);
  const x = shape?.extensions.find((l) => l.index === index);
  return shape && x && { shape, x };
}

/** The drag of the mark's grip for extension `index`, or undefined when it has none. */
export function centerMarkDrag(
  model: DocumentModel,
  insert: Entity,
  r: CenterMark,
  index: number,
): CenterMarkDrag | undefined {
  const found = extensionLine(model, insert, r, index);
  if (!found) return undefined;
  const { shape, x } = found;
  const same = (p: Vec2, q: Vec2) => length(sub(p, q)) <= 1e-9 * Math.max(1, length(p));
  const fixed = shape.lines.filter(
    ([p, q]) => !((same(p, x.from) && same(q, x.end)) || (same(p, x.end) && same(q, x.from))),
  );
  return {
    fixed,
    from: x.from,
    end: x.end,
    towards: x.towards,
    extension: r.extensions[index] ?? 0,
  };
}

/** The lines the mark draws with its grip dragged to `to` (`centerMarkDrag`'s). */
export function centerMarkDragLines(d: CenterMarkDrag, to: Vec2): Segment[] {
  const grown = stretched(d, d.extension, to) - d.extension;
  const end = add(d.end, scale(d.towards, grown));
  // An extension line the cross reaches past is not drawn, as `centerMarkLines` leaves it out.
  const out: Segment[] = [...d.fixed];
  if (dot(sub(end, d.from), d.towards) > 0) out.push([d.from, end]);
  return out;
}

/**
 * The mark's record with the grip for extension `index` dragged to `to`, or undefined when it
 * has no such grip or nothing changes.
 */
export function centerMarkGripEdit(
  model: DocumentModel,
  insert: Entity,
  r: CenterMark,
  index: number,
  to: Vec2,
): CenterMark | undefined {
  const found = extensionLine(model, insert, r, index);
  if (!found) return undefined;
  const now = r.extensions[index] ?? 0;
  const next = stretched(found.x, now, to);
  if (next === now) return undefined;
  return { ...r, extensions: r.extensions.map((e, i) => (i === index ? next : e)) };
}
