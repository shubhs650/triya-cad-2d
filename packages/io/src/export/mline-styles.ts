// TriyaToAcad for MLINESTYLE objects (M1-75 part 31): writes an edited multiline style's changed
// fields onto its acad-ts object, by handle, and adds the styles the drawing gains under the
// engine's handles (MLSTYLE New, M2's MLINE with a new current style), the inverse of
// `mlineStyle()` in map/styles.ts. Like a multileader style, an MLINE style is an object named by
// its ACAD_MLINESTYLE dictionary entry, so a new one joins that dictionary and a renamed one keeps
// its entry where it stands under the new name (M1-95). MLINEs point at their style by handle and
// follow a rename; $CMLSTYLE, which names it, must change with it (header.ts).
//
// AutoCAD's MLSTYLE is the spec (AutoCAD 2024 help, "MLSTYLE (Command)" and "New / Modify
// Multiline Style Dialog Box"):
// - Standard cannot be renamed, and neither Standard nor a style an MLINE uses can have its
//   elements or multiline properties changed ("You cannot edit the element and multiline
//   properties of the STANDARD multiline style or any multiline style that is being used in the
//   drawing"). An MLINE states one parameter list per element of its style, so a changed style
//   would no longer describe the MLINEs drawn with it. The description is neither, so it may
//   change on any style (the help is silent on it; this is the drafter's expectation).
// - A style has 1 to 16 elements, kept from the highest offset down (the dialog sorts them).
// - Cap angles are 10° to 170°.
//
// Refused besides: a new style before R13 (no MLINE styles), a true colour where the format keeps
// only a colour number (DXF 62, which acad-ts writes from the nearest ACI; a DWG before R2004),
// colour-book colours, and in a DWG before R2018 an element linetype other than ByLayer or
// ByBlock: those store a linetype by its index in the linetype table, and the index acad-ts
// writes counts ByLayer and ByBlock, which a DWG's LTYPE_CONTROL lists apart (roadmap M1-101).

