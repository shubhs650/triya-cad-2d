// TriyaToAcad for STYLE records (M1-75 part 8): writes an edited text style's changed fields
// onto its acad-ts record, by handle, and adds the styles the drawing gains under the engine's
// handles, the inverse of `textStyle()` in map/tables.ts (for the STYLE command, M4).
//
// A TrueType style's bold and italic live in its `ACAD` xdata (1000 face name, 1071 flags), which
// AutoCAD reads before the file name. acad-ts rewrites that pair when the style is bold or italic;
// a style made regular, or given another font, has its pair corrected here, so the face name
// never names the old font and an SHX font loses the pair altogether.

import {
  ACadVersion,
  AppId,
  ExtendedData,
  ExtendedDataInteger32,
  ExtendedDataString,
  TextStyle,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type { DocumentInit, DocumentModel, Handle, TextStyleRecord } from '@triya/engine';
import type { Resolver } from './entities';
import { changes, planRecords, XREF_BITS, type RecordPlan } from './records';

/** DXF 70: the record is a shape file's (AutoCAD names those with an empty string). */
export const SHAPE_FILE = 1;
/** DXF 71: backward, upside down. */
const GENERATION_BITS = 2 | 4;
/** `trueTypeFlags`: italic, bold (acad-ts `FontFlags`). */
const TRUETYPE_BITS = 1 | 2;
/** The xdata flag bits acad-ts maps to italic and bold. */
const ITALIC_XDATA = 0x01000000;
const BOLD_XDATA = 0x02000000;
/** AutoCAD's STYLE command takes an oblique angle between −85° and 85°. */
const MAX_OBLIQUE = (85 * Math.PI) / 180;

export type TextStylePlan = RecordPlan<TextStyle, TextStyleRecord>;

const isShapeFile = (s: TextStyleRecord): boolean => ((s.flags ?? 0) & SHAPE_FILE) !== 0;
const isShx = (font: string): boolean => /\.shx\s*$/i.test(font);
/** Whether a style draws with a TrueType font, which is what its xdata bold and italic need. */
const isTrueType = (s: TextStyleRecord): boolean => !isShapeFile(s) && !isShx(s.font);

/** The model's text style changes against the original's mapping, and why any cannot be written. */
export function planTextStyles(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver & { readonly created: Map<Handle, CadObject> },
): { plan: TextStylePlan; problems: string[] } {
  return planRecords(doc, base.tables?.textStyles ?? [], model.tables.textStyles, r, {
    what: 'text style',
    type: TextStyle,
    make: (a) => {
      // acad-ts refuses an empty name in the constructor; a shape file's style has one.
      const s = new TextStyle();
      if (a.name) s.name = a.name;
      // Before the style joins the table, which keys a nameless one by this flag.
      s.flags = (a.flags ?? 0) as never;
      return s;
    },
    // AutoCAD: the STANDARD text style cannot be renamed.
    fixedNames: [TextStyle.defaultName],
    mayBeNameless: isShapeFile,
    problems: (b, a) => textStyleProblems(doc.header?.version, b, a),
  });
}

function textStyleProblems(
  version: ACadVersion | undefined,
  b: TextStyleRecord | undefined,
  a: TextStyleRecord,
): string[] {
  const out: string[] = [];
  const changed = changes(b, a);
  if (a.name === '' && !isShapeFile(a)) out.push('only a shape file’s style has no name');
  const flags = (b?.flags ?? 0) ^ (a.flags ?? 0);
  if (b && (flags & SHAPE_FILE) !== 0) out.push('a style cannot become or stop being a shape file');
  if ((flags & XREF_BITS) !== 0) out.push('the xref-dependent flags belong to the xref');
  if (changed('font') && a.font.trim() === '') out.push('a style needs a font file');
  if (changed('height') && !(Number.isFinite(a.height) && a.height >= 0))
    out.push(`height ${a.height} is not 0 or more`);
  if (changed('lastHeight') && !(Number.isFinite(a.lastHeight) && a.lastHeight >= 0))
    out.push(`last height ${a.lastHeight} is not 0 or more`);
  if (changed('widthFactor') && !(Number.isFinite(a.widthFactor) && a.widthFactor > 0))
    out.push(`width factor ${a.widthFactor} is not more than 0`);
  if (changed('obliqueAngle') && !(Math.abs(a.obliqueAngle) <= MAX_OBLIQUE + 1e-12))
    out.push('the oblique angle is not between −85° and 85°');
  if (changed('generation') && (a.generation & ~GENERATION_BITS) !== 0)
    out.push(`generation flags ${a.generation} are not backward (2) or upside down (4)`);
  if (changed('trueTypeFlags', 'font', 'flags') && a.trueTypeFlags !== 0) {
    if ((a.trueTypeFlags & ~TRUETYPE_BITS) !== 0)
      out.push(`TrueType flags ${a.trueTypeFlags} are not italic (1) or bold (2)`);
    // The flags are xdata on a TrueType font; an SHX font or shape file has none.
    else if (!isTrueType(a)) out.push('bold and italic need a TrueType font');
    // R13 brought TrueType fonts; an R12 drawing has no xdata for them.
    else if (version !== undefined && version <= ACadVersion.AC1009)
      out.push('an R12 style has no TrueType bold or italic');
  }
  return out;
}

/** The font's face name as acad-ts derives it from a file name (`arial.ttf` → `arial`). */
function fontFamily(font: string): string {
  const name = font.trim().replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Corrects the `ACAD` face name and flags pair (the first two records, as AutoCAD writes them)
 * of a style whose font or bold and italic change; acad-ts writes a bold or italic style's pair
 * itself, the same way, and leaves the pair of any other style as read.
 */
function writeFontXdata(s: TextStyle, b: TextStyleRecord, a: TextStyleRecord): void {
  const entry = [...s.extendedData].find(([app]) => app.name.toUpperCase() === AppId.defaultName);
  const records = entry?.[1].records;
  const [face, bits] = [records?.[0], records?.[1]];
  if (!entry || !(face instanceof ExtendedDataString) || !(bits instanceof ExtendedDataInteger32))
    return;
  const rest = records!.slice(2);
  if (!isTrueType(a)) {
    // An SHX font has no face: a face name left behind would draw the old TrueType font.
    const others = [...s.extendedData].filter(([app]) => app !== entry[0]);
    s.extendedData.clear();
    for (const [app, data] of others) s.extendedData.set(app, data);
    if (rest.length > 0) s.extendedData.set(entry[0], new ExtendedData(rest));
    return;
  }
  const fontChanged = b.font !== a.font;
  // The face's charset, pitch and family bits hold only while the font is the same.
  const kept = fontChanged ? 0 : bits.value & ~(ITALIC_XDATA | BOLD_XDATA);
  const style = (a.trueTypeFlags & 1 ? ITALIC_XDATA : 0) | (a.trueTypeFlags & 2 ? BOLD_XDATA : 0);
  s.extendedData.set(
    entry[0],
    new ExtendedData([
      fontChanged ? new ExtendedDataString(fontFamily(a.font)) : face,
      new ExtendedDataInteger32(kept | style),
      ...rest,
    ]),
  );
}

/** Writes the fields of `a` that differ from `b` (every field when `b` is undefined). */
function writeTextStyle(s: TextStyle, b: TextStyleRecord | undefined, a: TextStyleRecord): void {
  const changed = changes(b, a);
  if (b && changed('name')) s.name = a.name;
  if (changed('flags')) s.flags = (a.flags ?? 0) as never;
  if (changed('font')) s.filename = a.font;
  if (changed('bigFont')) s.bigFontFilename = a.bigFont ?? null;
  if (changed('height')) s.height = a.height;
  if (changed('widthFactor')) s.width = a.widthFactor;
  if (changed('obliqueAngle')) s.obliqueAngle = a.obliqueAngle;
  if (changed('lastHeight')) s.lastHeight = a.lastHeight;
  if (changed('generation')) s.mirrorFlag = a.generation as never;
  if (changed('trueTypeFlags')) s.trueType = a.trueTypeFlags as never;
  if (b && changed('font', 'trueTypeFlags')) writeFontXdata(s, b, a);
}

/** Writes the planned text style changes onto `doc`; new styles join its STYLE table first. */
export function writeTextStyles(doc: CadDocument, plan: TextStylePlan): void {
  for (const { acad, after } of plan.added) {
    doc.textStyles!.add(acad);
    writeTextStyle(acad, undefined, after);
  }
  for (const { acad, before, after } of plan.updated) writeTextStyle(acad, before, after);
}
