// TriyaToAcad for TABLESTYLE objects (M1-75 part 12): writes an edited table style's changed
// fields onto its acad-ts object, by handle, and adds the styles the drawing gains under the
// engine's handles (the TABLESTYLE manager, M4; TABLE with a new current style), the inverse of
// `tableStyle()` in map/styles.ts. Like multileader styles, Triya keeps them beside the symbol
// tables, but the file keeps them as objects named by their ACAD_TABLESTYLE dictionary entry,
// so a new one joins that dictionary. A cell style's text style may be one the same save adds.
//
// What is written is the style as DXF and DWG before R2010 state it: the table-wide fields and
// three row styles, in the file's order data, title, header (AutoCAD DXF reference, TABLESTYLE;
// the ODA's Open Design Specification for .dwg, TABLESTYLE before R2010). From R2010 a DWG keeps
// named cell styles instead, and AutoCAD saves them in a DXF too, as the CELLSTYLEMAP its
// extension dictionary names (ACAD_ROUNDTRIP_2008_TABLESTYLE_CELLSTYLEMAP), so a change written
// to the row styles alone could be undone by the cell styles AutoCAD reads back: R2010 and later
// are refused until Triya maps those cell styles (M1-96).
//
// Refused besides: renaming a style, which acad-ts's dictionary cannot do in place (M1-95); a
// new style before R2004 (AutoCAD 2005 introduced tables); the data and unit types before R2007,
// which the format has no place for; a true colour where acad-ts writes an ACI (DXF, which has
// no true colour code for a table style, and DWG before R2004); colour-book colours; adding,
// removing or reordering cell styles or borders; and values AutoCAD's dialog does not take.

import {
  ACadVersion,
  CadDictionary,
  TableStyle,
  TextStyle,
  type CadDocument,
  type CadObject,
  type CellBorder,
  type CellStyle,
} from '@node-projects/acad-ts';
import type {
  Color,
  DocumentInit,
  DocumentModel,
  Handle,
  TableCellBorder,
  TableCellStyle,
  TableStyleRecord,
} from '@triya/engine';
import type { CadFormat } from '../read';
import { acadColor, acadLineweight, resolve, same, type Resolver } from './entities';
import { changes, planRecords, type RecordPlan } from './records';

export type TableStylePlan = RecordPlan<TableStyle, TableStyleRecord>;

/** The row styles a TABLESTYLE states before R2010, in its order. */
const ROWS = ['data', 'title', 'header'] as const;

/** The borders of a row style, in the order `TableCellStyle.borders` keeps them. */
const EDGES = ['top', 'inside horizontal', 'bottom', 'left', 'inside vertical', 'right'] as const;

/** The lineweights AutoCAD offers, in hundredths of a millimetre (DXF 370's values). */
const LINEWEIGHTS: readonly number[] = [
  0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200,
  211,
];

/** The model's table style changes against the original's mapping, and why any cannot be written. */
export function planTableStyles(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver & { readonly created: Map<Handle, CadObject> },
  format: CadFormat | undefined,
): { plan: TableStylePlan; problems: string[] } {
  const version = doc.header?.version;
  return planRecords(doc, base.tables?.tableStyles ?? [], model.tables.tableStyles, r, {
    what: 'table style',
    type: TableStyle,
    make: (a) => {
      const s = new TableStyle(a.name);
      // A read style lists the row styles it read; a new one the three it is made with.
      s.cellStyles = [s.dataCellStyle, s.titleCellStyle, s.headerCellStyle];
      return s;
    },
    fixedNames: [TableStyle.defaultName],
    problems: (b, a) => tableStyleProblems(r, version, format, b, a),
  });
}

const known = (v: ACadVersion | undefined): v is ACadVersion =>
  v !== undefined && v !== ACadVersion.Unknown;

