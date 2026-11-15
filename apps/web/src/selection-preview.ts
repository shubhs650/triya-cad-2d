// When the canvas shows the selection preview (M3-04 part 5; AutoCAD 2024 Help, "SELECTIONPREVIEW
// (System Variable)"): bit 1 "on when no commands are active", at `Command:`; bit 2 "on when a
// command prompts for object selection", at a "Select objects" prompt or an object pick that
// takes the pickbox (TRIM's "Select object to trim"). Not while "Select objects" asks for a
// window's corner or a fence's points (those are point prompts), nor at MEASUREGEOM Quick,
// whose pickbox measures rather than selects. Which objects light up is the renderer's
// (`previewObjects`, PREVIEWFILTER).
import { PREVIEW_AT_COMMAND, PREVIEW_SELECTING, type Prompt } from '@triya/engine';

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
