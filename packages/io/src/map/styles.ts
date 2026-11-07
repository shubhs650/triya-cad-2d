// MLEADERSTYLE and TABLESTYLE objects as Triya style records (M1-03). They are objects in the
// OBJECTS section, named by their ACAD_MLEADERSTYLE / ACAD_TABLESTYLE dictionary entry, but
// Triya keeps them beside the symbol tables because commands pick them by name like a DIMSTYLE.

import {
  CellStyleMap,
  type CellBorder,
  type CellStyle,
  type Color as AcadColor,
  type MultiLeaderStyle,
  type TableStyle,
} from '@node-projects/acad-ts';
import type {
  MLeaderStyleRecord,
  TableCellBorder,
  TableCellStyle,
  TableStyleRecord,
} from '@triya/engine';
import { common, mapColor, mapEntityColor, mapLineweight, ref, vec3 } from './common';

/** `ref` for an optional reference, as a spread so absent references stay absent. */
const opt = <K extends string>(key: K, o: { readonly handle: number } | null | undefined) => {
  const h = ref(o);
  return (h ? { [key]: h } : {}) as Partial<Record<K, string>>;
};

export function mleaderStyle(s: MultiLeaderStyle): MLeaderStyleRecord {
  return {
    ...common(s),
    name: s.name,
    description: s.description,
    contentType: s.contentType as number,
    mleaderDrawOrder: s.multiLeaderDrawOrder as number,
    leaderDrawOrder: s.leaderDrawOrder as number,
    maxLeaderPoints: s.maxLeaderSegmentsPoints,
    firstSegmentAngle: s.firstSegmentAngleConstraint,
    secondSegmentAngle: s.secondSegmentAngleConstraint,
    pathType: s.pathType,
    lineColor: mapEntityColor(s.lineColor),
    ...opt('linetype', s.leaderLineType),
    lineweight: mapLineweight(s.leaderLineWeight),
    landing: s.enableLanding,
    landingGap: s.landingGap,
    dogleg: s.enableDogleg,
    doglegLength: s.landingDistance,
    ...opt('arrowhead', s.arrowhead),
    arrowheadSize: s.arrowheadSize,
    defaultText: s.defaultTextContents,
    ...opt('textStyle', s.textStyle),
    textLeftAttachment: s.textLeftAttachment,
    textRightAttachment: s.textRightAttachment,
    textTopAttachment: s.textTopAttachment,
    textBottomAttachment: s.textBottomAttachment,
    textAttachmentDirection: s.textAttachmentDirection,
    textAngleType: s.textAngle,
    textAlignment: s.textAlignment,
    textColor: mapEntityColor(s.textColor),
    textHeight: s.textHeight,
    textFrame: s.textFrame,
    textAlignAlwaysLeft: s.textAlignAlwaysLeft,
    alignSpace: s.alignSpace,
    ...opt('block', s.blockContent),
    blockColor: mapEntityColor(s.blockContentColor),
    blockScale: vec3(s.blockContentScale),
    blockScaleOn: s.enableBlockContentScale,
    blockRotation: s.blockContentRotation,
    blockRotationOn: s.enableBlockContentRotation,
    blockConnection: s.blockContentConnection,
    scale: s.scaleFactor,
    overwriteProperties: s.overwritePropertyValue,
    annotative: s.isAnnotative,
    breakGap: s.breakGapSize,
  };
}

const border = (b: CellBorder): TableCellBorder => ({
  lineweight: mapLineweight(b.lineWeight as number),
  visible: !b.isInvisible,
  color: mapColor(b.color),
});

/**
 * Whether acad-ts read the cell style from a DWG TABLESTYLE from R2010, where it is a named
 * cell style (ODA Open Design Specification for .dwg, "Cell style"): only that reader sets the
 * cell style's own override flags.
 */
export const isNamedCellStyle = (c: CellStyle): boolean => c.cellPropertyOverrideFlags !== null;

/**
 * Whether a named cell style's background colour fills the cell. AutoCAD leaves it None (DWG
 * method 0xC8, ACI 257 in acad-ts) when unfilled, and its table style dialog offers a fill of
 * None or a colour only, so ByBlock and ByLayer (which acad-ts gives a style it makes) fill
 * nothing either.
 */
const fills = (c: AcadColor): boolean => c.isTrueColor || (c.index >= 1 && c.index <= 255);

