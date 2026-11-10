// The Clipboard commands (M2-14 part 2, COMMANDS.md "cross-document"): COPYCLIP, CUTCLIP and
// COPYBASE put objects on the app's Clipboard, which every open drawing shares; PASTECLIP,
// PASTEBLOCK and PASTEORIG paste them into the drawing they run in (edit/clipboard.ts).
//
// AutoCAD 2024 Help:
// - COPYCLIP (Ctrl+C) and CUTCLIP (Ctrl+X): "Select objects:"; the pasted objects' insertion
//   point is the lower-left corner of the selection's extents. CUTCLIP removes the objects.
// - COPYBASE (Ctrl+Shift+C): "Specify base point:", then "Select objects:".
// - PASTECLIP (Ctrl+V) and PASTEBLOCK (Ctrl+Shift+V): "Specify insertion point:", the objects
//   dragged with the cursor; PASTEBLOCK makes them one block reference.
// - PASTEORIG: pastes at the objects' own coordinates, only objects copied from another drawing
//   (AutoCAD greys the command out otherwise; here it says why it does nothing).
// None of the copying commands changes the drawing, so none is an undo step; a paste is one.
import type { Box } from '../../geom/bounds';
import type { Vec2 } from '../../geom/types';
import {
  copyToClipboard,
  pasteAsBlock,
  pasteObjects,
  pasteScale,
  type Clipboard,
} from '../../edit/clipboard';
import { point, scaleAbout } from '../../edit/similarity';
import { transformGeometry } from '../../edit/transform';
import { eraseObjects, refusalMessages } from '../../edit/edit';
import type { EntityId } from '../../model/entity-ids';
import type { EntityGeometry } from '../../model/types';
import type { CommandContext, CommandDef } from '../command';
import { currentLayer } from '../draw/line';
import type { Prompt, PromptAnswer } from '../prompt';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The most objects PASTECLIP drags as they are: past it, only their extents are dragged. */
const DRAGGED = 2000;

/** What the preview can draw without the drawing's blocks and styles: the curves. */
const DRAWN = new Set(['LINE', 'ARC', 'CIRCLE', 'ELLIPSE', 'LWPOLYLINE', 'SPLINE', 'POINT']);

async function* selectObjects(ctx: CommandContext, editable: boolean): Sub<readonly EntityId[]> {
  const a = yield ctx.prompt.selection({ message: 'Select objects', editable });
  return a.kind === 'selection' ? a.ids : [];
}

/**
 * Puts `ids` on the Clipboard with `base`, or the lower-left corner of their extents, as the
 * point a paste puts at its insertion point. Returns the objects copied.
 */
async function toClipboard(
  ctx: CommandContext,
  ids: readonly EntityId[],
  base?: Vec2,
): Promise<readonly EntityId[]> {
  // Scripts and tests have no renderer to measure the objects: their extents are then unknown.
  const bounds = await ctx.view.request({ op: 'bounds', ids });
  const box: Box | undefined = bounds.ok ? bounds.box : undefined;
  const at = base ?? (box ? { x: box.minX, y: box.minY } : { x: 0, y: 0 });
  const { clipboard, refused, unannotated } = copyToClipboard(ctx.model, ids, at, box);
  for (const line of refusalMessages(refused, 'copied')) ctx.message(line);
  if (unannotated > 0) {
    ctx.message(
      `${unannotated} ${unannotated === 1 ? 'copy is' : 'copies are'} not annotative (annotative copies are not saved yet).`,
    );
  }
  if (clipboard.entities.length === 0) return [];
  const reply = await ctx.view.request({ op: 'clipboard', content: clipboard });
  if (!reply.ok) {
    ctx.message(reply.message);
    return [];
  }
  const copied = new Set(clipboard.entities.map((e) => e.handle));
  return ids.filter((id) => copied.has(ctx.model.entity(id)?.handle ?? ''));
}

/** The Clipboard's content, or undefined (said why) when there is nothing to paste. */
async function fromClipboard(
  ctx: CommandContext,
): Promise<{ clipboard: Clipboard; sameDrawing: boolean } | undefined> {
  const reply = await ctx.view.request({ op: 'clipboard' });
  if (!reply.ok) {
    ctx.message(reply.message);
    return undefined;
  }
  if (!reply.clipboard || reply.clipboard.entities.length === 0) {
    ctx.message('The Clipboard holds no objects to paste.');
    return undefined;
  }
  return { clipboard: reply.clipboard, sameDrawing: reply.sameDrawing === true };
}

