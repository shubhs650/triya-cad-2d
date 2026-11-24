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
//
// The app also puts the objects on the system clipboard, with a picture of them for other apps,
// and a paste reads it (M2-32 part 5): another Triya window's objects come as a Clipboard, and
// another app's text as `text`, which PASTECLIP pastes as multiline text, and another app's
// picture as `picture`, which PASTECLIP pastes as a raster image (M2-54, edit/picture.ts), and a
// spreadsheet's cells (its HTML table or CSV as `cells`, its tab-separated rows as `text`), which
// PASTECLIP pastes as a table (M4-06, paste-table.ts).
//
// A reference to an xref pastes into the same drawing as a reference to the same xref; into
// another drawing it attaches the xref's file there (its path, type and units the source's), which
// the app loads in the paste's undo step, as XATTACH's (M5-04 part 19, edit/clipboard.ts).
//
// Objects from another drawing are scaled by the ratio of the two drawings' INSUNITS (M2-32).
// Where one of the two is unitless, AutoCAD scales nothing; Triya asks first what units the
// unitless drawing is in (PRD FR-F9: "insert scales by unit ratio with prompt when unitless";
// M3-09), Enter keeping AutoCAD's way (Unitless, nothing scaled). The answer is for that paste
// only: the drawing's INSUNITS is not changed (UNITS sets it).
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
import type { EntityGeometry, MTextGeometry } from '../../model/types';
import { mtextLiteral } from '../../edit/clipboard-data';
import { tabSeparatedCells, type SheetCells } from '../../edit/spreadsheet';
import { pasteTable } from './paste-table';
import { hasPixels, pastePicture, pictureFrame, type ClipboardPicture } from '../../edit/picture';
import { currentTextStyle, textSize } from '../draw/text';
import { parameterCopyModeOf } from '../constraint-upkeep';
import type { CommandContext, CommandDef } from '../command';
import { currentProps } from '../../properties/current';
import { insUnitsOf } from '../../model/units';
import type { Prompt, PromptAnswer } from '../prompt';
import { loadPastedXrefs, xrefHandles } from '../xref-attach';

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

type Found =
  | { readonly kind: 'objects'; readonly clipboard: Clipboard; readonly sameDrawing: boolean }
  | { readonly kind: 'text'; readonly contents: string }
  | { readonly kind: 'picture'; readonly picture: ClipboardPicture }
  | { readonly kind: 'cells'; readonly cells: SheetCells };

const NOTHING = 'The Clipboard holds no objects to paste.';

/**
 * The Clipboard's content: objects, or another app's text from the system clipboard as MTEXT
 * contents (M2-32 part 5); undefined (said why) when there is nothing to paste.
 */
async function readClipboard(ctx: CommandContext): Promise<Found | undefined> {
  const reply = await ctx.view.request({ op: 'clipboard' });
  if (!reply.ok) {
    ctx.message(reply.message);
    return undefined;
  }
  if (reply.cells && reply.cells.length > 0) {
    return { kind: 'cells', cells: reply.cells };
  } else if (reply.text !== undefined) {
    const cells = tabSeparatedCells(reply.text);
    if (cells) return { kind: 'cells', cells };
    const contents = mtextLiteral(reply.text);
    if (contents.trim() !== '') return { kind: 'text', contents };
  } else if (reply.picture) {
    if (hasPixels(reply.picture)) return { kind: 'picture', picture: reply.picture };
  } else if (reply.clipboard && reply.clipboard.entities.length > 0) {
    return { kind: 'objects', clipboard: reply.clipboard, sameDrawing: reply.sameDrawing === true };
  }
  ctx.message(NOTHING);
  return undefined;
}

/**
 * The Clipboard's objects, or undefined (said why): PASTEBLOCK and PASTEORIG paste no text or
 * picture.
 */
async function fromClipboard(
  ctx: CommandContext,
): Promise<{ clipboard: Clipboard; sameDrawing: boolean } | undefined> {
  const found = await readClipboard(ctx);
  if (found?.kind === 'text') {
    ctx.message('The Clipboard holds text, which PASTECLIP pastes as multiline text.');
    return undefined;
  }
  if (found?.kind === 'picture') {
    ctx.message('The Clipboard holds a picture, which PASTECLIP pastes as an image.');
    return undefined;
  }
  if (found?.kind === 'cells') {
    ctx.message("The Clipboard holds a spreadsheet's cells, which PASTECLIP pastes as a table.");
    return undefined;
  }
  return found;
}

/**
 * Another app's text pasted (AutoCAD 2024 Help, "PASTECLIP": text "is inserted as a multiline
 * text (mtext) object using the MTEXT defaults"): the current text style and TEXTSIZE (or the
 * style's own height), attached at its top left to the point given, unwrapped, on the current
 * layer with the current properties. A spreadsheet's rows paste as a table (M4-06,
 * paste-table.ts).
 */
async function* pasteText(ctx: CommandContext, contents: string): Sub<void> {
  const style = currentTextStyle(ctx.model);
  if (!style) {
    ctx.message('The drawing has no text style.');
    return;
  }
  const a = yield ctx.prompt.point({ message: 'Specify insertion point' });
  if (a.kind !== 'point') return;
  const geom: MTextGeometry = {
    kind: 'MTEXT',
    contents,
    style: style.handle,
    position: a.point,
    height: style.height > 0 ? style.height : textSize(ctx.model),
    width: 0,
    rotation: 0,
    attachment: 1,
    direction: 1,
    lineSpacingStyle: 1,
    lineSpacing: 1,
  };
  const props = currentProps(ctx.model);
  ctx.edit((b) => {
    b.addEntity({ owner: ctx.space, ...props, geom });
  });
}

