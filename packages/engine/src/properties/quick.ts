// Quick Properties (M2-35 part 16; AutoCAD 2024 Help, "Quick Properties Palette", "QPMODE"):
// the short list of the selected objects' properties the app shows by the cursor. AutoCAD takes
// its lists from the CUI file (each object type's Quick Properties in the CUI Editor), which
// Help does not reproduce and Triya does not ship (acad.cuix is Autodesk's). So the lists are
// Triya's own: General's Color, Layer and Linetype for every object, as AutoCAD's General
// entry has them, then the few rows a drafter checks a type by, its size before its place.
// Several types selected show General's three, as the Properties palette shows General only;
// the object list narrows the sheet to one type and its own rows.
import type { EntityType } from '../model/types';
import type { PropertySheet } from './sheet';

/** The rows every object shows. */
export const QUICK_GENERAL: readonly string[] = ['color', 'layer', 'linetype'];

const DIMENSION_ROWS = ['dimStyle', 'measurement', 'textOverride'] as const;
const TEXT_ROWS = ['contents', 'style', 'justify', 'height', 'rotation'] as const;

/**
 * Each type's own rows, by the Properties palette's row keys, in the order shown. A row the
 * sheet does not have for a selection (a gradient's pattern rows) is left out. A type that is
 * not listed shows General's three.
 */
export const QUICK_PROPERTIES: Readonly<Partial<Record<EntityType, readonly string[]>>> = {
  LINE: ['length', 'angle'],
  CIRCLE: ['radius', 'diameter', 'circumference', 'area'],
  ARC: ['radius', 'startAngle', 'endAngle', 'arcLength'],
  ELLIPSE: ['majorRadius', 'minorRadius'],
  POINT: ['positionX', 'positionY'],
  LWPOLYLINE: ['globalWidth', 'closed', 'length', 'area'],
  TEXT: TEXT_ROWS,
  MTEXT: TEXT_ROWS,
  INSERT: ['name', 'rotation', 'scaleX', 'scaleY'],
  DIMENSION: DIMENSION_ROWS,
  ARC_DIMENSION: DIMENSION_ROWS,
  LARGE_RADIAL_DIMENSION: DIMENSION_ROWS,
  HATCH: [
    'patternType',
    'patternName',
    'patternAngle',
    'patternScale',
    'gradientName',
    'gradientAngle',
    'associative',
  ],
  MULTILEADER: ['leaderType', 'arrowhead', 'style', 'height', 'sourceBlock', 'blockScale'],
};

/** QPMODE 2 shows the palette only for these types (Help: "objects that are supported"). */
export function hasQuickProperties(type: EntityType): boolean {
  return QUICK_PROPERTIES[type] !== undefined;
}

/**
 * The Properties sheet cut to Quick Properties: one section of General's three and the shown
 * type's own rows, the object list and the dynamic block badge kept. Undefined with nothing
 * selected: the drawing's current settings are the Properties palette's alone.
 */
export function quickPropertySheet(sheet: PropertySheet): PropertySheet | undefined {
  if (sheet.current || sheet.count === 0) return undefined;
  const oneType = sheet.filter ?? (sheet.types.length === 1 ? sheet.types[0]!.type : undefined);
  const keys = [...QUICK_GENERAL, ...((oneType && QUICK_PROPERTIES[oneType]) ?? [])];
  const rows = sheet.sections.flatMap((s) => s.rows);
  const quick = keys.flatMap((k) => rows.filter((r) => r.key === k));
  return { ...sheet, sections: [{ title: 'Quick Properties', rows: quick }] };
}
