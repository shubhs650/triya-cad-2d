// TriyaToAcad for DIMSTYLE records (M1-75 part 9): writes an edited dimension style's changed
// DIMVARs onto its acad-ts record, by handle, and adds the styles the drawing gains under the
// engine's handles (the DIMSTYLE manager, M4-03), the inverse of `dimStyle()` in map/dimvars.ts.
// DIMTXSTY and DIMLTYPE/DIMLTEX1/DIMLTEX2 may name a record the same save adds; the arrow
// blocks (DIMBLK, DIMBLK1, DIMBLK2, DIMLDRBLK) must be blocks the drawing has, as block
// definitions are not written yet.
//
// A DIMVAR the drawing's version has no group for is refused when it changes, as AutoCAD's own
// save to that version drops it (the DIMSTYLE layouts of the ODA's Open Design Specification for
// .dwg, §20.4.53, and the DXF reference's DIMSTYLE groups).

import {
  ACadVersion,
  BlockRecord,
  Color as AcadColor,
  DimensionStyle,
  LineType,
  TextStyle,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type {
  Color,
  DimStyleRecord,
  DimVarValue,
  DocumentInit,
  DocumentModel,
  Handle,
} from '@triya/engine';
import { aciOfTrueColor } from '../map/common';
import { DIMVARS, dimStyle, type DimVarKind, type DimVarProperty } from '../map/dimvars';
import type { CadFormat } from '../read';
import { resolve, same, type Resolver } from './entities';
import { planRecords, XREF_BITS, type RecordPlan } from './records';

export type DimStylePlan = RecordPlan<DimensionStyle, DimStyleRecord>;

interface DimVar {
  readonly code: number;
  readonly kind: DimVarKind;
  readonly prop: DimVarProperty;
}

const VARS: ReadonlyMap<string, DimVar> = new Map(
  DIMVARS.map(([name, code, kind, prop]) => [name, { code, kind, prop }]),
);

/** What each reference variable names. */
const REF_TYPES: Readonly<Record<string, abstract new (...args: never[]) => unknown>> = {
  DIMTXSTY: TextStyle,
  DIMLDRBLK: BlockRecord,
  DIMBLK: BlockRecord,
  DIMBLK1: BlockRecord,
  DIMBLK2: BlockRecord,
  DIMLTYPE: LineType,
  DIMLTEX1: LineType,
  DIMLTEX2: LineType,
};

/**
 * The DIMVARs a DIMSTYLE record gained after R12, by the version that brought them: R13 (the
 * DXF 179 and 270–289 groups and DIMTXSTY), R2000 (fractions, separators, lineweights and the
 * leader arrow, absent from the R13–R14 DWG record), R2007 (fixed extension lines, the jog angle,
 * text fill, the arc symbol and dimension linetypes, which the R2004 DWG record does not have)
 * and R2010 (DIMTXTDIRECTION). DIMADEC (179) is R2000 in the DWG record.
 */
const SINCE: readonly (readonly [ACadVersion, string, readonly string[]])[] = [
  [
    ACadVersion.AC1012,
    'R13',
    [
      'DIMUNIT',
      'DIMDEC',
      'DIMTDEC',
      'DIMALTU',
      'DIMALTTD',
      'DIMAUNIT',
      'DIMJUST',
      'DIMSD1',
      'DIMSD2',
      'DIMTOLJ',
      'DIMTZIN',
      'DIMALTZ',
      'DIMALTTZ',
      'DIMFIT',
      'DIMUPT',
      'DIMTXSTY',
    ],
  ],
  [
    ACadVersion.AC1015,
    'R2000',
    [
      'DIMAZIN',
      'DIMALTRND',
      'DIMADEC',
      'DIMFRAC',
      'DIMLUNIT',
      'DIMDSEP',
      'DIMTMOVE',
      'DIMATFIT',
      'DIMLDRBLK',
      'DIMLWD',
      'DIMLWE',
    ],
  ],
  [
    ACadVersion.AC1021,
    'R2007',
    [
      'DIMFXL',
      'DIMJOGANG',
      'DIMTFILL',
      'DIMTFILLCLR',
      'DIMARCSYM',
      'DIMFXLON',
      'DIMLTYPE',
      'DIMLTEX1',
      'DIMLTEX2',
    ],
  ],
  [ACadVersion.AC1024, 'R2010', ['DIMTXTDIRECTION']],
];

/** AutoCAD 2000 replaced DIMUNIT by DIMLUNIT and DIMFRAC, and DIMFIT by DIMATFIT and DIMTMOVE. */
const OBSOLETE: Readonly<Record<string, string>> = {
  DIMUNIT: 'DIMLUNIT and DIMFRAC',
  DIMFIT: 'DIMATFIT and DIMTMOVE',
};

/** DXF integer group codes (16- and 32-bit), whose DIMVARs hold whole numbers. */
const isIntegerCode = (code: number): boolean =>
  (code >= 60 && code <= 99) ||
  (code >= 170 && code <= 179) ||
  (code >= 270 && code <= 289) ||
  (code >= 370 && code <= 379);

/** The DIMVAR colours, which a R2004+ DWG may hold as true colours (`trueColors`). */
const COLORS = DIMVARS.filter(([, , kind]) => kind === 'color').map(([name]) => name);

/**
 * What a new record's DIMVARs are measured against: the drawing's Standard style, which the
 * DIMSTYLE manager starts a new style from, and which holds what this file's reader gives a
 * variable the version does not store; acad-ts's defaults (AutoCAD's) when there is none.
 */
function newStyleReference(base: DocumentInit): DimStyleRecord {
  const standard = (base.tables?.dimStyles ?? []).find(
    (s) => s.name.toUpperCase() === DimensionStyle.defaultName.toUpperCase(),
  );
  return standard ?? dimStyle(new DimensionStyle(DimensionStyle.defaultName));
}

/** The model's dimension style changes against the original's mapping, and why any cannot be written. */
export function planDimStyles(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver & { readonly created: Map<Handle, CadObject> },
  format: CadFormat | undefined,
): { plan: DimStylePlan; problems: string[] } {
  const reference = newStyleReference(base);
  return planRecords(doc, base.tables?.dimStyles ?? [], model.tables.dimStyles, r, {
    what: 'dimension style',
    type: DimensionStyle,
    make: (a) => new DimensionStyle(a.name),
    // acad-ts's table cannot rename its default entry, which DIMSTYLE commands fall back to.
    fixedNames: [DimensionStyle.defaultName],
    problems: (b, a) => dimStyleProblems(r, doc.header?.version, format, b, a, reference),
  });
}

/** Whether DIMVAR `name` changes from `b`'s. */
const changedVar = (b: DimStyleRecord, a: DimStyleRecord, name: string): boolean =>
  !same(b.vars[name], a.vars[name]);

function dimStyleProblems(
  r: Resolver,
  version: ACadVersion | undefined,
  format: CadFormat | undefined,
  b: DimStyleRecord | undefined,
  a: DimStyleRecord,
  reference: DimStyleRecord,
): string[] {
  const out: string[] = [];
  if ((((b?.flags ?? 0) ^ (a.flags ?? 0)) & XREF_BITS) !== 0)
    out.push('the xref-dependent flags belong to the xref');
  for (const name of Object.keys(a.vars)) {
    if (!VARS.has(name)) out.push(`${name} is not a DIMSTYLE variable`);
  }
  const changed = DIMVARS.map(([name]) => name).filter((n) => changedVar(b ?? reference, a, n));
  for (const name of changed) {
    const problem = valueProblem(r, name, a.vars[name]);
    if (problem) out.push(`${name}: ${problem}`);
  }
  if (version !== undefined && version !== ACadVersion.Unknown) {
    for (const [since, release, names] of SINCE) {
      if (version >= since) continue;
      for (const n of names.filter((n) => changed.includes(n)))
        out.push(`${n}: a DIMSTYLE before ${release} does not store it`);
    }
    if (version >= ACadVersion.AC1015) {
      for (const [n, by] of Object.entries(OBSOLETE))
        if (changed.includes(n)) out.push(`${n}: obsolete since R2000 (${by} replace it)`);
    }
  }
  out.push(...trueColorProblems(version, format, b, a));
  return out;
}

/** Why `value` cannot be DIMVAR `name`'s, if it cannot. */
function valueProblem(
  r: Resolver,
  name: string,
  value: DimVarValue | undefined,
): string | undefined {
  const v = VARS.get(name)!;
  if (v.kind === 'ref') {
    if (value === undefined) {
      // acad-ts keeps a DIMSTYLE's text style non-null, as AutoCAD always names one.
      return name === 'DIMTXSTY' ? 'a dimension style needs a text style' : undefined;
    }
    if (typeof value !== 'string') return 'a reference holds a handle';
    return resolve(r, value, REF_TYPES[name]!) ? undefined : `${value} does not exist`;
  }
  if (value === undefined) return 'it has no value';
  if (v.kind === 'color') {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 256
      ? undefined
      : `${JSON.stringify(value)} is not a colour number (0–256)`;
  }
  const expected = typeof new DimensionStyle()[v.prop];
  if (typeof value !== expected) return `${JSON.stringify(value)} is not a ${expected}`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return `${value} is not a number`;
    if (isIntegerCode(v.code) && !(Number.isInteger(value) && Math.abs(value) < 0x8000))
      return `${value} is not a whole number`;
  }
  if (name === 'DIMDSEP' && [...(value as string)].length !== 1)
    return 'the decimal separator is one character';
  // acad-ts's setters hold AutoCAD's ranges (DIMSCALE and DIMASZ 0 or more, DIMTXT more than 0,
  // DIMJOGANG between 5° and 90°): a dry run on a record of its own.
  try {
    (new DimensionStyle() as unknown as Record<string, unknown>)[v.prop] = value;
  } catch (e) {
    return (e as Error).message;
  }
  return undefined;
}