const isWhole = (v: unknown, min: number, max: number): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function tableStyleProblems(
  r: Resolver,
  version: ACadVersion | undefined,
  format: CadFormat | undefined,
  b: TableStyleRecord | undefined,
  a: TableStyleRecord,
): string[] {
  const out: string[] = [];
  const changed = changes(b, a);
  if (known(version) && version >= ACadVersion.AC1024)
    return [
      'from R2010 a table style keeps named cell styles, which Triya does not map yet (M1-96)',
    ];
  if (!b && known(version) && version < ACadVersion.AC1018)
    out.push(`${ACadVersion[version]} has no table styles (AutoCAD 2005 introduced tables)`);
  if (b && b.name !== a.name) out.push('acad-ts cannot rename a dictionary entry in place (M1-95)');
  // A TABLESTYLE is an object, not a table record: its 70 is the flow direction.
  if (changed('flags') && a.flags !== undefined) out.push('a table style has no flags');
  if (changed('description') && typeof a.description !== 'string')
    out.push(`description: ${JSON.stringify(a.description)} is not text`);
  // DXF 70: 0 down, 1 up.
  if (changed('flowDirection') && !isWhole(a.flowDirection, 0, 1))
    out.push(`flowDirection: ${JSON.stringify(a.flowDirection)} is not 0 or 1`);
  // DXF 71, a DWG BS.
  if (changed('styleFlags') && !isWhole(a.styleFlags, 0, 0x7fff))
    out.push(`styleFlags: ${JSON.stringify(a.styleFlags)} is not a whole number from 0 to 32767`);
  for (const k of ['horizontalMargin', 'verticalMargin'] as const) {
    const v = a[k];
    if (changed(k) && !(typeof v === 'number' && Number.isFinite(v) && v >= 0))
      out.push(`${k}: ${JSON.stringify(v)} is not a length of 0 or more`);
  }
  for (const k of ['suppressTitle', 'suppressHeader'] as const)
    if (changed(k) && typeof a[k] !== 'boolean')
      out.push(`${k}: ${JSON.stringify(a[k])} is not true or false`);
  if (!changed('cellStyles')) return out;
  if (!Array.isArray(a.cellStyles) || a.cellStyles.length !== ROWS.length) {
    out.push(`cellStyles: a table style has ${ROWS.length} row styles (data, title, header)`);
    return out;
  }
  a.cellStyles.forEach((c, i) =>
    out.push(
      ...cellStyleProblems(r, version, format, b?.cellStyles[i], c).map(
        (p) => `${ROWS[i]} row ${p}`,
      ),
    ),
  );
  return out;
}

function cellStyleProblems(
  r: Resolver,
  version: ACadVersion | undefined,
  format: CadFormat | undefined,
  b: TableCellStyle | undefined,
  a: TableCellStyle,
): string[] {
  if (b && same(b, a)) return [];
  const out: string[] = [];
  const changed = changes(b, a);
  if (changed('textStyle')) {
    if (a.textStyle === undefined) out.push('textStyle: a row style needs one');
    else if (!resolve(r, a.textStyle, TextStyle))
      out.push(`textStyle: ${a.textStyle} does not exist`);
  }
  if (changed('textHeight') && !(typeof a.textHeight === 'number' && a.textHeight > 0))
    out.push(`textHeight: ${JSON.stringify(a.textHeight)} is not more than 0`);
  // DXF 170: 1 top left … 9 bottom right.
  if (changed('alignment') && !isWhole(a.alignment, 1, 9))
    out.push(`alignment: ${JSON.stringify(a.alignment)} is not a whole number from 1 to 9`);
  if (changed('fillOn') && typeof a.fillOn !== 'boolean')
    out.push(`fillOn: ${JSON.stringify(a.fillOn)} is not true or false`);
  for (const k of ['dataType', 'unitType'] as const) {
    if (!changed(k)) continue;
    // DXF 90 / 91 and the DWG BLs after the borders, which R2007 introduced: before it a
    // style reads back with 0.
    if (known(version) && version < ACadVersion.AC1021 && (b !== undefined || a[k] !== 0))
      out.push(`${k}: ${ACadVersion[version]} has no place for it (R2007 introduced it)`);
    else if (!isWhole(a[k], -0x80000000, 0x7fffffff))
      out.push(`${k}: ${JSON.stringify(a[k])} is not a whole number`);
  }
  for (const k of ['textColor', 'fillColor'] as const)
    if (changed(k)) out.push(...colorProblems(version, format, k, a[k]));
  if (!changed('borders')) return out;
  if (!Array.isArray(a.borders) || a.borders.length !== EDGES.length) {
    out.push(`borders: a row style has ${EDGES.length} borders`);
    return out;
  }
  a.borders.forEach((e, i) => {
    const was = b?.borders[i];
    const edge = changes<TableCellBorder>(was, e);
    const p: string[] = [];
    if (edge('lineweight')) {
      const w = e.lineweight;
      const named = w === 'ByLayer' || w === 'ByBlock' || w === 'Default';
      if (!named && !LINEWEIGHTS.includes(w as number))
        p.push(`lineweight: ${JSON.stringify(w)} is not a lineweight`);
    }
    if (edge('visible') && typeof e.visible !== 'boolean')
      p.push(`visible: ${JSON.stringify(e.visible)} is not true or false`);
    if (edge('color')) p.push(...colorProblems(version, format, 'color', e.color));
    out.push(...p.map((q) => `${EDGES[i]} border ${q}`));
  });
  return out;
}

