// TriyaToAcad for TABLESTYLE objects (M1-75 part 12): writes an edited table style's changed
// fields onto its acad-ts object, by handle, and adds the styles the drawing gains under the
// engine's handles (the TABLESTYLE manager, M4; TABLE with a new current style), the inverse of
// `tableStyle()` in map/styles.ts. Like multileader styles, Triya keeps them beside the symbol
// tables, but the file keeps them as objects named by their ACAD_TABLESTYLE dictionary entry,
// so a new one joins that dictionary. A cell style's text style may be one the same save adds.
//
// DXF and DWG before R2010 state the style as table-wide fields and three row styles, in the
// file's order data, title, header (AutoCAD DXF reference, TABLESTYLE; the ODA's Open Design
// Specification for .dwg, TABLESTYLE before R2010). From R2010 a DWG keeps named cell styles
// instead (M1-96): the "Table" cell style holds the margins and the flow direction (a merge
// flag), and `_DATA`, `_TITLE` and `_HEADER` the rows, with the alignment in their content
// format and an unfilled row's background None, so a row's edit is written there; they have no
// place for the table style's flags (DXF 71) or the suppress title / header settings, which
// AutoCAD 2008 dropped. AutoCAD 2008 and later also keep the named cell styles beside the rows,
// as the CELLSTYLEMAP the style's extension dictionary names
// (ACAD_ROUNDTRIP_2008_TABLESTYLE_CELLSTYLEMAP), in every DXF they save and in a DWG before
// R2010: a row's edit is written to its cell style there too, so that the two still agree
// (acad-ts reads and writes the DWG one since patch 0156, M1-98).
//
// The record's margins are table-wide, but every named cell style holds its own (AutoCAD's
// samples state the Table cell style's in each): a cell style whose margin is the one the edit
// changes follows it, and one that differed keeps its own, as a cell style that overrides it.
//
// A renamed style keeps its ACAD_TABLESTYLE entry where it stands under the new name (M1-95);
// the TABLEs using it point at it by handle, and CTABLESTYLE, which names it, must change with
// it (header.ts).
//
// A border's linetype, double line and spacing (M4-16 part 8) have no place in the rows: a DWG
// from R2010 states them in its named cell styles and a DXF (or a DWG before R2010 that has one)
// in the CELLSTYLEMAP. A DXF style without a CELLSTYLEMAP is given one, laid out as AutoCAD's
// (`_TITLE`, `_HEADER` and `_DATA`, in the style's extension dictionary), when its borders need
// it; a DWG before R2010 without one refuses them. Their override bits (type 0x1, linetype 0x4,
// spacing 0x20) are set beside the values, as Triya's cell borders are: every corpus style
// states flags 0 with the defaults, and AutoCAD's help does not say how it reads a style's.
//
// Cell styles of the drafter's own (M4-16 part 9, `userCellStyles`) are named cell styles beside
// `_TITLE`, `_HEADER` and `_DATA` in the CELLSTYLEMAP (ids from 101, AutoCAD's numbering, class
// data), which a DXF style is given when it gains one; added, renamed, written and removed there
// by id. A DWG save refuses a change to them: save is DXF only (DEC-047), and the DWG's named cell
// styles get no new work.
//
// Refused besides: a new style before R2004 (AutoCAD 2005 introduced tables); the data and unit types before R2007,
// which the format has no place for; a true colour where acad-ts writes an ACI (DXF, which has
// no true colour code for a table style, and DWG before R2004); colour-book colours; adding,
// removing or reordering cell styles or borders; and values AutoCAD's dialog does not take.