/**
 * Another app's picture pasted as a raster image (M2-54, edit/picture.ts): its frame dragged by
 * its lower-left corner, which goes to the point given, on the current layer with the current
 * properties.
 */
async function* pasteImage(ctx: CommandContext, picture: ClipboardPicture): Sub<void> {
  const origin = { x: 0, y: 0 };
  ctx.preview([
    {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: pictureFrame(ctx.model, picture, origin).map((p) => ({ ...p, bulge: 0 })),
    },
  ]);
  const a = yield ctx.prompt.point({
    message: 'Specify insertion point',
    drag: { kind: 'preview', from: origin },
  });
  ctx.preview([]);
  if (a.kind !== 'point') return;
  const props = currentProps(ctx.model);
  ctx.edit((b) => {
    pastePicture(b, ctx.model, picture, ctx.space, a.point, props);
  });
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

/**
 * The units a unitless drawing may be named in, with their INSUNITS codes (the keywords' capitals
 * are what may be typed: MEters' ME beside Millimeters' M).
 */
export const UNITLESS_OPTIONS: readonly (readonly [string, number])[] = [
  ['Unitless', 0],
  ['Inches', 1],
  ['Feet', 2],
  ['Yards', 10],
  ['Millimeters', 4],
  ['Centimeters', 5],
  ['MEters', 6],
  ['Kilometers', 7],
];

/** What a paste of `clip` scales by: the Clipboard with its units, and the drawing's. */
interface PasteUnits {
  readonly clip: Clipboard;
  /** The drawing's units named for this paste; absent: its INSUNITS. */
  readonly units?: number;
}

/**
 * The units of a paste from another drawing where exactly one of the two drawings is unitless,
 * asked of the drafter (M3-09); undefined on Esc.
 */
async function* pasteUnits(
  ctx: CommandContext,
  clip: Clipboard,
  sameDrawing: boolean,
): Sub<PasteUnits | undefined> {
  const from = clip.insUnits ?? 0;
  const to = insUnitsOf(ctx.model);
  if (sameDrawing || (from === 0) === (to === 0)) return { clip };
  const a = yield ctx.prompt.keyword({
    message:
      from === 0
        ? 'The objects come from a unitless drawing. Specify their units'
        : 'This drawing is unitless. Specify its units for the paste',
    options: UNITLESS_OPTIONS.map(([name]) => name),
    default: { kind: 'keyword', keyword: 'Unitless' },
  });
  if (a.kind !== 'keyword') return undefined;
  const code = UNITLESS_OPTIONS.find(([name]) => name === a.keyword)![1];
  return from === 0 ? { clip: { ...clip, insUnits: code } } : { clip, units: code };
}

/** "Specify insertion point:" with the Clipboard's objects at the cursor. */
async function* insertionPoint(
  ctx: CommandContext,
  clip: Clipboard,
  units?: number,
): Sub<Vec2 | undefined> {
  ctx.preview(previewOf(clip, pasteScale(ctx.model, clip, units)));
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
      const found = await readClipboard(ctx);
      if (!found) return;
      if (found.kind === 'text') {
        yield* pasteText(ctx, found.contents);
        return;
      }
      if (found.kind === 'picture') {
        yield* pasteImage(ctx, found.picture);
        return;
      }
      if (found.kind === 'cells') {
        yield* pasteTable(ctx, found.cells);
        return;
      }
      const paste = yield* pasteUnits(ctx, found.clipboard, found.sameDrawing);
      if (!paste) return;
      const at = yield* insertionPoint(ctx, paste.clip, paste.units);
      if (!at) return;
      const before = xrefHandles(ctx);
      const carrying = paste.clip.constraints !== undefined;
      const mode = await parameterCopyModeOf(ctx, carrying);
      const carry = { mode, sameDrawing: found.sameDrawing };
      ctx.edit((b) => pasteObjects(b, ctx.model, paste.clip, ctx.space, at, paste.units, carry));
      await loadPastedXrefs(ctx, before);
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
      const paste = yield* pasteUnits(ctx, found.clipboard, found.sameDrawing);
      if (!paste) return;
      const at = yield* insertionPoint(ctx, paste.clip, paste.units);
      if (!at) return;
      const props = currentProps(ctx.model);
      const before = xrefHandles(ctx);
      ctx.edit((b) => pasteAsBlock(b, ctx.model, paste.clip, ctx.space, props, at, paste.units));
      await loadPastedXrefs(ctx, before);
    },
  };
}

export function pasteOrigCommand(): CommandDef {
  return {
    name: 'PASTEORIG',
    usesSelection: 'none',
    async *run(ctx) {
      const found = await fromClipboard(ctx);
      if (!found) return;
      if (found.sameDrawing) {
        ctx.message('PASTEORIG pastes objects copied from another drawing only.');
        return;
      }
      const paste = yield* pasteUnits(ctx, found.clipboard, false);
      if (!paste) return;
      const { clip, units } = paste;
      const before = xrefHandles(ctx);
      const mode = await parameterCopyModeOf(ctx, clip.constraints !== undefined);
      const carry = { mode, sameDrawing: false };
      ctx.edit((b) => pasteObjects(b, ctx.model, clip, ctx.space, clip.base, units, carry));
      await loadPastedXrefs(ctx, before);
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
