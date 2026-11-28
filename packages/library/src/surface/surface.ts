// Surface texture symbols (M8-02 part 3, DEC-094): the graphical symbol of ISO 1302 or ASME
// Y14.36 with the requirements a drafter states, as a block based at the symbol's point, on the
// surface.
//
// The symbol: two legs at 60° to the surface from the base point, the short one 1.4h high and
// the long one 3h (ISO 1302's H1 and H2 for a text height h), the long one 1.25h longer for a
// second requirement. Material removal required closes the V with a bar at the short leg's top;
// prohibited puts a circle in the V, touching both legs and the bar's height; any process has
// neither. The extension runs right from the long leg's top for the drafter's length; all around
// is a circle at that corner.
//
// Requirements (positions a to e of ISO 1302 §3.4): ISO writes the first requirement (a) and the
// second (b) under the extension, right of the long leg, the method (c) above the extension.
// ASME Y14.36 drafters write the roughness value in the V, above the short leg and left of the
// long leg (a maximum over a minimum), and draw the extension only for a method or all around.
// Both put the lay (d) at the foot of the long leg on its right and the machining allowance (e)
// left of the short leg. Each text is placed by its alignment point so that none depends on its
// width (DEC-093).
import type { ChangeSetBuilder, DocumentModel, Handle } from '@triya/engine';
import { addPartsBlock } from '../block';
import { circle, line, type LibraryPart } from '../parts';
import {
  BOTTOM,
  LEFT,
  MIDDLE,
  RIGHT,
  TOP,
  currentTextStyle,
  digest,
  figure,
  oneLine,
  text,
} from '../texts';

export type SurfaceStandard = 'ISO' | 'ASME';

export const SURFACE_STANDARD_NAMES: Readonly<Record<SurfaceStandard, string>> = {
  ISO: 'ISO 1302',
  ASME: 'ASME Y14.36',
};

export const SURFACE_PROCESSES = ['any', 'removal-required', 'removal-prohibited'] as const;

export type SurfaceProcess = (typeof SURFACE_PROCESSES)[number];

export const SURFACE_PROCESS_NAMES: Readonly<Record<SurfaceProcess, string>> = {
  any: 'any process allowed',
  'removal-required': 'material removal required',
  'removal-prohibited': 'material removal prohibited',
};

/** ISO 1302's abbreviations, for the block name. */
const PROCESS_CODES: Readonly<Record<SurfaceProcess, string>> = {
  any: 'APA',
  'removal-required': 'MRR',
  'removal-prohibited': 'NMR',
};

export const SURFACE_LAYS = [
  'parallel',
  'perpendicular',
  'crossed',
  'multidirectional',
  'circular',
  'radial',
  'particulate',
] as const;

export type SurfaceLay = (typeof SURFACE_LAYS)[number];

/** The lay's symbol: = and ⊥ are drawn, the letters written. */
export const SURFACE_LAY_SYMBOLS: Readonly<Record<SurfaceLay, string>> = {
  parallel: '=',
  perpendicular: '⊥',
  crossed: 'X',
  multidirectional: 'M',
  circular: 'C',
  radial: 'R',
  particulate: 'P',
};

export interface SurfaceFinishSpec {
  readonly standard: SurfaceStandard;
  readonly process: SurfaceProcess;
  /** Position a: the requirement (ISO `Ra 3.2`, ASME `125` µin or a maximum). */
  readonly requirement?: string;
  /** Position b: a second requirement (ISO), or the minimum under a maximum (ASME). */
  readonly secondRequirement?: string;
  /** Position c: the manufacturing method (`milled`, `GRIND`). */
  readonly method?: string;
  /** Position d: the lay's direction. */
  readonly lay?: SurfaceLay;
  /** Position e: the machining allowance. */
  readonly allowance?: string;
  readonly allAround?: boolean;
  /** The text height, which sets the symbol's, in drawing units. */
  readonly height: number;
  /** The extension's length, long enough for the texts under or over it. */
  readonly extensionLength: number;
}

/** A machined 125 µin surface, ASME Y14.36, in inches (the palette scales by `drawingScale`). */
export const SURFACE_FINISH_DEFAULTS: SurfaceFinishSpec = {
  standard: 'ASME',
  process: 'removal-required',
  requirement: '125',
  height: 0.125,
  extensionLength: 0.75,
};