import {
  ACadVersion,
  CadDictionary,
  CellStyle as AcadCellStyle,
  CellStyleMap,
  CellStyleType,
  DictionaryCloningFlags,
  LineType,
  TableBorderPropertyFlags,
  TableEntityBorderType,
  Color as AcadColor,
  MarginFlags,
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
import { acadColor, acadLineweight, linetype, resolve, same, type Resolver } from './entities';
import { entryRenameProblems, renameEntries } from './dictionary-entries';
import { changes, planRecords, type RecordPlan } from './records';
import {
  CELL_STYLE_MAP,
  cellStyleMapOf,
  cellStyleMapRows,
  FLOW_BOTTOM_TO_TOP,
  isNamedCellStyle,
} from '../map/styles';

export type TableStylePlan = RecordPlan<TableStyle, TableStyleRecord>;

/** The row styles a TABLESTYLE states before R2010, in its order. */
const ROWS = ['data', 'title', 'header'] as const;

/** The borders of a row style, in the order `TableCellStyle.borders` keeps them. */
const EDGES = ['top', 'inside horizontal', 'bottom', 'left', 'inside vertical', 'right'] as const;

/** The lineweights AutoCAD offers, in hundredths of a millimetre (DXF 370's values). */
export const LINEWEIGHTS: readonly number[] = [
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
  // A new style is made the way the DWG writer writes it: with named cell styles from R2010. A
  // DXF keeps the rows only (AutoCAD reads those of a style without a CELLSTYLEMAP).
  const namedNew = known(version) && version >= ACadVersion.AC1024 && format !== 'dxf';
  return planRecords(doc, base.tables?.tableStyles ?? [], model.tables.tableStyles, r, {
    what: 'table style',
    type: TableStyle,
    make: (a) => {
      const s = new TableStyle(a.name);
      // A read style lists the row styles it read; a new one the three it is made with.
      s.cellStyles = [s.dataCellStyle, s.titleCellStyle, s.headerCellStyle];
      if (namedNew) nameCellStyles(s);
      return s;
    },
    fixedNames: [TableStyle.defaultName],
    removable: true,
    problems: (b, a, acad) => {
      const named = acad ? isNamedCellStyle(acad.tableCellStyle) : namedNew;
      const out = tableStyleProblems(
        r,
        version,
        format,
        named,
        b,
        a,
        borderPlace(acad, named, format),
      );
      if (b && acad && b.name !== a.name)
        out.push(
          ...entryRenameProblems(acad, a.name, (o) =>
            model.tables.tableStyles.has(o.handle.toString(16).toUpperCase()),
          ),
        );
      return out;
    },
  });
}

const known = (v: ACadVersion | undefined): v is ACadVersion =>
  v !== undefined && v !== ACadVersion.Unknown;

const isWhole = (v: unknown, min: number, max: number): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * A new style's cell styles as AutoCAD's own R2010+ Standard states them (acadsharp
 * sample_AC1024–AC1032): `_TITLE` (id 1), `_HEADER` (2), `_DATA` (3) and the "Table" cell style
 * (4); classes label for the title and header rows and data for the rest (AcDb::CellClass, which
 * acad-ts's enum names the other way round); each overrides margins of 0.06 and 0.18 spacing,
 * with a None background, and the title merges its cells. The record's values follow.
 */
function nameCellStyles(s: TableStyle): void {
  const named = [
    [s.titleCellStyle, '_TITLE', 1, 1],
    [s.headerCellStyle, '_HEADER', 2, 1],
    [s.dataCellStyle, '_DATA', 3, 2],
    [s.tableCellStyle, 'Table', 4, 2],
  ] as const;
  for (const [c, name, id, styleClass] of named) {
    c.name = name;
    c.id = id;
    c.styleClass = styleClass as never;
    c.cellStyleType = CellStyleType.Table;
    c.hasData = true;
    c.cellPropertyOverrideFlags = 0 as never;
    c.backgroundColor = AcadColor.byEntity;
    c.contentLayoutFlags = 1 as never;
    c.scale = 1;
    c.marginOverrideFlags = MarginFlags.Override;
    c.bottomMargin = c.rightMargin = 0.06;
    c.marginHorizontalSpacing = c.marginVerticalSpacing = 0.18;
  }
  s.tableCellStyle.textHeight = 0.18;
  s.tableCellStyle.alignment = 1;
  s.titleCellStyle.tableCellStylePropertyFlags = 0x8000 as never;
}

/**
 * Why a style's borders cannot state a linetype or double line (M4-16 part 8), or undefined: the
 * named cell styles that hold them are a DWG's from R2010, the CELLSTYLEMAP (whose `_TITLE`,
 * `_HEADER` and `_DATA` a DXF style without one is given), or none.
 */
function borderPlace(
  acad: TableStyle | undefined,
  named: boolean,
  format: CadFormat | undefined,
): string | undefined {
  if (acad && cellStyleMapRows(acad)) return undefined;
  if (acad && cellStyleMapOf(acad))
    return 'the style’s CELLSTYLEMAP lacks its _TITLE, _HEADER or _DATA cell style';
  // A DXF writes a DWG's named cell styles as rows: it is given a CELLSTYLEMAP too.
  if (named || format === 'dxf') return undefined;
  return 'a DWG table style before R2010 has no place for it';
}

/** Whether a row style's borders state what only a named cell style holds (M4-16 part 8). */
const statesBorderExtras = (c: TableCellStyle): boolean =>
  c.borders.some((e) => e.linetype !== undefined || e.double !== undefined);

/** Whether a named cell style's background colour fills (map/styles.ts `fills`). */
const fills = (c: Color): boolean =>
  c.kind === 'rgb' || (c.kind === 'aci' && c.index >= 1 && c.index <= 255);

function tableStyleProblems(
  r: Resolver,
  version: ACadVersion | undefined,
  format: CadFormat | undefined,
  named: boolean,
  b: TableStyleRecord | undefined,
  a: TableStyleRecord,
  place: string | undefined,
): string[] {
  const out: string[] = [];
  const changed = changes(b, a);
  if (named && changed('styleFlags') && a.styleFlags !== 0)
    out.push('styleFlags: an R2010+ DWG table style has no place for them (DXF 71)');
  for (const k of ['suppressTitle', 'suppressHeader'] as const)
    if (named && changed(k) && a[k] !== false)
      out.push(`${k}: an R2010+ DWG table style has none (AutoCAD 2008 dropped it)`);
  if (!b && known(version) && version < ACadVersion.AC1018)
    out.push(`${ACadVersion[version]} has no table styles (AutoCAD 2005 introduced tables)`);
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
  if (changed('userCellStyles'))
    out.push(...userCellStyleProblems(r, version, format, b?.userCellStyles, a, place));
  if (!changed('cellStyles')) return out;
  if (!Array.isArray(a.cellStyles) || a.cellStyles.length !== ROWS.length) {
    out.push(`cellStyles: a table style has ${ROWS.length} row styles (data, title, header)`);
    return out;
  }
  a.cellStyles.forEach((c, i) =>
    out.push(
      ...cellStyleProblems(r, version, format, named, b?.cellStyles[i], c, place).map(
        (p) => `${ROWS[i]} row ${p}`,
      ),
    ),
  );
  return out;
}

/** The names of the cell styles every style holds, which one of the drafter's own cannot take. */
const RESERVED = new Set(['TITLE', 'HEADER', 'DATA', '_TITLE', '_HEADER', '_DATA', 'TABLE']);

/** Why a style's cell styles of the drafter's own cannot be written (M4-16 part 9). */
function userCellStyleProblems(
  r: Resolver,
  version: ACadVersion | undefined,
  format: CadFormat | undefined,
  b: TableStyleRecord['userCellStyles'],
  a: TableStyleRecord,
  place: string | undefined,
): string[] {
  const own = a.userCellStyles;
  if (own === undefined) return [];
  if (format !== 'dxf')
    return ['userCellStyles: a DWG save does not write cell styles of the drafter’s own (DEC-047)'];
  if (place) return [`userCellStyles: ${place}`];
  if (!Array.isArray(own)) return ['userCellStyles: not a list of cell styles'];
  const out: string[] = [];
  const ids = new Set<number>();
  const names = new Set<string>();
  for (const c of own) {
    const name = typeof c.name === 'string' ? c.name : '';
    const where = `cell style ${JSON.stringify(c.name)}`;
    // AutoCAD numbers them from 101; 1 to 4 are `_TITLE`, `_HEADER`, `_DATA` and "Table".
    if (!isWhole(c.id, 5, 0x7fffffff))
      out.push(`${where}: id ${JSON.stringify(c.id)} is not 5 or more`);
    else if (ids.has(c.id)) out.push(`${where}: id ${c.id} is taken`);
    ids.add(c.id);
    if (name.trim() === '' || /[\r\n]/.test(name)) out.push(`${where}: not a name`);
    else if (RESERVED.has(name.toUpperCase()) || names.has(name.toUpperCase()))
      out.push(`${where}: the name is taken`);
    names.add(name.toUpperCase());
    const was = b?.find((x) => x.id === c.id);
    out.push(
      ...cellStyleProblems(r, version, format, true, was, c, place).map((p) => `${where} ${p}`),
    );
  }
  return out;
}

function cellStyleProblems(
  r: Resolver,
  version: ACadVersion | undefined,
  format: CadFormat | undefined,
  named: boolean,
  b: TableCellStyle | undefined,
  a: TableCellStyle,
  place: string | undefined,
): string[] {
  if (b && same(b, a)) return [];
  const out: string[] = [];
  const changed = changes(b, a);
  // A named cell style fills with its background colour, None when unfilled.
  if (named && changed('fillOn', 'fillColor')) {
    if (a.fillOn === true && !fills(a.fillColor))
      out.push(
        `fillColor: an R2010+ cell style fills with a colour, not ${JSON.stringify(a.fillColor)}`,
      );
    if (a.fillOn === false && !(a.fillColor?.kind === 'aci' && a.fillColor.index === 7))
      out.push('fillColor: an unfilled R2010+ cell style keeps none (it reads back as ACI 7)');
  }
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
    p.push(...borderExtraProblems(r, was, e, place));
    out.push(...p.map((q) => `${EDGES[i]} border ${q}`));
  });
  return out;
}

