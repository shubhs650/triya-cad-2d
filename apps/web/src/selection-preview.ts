// When the canvas shows the selection preview (M3-04 part 5; AutoCAD 2024 Help, "SELECTIONPREVIEW
// (System Variable)"): bit 1 "on when no commands are active", at `Command:`; bit 2 "on when a
// command prompts for object selection", at a "Select objects" prompt or an object pick that
// takes the pickbox (TRIM's "Select object to trim"). Not while "Select objects" asks for a
// window's corner or a fence's points (those are point prompts), nor at MEASUREGEOM Quick,
// whose pickbox measures rather than selects. Which objects light up is the renderer's
// (`previewObjects`, PREVIEWFILTER).
import { PREVIEW_AT_COMMAND, PREVIEW_SELECTING, type Prompt, type Vec2 } from '@triya/engine';
import type { SelectQuery } from '@triya/render';

/**
 * Whether the pickbox previews what it would select: `bits` is SELECTIONPREVIEW, `prompt` the
 * prompt the drawing waits at, `atCommand` whether it waits at `Command:` with no command.
 */
export function previewsSelection(
  bits: number,
  prompt: Prompt | undefined,
  atCommand: boolean,
): boolean {
  if (!prompt) return atCommand && (bits & PREVIEW_AT_COMMAND) !== 0;
  if ((bits & PREVIEW_SELECTING) === 0) return false;
  return (
    prompt.kind === 'selection' || (prompt.kind === 'point' && !!prompt.pickbox && !prompt.quick)
  );
}

/**
 * Whether a selection window, polygon, fence or lasso being dragged at `prompt` previews what it
 * would take (M3-04 part 6; AutoCAD's window selection preview, SELECTIONPREVIEWLIMIT): the
 * implied window at `Command:` with bit 1, one at a command's "Select objects" with bit 2.
 */
export function areaPreviewed(bits: number, prompt: Prompt | undefined): boolean {
  if (prompt?.kind !== 'point' || !prompt.rubberBand?.selection) return false;
  return (bits & (prompt.rubberBand.atCommand ? PREVIEW_AT_COMMAND : PREVIEW_SELECTING)) !== 0;
}

/** A selection window between two corners, a crossing window with `crossing`. */
export function windowArea(a: Vec2, b: Vec2, crossing: boolean): SelectQuery {
  return { kind: crossing ? 'crossing' : 'window', box: boxAround([a, b]) };
}

/** A selection polygon (WPolygon, CPolygon, a lasso) or fence through `points`. */
export function pathArea(points: readonly Vec2[], kind: SelectQuery['kind']): SelectQuery {
  return { kind, box: boxAround(points), polygon: points };
}

function boxAround(points: readonly Vec2[]): SelectQuery['box'] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}