/**
 * DIMVAR true colours: an R2004+ DWG stores the colour itself, every other format only the ACI
 * AutoCAD derives from it, which `vars` must then hold (the mapping derives it the same way).
 */
function trueColorProblems(
  version: ACadVersion | undefined,
  format: CadFormat | undefined,
  b: DimStyleRecord | undefined,
  a: DimStyleRecord,
): string[] {
  const out: string[] = [];
  for (const name of COLORS) {
    const was = b?.trueColors?.[name];
    const now = a.trueColors?.[name];
    // A colour number of its own goes with removing the true colour, which takes precedence.
    if (now === undefined || (same(was, now) && same(b?.vars[name], a.vars[name]))) continue;
    if (now.kind !== 'rgb') out.push(`${name}: a true colour is an RGB colour`);
    else if (now.bookName !== undefined) out.push(`${name}: colour-book colours`);
    else if (format !== 'dwg' || (version !== undefined && version < ACadVersion.AC1018))
      out.push(`${name}: only an R2004+ DWG stores a DIMSTYLE true colour`);
    else if (a.vars[name] !== aciOfTrueColor(now.r, now.g, now.b))
      out.push(`${name}: its colour number is not the one AutoCAD gives the true colour`);
  }
  return out;
}

/** Writes DIMVAR `name` (absent: a reference to nothing). */
function writeVar(r: Resolver, s: DimensionStyle, name: string, a: DimStyleRecord): void {
  const v = VARS.get(name)!;
  const value = a.vars[name];
  const target = s as unknown as Record<string, unknown>;
  if (v.kind === 'ref') {
    target[v.prop] = value === undefined ? null : resolve(r, value as Handle, REF_TYPES[name]!);
  } else if (v.kind === 'color') {
    const t: Color | undefined = a.trueColors?.[name];
    target[v.prop] =
      t?.kind === 'rgb' ? new AcadColor(t.r, t.g, t.b) : new AcadColor(value as number);
  } else {
    target[v.prop] = value;
  }
}

/** Writes the DIMVARs of `a` that differ from `b` (every one when `b` is undefined). */
function writeDimStyle(
  r: Resolver,
  s: DimensionStyle,
  b: DimStyleRecord | undefined,
  a: DimStyleRecord,
): void {
  if (b && b.name !== a.name) s.name = a.name;
  if (!b || b.flags !== a.flags) s.flags = (a.flags ?? 0) as never;
  for (const [name] of DIMVARS) {
    const colorChanged = !same(b?.trueColors?.[name], a.trueColors?.[name]);
    if (!b || !same(b.vars[name], a.vars[name]) || colorChanged) writeVar(r, s, name, a);
  }
}

/** Writes the planned dimension style changes onto `doc`; new styles join its DIMSTYLE table first. */
export function writeDimStyles(doc: CadDocument, r: Resolver, plan: DimStylePlan): void {
  for (const { acad, after } of plan.added) {
    doc.dimensionStyles!.add(acad);
    writeDimStyle(r, acad, undefined, after);
  }
  for (const { acad, before, after } of plan.updated) writeDimStyle(r, acad, before, after);
}
