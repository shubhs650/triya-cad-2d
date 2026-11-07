// DIMSTYLE records as DIMVARs (M1-03). The names and group codes are AutoCAD's DXF reference
// for the DIMSTYLE table (https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-F2FAD36F-0CE3-4943-9DAD-A9BCD2AE81DA);
// each one is read from the acad-ts DimensionStyle property that carries that group.

import type { Color as AcadColor, DimensionStyle } from '@node-projects/acad-ts';
import type { Color, DimStyleRecord, DimVarValue } from '@triya/engine';
import { colorNumber, common, mapColor, ref } from './common';

export type DimVarKind = 'value' | 'color' | 'ref';
/** The acad-ts property that carries a DIMVAR's group (read and written as is). */
export type DimVarProperty = keyof DimensionStyle & string;

/** [DIMVAR, DXF group, how its value is kept, the acad-ts property]. */
export const DIMVARS: readonly (readonly [string, number, DimVarKind, DimVarProperty])[] = [
  ['DIMPOST', 3, 'value', 'postFix'],
  ['DIMAPOST', 4, 'value', 'alternateDimensioningSuffix'],
  ['DIMSCALE', 40, 'value', 'scaleFactor'],
  ['DIMASZ', 41, 'value', 'arrowSize'],
  ['DIMEXO', 42, 'value', 'extensionLineOffset'],
  ['DIMDLI', 43, 'value', 'dimensionLineIncrement'],
  ['DIMEXE', 44, 'value', 'extensionLineExtension'],
  ['DIMRND', 45, 'value', 'rounding'],
  ['DIMDLE', 46, 'value', 'dimensionLineExtension'],
  ['DIMTP', 47, 'value', 'plusTolerance'],
  ['DIMTM', 48, 'value', 'minusTolerance'],
  ['DIMFXL', 49, 'value', 'fixedExtensionLineLength'],
  ['DIMJOGANG', 50, 'value', 'joggedRadiusDimensionTransverseSegmentAngle'],
  ['DIMTFILL', 69, 'value', 'textBackgroundFillMode'],
  // DIMTFILLCLR is the record's second 70 group, after DIMTFILL; the first is the flags.
  ['DIMTFILLCLR', 70, 'color', 'textBackgroundColor'],
  ['DIMTOL', 71, 'value', 'generateTolerances'],
  ['DIMLIM', 72, 'value', 'limitsGeneration'],
  ['DIMTIH', 73, 'value', 'textInsideHorizontal'],
  ['DIMTOH', 74, 'value', 'textOutsideHorizontal'],
  ['DIMSE1', 75, 'value', 'suppressFirstExtensionLine'],
  ['DIMSE2', 76, 'value', 'suppressSecondExtensionLine'],
  ['DIMTAD', 77, 'value', 'textVerticalAlignment'],
  ['DIMZIN', 78, 'value', 'zeroHandling'],
  ['DIMAZIN', 79, 'value', 'angularZeroHandling'],
  ['DIMARCSYM', 90, 'value', 'arcLengthSymbolPosition'],
  ['DIMTXT', 140, 'value', 'textHeight'],
  ['DIMCEN', 141, 'value', 'centerMarkSize'],
  ['DIMTSZ', 142, 'value', 'tickSize'],
  ['DIMALTF', 143, 'value', 'alternateUnitScaleFactor'],
  ['DIMLFAC', 144, 'value', 'linearScaleFactor'],
  ['DIMTVP', 145, 'value', 'textVerticalPosition'],
  ['DIMTFAC', 146, 'value', 'toleranceScaleFactor'],
  ['DIMGAP', 147, 'value', 'dimensionLineGap'],
  ['DIMALTRND', 148, 'value', 'alternateUnitRounding'],
  ['DIMALT', 170, 'value', 'alternateUnitDimensioning'],
  ['DIMALTD', 171, 'value', 'alternateUnitDecimalPlaces'],
  ['DIMTOFL', 172, 'value', 'textOutsideExtensions'],
  ['DIMSAH', 173, 'value', 'separateArrowBlocks'],
  ['DIMTIX', 174, 'value', 'textInsideExtensions'],
  ['DIMSOXD', 175, 'value', 'suppressOutsideExtensions'],
  ['DIMCLRD', 176, 'color', 'dimensionLineColor'],
  ['DIMCLRE', 177, 'color', 'extensionLineColor'],
  ['DIMCLRT', 178, 'color', 'textColor'],
  ['DIMADEC', 179, 'value', 'angularDecimalPlaces'],
  ['DIMUNIT', 270, 'value', 'dimensionUnit'],
  ['DIMDEC', 271, 'value', 'decimalPlaces'],
  ['DIMTDEC', 272, 'value', 'toleranceDecimalPlaces'],
  ['DIMALTU', 273, 'value', 'alternateUnitFormat'],
  ['DIMALTTD', 274, 'value', 'alternateUnitToleranceDecimalPlaces'],
  ['DIMAUNIT', 275, 'value', 'angularUnit'],
  ['DIMFRAC', 276, 'value', 'fractionFormat'],
  ['DIMLUNIT', 277, 'value', 'linearUnitFormat'],
  // DXF states DIMDSEP as a character code; acad-ts and Triya keep the character.
  ['DIMDSEP', 278, 'value', 'decimalSeparator'],
  ['DIMTMOVE', 279, 'value', 'textMovement'],
  ['DIMJUST', 280, 'value', 'textHorizontalAlignment'],
  ['DIMSD1', 281, 'value', 'suppressFirstDimensionLine'],
  ['DIMSD2', 282, 'value', 'suppressSecondDimensionLine'],
  ['DIMTOLJ', 283, 'value', 'toleranceAlignment'],
  ['DIMTZIN', 284, 'value', 'toleranceZeroHandling'],
  ['DIMALTZ', 285, 'value', 'alternateUnitZeroHandling'],
  ['DIMALTTZ', 286, 'value', 'alternateUnitToleranceZeroHandling'],
  ['DIMFIT', 287, 'value', 'dimensionFit'],
  ['DIMUPT', 288, 'value', 'cursorUpdate'],
  ['DIMATFIT', 289, 'value', 'dimensionTextArrowFit'],
  ['DIMFXLON', 290, 'value', 'isExtensionLineLengthFixed'],
  // The DXF reference gives DIMTXTDIRECTION as 294; acad-ts reads and writes it as 295. No
  // public corpus file states it, so the group code is not tested here.
  ['DIMTXTDIRECTION', 294, 'value', 'textDirection'],
  ['DIMTXSTY', 340, 'ref', 'style'],
  ['DIMLDRBLK', 341, 'ref', 'leaderArrow'],
  ['DIMBLK', 342, 'ref', 'arrowBlock'],
  ['DIMBLK1', 343, 'ref', 'dimArrow1'],
  ['DIMBLK2', 344, 'ref', 'dimArrow2'],
  ['DIMLTYPE', 345, 'ref', 'lineType'],
  ['DIMLTEX1', 346, 'ref', 'lineTypeExt1'],
  ['DIMLTEX2', 347, 'ref', 'lineTypeExt2'],
  ['DIMLWD', 371, 'value', 'dimensionLineWeight'],
  ['DIMLWE', 372, 'value', 'extensionLineWeight'],
];

function dimVar(kind: DimVarKind, v: unknown): DimVarValue | undefined {
  if (kind === 'ref') return ref(v as { handle: number } | null);
  if (kind === 'color') return colorNumber(v as AcadColor);
  return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ? v : undefined;
}

export function dimStyle(s: DimensionStyle): DimStyleRecord {
  const vars: Record<string, DimVarValue> = {};
  // R2004+ DWGs hold DIMSTYLE colours as AcCmColor, which may be a true colour; DXF only has the
  // ACI AutoCAD writes for it, which `vars` keeps (M1-55).
  const trueColors: Record<string, Color> = {};
  for (const [name, , kind, prop] of DIMVARS) {
    const raw: unknown = s[prop];
    const v = dimVar(kind, raw);
    if (v !== undefined) vars[name] = v;
    if (kind === 'color' && (raw as AcadColor).isTrueColor)
      trueColors[name] = mapColor(raw as AcadColor);
  }
  return {
    ...common(s),
    name: s.name,
    ...(s.flags ? { flags: s.flags as number } : {}),
    vars,
    ...(Object.keys(trueColors).length ? { trueColors } : {}),
  };
}