/**
 * What PASTECLIP drags: the curves among the objects, and their extents' frame, scaled by `k`
 * about the base point as the paste will scale them (M2-32).
 */
function previewOf(clip: Clipboard, k: number): EntityGeometry[] {
  const t = scaleAbout(clip.base, k);
  const out: EntityGeometry[] = [];
  if (clip.entities.length <= DRAGGED) {
    for (const e of clip.entities) {
      if (DRAWN.has(e.geom.kind)) out.push(k === 1 ? e.geom : transformGeometry(e.geom, t));
    }
  }
  const box = clip.extents;
  if (box) {
    const corners = [
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.maxY },
    ];
    out.push({
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: corners.map((c) => ({ ...(k === 1 ? c : point(t, c)), bulge: 0 })),
    });
  }
  return out;
}

/** "Specify insertion point:" with the Clipboard's objects at the cursor. */
async function* insertionPoint(ctx: CommandContext, clip: Clipboard): Sub<Vec2 | undefined> {
  ctx.preview(previewOf(clip, pasteScale(ctx.model, clip)));
  const a = yield ctx.prompt.point({
    message: 'Specify insertion point',
    drag: { kind: 'preview', from: clip.base },
  });
  ctx.preview([]);
  return a.kind === 'point' ? a.point : undefined;
}

export function copyClipCommand(): CommandDef {
  return {
    name: 'COPYCLIP',
    usesSelection: 'during',
    async *run(ctx) {
      const ids = yield* selectObjects(ctx, false);
      if (ids.length > 0) await toClipboard(ctx, ids);
    },
  };
}

export function cutClipCommand(): CommandDef {
  return {
    name: 'CUTCLIP',
    usesSelection: 'during',
    async *run(ctx) {
      const ids = yield* selectObjects(ctx, true);
      if (ids.length === 0) return;
      const copied = await toClipboard(ctx, ids);
      if (copied.length === 0) return;
      let refused: ReadonlyMap<string, number> = new Map();
      ctx.edit((b) => {
        refused = eraseObjects(b, ctx.model, copied).refused;
      });
      for (const line of refusalMessages(refused, 'cut')) ctx.message(line);
    },
  };
}

export function copyBaseCommand(): CommandDef {
  return {
    name: 'COPYBASE',
    async *run(ctx) {
      const a = yield ctx.prompt.point({ message: 'Specify base point' });
      if (a.kind !== 'point') return;
      const ids = yield* selectObjects(ctx, false);
      if (ids.length > 0) await toClipboard(ctx, ids, a.point);
    },
  };
}

export function pasteClipCommand(): CommandDef {
  return {
    name: 'PASTECLIP',
    usesSelection: 'none',
    async *run(ctx) {
      const found = await fromClipboard(ctx);
      if (!found) return;
      const at = yield* insertionPoint(ctx, found.clipboard);
      if (!at) return;
      ctx.edit((b) => pasteObjects(b, ctx.model, found.clipboard, ctx.space, at));
    },
  };
}

export function pasteBlockCommand(): CommandDef {
  return {
    name: 'PASTEBLOCK',
    usesSelection: 'none',
    async *run(ctx) {
      const found = await fromClipboard(ctx);
      if (!found) return;
      const at = yield* insertionPoint(ctx, found.clipboard);
      if (!at) return;
      const layer = currentLayer(ctx.model);
      ctx.edit((b) => pasteAsBlock(b, ctx.model, found.clipboard, ctx.space, layer, at));
    },
  };
}

export function pasteOrigCommand(): CommandDef {
  return {
    name: 'PASTEORIG',
    usesSelection: 'none',
    // eslint-disable-next-line require-yield -- it asks nothing
    async *run(ctx) {
      const found = await fromClipboard(ctx);
      if (!found) return;
      if (found.sameDrawing) {
        ctx.message('PASTEORIG pastes objects copied from another drawing only.');
        return;
      }
      const { clipboard } = found;
      ctx.edit((b) => pasteObjects(b, ctx.model, clipboard, ctx.space, clipboard.base));
    },
  };
}

export const CLIPBOARD_COMMANDS: readonly (() => CommandDef)[] = [
  copyClipCommand,
  cutClipCommand,
  copyBaseCommand,
  pasteClipCommand,
  pasteBlockCommand,
  pasteOrigCommand,
];