function colorProblems(
  version: ACadVersion | undefined,
  format: CadFormat | undefined,
  k: string,
  c: Color,
): string[] {
  if (c?.kind === 'byLayer' || c?.kind === 'byBlock') return [];
  if (c?.kind === 'aci')
    return isWhole(c.index, 1, 255) ? [] : [`${k}: ACI ${JSON.stringify(c.index)} is not 1–255`];
  if (c?.kind !== 'rgb') return [`${k}: ${JSON.stringify(c)} is not a colour`];
  if (c.bookName !== undefined) return [`${k}: colour-book colours`];
  // acad-ts writes an ACI for these (DXF 62–69 are ACI codes; DWG before R2004 a CMC index).
  if (format === 'dxf') return [`${k}: a DXF table style holds ACI colours only`];
  if (known(version) && version < ACadVersion.AC1018)
    return [`${k}: a DWG table style before R2004 holds ACI colours only`];
  return [];
}

function writeBorder(border: CellBorder, b: TableCellBorder | undefined, a: TableCellBorder): void {
  const changed = changes(b, a);
  if (changed('lineweight')) border.lineWeight = acadLineweight(a.lineweight) as never;
  if (changed('visible')) border.isInvisible = !a.visible;
  if (changed('color')) border.color = acadColor(a.color);
}

function writeCellStyle(
  r: Resolver,
  c: CellStyle,
  b: TableCellStyle | undefined,
  a: TableCellStyle,
): void {
  const changed = changes(b, a);
  if (changed('textStyle')) c.textStyle = resolve(r, a.textStyle!, TextStyle)!;
  if (changed('textHeight')) c.textHeight = a.textHeight;
  if (changed('alignment')) c.cellAlignment = a.alignment as never;
  // DXF 62 and the DWG row style's text colour, which acad-ts keeps on the content format.
  if (changed('textColor')) c.color = acadColor(a.textColor);
  if (changed('fillColor')) c.backgroundColor = acadColor(a.fillColor);
  if (changed('fillOn')) c.isFillColorOn = a.fillOn;
  if (changed('dataType')) c.valueDataType = a.dataType;
  if (changed('unitType')) c.valueUnitType = a.unitType;
  if (!changed('borders')) return;
  const borders = [
    c.topBorder,
    c.horizontalInsideBorder,
    c.bottomBorder,
    c.leftBorder,
    c.verticalInsideBorder,
    c.rightBorder,
  ];
  a.borders.forEach((e, i) => writeBorder(borders[i]!, b?.borders[i], e));
}

/** Writes the fields of `a` that differ from `b` (every one when `b` is undefined). */
function writeTableStyle(
  r: Resolver,
  s: TableStyle,
  b: TableStyleRecord | undefined,
  a: TableStyleRecord,
): void {
  const changed = changes(b, a);
  if (changed('description')) s.description = a.description;
  if (changed('flowDirection')) s.flowDirection = a.flowDirection as never;
  if (changed('styleFlags')) s.flags = a.styleFlags;
  if (changed('horizontalMargin')) s.horizontalCellMargin = a.horizontalMargin;
  if (changed('verticalMargin')) s.verticalCellMargin = a.verticalMargin;
  if (changed('suppressTitle')) s.suppressTitle = a.suppressTitle;
  if (changed('suppressHeader')) s.suppressHeaderRow = a.suppressHeader;
  if (changed('cellStyles'))
    a.cellStyles.forEach((c, i) => writeCellStyle(r, s.cellStyles[i]!, b?.cellStyles[i], c));
}

/**
 * Writes the planned table style changes onto `doc`; new styles join its ACAD_TABLESTYLE
 * dictionary first (made when the drawing has none, as a new document's root holds one).
 */
export function writeTableStyles(doc: CadDocument, r: Resolver, plan: TableStylePlan): void {
  if (plan.added.length > 0) {
    const root = doc.rootDictionary!;
    let dict = root.get(CadDictionary.acadTableStyle);
    if (!(dict instanceof CadDictionary)) {
      dict = new CadDictionary(CadDictionary.acadTableStyle);
      dict.handle = r.allocate();
      root.add(dict as CadDictionary);
    }
    for (const { acad, after } of plan.added) {
      (dict as CadDictionary).add(acad);
      writeTableStyle(r, acad, undefined, after);
    }
  }
  for (const { acad, before, after } of plan.updated) writeTableStyle(r, acad, before, after);
}