/** Why a border's linetype, double line or spacing cannot be written (M4-16 part 8). */
function borderExtraProblems(
  r: Resolver,
  b: TableCellBorder | undefined,
  a: TableCellBorder,
  place: string | undefined,
): string[] {
  const changed = changes(b, a);
  const out: string[] = [];
  if (changed('linetype') && a.linetype !== undefined) {
    if (place) out.push(`linetype: ${place}`);
    else if (a.linetype === 'ByBlock') out.push('linetype: ByBlock is no linetype (leave it out)');
    else if (a.linetype !== 'ByLayer' && !resolve(r, a.linetype, LineType))
      out.push(`linetype: ${a.linetype} does not exist`);
  }
  if (changed('double') && a.double !== undefined) {
    if (place) out.push(`double: ${place}`);
    else if (a.double !== true) out.push(`double: ${JSON.stringify(a.double)} is not true`);
  }
  if (changed('double', 'spacing')) {
    if (
      a.double === true &&
      !(typeof a.spacing === 'number' && a.spacing > 0 && Number.isFinite(a.spacing))
    )
      out.push(`spacing: ${JSON.stringify(a.spacing)} is not more than 0`);
    if (a.double !== true && a.spacing !== undefined) out.push('spacing: a single line has none');
  }
  return out;
}

