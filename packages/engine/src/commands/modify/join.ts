// JOIN, EXPLODE and REVERSE (M3-02 part 4), with AutoCAD 2024's prompts and messages (AutoCAD
// Help, "JOIN (Command)", "EXPLODE (Command)", "REVERSE (Command)"):
//
//   Select source object or multiple objects to join at once:
//   Select objects to join:
//   3 objects converted to 1 polyline
//
// JOIN with one object chosen takes it as the source and asks for what to join to it (an arc or
// elliptical arc source offers cLose, which makes its circle or ellipse); with several it joins
// every group that can join. EXPLODE breaks what it is given into its parts; REVERSE runs lines,
// polylines and splines the other way. The geometry is `edit/join.ts`, `edit/explode.ts` and
// `edit/break.ts`'s.
import { eraseObjects, refusalMessages, reshapeObject } from '../../edit/edit';
import { closeArc, closeEllipse, joinable, joinObjects, type Joined } from '../../edit/join';
import { explodeObjects, type TextPiecesOf } from '../../edit/explode';
import { breakCurveOf, reverseGeometry } from '../../edit/break';
import { edgeCurvesOf } from '../../edit/trim';
import type { EntityId } from '../../model/entity-ids';
import type { MTextGeometry } from '../../model/types';
import { multiLeaderParts } from '../../annotation/multileader';
import type { TextMeasure } from '../../annotation/tolerance';
import type { CommandContext, CommandDef } from '../command';
import type { TextPiece } from '../view/host';
import { toleranceFor } from './offset';
import { toleranceForSize } from '../../geom/tolerance';

// ── JOIN ────────────────────────────────────────────────────────────────────────────────────

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What JOIN says it made. */
function joinedMessage(j: Joined, kinds: readonly string[]): string {
  const n = j.parts.length;
  switch (j.made) {
    case 'line':
      return `${n} lines joined into 1 line`;
    case 'arc':
      return `${n} arcs joined into 1 arc`;
    case 'circle':
      return `${n} arcs joined into 1 circle`;
    case 'ellipse':
      return j.geom.kind === 'ELLIPSE' && j.geom.startParam === 0 && j.geom.endParam === 2 * Math.PI
        ? `${n} elliptical arcs joined into 1 ellipse`
        : `${n} elliptical arcs joined into 1 elliptical arc`;
    case 'polyline':
      // A polyline that took others in grew; anything else was converted.
      return kinds[0] === 'LWPOLYLINE' || kinds[0] === 'POLYLINE'
        ? `${plural(n - 1, 'segment')} added to polyline`
        : `${n} objects converted to 1 polyline`;
    case 'spline':
      return `${n} objects converted to 1 spline`;
  }
}

export function joinCommand(): CommandDef {
  return {
    name: 'JOIN',
    usesSelection: 'during',
    async *run(ctx) {
      const a = yield ctx.prompt.selection({
        message: 'Select source object or multiple objects to join at once',
        editable: true,
      });
      if (a.kind !== 'selection' || a.ids.length === 0) return;
      if (a.ids.length > 1) {
        join(ctx, a.ids, undefined);
        return;
      }
      const source = a.ids[0]!;
      const g = ctx.model.entity(source)?.geom;
      const curved = g?.kind === 'ARC' || (g?.kind === 'ELLIPSE' && joinable(g));
      const b = yield ctx.prompt.selection({
        message: !curved
          ? 'Select objects to join'
          : g.kind === 'ARC'
            ? 'Select arcs to join to source or'
            : 'Select elliptical arcs to join to source or',
        ...(curved && { options: ['cLose'] }),
        editable: true,
      });
      if (b.kind === 'keyword' && curved) {
        ctx.edit((e) =>
          reshapeObject(e, ctx.model, source, [
            g.kind === 'ARC' ? closeArc(g) : closeEllipse(g as never),
          ]),
        );
        ctx.message(
          g.kind === 'ARC'
            ? 'Arc converted to a circle.'
            : 'Elliptical arc converted to an ellipse.',
        );
        return;
      }
      const more = b.kind === 'selection' ? b.ids.filter((id) => id !== source) : [];
      join(ctx, [source, ...more], source);
    },
  };
}

