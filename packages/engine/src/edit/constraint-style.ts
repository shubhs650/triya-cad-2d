// An annotational dimensional constraint's dimension style (M9-03 part 15, DEC-088). AutoCAD
// 2024 Help, "About Applying Dimensional Constraints": annotational constraints "display using
// the current dimension style", and their appearance is changed in the Properties palette, as
// a dimension's is. A constraint made (or turned) annotational takes the current style and the
// DIMVARs the header sets over it ("<style overrides>", as a new dimension's `DSTYLE` list
// takes them, M2-31); the palette changes its style and its own DIMVARs.
//
// Triya draws a constraint with fewer of a style's DIMVARs than a dimension: the arrows
// (DIMASZ), extension lines (DIMEXE, DIMEXO), text height and gap (DIMTXT, DIMGAP), all times
// DIMSCALE. Those are the ones it keeps and the palette shows; the text's style, colours and
// units follow the constraint display's own rules (CONSTRAINTNAMEFORMAT, LUNITS/LUPREC).
//
// A constraint saved before DEC-088 names no style: it is drawn with the header's DIMVARs (the
// current style and its overrides), as before.

import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { DimensionalConstraintObject, DimStyleRecord } from '../model/types';
import { DIMVAR_DEFAULTS } from '../properties/dimension';
import { currentDimStyle, headerDimvarOverrides } from './dimension';

/** The DIMVARs an annotational constraint is drawn with, the ones it may override. */
export const CONSTRAINT_DIMVARS = [
  'DIMASZ',
  'DIMEXE',
  'DIMEXO',
  'DIMGAP',
  'DIMSCALE',
  'DIMTXT',
] as const;

export type ConstraintDimvar = (typeof CONSTRAINT_DIMVARS)[number];

/** Each of `CONSTRAINT_DIMVARS`' values. */
export type ConstraintDimvars = Readonly<Record<ConstraintDimvar, number>>;

export const isConstraintDimvar = (name: string): name is ConstraintDimvar =>
  (CONSTRAINT_DIMVARS as readonly string[]).includes(name);

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** The constraint's own DIMVARs among `vars` (the numeric ones it draws with). */
function ownOf(vars: Readonly<Record<string, unknown>>): Partial<Record<ConstraintDimvar, number>> {
  const out: Partial<Record<ConstraintDimvar, number>> = {};
  for (const name of CONSTRAINT_DIMVARS) {
    const v = num(vars[name]);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

/** The style `c` names, when the drawing still has it. */
export function constraintDimStyle(
  model: DocumentModel,
  c: Pick<DimensionalConstraintObject, 'style'>,
): DimStyleRecord | undefined {
  return c.style === undefined ? undefined : model.tables.dimStyles.get(c.style);
}

/**
 * The style `c` is drawn with, as the palette's Dim style shows it: its own, else (saved before
 * DEC-088, or its style purged) the current one.
 */
export function shownDimStyle(
  model: DocumentModel,
  c: Pick<DimensionalConstraintObject, 'style'>,
): DimStyleRecord | undefined {
  return constraintDimStyle(model, c) ?? currentDimStyle(model);
}

/**
 * What `c` is drawn with: its style's DIMVARs (AutoCAD's defaults where it states none) and
 * its own over them; with no style of its own, the header's (the current style and the DIMVARs
 * set over it) and its own over them.
 */
export function constraintDimvars(
  model: DocumentModel,
  c: Pick<DimensionalConstraintObject, 'style' | 'dimvars'>,
): ConstraintDimvars {
  const style = constraintDimStyle(model, c);
  const out = {} as Record<ConstraintDimvar, number>;
  for (const name of CONSTRAINT_DIMVARS) {
    const from = style ? style.vars[name] : model.header.get(`$${name}`);
    out[name] = c.dimvars?.[name] ?? num(from) ?? (DIMVAR_DEFAULTS[name] as number);
  }
  return out;
}

/**
 * The style fields a constraint made annotational now takes: the current style and the header's
 * overrides of it among the DIMVARs it draws with. Nothing when the drawing has no style.
 */
export function newConstraintStyle(
  model: DocumentModel,
): Pick<DimensionalConstraintObject, 'style' | 'dimvars'> {
  const style = currentDimStyle(model);
  if (!style) return {};
  const own = ownOf(headerDimvarOverrides(model, style));
  return { style: style.handle, ...(Object.keys(own).length > 0 && { dimvars: own }) };
}

/**
 * The style fields of a constraint DCCONVERT makes from a dimension drawn in style `style` with
 * `DSTYLE` overrides `overrides`: the dimension's style and its overrides among the DIMVARs a
 * constraint draws with, so it looks as the dimension did.
 */
export function convertedConstraintStyle(
  style: Handle,
  overrides: Readonly<Record<string, unknown>>,
): Pick<DimensionalConstraintObject, 'style' | 'dimvars'> {
  const own = ownOf(overrides);
  return { style, ...(Object.keys(own).length > 0 && { dimvars: own }) };
}
