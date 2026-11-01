// MLEADERSTYLE and TABLESTYLE objects as Triya style records (M1-03). They are objects in the
// OBJECTS section, named by their ACAD_MLEADERSTYLE / ACAD_TABLESTYLE dictionary entry, but
// Triya keeps them beside the symbol tables because commands pick them by name like a DIMSTYLE.

import type { CellBorder, CellStyle, MultiLeaderStyle, TableStyle } from '@node-projects/acad-ts';
import type {
  MLeaderStyleRecord,
  TableCellBorder,
  TableCellStyle,
  TableStyleRecord,
} from '@triya/engine';
import { common, mapColor, mapEntityColor, mapLineweight, ref, vec3 } from './common';

/** What acad-ts holds in a MultiLeaderStyle colour property (see mapEntityColor). */
type AcadColorValue = Parameters<typeof mapEntityColor>[0];

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
    lineColor: mapEntityColor(s.lineColor as AcadColorValue),
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
    textColor: mapEntityColor(s.textColor as AcadColorValue),
    textHeight: s.textHeight,
    textFrame: s.textFrame,
    textAlignAlwaysLeft: s.textAlignAlwaysLeft,
    alignSpace: s.alignSpace,
    ...opt('block', s.blockContent),
    blockColor: mapEntityColor(s.blockContentColor as AcadColorValue),
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

function cellStyle(c: CellStyle): TableCellStyle {
  return {
    ...opt('textStyle', c.textStyle),
    textHeight: c.textHeight,
    alignment: c.cellAlignment as number,
    // DXF 62 is the cell's content colour, which acad-ts keeps on the content format.
    textColor: mapColor(c.color),
    fillColor: mapColor(c.backgroundColor),
    fillOn: c.isFillColorOn,
    dataType: c.cellStyleType as number,
    unitType: c.styleClass as number,
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

export function tableStyle(s: TableStyle): TableStyleRecord {
  return {
    // Not `base`: a TABLESTYLE has no DXF 70 standard flags; its 70 is the flow direction
    // and its flags are 71.
    ...common(s),
    name: s.name,
    description: s.description,
    flowDirection: s.flowDirection as number,
    styleFlags: s.flags,
    horizontalMargin: s.horizontalCellMargin,
    verticalMargin: s.verticalCellMargin,
    suppressTitle: s.suppressTitle,
    suppressHeader: s.suppressHeaderRow,
    cellStyles: s.cellStyles.map(cellStyle),
  };
}
