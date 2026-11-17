// XCLIP (M5-04 part 3; COMMANDS.md "Blocks and references"), with AutoCAD 2024's prompts
// (AutoCAD Help, "XCLIP (Command)"):
//
//   Select objects:                       (block references and xrefs; others are left out)
//   Enter clipping option [ON/OFF/Delete/generate Polyline/New boundary] <New>:
//     ON / OFF        the clip hides what lies outside it, or the whole block shows
//     Delete          the clip goes ("ERASE cannot be used to delete clipping boundaries")
//     generate Polyline   a polyline along each clip, with the current properties
//     New boundary    Delete old boundary(s)? [Yes/No] <Yes>:   (when one is clipped already)
//                     Outside mode - Objects outside boundary will be hidden.
//                     Specify clipping boundary [Select polyline/Polygonal/Rectangular] <Rectangular>:
//                       Rectangular:  Specify first corner:  Specify opposite corner:
//                       Polygonal:    Specify first point:  Specify next point or [Undo]:
//                       Select polyline:  Select polyline:
//
// The whole command is one XCLIP undo step; the save writes each clip as AutoCAD's SPATIAL_FILTER
// (io export/xclips.ts). A new boundary applies to every reference selected, as in AutoCAD.
//
// Left out: Clipdepth (front and back clipping planes are 3D, PRD non-goal 1; a clip's planes
// are kept), and Invert clip, whose inner boundary AutoCAD keeps in an ACAD_XREC_ROUNDTRIP record
// the save does not write yet (a later part of M5-04).
//
// Ambiguity: the help says a clipping polyline "must consist of straight line segments"; its
// arcs are followed by chords here, as WIPEOUT's Polyline does, rather than refused (the common
// drafter expectation: the clip follows the polyline drawn).
import type { Vec2 } from '../geom/types';
import { flatten } from '../geom/flatten';
import { toleranceForSize } from '../geom/tolerance';
import type { EntityId } from '../model/entity-ids';
import type { Entity } from '../model/types';
import { distinctVertices, signedArea2 } from '../edit/revcloud';
import {
  clipOf,
  clipOutline,
  selfIntersecting,
  setClip,
  setClipEnabled,
  xclipProblem,
} from '../edit/xclip';
import { currentProps } from '../properties/current';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import { currentUcs } from './ucs';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const keyword = (a: PromptAnswer): string | undefined =>
  a.kind === 'keyword' ? a.keyword : undefined;

/** The linear tolerance for a shape of these points (their magnitude, as the extents give it). */
const toleranceOf = (points: readonly Vec2[]): number =>
  toleranceForSize(Math.max(1, ...points.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]))).linear;

/** Why `points` cannot be a clipping polygon, or undefined when they can. */
function polygonProblem(points: readonly Vec2[]): string | undefined {
  const tol = toleranceOf(points);
  if (points.length < 3 || Math.abs(signedArea2(points)) <= tol * tol) {
    return 'The clipping boundary must enclose an area.';
  }
  if (selfIntersecting(points, tol)) return 'The clipping boundary cannot intersect itself.';
  return undefined;
}

/**
 * Rectangular: the rectangle on two corners, along the current UCS's axes. Stored as the two
 * corners, as AutoCAD stores a rectangular clip, when the UCS is the world's turn; as its four
 * corners otherwise (a two-point boundary is a rectangle on the world's axes).
 */
function rectangle(a: Vec2, b: Vec2, angle: number): Vec2[] {
  if (Math.abs(Math.sin(angle)) < 1e-12) return [a, b];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const toUcs = (p: Vec2): Vec2 => ({ x: c * p.x + s * p.y, y: -s * p.x + c * p.y });
  const toWorld = (p: Vec2): Vec2 => ({ x: c * p.x - s * p.y, y: s * p.x + c * p.y });
  const p = toUcs(a);
  const q = toUcs(b);
  return [
    { x: p.x, y: p.y },
    { x: q.x, y: p.y },
    { x: q.x, y: q.y },
    { x: p.x, y: q.y },
  ].map(toWorld);
}

export async function* rectangular(ctx: CommandContext): Sub<Vec2[] | undefined> {
  for (;;) {
    const a = yield ctx.prompt.point({ message: 'Specify first corner' });
    if (a.kind !== 'point') return undefined;
    const b = yield ctx.prompt.point({
      message: 'Specify opposite corner',
      rubberBand: { from: a.point, box: true },
    });
    if (b.kind !== 'point') return undefined;
    const r = rectangle(a.point, b.point, currentUcs(ctx).angle);
    const tol = toleranceOf(r);
    const area =
      r.length === 2
        ? Math.abs(a.point.x - b.point.x) > tol && Math.abs(a.point.y - b.point.y) > tol
        : !polygonProblem(r);
    if (area) return r;
    ctx.message('The clipping boundary must enclose an area.');
  }
}

export async function* polygonal(ctx: CommandContext): Sub<Vec2[] | undefined> {
  const first = yield ctx.prompt.point({ message: 'Specify first point' });
  if (first.kind !== 'point') return undefined;
  const points: Vec2[] = [first.point];
  for (;;) {
    const n = yield ctx.prompt.point({
      message: points.length > 1 ? 'Specify next point or' : 'Specify next point',
      ...(points.length > 1 && { options: ['Undo'] }),
      rubberBand: { from: points.at(-1)!, path: { points: [...points] } },
    });
    if (n.kind === 'point') {
      points.push(n.point);
      continue;
    }
    if (keyword(n) === 'Undo') {
      if (points.length > 1) points.pop();
      continue;
    }
    if (n.kind !== 'enter') return undefined;
    const ring = distinctVertices(points, toleranceOf(points));
    const problem = polygonProblem(ring);
    if (!problem) return ring;
    ctx.message(problem);
    if (points.length < 2) return undefined;
  }
}

