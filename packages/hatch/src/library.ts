// The patterns a drawing's hatches can name (M1-16 part 3): the bundled set, and .pat files
// the user adds, which win over a bundled pattern of the same name. AutoCAD matches pattern
// names without regard to case.
//
// A HATCH read from a file draws from the pattern lines it stores (DXF 53–49), which is what
// AutoCAD shows even when the pattern file differs; the library supplies lines only for a
// hatch stored without them (`hatchLines`) and for hatches made in Triya (M4).

import type { HatchGeometry, HatchPatternLine } from '@triya/engine';
import { TRIYA_ISO_PAT } from './bundled';
import { parsePat, patternLines, userDefinedLines, type PatFile, type PatPattern } from './pat';

export class PatternLibrary {
  readonly #patterns = new Map<string, PatPattern>();

  /** A library of the given .pat sources, later ones winning on a shared name. */
  constructor(...sources: string[]) {
    for (const s of sources) this.add(s);
  }

  /** Adds a .pat file's patterns (replacing any of the same name); returns what was read. */
  add(source: string): PatFile {
    const file = parsePat(source);
    for (const p of file.patterns) this.#patterns.set(p.name.toUpperCase(), p);
    return file;
  }

  get(name: string): PatPattern | undefined {
    return this.#patterns.get(name.toUpperCase());
  }

  /** The pattern names, as their files spell them. */
  names(): string[] {
    return [...this.#patterns.values()].map((p) => p.name);
  }
}

/** The bundled patterns (`assets/patterns/triya-iso.pat`). */
export const bundledPatterns = (): PatternLibrary => new PatternLibrary(TRIYA_ISO_PAT);

/**
 * The pattern lines a pattern hatch draws: the ones it stores, or else its user-defined
 * lines (DXF 76 = 0: the angle, the spacing in DXF 41 and the double flag) or its predefined
 * or custom pattern from `library` at its angle and scale. Empty when the pattern is unknown;
 * the health report lists missing patterns (M1-25).
 */
export function hatchLines(
  g: Pick<
    HatchGeometry,
    'patternLines' | 'pattern' | 'patternType' | 'patternAngle' | 'patternScale' | 'double'
  >,
  library: PatternLibrary,
): readonly HatchPatternLine[] {
  if (g.patternLines.length > 0) return g.patternLines;
  if (g.patternType === 0) {
    return g.patternScale > 0 ? userDefinedLines(g.patternAngle, g.patternScale, g.double) : [];
  }
  const p = library.get(g.pattern);
  return p ? patternLines(p, { angle: g.patternAngle, scale: g.patternScale }) : [];
}
