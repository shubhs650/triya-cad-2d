// Command preview (M3-12 part 6; AutoCAD 2024 Help, COMMANDPREVIEW: "Controls whether a preview
// of the possible outcome of certain commands is displayed"): while TRIM, EXTEND, FILLET,
// CHAMFER, LENGTHEN, BREAK or OFFSET waits for a pick or a point, the canvas shows what the
// pick (point) at the cursor would do before it is made. The prompt carries the command's own
// `CommandPreviewSource`; the front-end asks it at each cursor position (with the objects under
// the pickbox when it `hover`s) and draws the answer: the objects the command would change
// faded, and the shapes they (and any object it would add) would take drawn over them.
//
// The source works out the same edit the answer would make, with the command's settings at the
// time, and never edits the drawing or speaks on the command line.
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Entity, EntityGeometry } from '../model/types';
import type { GeneralProps } from '../properties/sheet';

/** One shape a preview draws: as an object with these properties would be drawn. */
export interface PreviewShape {
  readonly geom: EntityGeometry;
  readonly props: GeneralProps;
}

/** What a pick (point) at the cursor would do. */
export interface CommandPreview {
  /** The objects it changes or erases, drawn faded while the preview shows. */
  readonly faded: readonly EntityId[];
  /** The shapes they become and the objects it adds. */
  readonly shapes: readonly PreviewShape[];
}

/** Where the preview is asked for. */
export interface PreviewQuery {
  /** The cursor, as the drafting aids place it at a point prompt. */
  readonly cursor: Vec2;
  /** With `hover`: the objects under the pickbox, as a pick there would find them. */
  readonly hits: readonly EntityId[];
  /** Shift is held: TRIM's pick would extend, FILLET's would make a sharp corner. */
  readonly shift?: boolean;
}

/**
 * A prompt's preview (`PromptBase.commandPreview`). The engine runs in a worker (M1-67): the
 * prompt the app sees has no `at`, and the app asks the engine with `PromptBus.commandPreview`
 * (the session's `command-preview` input), which asks the prompt the command is waiting at.
 */
export interface CommandPreviewSource {
  /** The preview is of the object under the pickbox: the front-end passes `hits`. */
  readonly hover?: true;
  readonly at?: (
    q: PreviewQuery,
  ) => CommandPreview | undefined | Promise<CommandPreview | undefined>;
}

/** An object's own properties, which a shape it becomes is drawn with. */
export const shapeProps = (e: Entity): GeneralProps => ({
  layer: e.layer,
  color: e.color,
  linetype: e.linetype,
  lineweight: e.lineweight,
  transparency: e.transparency,
  ltScale: e.ltScale,
});

/**
 * The preview of `reshaped` objects becoming their shapes (none: erased), as `reshapeObject`
 * makes them, with the objects `added`.
 */
export function reshapePreview(
  model: DocumentModel,
  reshaped: readonly (readonly [EntityId, readonly EntityGeometry[]])[],
  added: readonly PreviewShape[] = [],
): CommandPreview {
  const faded: EntityId[] = [];
  const shapes: PreviewShape[] = [];
  for (const [id, geoms] of reshaped) {
    const e = model.entity(id);
    if (!e) continue;
    faded.push(id);
    const props = shapeProps(e);
    for (const geom of geoms) shapes.push({ geom, props });
  }
  return { faded, shapes: [...shapes, ...added] };
}
