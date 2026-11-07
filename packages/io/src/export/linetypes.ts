// TriyaToAcad for LTYPE records (M1-75 part 8): writes an edited linetype's changed fields onto
// its acad-ts record, by handle, and adds the linetypes the drawing gains under the engine's
// handles (LINETYPE Load, M4), the inverse of `linetype()` in map/tables.ts. Text and shape
// elements name a STYLE record, which may be one the same save adds.

import {
  ACadVersion,
  LineType,
  LineTypeSegment,
  TextStyle,
  type CadDocument,
  type TableEntry,
} from '@node-projects/acad-ts';
import type {
  DocumentInit,
  DocumentModel,
  Handle,
  LinetypeElement,
  LinetypeRecord,
} from '@triya/engine';
import { resolve, type Resolver } from './entities';
import { changes, planRecords, XREF_BITS, type RecordPlan } from './records';
import { SHAPE_FILE } from './text-styles';

/** DXF 74: text, shape (1 is absolute rotation). */
const TEXT = 2;
const SHAPE = 4;
/** AutoCAD: "A linetype definition can contain up to 12 dash length specifications". */
const MAX_ELEMENTS = 12;

export type LinetypePlan = RecordPlan<LineType, LinetypeRecord>;

/** The model's linetype changes against the original's mapping, and why any cannot be written. */
export function planLinetypes(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver & { readonly created: Map<Handle, TableEntry> },
): { plan: LinetypePlan; problems: string[] } {
  return planRecords(doc, base.tables?.linetypes ?? [], model.tables.linetypes, r, {
    what: 'linetype',
    type: LineType,
    make: (a) => new LineType(a.name),
    // AutoCAD: BYLAYER, BYBLOCK and CONTINUOUS cannot be renamed.
    fixedNames: [LineType.byLayerName, LineType.byBlockName, LineType.continuousName],
    problems: (b, a) => linetypeProblems(r, doc.header?.version, b, a),
  });
}

function linetypeProblems(
  r: Resolver,
  version: ACadVersion | undefined,
  b: LinetypeRecord | undefined,
  a: LinetypeRecord,
): string[] {
  const out: string[] = [];
  const changed = changes(b, a);
  const name = (b ?? a).name.toUpperCase();
  // They stand for the entity's layer and block, and for a solid line: no pattern to edit.
  if (b && [LineType.byLayerName, LineType.byBlockName].some((n) => n.toUpperCase() === name))
    out.push(`${b.name} is not a linetype to edit`);
  else if (b && name === LineType.continuousName.toUpperCase() && changed('elements'))
    out.push('Continuous has no pattern');
  if (((b?.flags ?? 0) ^ (a.flags ?? 0)) & XREF_BITS)
    out.push('the xref-dependent flags belong to the xref');
  // acad-ts writes DXF 72 as `A`, the only alignment AutoCAD has.
  if (changed('alignment') && a.alignment !== 'A') out.push('the alignment is always A');
  if (changed('elements', 'patternLength')) {
    // acad-ts writes DXF 40 as the sum of the element lengths, as AutoCAD does.
    const total = a.elements.reduce((sum, e) => sum + Math.abs(e.length), 0);
    if (Math.abs(total - a.patternLength) > 1e-9 * Math.max(1, total))
      out.push(`the pattern length ${a.patternLength} is not the elements' total ${total}`);
  }
  if (changed('elements')) {
    if (a.elements.length > MAX_ELEMENTS) out.push(`more than ${MAX_ELEMENTS} elements`);
    a.elements.forEach((e, i) =>
      out.push(...elementProblems(r, version, e).map((p) => `element ${i}: ${p}`)),
    );
  }
  return out;
}

function elementProblems(
  r: Resolver,
  version: ACadVersion | undefined,
  e: LinetypeElement,
): string[] {
  const out: string[] = [];
  if (!Number.isFinite(e.length)) out.push(`length ${e.length}`);
  // Bits past 1, 2 and 4 are not in the DXF reference but AutoCAD writes them (74 = 10 on the
  // GAS_LINE of the ACadSharp samples), so they are written as the model holds them.
  if (!Number.isInteger(e.shapeFlags) || e.shapeFlags < 0)
    out.push(`shape flags ${e.shapeFlags} are not bits`);
  const text = (e.shapeFlags & TEXT) !== 0;
  const shape = (e.shapeFlags & SHAPE) !== 0;
  if (text && shape) out.push('an element is text or a shape, not both');
  if (!text && !shape) return out;
  // R13 brought complex linetypes; an R12 LTYPE states dashes only.
  if (version !== undefined && version <= ACadVersion.AC1009)
    out.push('an R12 linetype has no text or shapes');
  const style = e.style === undefined ? undefined : resolve(r, e.style, TextStyle);
  if (!style) out.push(`text style ${e.style ?? '(none)'} does not exist`);
  else if (shape !== ((style.flags as number) & SHAPE_FILE) > 0)
    out.push(
      shape ? 'a shape needs a shape file’s style' : 'text needs a text style, not a shape file',
    );
  if (text && !e.text) out.push('a text element needs its text');
  if (shape && e.text !== undefined) out.push('a shape has no text');
  if (![e.offset.x, e.offset.y, e.rotation, e.scale].every(Number.isFinite))
    out.push('offset, rotation and scale must be numbers');
  return out;
}

/** Writes the fields of `a` that differ from `b` (every field when `b` is undefined). */
function writeLinetype(
  r: Resolver,
  l: LineType,
  b: LinetypeRecord | undefined,
  a: LinetypeRecord,
): void {
  const changed = changes(b, a);
  if (b && changed('name')) l.name = a.name;
  if (changed('flags')) l.flags = (a.flags ?? 0) as never;
  if (changed('description')) l.description = a.description;
  if (changed('alignment')) l.alignment = a.alignment;
  if (!changed('elements')) return;
  // LineType offers no way to drop a segment; its `segments` is the array it writes.
  (l.segments as LineTypeSegment[]).splice(0);
  for (const e of a.elements) {
    const s = new LineTypeSegment();
    s.length = e.length;
    s.shapeFlags = e.shapeFlags as never;
    s.shapeNumber = e.shapeNumber;
    s.style = e.style === undefined ? null : resolve(r, e.style, TextStyle)!;
    s.offset = { x: e.offset.x, y: e.offset.y };
    s.rotation = e.rotation;
    s.scale = e.scale;
    s.text = e.text ?? '';
    l.addSegment(s);
  }
}

/** Writes the planned linetype changes onto `doc`; new linetypes join its LTYPE table first. */
export function writeLinetypes(doc: CadDocument, r: Resolver, plan: LinetypePlan): void {
  for (const { acad, after } of plan.added) {
    doc.lineTypes!.add(acad);
    writeLinetype(r, acad, undefined, after);
  }
  for (const { acad, before, after } of plan.updated) writeLinetype(r, acad, before, after);
}
