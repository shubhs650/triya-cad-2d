// Drawing health report v1 (M1-25), second step: the file's facts (facts.ts) set against the
// fonts and patterns the app has loaded. The app runs it on the main thread, which must not
// load acad-ts, so it is its own entry (`@triya/io/health`) and imports facts.ts for types
// only; the I/O worker, which only gathers facts, does not load the font and pattern code.

import { bundledPatterns } from '@triya/hatch';
import { styleFont, type MTextFont } from '@triya/text';
import type { DrawingFacts, DrawingReference } from './facts';

export type { DrawingFacts, DrawingReference } from './facts';

/** The app's loaded fonts, as `FontBook` provides them, asked without recording anything. */
export interface HealthFonts {
  /** How a text font draws: its own face, a stand-in (by file key), or nothing. */
  resolve(font: MTextFont): { readonly face?: unknown; readonly substitute?: string };
  /** Whether a big font or shape file is loaded. */
  hasShx(name: string): boolean;
}

/** A font file the app could not read or parse (M1-38): `TtfRegistry.warnings` or a user file. */
export interface FontError {
  /** Where it came from, as the app names it: "Your fonts", "This computer". */
  readonly source: string;
  /** The file or family name. */
  readonly font: string;
  readonly problem: string;
}

export interface HealthSources {
  readonly fonts: HealthFonts;
  /** The app's font errors; every one is listed, whether or not this drawing names it. */
  readonly fontErrors?: readonly FontError[];
  /** Fonts installed on this computer the app draws with (M1-38 part 2), by the name asked for. */
  readonly installed?: readonly { readonly requested: string; readonly face: string }[];
  /** The patterns hatches stored without lines draw from; the bundled set when not given. */
  readonly patterns?: { get(name: string): unknown };
}

export interface MissingFont {
  /** As the drawing names it. */
  readonly font: string;
  /** The loaded font (file key) that draws it instead; undefined when nothing does. */
  readonly substitute: string | undefined;
  /** Text styles that name it (as primary, big font or shape file). */
  readonly styles: readonly string[];
}

export interface HealthReport {
  readonly version: { readonly code: string; readonly release: string | undefined };
  readonly units: {
    readonly insUnits: number;
    readonly name: string;
    readonly measurement: 'imperial' | 'metric';
  };
  readonly fonts: {
    readonly missing: readonly MissingFont[];
    /** Font files that could not be read or parsed, with this drawing's styles naming each. */
    readonly errors: readonly (FontError & { readonly styles: readonly string[] })[];
    /** This drawing's fonts drawn with a face installed on this computer, and which face. */
    readonly installed: readonly {
      readonly font: string;
      readonly face: string;
      readonly styles: readonly string[];
    }[];
  };
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
 * list does not wait for the text to be drawn. Fonts MTEXT names inline (`\F`) are not in the
 * facts yet (M8-07).
 */
export function healthReport(facts: DrawingFacts, sources: HealthSources): HealthReport {
  const { fonts } = sources;
  const patterns = sources.patterns ?? bundledPatterns();
  // Font name → what draws it and the styles naming it. Asked of this drawing's styles only:
  // the app's one FontBook serves every open drawing.
  const missingFonts = new Map<string, { substitute: string | undefined; styles: Set<string> }>();
  const miss = (font: string, style: string, substitute: string | undefined) => {
    const m = missingFonts.get(font) ?? { substitute, styles: new Set<string>() };
    m.styles.add(style);
    missingFonts.set(font, m);
  };
  for (const s of facts.textStyles) {
    if (s.shapeFile) {
      // A shape file draws linetype shapes, never text, so no text font stands in for it.
      if (!fonts.hasShx(s.font)) miss(s.font, s.name, undefined);
      continue;
    }
    const r = fonts.resolve(styleFont(s));
    if (!r.face || r.substitute !== undefined) miss(s.font, s.name, r.substitute);
    // A big font's characters have no stand-in either.
    if (s.bigFont && !fonts.hasShx(s.bigFont)) miss(s.bigFont, s.name, undefined);
  }
  const missing = [...missingFonts]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([font, m]) => ({ font, substitute: m.substitute, styles: [...m.styles].sort() }));
  const naming = stylesNaming(facts);
  const byFont = <T extends { font: string }>(a: T, b: T) =>
    a.font.toLowerCase() < b.font.toLowerCase()
      ? -1
      : a.font.toLowerCase() > b.font.toLowerCase()
        ? 1
        : 0;
  const errors = (sources.fontErrors ?? [])
    .map((e) => ({ font: e.font, source: e.source, problem: e.problem, styles: naming(e.font) }))
    .sort(byFont);
  const installed = (sources.installed ?? [])
    .map((u) => ({ font: u.requested, face: u.face, styles: naming(u.requested) }))
    .filter((u) => u.styles.length > 0)
    .sort(byFont);
  const total = (rows: readonly { count: number }[]) => rows.reduce((n, r) => n + r.count, 0);
  return {
    version: { code: facts.version, release: RELEASES[facts.version] },
    units: {
      insUnits: facts.insUnits,
      name: INSUNITS[facts.insUnits] ?? `Unknown (${facts.insUnits})`,
      measurement: facts.measurement,
    },
    fonts: { missing, errors, installed },
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

/** A font name as files are matched: no folder, extension or case (`C:\Fonts\Arial.TTF` → arial). */
const fontKey = (name: string) =>
  (name.split(/[\\/]/).pop() ?? name).replace(/\.(shx|ttf|otf|ttc)$/i, '').toLowerCase();

/** The text styles of a drawing that name a font, as primary font, big font or shape file. */
function stylesNaming(facts: DrawingFacts): (font: string) => string[] {
  const styles = new Map<string, Set<string>>();
  for (const s of facts.textStyles) {
    for (const f of [s.font, s.bigFont]) {
      if (!f) continue;
      const set = styles.get(fontKey(f)) ?? new Set<string>();
      set.add(s.name);
      styles.set(fontKey(f), set);
    }
  }
  return (font) => [...(styles.get(fontKey(font)) ?? [])].sort();
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