/** Each standard's usual general requirement: Ra 3.2 µm, or 125 µin Ra. */
const USUAL: Readonly<Record<SurfaceStandard, string>> = { ISO: 'Ra 3.2', ASME: '125' };

/**
 * The defaults with each length multiplied by `scale` (25.4 for a drawing in millimetres), in
 * `standard` with its usual requirement.
 */
export function surfaceFinishDefaults(
  scale = 1,
  standard: SurfaceStandard = 'ASME',
): SurfaceFinishSpec {
  const d = SURFACE_FINISH_DEFAULTS;
  return {
    ...d,
    standard,
    requirement: USUAL[standard],
    height: d.height * scale,
    extensionLength: d.extensionLength * scale,
  };
}

const ROOT3 = Math.sqrt(3);
/** ISO 1302's H1 and H2, in h. */
const SHORT = 1.4;
const LONG = 3;
/** A text line's pitch and the gap between a text and a line, in h. */
const PITCH = 1.25;
const GAP = 0.25;
/** The all-around circle's radius, in h. */
const AROUND = 0.4;

/** The long leg's x at height y (both in h): it rises at 60°. */
const legX = (y: number) => y / ROOT3;

/** Whether the symbol has its extension: ISO with any of a to c, ASME with c; all around. */
function extended(spec: SurfaceFinishSpec): boolean {
  if (spec.allAround || spec.method) return true;
  return spec.standard === 'ISO' && !!(spec.requirement || spec.secondRequirement);
}

/** The pieces of the symbol `spec` (in drawing units) about its point, its texts in `style`. */
export function surfaceFinishParts(spec: SurfaceFinishSpec, style: Handle): LibraryPart[] {
  const h = spec.height;
  const p = (x: number, y: number) => ({ x: x * h, y: y * h });
  const long = LONG + (spec.secondRequirement ? PITCH : 0);
  const shortTop = p(-legX(SHORT), SHORT);
  const longTop = p(legX(long), long);
  const parts: LibraryPart[] = [];
  const add = (geom: LibraryPart['geom']) => parts.push({ role: 'visible', geom });

  add(line({ x: 0, y: 0 }, shortTop));
  add(line({ x: 0, y: 0 }, longTop));
  if (spec.process === 'removal-required') add(line(shortTop, p(legX(SHORT), SHORT)));
  // The incircle of the equilateral V up to the bar's height.
  if (spec.process === 'removal-prohibited') add(circle((SHORT / 3) * h, p(0, (2 * SHORT) / 3)));
  if (extended(spec)) add(line(longTop, { x: longTop.x + spec.extensionLength, y: longTop.y }));
  if (spec.allAround) add(circle(AROUND * h, longTop));

  const say = (value: string, x: number, y: number, halign: number, valign: number) =>
    parts.push(text(value, p(x, y), h, halign, valign, style));
  // Texts along the extension start clear of the all-around circle at its corner.
  const clear = spec.allAround ? legX(long) + AROUND + GAP : -Infinity;
  if (spec.method) say(spec.method, Math.max(legX(long) + GAP, clear), long + GAP, LEFT, BOTTOM);
  if (spec.standard === 'ISO') {
    // Under the extension, each text starting right of the leg at its top.
    const a = long - GAP;
    if (spec.requirement) say(spec.requirement, Math.max(legX(a) + GAP, clear), a, LEFT, TOP);
    const b = a - PITCH;
    if (spec.secondRequirement) say(spec.secondRequirement, legX(b) + GAP, b, LEFT, TOP);
  } else {
    // In the V, each text ending left of the leg at its foot: the minimum, then the maximum.
    const low = SHORT + GAP;
    const values = [spec.secondRequirement, spec.requirement].filter((v): v is string => !!v);
    values.forEach((v, i) => say(v, legX(low + i * PITCH) - GAP, low + i * PITCH, RIGHT, BOTTOM));
  }

  if (spec.lay) {
    // A band 0.2h to 1.2h high, starting right of the long leg at the band's top.
    const x0 = legX(1.2) + 0.3;
    if (spec.lay === 'parallel') {
      add(line(p(x0, 0.55), p(x0 + 0.8, 0.55)));
      add(line(p(x0, 0.85), p(x0 + 0.8, 0.85)));
    } else if (spec.lay === 'perpendicular') {
      add(line(p(x0, 0.2), p(x0 + 0.8, 0.2)));
      add(line(p(x0 + 0.4, 0.2), p(x0 + 0.4, 1.2)));
    } else {
      say(SURFACE_LAY_SYMBOLS[spec.lay], x0, 0.7, LEFT, MIDDLE);
    }
  }
  if (spec.allowance) {
    // Mid-height on the short leg, ending left of the leg at the text's top (a wider gap: a
    // stroke font's figures have next to no side bearing, and 0.25h looked to touch the leg).
    const y = SHORT / 2;
    say(spec.allowance, -legX(y + 0.5) - 2 * GAP, y, RIGHT, MIDDLE);
  }
  return parts;
}

