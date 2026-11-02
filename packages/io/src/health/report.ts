// Drawing health report v1 (M1-25), second step: the file's facts (facts.ts) set against the
// fonts and patterns the app has loaded. The app runs it on the main thread, which must not
// load acad-ts, so it is its own entry (`@triya/io/health`) and imports facts.ts for types
// only; the I/O worker, which only gathers facts, does not load the font and pattern code.

import { bundledPatterns } from '@triya/hatch';
import { styleFont, type TextFonts } from '@triya/text';
import type { DrawingFacts, DrawingReference } from './facts';

export type { DrawingFacts, DrawingReference } from './facts';

/** The app's loaded fonts, as `FontBook` provides them. */
export interface HealthFonts extends TextFonts {
  readonly missing: ReadonlySet<string>;
  readonly substitutions: ReadonlyMap<string, string>;
}

export interface HealthSources {
  readonly fonts: HealthFonts;
  /** The patterns hatches stored without lines draw from; the bundled set when not given. */
  readonly patterns?: { get(name: string): unknown };
}

export interface MissingFont {
  /** As the drawing names it. */
  readonly font: string;
  /** The loaded font (file key) that draws it instead; undefined when nothing does. */
  readonly substitute: string | undefined;
  /** Text styles that name it (as primary, big font or shape file); empty for MTEXT `\F`. */
  readonly styles: readonly string[];
}

export interface HealthReport {
  readonly version: { readonly code: string; readonly release: string | undefined };
  readonly units: {
    readonly insUnits: number;
    readonly name: string;
    readonly measurement: 'imperial' | 'metric';
  };
  readonly fonts: { readonly missing: readonly MissingFont[] };
  /** Not looked for yet: finding the files is the references palette's job (M1-21). */
  readonly references: readonly (DrawingReference & { readonly status: 'unchecked' })[];
  readonly patterns: {
    readonly missing: readonly { readonly pattern: string; readonly hatches: number }[];
  };
  readonly unknownObjects: {
    readonly total: number;
    readonly byType: DrawingFacts['unknownObjects'];
  };
  readonly unmappedEntities: {
    readonly total: number;
    readonly byType: DrawingFacts['unmappedEntities'];
  };
}

/**
 * The health report of a drawing whose facts are `facts`, given the app's fonts and patterns.
 * Each text style's fonts are resolved through `fonts` as drawing them would, so the missing
 * list does not wait for the text to be drawn; fonts already recorded as missing (MTEXT `\F`
 * fonts drawn so far) are listed too.
 */
export function healthReport(facts: DrawingFacts, sources: HealthSources): HealthReport {
  const { fonts } = sources;
  const patterns = sources.patterns ?? bundledPatterns();
  const named = new Map<string, Set<string>>();
  const name = (font: string, style: string) => {
    const set = named.get(font) ?? new Set<string>();
    set.add(style);
    named.set(font, set);
  };
  const shapesMissing = new Set<string>();
  for (const s of facts.textStyles) {
    if (s.shapeFile) {
      // A shape file draws linetype shapes, never text, so no text font stands in for it.
      if (!fonts.bigFont(s.font)) shapesMissing.add(s.font);
      name(s.font, s.name);
      continue;
    }
    fonts.face(styleFont(s));
    name(s.font, s.name);
    if (s.bigFont) {
      fonts.bigFont(s.bigFont);
      name(s.bigFont, s.name);
    }
  }
  const missing = [...new Set([...fonts.missing, ...shapesMissing])].sort().map((font) => ({
    font,
    substitute: shapesMissing.has(font) ? undefined : fonts.substitutions.get(font),
    styles: [...(named.get(font) ?? [])].sort(),
  }));
  const total = (rows: readonly { count: number }[]) => rows.reduce((n, r) => n + r.count, 0);
  return {
    version: { code: facts.version, release: RELEASES[facts.version] },
    units: {
      insUnits: facts.insUnits,
      name: INSUNITS[facts.insUnits] ?? `Unknown (${facts.insUnits})`,
      measurement: facts.measurement,
    },
    fonts: { missing },
    references: facts.references.map((r) => ({ ...r, status: 'unchecked' as const })),
    patterns: {
      missing: facts.patternHatches
        .filter((p) => patterns.get(p.pattern) === undefined)
        .map((p) => ({ pattern: p.pattern, hatches: p.count })),
    },
    unknownObjects: { total: total(facts.unknownObjects), byType: facts.unknownObjects },
    unmappedEntities: { total: total(facts.unmappedEntities), byType: facts.unmappedEntities },
  };
}

/**
 * The release that introduced each format, as AutoCAD's Save As list names it (AC1032 is
 * "AutoCAD 2018", also written by 2019 to 2025).
 * https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-A85E8E67-27CD-4C59-BE61-4DC9FADBE74A
 */
const RELEASES: Readonly<Record<string, string>> = {
  AC1002: 'AutoCAD R2.5',
  AC1003: 'AutoCAD R2.6',
  AC1004: 'AutoCAD R9',
  AC1006: 'AutoCAD R10',
  AC1009: 'AutoCAD R11/R12',
  AC1012: 'AutoCAD R13',
  AC1014: 'AutoCAD R14',
  AC1015: 'AutoCAD 2000',
  AC1018: 'AutoCAD 2004',
  AC1021: 'AutoCAD 2007',
  AC1024: 'AutoCAD 2010',
  AC1027: 'AutoCAD 2013',
  AC1032: 'AutoCAD 2018',
};

/** `$INSUNITS` values as AutoCAD 2024's help for the INSUNITS system variable lists them. */
const INSUNITS: readonly string[] = [
  'Unspecified (no units)',
  'Inches',
  'Feet',
  'Miles',
  'Millimeters',
  'Centimeters',
  'Meters',
  'Kilometers',
  'Microinches',
  'Mils',
  'Yards',
  'Angstroms',
  'Nanometers',
  'Microns',
  'Decimeters',
  'Decameters',
  'Hectometers',
  'Gigameters',
  'Astronomical Units',
  'Light Years',
  'Parsecs',
  'US Survey Feet',
  'US Survey Inches',
  'US Survey Yards',
  'US Survey Miles',
];
