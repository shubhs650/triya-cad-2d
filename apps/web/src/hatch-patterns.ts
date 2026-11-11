// The app's answer to a hatch given another pattern by name (Properties' Pattern name, M2-35
// part 3): the engine has no pattern files, so it asks for the pattern placed once per hatch
// from the library every canvas draws with (the bundled patterns, then the user's .pat files in
// the order added, a later one winning on a shared name; M1-50).
import type { PatternPlacement, ViewReply } from '@triya/engine';
import { PatternLibrary, patternLines } from '@triya/hatch';
import { patternLibrary } from '@triya/render';

/**
 * `name` placed at each of `placements`, named as its file spells it, Custom (DXF 76 = 2) when
 * one of the user's files defines it, as AutoCAD calls a pattern from a .pat file of one's own.
 */
export function hatchPatternReply(
  sources: readonly string[],
  name: string,
  placements: readonly PatternPlacement[],
): ViewReply {
  const p = patternLibrary(sources).get(name);
  if (!p) return { ok: false, message: `Pattern "${name}" is not in the pattern library.` };
  return {
    ok: true,
    pattern: {
      name: p.name,
      custom: new PatternLibrary(...sources).get(name) !== undefined,
      lines: placements.map((at) => patternLines(p, at)),
    },
  };
}

/** The names Pattern name offers: SOLID, then the library's patterns as their files spell them. */
export function hatchPatternNames(sources: readonly string[]): string[] {
  return ['SOLID', ...patternLibrary(sources).names()];
}