function cellStyle(c: CellStyle, named = isNamedCellStyle(c)): TableCellStyle {
  // A named cell style has no fill flag and no row alignment: AutoCAD keeps the alignment in its
  // content format and leaves the background colour None when unfilled. Its DXF save (the
  // R2010+ DXF still lists data, title and header row styles, kept in step with the
  // CELLSTYLEMAP) states such a row as fill off with colour 7, the colour a style made before
  // R2010 holds too (acadsharp sample_AC1024–AC1032 DWG against their DXF saves).
  const filled = named ? fills(c.backgroundColor) : c.isFillColorOn;
  return {
    ...opt('textStyle', c.textStyle),
    textHeight: c.textHeight,
    alignment: (named ? c.alignment : c.cellAlignment) as number,
    // DXF 62 is the cell's content colour, which acad-ts keeps on the content format.
    textColor: mapColor(c.color),
    fillColor: named && !filled ? { kind: 'aci', index: 7 } : mapColor(c.backgroundColor),
    fillOn: filled,
    dataType: c.valueDataType,
    unitType: c.valueUnitType,
    borders: [
      c.topBorder,
      c.horizontalInsideBorder,
      c.bottomBorder,
      c.leftBorder,
      c.verticalInsideBorder,
      c.rightBorder,
    ].map(border),
  };
}

/**
 * The row styles in the order DXF lists them and the record keeps them: data, title, header.
 * acad-ts lists a DWG's named cell styles from R2010 as stored (title, header, data, then any
 * user cell styles) but files the three by id, as it does a DXF's rows. A style that holds no
 * cell styles (made in memory) keeps none.
 */
const rowStyles = (s: TableStyle): CellStyle[] =>
  s.cellStyles.length === 0 ? [] : [s.dataCellStyle, s.titleCellStyle, s.headerCellStyle];

/**
 * The extension dictionary entry of the CELLSTYLEMAP that holds a table style's named cell
 * styles where the file keeps row styles: in every DXF AutoCAD 2008 or later saves, whatever its
 * version, and in a DWG before R2010 (which acad-ts keeps unread).
 */
export const CELL_STYLE_MAP = 'ACAD_ROUNDTRIP_2008_TABLESTYLE_CELLSTYLEMAP';

/**
 * A table style's CELLSTYLEMAP: its extension dictionary's CELL_STYLE_MAP entry, which an R14
 * DWG names `ACAD_ROUNDTRIP_2008_TABLES` (acadsharp sample_AC1014.dwg), so it is found by type.
 */
export function cellStyleMapOf(s: TableStyle): CellStyleMap | undefined {
  const named = s.xDictionary?.get(CELL_STYLE_MAP);
  if (named instanceof CellStyleMap) return named;
  for (const entry of s.xDictionary ?? []) if (entry instanceof CellStyleMap) return entry;
  return undefined;
}

/**
 * The data, title and header cell styles of a table style's CELLSTYLEMAP, in the record's row
 * order, by their ids (1 `_TITLE`, 2 `_HEADER`, 3 `_DATA`, as AutoCAD numbers them); undefined
 * when the style has no readable map or the map lacks one of the three.
 */
export function cellStyleMapRows(s: TableStyle): CellStyle[] | undefined {
  const map = cellStyleMapOf(s);
  if (!map) return undefined;
  const rows = [3, 1, 2].map((id) => map.cellStyles.find((c) => c.id === id));
  return rows.every((c) => c !== undefined) ? (rows as CellStyle[]) : undefined;
}

/**
 * A table style's CELLSTYLEMAP mapped as the record's row styles, which AutoCAD keeps in step
 * with the rows (M1-96); undefined as for `cellStyleMapRows`.
 */
export const mappedCellStyleMap = (s: TableStyle): TableCellStyle[] | undefined =>
  cellStyleMapRows(s)?.map((c) => cellStyle(c, true));

/** DWG "merge flags" bit of the Table cell style for a table that grows up (ODA spec). */
export const FLOW_BOTTOM_TO_TOP = 0x10000;

export function tableStyle(s: TableStyle): TableStyleRecord {
  // From R2010 a DWG keeps the table-wide settings in the style's "Table" cell style: its
  // margins, and the flow direction as a flag (the ODA spec's cell style merge flags, which may
  // only hold 0x8000 merge all and 0x10000 flow bottom to top). It has no suppress flags (the
  // AutoCAD 2008 table style dialog dropped them), and AutoCAD's DXF save states 0 for both.
  const table = isNamedCellStyle(s.tableCellStyle) ? s.tableCellStyle : null;
  return {
    // Not `base`: a TABLESTYLE has no DXF 70 standard flags; its 70 is the flow direction
    // and its flags are 71.
    ...common(s),
    name: s.name,
    description: s.description,
    flowDirection: table
      ? (table.tableCellStylePropertyFlags & FLOW_BOTTOM_TO_TOP) !== 0
        ? 1
        : 0
      : (s.flowDirection as number),
    styleFlags: s.flags,
    horizontalMargin: table ? table.horizontalMargin : s.horizontalCellMargin,
    verticalMargin: table ? table.verticalMargin : s.verticalCellMargin,
    suppressTitle: table ? false : s.suppressTitle,
    suppressHeader: table ? false : s.suppressHeaderRow,
    cellStyles: rowStyles(s).map((c) => cellStyle(c)),
  };
}
