// The CENTER* variables new center marks and centerlines take (M4-08 part 3; AutoCAD 2024 Help,
// "CENTERCROSSSIZE", "CENTERCROSSGAP", "CENTEREXE", "CENTERMARKEXE", "CENTERLTYPE",
// "CENTERLTSCALE", "CENTERLAYER"). AutoCAD saves each in the drawing, as a DICTIONARYVAR (text):
// Triya reads them there and SETVAR sets them there, and a drawing without one keeps the value
// SETVAR gives it for the session (io's session-only variables), as FIELDEVAL is kept.
//
// CENTERLTYPEFILE, the .lin file AutoCAD loads CENTERLTYPE from, is a registry setting for
// AutoCAD's own acad.lin, which Triya does not ship: loading a linetype is roadmap M5-08.
import type { HeaderValue } from '../model/types';

/** What a drawing states its variables in, and how it was opened. */
export interface CenterSource {
  readonly header: ReadonlyMap<string, HeaderValue>;
  readonly meta?: { readonly measurement?: 'imperial' | 'metric' };
}

/** Whether the drawing is metric: $MEASUREMENT when it states it, else how it was opened. */
function metric(model: CenterSource): boolean {
  const m = model.header.get('$MEASUREMENT');
  return typeof m === 'number' ? m === 1 : model.meta?.measurement === 'metric';
}

/**
 * AutoCAD's initial values, as the DICTIONARYVARs hold them (text): CENTEREXE is 0.12 in
 * imperial drawings and 3.5 in metric ones; CENTERLAYER "." is the current layer.
 */
export const CENTER_VARIABLES: Readonly<Record<string, string | ((m: CenterSource) => string)>> = {
  CENTERCROSSSIZE: '0.1x',
  CENTERCROSSGAP: '0.05x',
  CENTEREXE: (m) => (metric(m) ? '3.500000' : '0.120000'),
  CENTERMARKEXE: '1',
  CENTERLTYPE: 'CENTER2',
  CENTERLTSCALE: '1.000000',
  CENTERLAYER: '.',
};

/** A CENTERCROSSSIZE-style value for a circle of `diameter`: `0.1x` is a tenth of it. */
export function centerLength(text: string, diameter: number): number {
  const t = text.trim();
  const relative = /x$/i.test(t);
  const n = Number(relative ? t.slice(0, -1) : t);
  if (!Number.isFinite(n) || n < 0) return 0;
  return relative ? n * diameter : n;
}

/** Whether `text` is a value CENTERCROSSSIZE or CENTERCROSSGAP takes. */
export const isCenterLength = (text: string): boolean =>
  /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?x?$/i.test(text.trim());

/** The settings a new mark takes (the CENTER* variables). */
export interface CenterSettings {
  /** CENTERCROSSSIZE: a length, or a factor of the diameter followed by `x`. */
  readonly crossSize: string;
  /** CENTERCROSSGAP, the same way. */
  readonly crossGap: string;
  /** CENTEREXE: how far extension lines go past the object. */
  readonly extension: number;
  /** CENTERMARKEXE: a center mark has extension lines. */
  readonly showExtensions: boolean;
  /** CENTERLTYPE: a linetype's name, or "." for the current linetype. */
  readonly linetype: string;
  /** CENTERLTSCALE. */
  readonly ltScale: number;
  /** CENTERLAYER: a layer's name, or "." for the current layer. */
  readonly layer: string;
}

/** AutoCAD's initial values. */
export function defaultCenterSettings(isMetric: boolean): CenterSettings {
  return {
    crossSize: '0.1x',
    crossGap: '0.05x',
    extension: isMetric ? 3.5 : 0.12,
    showExtensions: true,
    linetype: 'CENTER2',
    ltScale: 1,
    layer: '.',
  };
}

/** The settings the drawing states (the session's value of a variable it has none of), else AutoCAD's. */
export function centerSettings(model: CenterSource): CenterSettings {
  const out = defaultCenterSettings(metric(model));
  const text = (name: string): string | undefined => {
    const v = model.header.get(name);
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? '1' : '0';
    return undefined;
  };
  const number = (name: string): number | undefined => {
    const t = text(name);
    const n = t === undefined || t === '' ? NaN : Number(t);
    return Number.isFinite(n) ? n : undefined;
  };
  const size = text('CENTERCROSSSIZE');
  const gap = text('CENTERCROSSGAP');
  const exe = number('CENTEREXE');
  const show = number('CENTERMARKEXE');
  const linetype = text('CENTERLTYPE');
  const ltScale = number('CENTERLTSCALE');
  const layer = text('CENTERLAYER');
  return {
    crossSize: size !== undefined && isCenterLength(size) ? size : out.crossSize,
    crossGap: gap !== undefined && isCenterLength(gap) ? gap : out.crossGap,
    extension: exe !== undefined && exe >= 0 ? exe : out.extension,
    showExtensions: show === undefined ? out.showExtensions : show !== 0,
    linetype: linetype || out.linetype,
    ltScale: ltScale !== undefined && ltScale > 0 ? ltScale : out.ltScale,
    layer: layer || out.layer,
  };
}