export function colorProblems(
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

/**
 * Writes a border's changes; a named cell style's (`named`) also its linetype, double line and
 * spacing, with their override bits (M4-16 part 8). No linetype is none of the border's own
 * (DXF 340 = 0, as AutoCAD states it).
 */
function writeBorder(
  r: Resolver,
  border: CellBorder,
  b: TableCellBorder | undefined,
  a: TableCellBorder,
  named: boolean,
): void {
  const changed = changes(b, a);
  if (changed('lineweight')) border.lineWeight = acadLineweight(a.lineweight) as never;
  if (changed('visible')) border.isInvisible = !a.visible;
  if (changed('color')) border.color = acadColor(a.color);
  if (!named) return;
  const B = TableBorderPropertyFlags;
  const flag = (bit: number) => {
    border.propertyOverrideFlags = (border.propertyOverrideFlags | bit) as never;
  };
  if (changed('linetype')) {
    border.lineType = a.linetype === undefined ? null : (linetype(r, a.linetype) ?? null);
    flag(B.LineType);
  }
  if (changed('double')) {
    border.type = a.double ? TableEntityBorderType.Double : TableEntityBorderType.Single;
    flag(B.BorderType);
  }
  if (changed('spacing') && a.spacing !== undefined) {
    border.doubleLineSpacing = a.spacing;
    flag(B.DoubleLineSpacing);
  }
}

/**
 * Writes a row style's changes onto a row style, or a named cell style (`named`), which keeps
 * the alignment in its content format and fills with its background colour, None when unfilled.
 */
function writeCellStyle(
  r: Resolver,
  c: CellStyle,
  b: TableCellStyle | undefined,
  a: TableCellStyle,
  named: boolean,
): void {
  const changed = changes(b, a);
  if (changed('textStyle')) c.textStyle = resolve(r, a.textStyle!, TextStyle)!;
  if (changed('textHeight')) c.textHeight = a.textHeight;
  if (changed('alignment')) {
    if (named) c.alignment = a.alignment;
    else c.cellAlignment = a.alignment as never;
  }
  // DXF 62 and the DWG row style's text colour, which acad-ts keeps on the content format.
  if (changed('textColor')) c.color = acadColor(a.textColor);
  if (named) {
    if (changed('fillOn', 'fillColor'))
      c.backgroundColor = a.fillOn ? acadColor(a.fillColor) : AcadColor.byEntity;
  } else {
    if (changed('fillColor')) c.backgroundColor = acadColor(a.fillColor);
    if (changed('fillOn')) c.isFillColorOn = a.fillOn;
  }
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
  a.borders.forEach((e, i) => writeBorder(r, borders[i]!, b?.borders[i], e, named));
}

/** Writes the fields of `a` that differ from `b` (every one when `b` is undefined). */
function writeTableStyle(
  r: Resolver,
  s: TableStyle,
  b: TableStyleRecord | undefined,
  a: TableStyleRecord,
): void {
  const changed = changes(b, a);
  const t = s.tableCellStyle;
  const named = isNamedCellStyle(t);
  const rows = [s.dataCellStyle, s.titleCellStyle, s.headerCellStyle];
  // A DXF style whose borders come to need a CELLSTYLEMAP is given one, written whole below; a
  // DWG's named cell styles hold them, but a DXF save writes those as rows (M1-96).
  const fresh =
    (r.format === 'dxf' || !named) &&
    !cellStyleMapOf(s) &&
    (a.cellStyles.some(statesBorderExtras) || (a.userCellStyles?.length ?? 0) > 0);
  if (fresh) addCellStyleMap(r, s, a);
  const map = cellStyleMapRows(s);
  if (changed('description')) s.description = a.description;
  if (changed('flowDirection')) {
    s.flowDirection = a.flowDirection as never;
    if (named)
      t.tableCellStylePropertyFlags = (
        a.flowDirection === 1
          ? t.tableCellStylePropertyFlags | FLOW_BOTTOM_TO_TOP
          : t.tableCellStylePropertyFlags & ~FLOW_BOTTOM_TO_TOP
      ) as never;
  }
  if (changed('styleFlags')) s.flags = a.styleFlags;
  if (changed('horizontalMargin')) s.horizontalCellMargin = a.horizontalMargin;
  if (changed('verticalMargin')) s.verticalCellMargin = a.verticalMargin;
  if (named && changed('horizontalMargin', 'verticalMargin')) {
    // The DWG writes a cell style's margins only when it overrides them, as the Table cell
    // style of AutoCAD's own does; one made without them states none.
    t.marginOverrideFlags |= MarginFlags.Override;
    t.horizontalMargin = a.horizontalMargin;
    t.verticalMargin = a.verticalMargin;
  }
  // Every cell style of the map follows, those of the drafter's own too (M4-16 part 9).
  for (const c of [...(named ? rows : []), ...(cellStyleMapOf(s)?.cellStyles ?? [])]) {
    if (changed('horizontalMargin') && (!b || c.horizontalMargin === b.horizontalMargin))
      c.horizontalMargin = a.horizontalMargin;
    if (changed('verticalMargin') && (!b || c.verticalMargin === b.verticalMargin))
      c.verticalMargin = a.verticalMargin;
  }
  if (changed('suppressTitle')) s.suppressTitle = a.suppressTitle;
  if (changed('suppressHeader')) s.suppressHeaderRow = a.suppressHeader;
  if (changed('userCellStyles')) writeUserCellStyles(r, s, b?.userCellStyles, a.userCellStyles);
  if (!changed('cellStyles') && !fresh) return;
  a.cellStyles.forEach((c, i) => {
    writeCellStyle(r, rows[i]!, b?.cellStyles[i], c, named);
    if (map) writeCellStyle(r, map[i]!, fresh ? undefined : b?.cellStyles[i], c, true);
  });
}

/**
 * Gives table style `s` a CELLSTYLEMAP as AutoCAD's DXF saves hold one (acadsharp
 * sample_AC1032_ascii.dxf): `_TITLE`, `_HEADER` and `_DATA` cell styles (ids 1 to 3), named
 * ACAD_ROUNDTRIP_2008_TABLESTYLE_CELLSTYLEMAP in the style's extension dictionary (hard owner,
 * cloning kept), each laid out as a new R2010 style's (`nameCellStyles`) with the style's
 * margins. `writeTableStyle` then writes the rows' values into it.
 */
function addCellStyleMap(r: Resolver, s: TableStyle, a: TableStyleRecord): void {
  const map = new CellStyleMap();
  map.handle = r.allocate();
  const named = [
    ['_TITLE', 1, 1],
    ['_HEADER', 2, 1],
    ['_DATA', 3, 2],
  ] as const;
  map.cellStyles = named.map(([name, id, styleClass]) => {
    const c = mapCellStyle(name, id, styleClass, a.horizontalMargin, a.verticalMargin);
    if (id === 1) c.tableCellStylePropertyFlags = 0x8000 as never;
    return c;
  });
  let dict = s.xDictionary;
  if (!dict) {
    dict = new CadDictionary();
    dict.handle = r.allocate();
    dict.hardOwnerFlag = true;
    dict.clonningFlags = DictionaryCloningFlags.KeepExisting;
    dict.addByKey(CELL_STYLE_MAP, map);
    // Joining the style registers the dictionary and the map with the drawing.
    s.xDictionary = dict;
  } else {
    dict.addByKey(CELL_STYLE_MAP, map);
  }
}

/**
 * A named cell style for a CELLSTYLEMAP, laid out as a new R2010 style's (`nameCellStyles`):
 * class 1 label or 2 data, the margins `h` and `v` overridden, a None background.
 */
function mapCellStyle(
  name: string,
  id: number,
  styleClass: number,
  h: number,
  v: number,
): AcadCellStyle {
  const c = new AcadCellStyle();
  c.name = name;
  c.id = id;
  c.styleClass = styleClass as never;
  c.cellStyleType = CellStyleType.Table;
  c.hasData = true;
  c.cellPropertyOverrideFlags = 0 as never;
  c.backgroundColor = AcadColor.byEntity;
  c.contentLayoutFlags = 1 as never;
  c.scale = 1;
  c.marginOverrideFlags = MarginFlags.Override;
  c.horizontalMargin = h;
  c.verticalMargin = v;
  c.bottomMargin = c.rightMargin = 0.06;
  c.marginHorizontalSpacing = c.marginVerticalSpacing = 0.18;
  return c;
}

/**
 * Writes the cell styles of the drafter's own (M4-16 part 9) into style `s`'s CELLSTYLEMAP, by
 * id: one gone from `a` is removed, a new one added after the others as a data cell style (as
 * AutoCAD's Create New Cell Style makes one) with the style's margins, and each written as `a`
 * holds it (its name, then what changed from `b`).
 */
function writeUserCellStyles(
  r: Resolver,
  s: TableStyle,
  b: TableStyleRecord['userCellStyles'],
  a: TableStyleRecord['userCellStyles'],
): void {
  const map = cellStyleMapOf(s);
  if (!map) return;
  const was = new Map((b ?? []).map((c) => [c.id, c]));
  const kept = new Set((a ?? []).map((c) => c.id));
  const own = (c: CellStyle) => c.name !== '' && !RESERVED.has(c.name.toUpperCase());
  map.cellStyles = map.cellStyles.filter((c) => !(own(c) && was.has(c.id) && !kept.has(c.id)));
  for (const c of a ?? []) {
    let acad = map.cellStyles.find((x) => own(x) && x.id === c.id);
    const before = acad ? was.get(c.id) : undefined;
    if (!acad) {
      acad = mapCellStyle(c.name, c.id, 2, s.horizontalCellMargin, s.verticalCellMargin);
      map.cellStyles.push(acad);
    }
    acad.name = c.name;
    writeCellStyle(r, acad, before, c, true);
  }
}

/**
 * Writes the planned table style changes onto `doc`; new styles join its ACAD_TABLESTYLE
 * dictionary first (made when the drawing has none, as a new document's root holds one).
 */
export function writeTableStyles(doc: CadDocument, r: Resolver, plan: TableStylePlan): void {
  // Renamed styles first, as a new style may take a name one gives up.
  renameEntries(
    plan.updated
      .filter(({ before, after }) => before.name !== after.name)
      .map(({ acad, after }) => ({ acad, name: after.name })),
  );
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