function join(ctx: CommandContext, ids: readonly EntityId[], source: EntityId | undefined): void {
  const parts = ids.flatMap((id) => {
    const e = ctx.model.entity(id);
    return e ? [{ id, geom: e.geom }] : [];
  });
  // A 3D polyline's tolerance comes from its plan view (M3-17).
  const first = parts
    .map((p) => breakCurveOf(p.geom) ?? edgeCurvesOf(p.geom, false)[0])
    .find((c) => c !== undefined);
  const tol = first ? toleranceFor(ctx.model, first) : toleranceForSize(1);
  const r = joinObjects(parts, source, tol);
  const lines: string[] = [];
  if (r.joined.length > 0) {
    ctx.edit((b) => {
      for (const j of r.joined) {
        const kinds = j.parts.map((id) => ctx.model.entity(id)!.geom.kind);
        lines.push(joinedMessage(j, kinds));
        reshapeObject(b, ctx.model, j.keep, [j.geom]);
        eraseObjects(
          b,
          ctx.model,
          j.parts.filter((id) => id !== j.keep),
        );
      }
    });
  }
  if (r.discarded > 0) {
    lines.push(`${plural(r.discarded, 'object')} discarded from the operation`);
  }
  for (const line of lines) ctx.message(line);
}

// ── EXPLODE ─────────────────────────────────────────────────────────────────────────────────

export function explodeCommand(): CommandDef {
  return {
    name: 'EXPLODE',
    usesSelection: 'during',
    async *run(ctx) {
      const a = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
      if (a.kind !== 'selection' || a.ids.length === 0) return;
      const measure = await multileaderWidths(ctx, a.ids);
      const textPieces = await mtextPieces(ctx, a.ids);
      let report: ReturnType<typeof explodeObjects> | undefined;
      ctx.edit((b) => {
        report = explodeObjects(b, ctx.model, a.ids, {
          hatchLines: ctx.hatchLines,
          measure,
          textPieces,
        });
      });
      const r = report!;
      for (const line of refusalMessages(r.refused, 'exploded')) ctx.message(line);
      if (r.lostWidth) {
        ctx.message('Exploding this polyline has lost width information.');
        ctx.message('The UNDO command will restore it.');
      }
    },
  };
}

/**
 * A measure of the multileaders' texts among `ids`, each measured once on the canvas
 * (`textWidths`), so an exploded multileader keeps its underline or overline (M1-111); a text
 * the canvas cannot measure (no canvas, a font not loaded) loses it.
 */
async function multileaderWidths(
  ctx: CommandContext,
  ids: readonly EntityId[],
): Promise<TextMeasure | undefined> {
  const texts = new Map<string, MTextGeometry>();
  const asked: TextMeasure = (t) => {
    texts.set(JSON.stringify(t), t);
    return undefined;
  };
  for (const id of ids) {
    const g = ctx.model.entity(id)?.geom;
    if (g?.kind === 'MULTILEADER') multiLeaderParts(g, ctx.model, asked);
  }
  if (texts.size === 0) return undefined;
  const reply = await ctx.view.request({ op: 'textWidths', texts: [...texts.values()] });
  const widths = new Map<string, number | undefined>();
  [...texts.keys()].forEach((k, i) =>
    widths.set(k, (reply.ok ? reply.widths?.[i] : undefined) ?? undefined),
  );
  return (t) => widths.get(JSON.stringify(t));
}

/**
 * The MTEXTs among `ids` laid out on the canvas as the TEXT runs and strokes they explode into
 * (`textPieces`, M3-12 part 7); one the canvas cannot lay out (no canvas, a font not loaded)
 * is not exploded.
 */
async function mtextPieces(
  ctx: CommandContext,
  ids: readonly EntityId[],
): Promise<TextPiecesOf | undefined> {
  const texts = new Map<string, MTextGeometry>();
  for (const id of ids) {
    const g = ctx.model.entity(id)?.geom;
    if (g?.kind === 'MTEXT') texts.set(JSON.stringify(g), g);
  }
  if (texts.size === 0) return undefined;
  const reply = await ctx.view.request({ op: 'textPieces', texts: [...texts.values()] });
  const pieces = new Map<string, readonly TextPiece[] | undefined>();
  [...texts.keys()].forEach((k, i) =>
    pieces.set(k, (reply.ok ? reply.pieces?.[i] : undefined) ?? undefined),
  );
  return (t) => pieces.get(JSON.stringify(t));
}

// ── REVERSE ─────────────────────────────────────────────────────────────────────────────────

export function reverseCommand(): CommandDef {
  return {
    name: 'REVERSE',
    usesSelection: 'during',
    async *run(ctx) {
      const a = yield ctx.prompt.selection({
        message: 'Select lines, polylines, splines, or helixes to reverse direction',
        editable: true,
      });
      if (a.kind !== 'selection' || a.ids.length === 0) return;
      let n = 0;
      ctx.edit((b) => {
        for (const id of a.ids) {
          const e = b.entity(id);
          const g = e && reverseGeometry(e.geom);
          if (!g) continue;
          b.updateEntity(id, { geom: g });
          n++;
        }
      });
      ctx.message(`${n} object(s) direction has been reversed.`);
    },
  };
}