/** Why `spec` is not a symbol ISO 1302 or ASME Y14.36 draws, or undefined when it is. */
export function checkSurfaceFinish(spec: SurfaceFinishSpec): string | undefined {
  if (spec.standard !== 'ISO' && spec.standard !== 'ASME')
    return `${String(spec.standard)} is not a standard`;
  if (!SURFACE_PROCESSES.includes(spec.process)) return `${String(spec.process)} is not a process`;
  if (spec.lay !== undefined && !SURFACE_LAYS.includes(spec.lay))
    return `${String(spec.lay)} is not a lay`;
  for (const [key, label] of [
    ['height', 'height'],
    ['extensionLength', 'extension length'],
  ] as const) {
    const v = spec[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${label} must be a number`;
    if (v <= 0) return `${label} must be more than 0`;
  }
  if (extended(spec) && spec.extensionLength < 2 * spec.height)
    return 'extension length must be at least twice the height';
  if (spec.secondRequirement && !spec.requirement) return 'a second requirement needs a first';
  for (const [key, label] of [
    ['requirement', 'requirement'],
    ['secondRequirement', 'second requirement'],
    ['method', 'method'],
    ['allowance', 'allowance'],
  ] as const) {
    if (!oneLine(spec[key])) return `${label} must be one line`;
  }
  return undefined;
}

/**
 * "Surface texture, ISO 1302: material removal required; Ra 3.2; …; height 0.125, extension
 * 0.75": everything the symbol is drawn from.
 */
export function surfaceFinishDescription(spec: SurfaceFinishSpec): string {
  const said = [
    SURFACE_PROCESS_NAMES[spec.process],
    spec.requirement,
    spec.secondRequirement,
    spec.method && `method ${spec.method}`,
    spec.lay && `lay ${SURFACE_LAY_SYMBOLS[spec.lay]} (${spec.lay})`,
    spec.allowance && `allowance ${spec.allowance}`,
    spec.allAround && 'all around',
    `height ${figure(spec.height)}, extension ${figure(spec.extensionLength)}`,
  ].filter(Boolean);
  return `Surface texture, ${SURFACE_STANDARD_NAMES[spec.standard]}: ${said.join('; ')}`;
}

/**
 * The block's name: `TRIYA_SURF_<standard>_<APA|MRR|NMR>_<digest>`, ISO 1302's abbreviation of
 * the process and a digest of the description (the requirements may hold characters a block
 * name cannot).
 */
export function surfaceFinishName(spec: SurfaceFinishSpec): string {
  return [
    'TRIYA_SURF',
    spec.standard,
    PROCESS_CODES[spec.process],
    digest(surfaceFinishDescription(spec)),
  ].join('_');
}

/**
 * The handle of the drawing's block for the symbol `spec` (in the drawing's units), adding it,
 * its texts in the current text style, when the drawing lacks it. Undefined, with nothing
 * added, when `spec` is no surface texture symbol or the drawing has no text style.
 */
export function addSurfaceFinishBlock(
  b: ChangeSetBuilder,
  model: DocumentModel,
  spec: SurfaceFinishSpec,
): Handle | undefined {
  if (checkSurfaceFinish(spec) !== undefined) return undefined;
  const style = currentTextStyle(model);
  if (style === undefined) return undefined;
  return addPartsBlock(b, model, surfaceFinishName(spec), surfaceFinishDescription(spec), () =>
    surfaceFinishParts(spec, style),
  );
}
