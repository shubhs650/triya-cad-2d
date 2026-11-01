// DIMSTYLE records as DIMVARs (M1-03). The names and group codes are AutoCAD's DXF reference
// for the DIMSTYLE table (https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-F2FAD36F-0CE3-4943-9DAD-A9BCD2AE81DA);
// each one is read from the acad-ts DimensionStyle property that carries that group.

import type { DimensionStyle } from '@node-projects/acad-ts';
import type { DimStyleRecord, DimVarValue } from '@triya/engine';
import { common, ref } from './common';

type Kind = 'value' | 'color' | 'ref';
type Getter = (s: DimensionStyle) => unknown;

/** [DIMVAR, DXF group, how its value is kept, the acad-ts property]. */
export const DIMVARS: readonly (readonly [string, number, Kind, Getter])[] = [
  ['DIMPOST', 3, 'value', (s) => s.postFix],
  ['DIMAPOST', 4, 'value', (s) => s.alternateDimensioningSuffix],
  ['DIMSCALE', 40, 'value', (s) => s.scaleFactor],
  ['DIMASZ', 41, 'value', (s) => s.arrowSize],
  ['DIMEXO', 42, 'value', (s) => s.extensionLineOffset],
  ['DIMDLI', 43, 'value', (s) => s.dimensionLineIncrement],
  ['DIMEXE', 44, 'value', (s) => s.extensionLineExtension],
  ['DIMRND', 45, 'value', (s) => s.rounding],
  ['DIMDLE', 46, 'value', (s) => s.dimensionLineExtension],
  ['DIMTP', 47, 'value', (s) => s.plusTolerance],
  ['DIMTM', 48, 'value', (s) => s.minusTolerance],
  ['DIMFXL', 49, 'value', (s) => s.fixedExtensionLineLength],
  ['DIMJOGANG', 50, 'value', (s) => s.joggedRadiusDimensionTransverseSegmentAngle],
  ['DIMTFILL', 69, 'value', (s) => s.textBackgroundFillMode],
  // DIMTFILLCLR is the record's second 70 group, after DIMTFILL; the first is the flags.
  ['DIMTFILLCLR', 70, 'color', (s) => s.textBackgroundColor],
  ['DIMTOL', 71, 'value', (s) => s.generateTolerances],
  ['DIMLIM', 72, 'value', (s) => s.limitsGeneration],
  ['DIMTIH', 73, 'value', (s) => s.textInsideHorizontal],
  ['DIMTOH', 74, 'value', (s) => s.textOutsideHorizontal],
  ['DIMSE1', 75, 'value', (s) => s.suppressFirstExtensionLine],
  ['DIMSE2', 76, 'value', (s) => s.suppressSecondExtensionLine],
  ['DIMTAD', 77, 'value', (s) => s.textVerticalAlignment],
  ['DIMZIN', 78, 'value', (s) => s.zeroHandling],
  ['DIMAZIN', 79, 'value', (s) => s.angularZeroHandling],
  ['DIMARCSYM', 90, 'value', (s) => s.arcLengthSymbolPosition],
  ['DIMTXT', 140, 'value', (s) => s.textHeight],
  ['DIMCEN', 141, 'value', (s) => s.centerMarkSize],
  ['DIMTSZ', 142, 'value', (s) => s.tickSize],
  ['DIMALTF', 143, 'value', (s) => s.alternateUnitScaleFactor],
  ['DIMLFAC', 144, 'value', (s) => s.linearScaleFactor],
  ['DIMTVP', 145, 'value', (s) => s.textVerticalPosition],
  ['DIMTFAC', 146, 'value', (s) => s.toleranceScaleFactor],
  ['DIMGAP', 147, 'value', (s) => s.dimensionLineGap],
  ['DIMALTRND', 148, 'value', (s) => s.alternateUnitRounding],
  ['DIMALT', 170, 'value', (s) => s.alternateUnitDimensioning],
  ['DIMALTD', 171, 'value', (s) => s.alternateUnitDecimalPlaces],
  ['DIMTOFL', 172, 'value', (s) => s.textOutsideExtensions],
  ['DIMSAH', 173, 'value', (s) => s.separateArrowBlocks],
  ['DIMTIX', 174, 'value', (s) => s.textInsideExtensions],
  ['DIMSOXD', 175, 'value', (s) => s.suppressOutsideExtensions],
  ['DIMCLRD', 176, 'color', (s) => s.dimensionLineColor],
  ['DIMCLRE', 177, 'color', (s) => s.extensionLineColor],
  ['DIMCLRT', 178, 'color', (s) => s.textColor],
  ['DIMADEC', 179, 'value', (s) => s.angularDecimalPlaces],
  ['DIMUNIT', 270, 'value', (s) => s.dimensionUnit],
  ['DIMDEC', 271, 'value', (s) => s.decimalPlaces],
  ['DIMTDEC', 272, 'value', (s) => s.toleranceDecimalPlaces],
  ['DIMALTU', 273, 'value', (s) => s.alternateUnitFormat],
  ['DIMALTTD', 274, 'value', (s) => s.alternateUnitToleranceDecimalPlaces],
  ['DIMAUNIT', 275, 'value', (s) => s.angularUnit],
  ['DIMFRAC', 276, 'value', (s) => s.fractionFormat],
  ['DIMLUNIT', 277, 'value', (s) => s.linearUnitFormat],
  // DXF states DIMDSEP as a character code; acad-ts and Triya keep the character.
  ['DIMDSEP', 278, 'value', (s) => s.decimalSeparator],
  ['DIMTMOVE', 279, 'value', (s) => s.textMovement],
  ['DIMJUST', 280, 'value', (s) => s.textHorizontalAlignment],
  ['DIMSD1', 281, 'value', (s) => s.suppressFirstDimensionLine],
  ['DIMSD2', 282, 'value', (s) => s.suppressSecondDimensionLine],
  ['DIMTOLJ', 283, 'value', (s) => s.toleranceAlignment],
  ['DIMTZIN', 284, 'value', (s) => s.toleranceZeroHandling],
  ['DIMALTZ', 285, 'value', (s) => s.alternateUnitZeroHandling],
  ['DIMALTTZ', 286, 'value', (s) => s.alternateUnitToleranceZeroHandling],
  ['DIMFIT', 287, 'value', (s) => s.dimensionFit],
  ['DIMUPT', 288, 'value', (s) => s.cursorUpdate],
  ['DIMATFIT', 289, 'value', (s) => s.dimensionTextArrowFit],
  ['DIMFXLON', 290, 'value', (s) => s.isExtensionLineLengthFixed],
  // The DXF reference gives DIMTXTDIRECTION as 294; acad-ts reads and writes it as 295. No
  // public corpus file states it, so the group code is not tested here.
  ['DIMTXTDIRECTION', 294, 'value', (s) => s.textDirection],
  ['DIMTXSTY', 340, 'ref', (s) => s.style],
  ['DIMLDRBLK', 341, 'ref', (s) => s.leaderArrow],
  ['DIMBLK', 342, 'ref', (s) => s.arrowBlock],
  ['DIMBLK1', 343, 'ref', (s) => s.dimArrow1],
  ['DIMBLK2', 344, 'ref', (s) => s.dimArrow2],
  ['DIMLTYPE', 345, 'ref', (s) => s.lineType],
  ['DIMLTEX1', 346, 'ref', (s) => s.lineTypeExt1],
  ['DIMLTEX2', 347, 'ref', (s) => s.lineTypeExt2],
  ['DIMLWD', 371, 'value', (s) => s.dimensionLineWeight],
  ['DIMLWE', 372, 'value', (s) => s.extensionLineWeight],
];

function dimVar(kind: Kind, v: unknown): DimVarValue | undefined {
  if (kind === 'ref') return ref(v as { handle: number } | null);
  if (kind === 'color') {
    const c = v as { isTrueColor: boolean; index: number; getApproxIndex(): number };
    return c.isTrueColor ? c.getApproxIndex() : c.index;
  }
  return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ? v : undefined;
}

export function dimStyle(s: DimensionStyle): DimStyleRecord {
  const vars: Record<string, DimVarValue> = {};
  for (const [name, , kind, get] of DIMVARS) {
    const v = dimVar(kind, get(s));
    if (v !== undefined) vars[name] = v;
  }
  return {
    ...common(s),
    name: s.name,
    ...(s.flags ? { flags: s.flags as number } : {}),
    vars,
  };
}