import {
  ACadVersion,
  CadDictionary,
  LineType,
  MLineStyle,
  MLineStyleElement,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type {
  Color,
  DocumentInit,
  DocumentModel,
  Handle,
  MLineStyleElement as TriyaElement,
  MLineStyleRecord,
} from '@triya/engine';
import type { CadFormat } from '../read';
import { entryRenameProblems, renameEntries } from './dictionary-entries';
import { acadColor, resolve, type Resolver } from './entities';
import { changes, planRecords, type RecordPlan } from './records';

export type MLineStylePlan = RecordPlan<MLineStyle, MLineStyleRecord>;

/** DXF 70: fill on, display miters, then the start and end square, inner-arc and round caps. */
const STYLE_FLAG_BITS = 1 | 2 | 16 | 32 | 64 | 256 | 512 | 1024;

/** The MLSTYLE dialog's limit on elements. */
const MAX_ELEMENTS = 16;

const DEGREE = Math.PI / 180;
/** The cap angles the MLSTYLE dialog takes, with room for a value read back from DXF degrees. */
const ANGLE_RANGE = [10 * DEGREE - 1e-12, 170 * DEGREE + 1e-12] as const;

/** The fields AutoCAD fixes on Standard and on a style in use. */
const PROPERTIES = ['styleFlags', 'fillColor', 'startAngle', 'endAngle', 'elements'] as const;

/** The model's MLINE style changes against the original's mapping, and why any cannot be written. */
export function planMLineStyles(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver & { readonly created: Map<Handle, CadObject> },
  format: CadFormat | undefined,
): { plan: MLineStylePlan; problems: string[] } {
  const version = doc.header?.version;
  const used = new Map<Handle, Handle>();
  for (const e of model.entities())
    if (e.geom.kind === 'MLINE' && e.geom.style !== undefined && !used.has(e.geom.style))
      used.set(e.geom.style, e.handle);
  return planRecords(doc, base.tables?.mlineStyles ?? [], model.tables.mlineStyles, r, {
    what: 'MLINE style',
    type: MLineStyle,
    make: (a) => new MLineStyle(a.name),
    fixedNames: [MLineStyle.defaultName],
    removable: true,
    problems: (b, a, acad) => [
      ...mlineStyleProblems(r, version, format, b, a, used.get(a.handle)),
      ...(b && acad && b.name !== a.name
        ? entryRenameProblems(acad, a.name, (o) =>
            model.tables.mlineStyles.has(o.handle.toString(16).toUpperCase()),
          )
        : []),
    ],
  });
}

const known = (v: ACadVersion | undefined): v is ACadVersion =>
  v !== undefined && v !== ACadVersion.Unknown;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function mlineStyleProblems(
  r: Resolver,
  version: ACadVersion | undefined,
  format: CadFormat | undefined,
  b: MLineStyleRecord | undefined,
  a: MLineStyleRecord,
  usedBy: Handle | undefined,
): string[] {
  const out: string[] = [];
  const changed = changes(b, a);
  // An MLINESTYLE is an object, not a table record: its DXF 70 is `styleFlags`.
  if (changed('flags') && a.flags !== undefined) out.push('an MLINE style has no record flags');
  if (!b && known(version) && version < ACadVersion.AC1012)
    out.push(`${ACadVersion[version]} has no MLINE styles (R13 introduced them)`);
  if (b && changed(...PROPERTIES)) {
    const fixed = PROPERTIES.filter((k) => changed(k)).join(', ');
    if (b.name.toUpperCase() === MLineStyle.defaultName.toUpperCase())
      out.push(`${fixed}: AutoCAD does not let Standard's elements and properties change`);
    else if (usedBy !== undefined)
      out.push(
        `${fixed}: MLINE ${usedBy} uses it, and AutoCAD does not let a style in use change its elements and properties`,
      );
  }
  if (changed('description') && typeof a.description !== 'string')
    out.push(`description: ${JSON.stringify(a.description)} is not text`);
  if (changed('styleFlags')) {
    const f = a.styleFlags;
    if (!(Number.isInteger(f) && f >= 0 && (f & ~STYLE_FLAG_BITS) === 0))
      out.push(`styleFlags: ${JSON.stringify(f)} has bits other than ${STYLE_FLAG_BITS}`);
  }
  for (const k of ['startAngle', 'endAngle'] as const) {
    const v = a[k];
    if (changed(k) && !(finite(v) && v >= ANGLE_RANGE[0] && v <= ANGLE_RANGE[1]))
      out.push(`${k}: ${JSON.stringify(v)} is not an angle from 10° to 170°`);
  }
  if (changed('fillColor')) out.push(...colorProblems('fillColor', a.fillColor, version, format));
  if (changed('elements')) out.push(...elementProblems(r, version, format, a.elements));
  return out;
}

function colorProblems(
  what: string,
  c: Color,
  version: ACadVersion | undefined,
  format: CadFormat | undefined,
): string[] {
  if (c.kind !== 'rgb') return [];
  if (c.bookName !== undefined) return [`${what}: colour-book colours`];
  if (format === 'dxf') return [`${what}: a DXF MLINESTYLE stores colour numbers only (62)`];
  if (known(version) && version < ACadVersion.AC1018)
    return [`${what}: a DWG before R2004 stores colour numbers only`];
  return [];
}

function elementProblems(
  r: Resolver,
  version: ACadVersion | undefined,
  format: CadFormat | undefined,
  elements: readonly TriyaElement[],
): string[] {
  if (!Array.isArray(elements)) return ['elements: not a list'];
  const out: string[] = [];
  if (elements.length < 1 || elements.length > MAX_ELEMENTS)
    out.push(`elements: ${elements.length}, where a style has 1 to ${MAX_ELEMENTS}`);
  elements.forEach((e, i) => {
    const what = `element ${i + 1}`;
    if (!finite(e.offset)) out.push(`${what} offset: ${JSON.stringify(e.offset)} is not a number`);
    else if (i > 0 && finite(elements[i - 1]!.offset) && e.offset > elements[i - 1]!.offset)
      out.push(
        `${what} offset: ${e.offset} is above the offset before it (AutoCAD keeps them from the highest down)`,
      );
    out.push(...colorProblems(`${what} color`, e.color, version, format));
    if (e.linetype === undefined) return;
    const lt = resolve(r, e.linetype, LineType);
    if (!lt) out.push(`${what} linetype: ${e.linetype} does not exist`);
    else if (
      format === 'dwg' &&
      known(version) &&
      version < ACadVersion.AC1032 &&
      lt !== r.byLayer &&
      lt !== r.byBlock
    )
      out.push(
        `${what} linetype: a DWG MLINESTYLE before R2018 names it by an index acad-ts does not write as AutoCAD reads it (roadmap M1-101)`,
      );
  });
  return out;
}

/** Writes the fields of `a` that differ from `b` (every one when `b` is undefined). */
function writeMLineStyle(
  r: Resolver,
  s: MLineStyle,
  b: MLineStyleRecord | undefined,
  a: MLineStyleRecord,
): void {
  const changed = changes(b, a);
  if (changed('description')) s.description = a.description;
  if (changed('styleFlags')) s.flags = a.styleFlags;
  if (changed('fillColor')) s.fillColor = acadColor(a.fillColor);
  if (changed('startAngle')) s.startAngle = a.startAngle;
  if (changed('endAngle')) s.endAngle = a.endAngle;
  if (!changed('elements')) return;
  // acad-ts has no way to take an element out, so a changed list replaces them all, giving up
  // their linetype references first.
  const old = (s as unknown as { _elements: MLineStyleElement[] })._elements;
  for (const e of old.splice(0)) {
    e.unassignDocument();
    e.owner = null;
  }
  for (const src of a.elements) {
    const e = new MLineStyleElement();
    e.offset = src.offset;
    e.color = acadColor(src.color);
    // None is written as acad-ts writes a style without one: BYLAYER.
    e.lineType = src.linetype === undefined ? null : (resolve(r, src.linetype, LineType) ?? null);
    s.addElement(e);
  }
}

/**
 * Writes the planned MLINE style changes onto `doc`: renamed styles first, as a new style may take
 * a name one gives up; then new styles join its ACAD_MLINESTYLE dictionary (made when the drawing
 * has none, as a new document's root holds one), before their elements, whose linetypes register
 * with the drawing's table only once the style is in it.
 */
export function writeMLineStyles(doc: CadDocument, r: Resolver, plan: MLineStylePlan): void {
  renameEntries(
    plan.updated
      .filter(({ before, after }) => before.name !== after.name)
      .map(({ acad, after }) => ({ acad, name: after.name })),
  );
  if (plan.added.length > 0) {
    const root = doc.rootDictionary!;
    let dict = root.get(CadDictionary.acadMLineStyle);
    if (!(dict instanceof CadDictionary)) {
      dict = new CadDictionary(CadDictionary.acadMLineStyle);
      dict.handle = r.allocate();
      root.add(dict as CadDictionary);
    }
    for (const { acad, after } of plan.added) {
      (dict as CadDictionary).add(acad);
      writeMLineStyle(r, acad, undefined, after);
    }
  }
  for (const { acad, before, after } of plan.updated) writeMLineStyle(r, acad, before, after);
}