export async function* fromPolyline(ctx: CommandContext): Sub<Vec2[] | undefined> {
  for (;;) {
    const a = yield ctx.prompt.selection({ message: 'Select polyline', single: true });
    if (a.kind !== 'selection' || a.ids.length === 0) return undefined;
    const g = ctx.model.entity(a.ids[0]!)?.geom;
    if (!g || (g.kind !== 'LWPOLYLINE' && (g.kind !== 'POLYLINE' || g.is3d))) {
      ctx.message('Object is not a 2D polyline.');
      continue;
    }
    // An open polyline is closed back to its first vertex (AutoCAD: "The polyline can be open").
    const size = Math.max(1, ...g.vertices.flatMap((v) => [Math.abs(v.x), Math.abs(v.y)]));
    const flat = flatten({ kind: 'LWPOLYLINE', vertices: g.vertices, closed: true }, size * 1e-3);
    const ring = distinctVertices(flat.points, toleranceOf(flat.points));
    const problem = polygonProblem(ring);
    if (!problem) return ring;
    ctx.message(problem);
  }
}

async function* newBoundary(ctx: CommandContext, refs: readonly Entity[]): Sub<void> {
  if (refs.some((e) => clipOf(ctx.model, e.handle))) {
    const a = yield ctx.prompt.keyword({
      message: 'Delete old boundary(s)?',
      options: ['Yes', 'No'],
      default: { kind: 'keyword', keyword: 'Yes' },
    });
    if (keyword(a) !== 'Yes') return;
  }
  ctx.message('Outside mode - Objects outside boundary will be hidden.');
  const a = yield ctx.prompt.keyword({
    message: 'Specify clipping boundary',
    options: ['Select polyline', 'Polygonal', 'Rectangular'],
    default: { kind: 'keyword', keyword: 'Rectangular' },
  });
  const how = keyword(a);
  const boundary =
    how === 'Select polyline'
      ? yield* fromPolyline(ctx)
      : how === 'Polygonal'
        ? yield* polygonal(ctx)
        : how === 'Rectangular'
          ? yield* rectangular(ctx)
          : undefined;
  if (!boundary) return;
  ctx.edit((b) => {
    for (const e of refs) {
      if (!setClip(b, ctx.model, e, boundary)) {
        ctx.message(`Block reference ${e.handle} has a zero scale and cannot be clipped.`);
      }
    }
  });
}

/** Each of `refs` that has a clip, with it; a line for the ones without. */
function clipped(ctx: CommandContext, refs: readonly Entity[]) {
  const out = refs.flatMap((e) => {
    const filter = clipOf(ctx.model, e.handle);
    return filter ? [{ e, filter }] : [];
  });
  if (out.length === 0) ctx.message('No clipping boundary found.');
  return out;
}

export function xclipCommand(): CommandDef {
  return {
    name: 'XCLIP',
    usesSelection: 'during',
    async *run(ctx) {
      const s = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
      const ids: readonly EntityId[] = s.kind === 'selection' ? s.ids : [];
      if (ids.length === 0) return;
      const refs: Entity[] = [];
      let others = 0;
      for (const id of ids) {
        const e = ctx.model.entity(id);
        if (e && !xclipProblem(e)) refs.push(e);
        else others++;
      }
      if (others > 0) {
        ctx.message(
          `${others} ${others === 1 ? 'object is' : 'objects are'} not a block reference or xref.`,
        );
      }
      if (refs.length === 0) return;
      const a = yield ctx.prompt.keyword({
        message: 'Enter clipping option',
        options: ['ON', 'OFF', 'Delete', 'generate Polyline', 'New boundary'],
        defaultLabel: 'New',
      });
      const option = a.kind === 'enter' ? 'New boundary' : keyword(a);
      switch (option) {
        case 'ON':
        case 'OFF': {
          const on = option === 'ON';
          const found = clipped(ctx, refs);
          if (found.length > 0) {
            ctx.edit((b) => {
              for (const { filter } of found) setClipEnabled(b, filter, on);
            });
          }
          return;
        }
        case 'Delete': {
          const found = clipped(ctx, refs);
          if (found.length > 0) {
            ctx.edit((b) => {
              for (const { filter } of found) b.removeObject(filter.handle);
            });
          }
          return;
        }
        case 'generate Polyline': {
          const found = clipped(ctx, refs);
          if (found.length === 0) return;
          const props = currentProps(ctx.model);
          ctx.edit((b) => {
            for (const { e, filter } of found) {
              const outline = clipOutline(ctx.model, e, filter);
              if (!outline) continue;
              b.addEntity({
                owner: e.owner,
                ...props,
                geom: {
                  kind: 'LWPOLYLINE',
                  closed: true,
                  vertices: outline.map((p) => ({ ...p, bulge: 0 })),
                },
              });
            }
          });
          return;
        }
        case 'New boundary':
          yield* newBoundary(ctx, refs);
          return;
        default:
          return;
      }
    },
  };
}
