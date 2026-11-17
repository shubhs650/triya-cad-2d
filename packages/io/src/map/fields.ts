// A text's fields (M4-10 part 1): the FIELD tree AutoCAD keeps in the `TEXT` entry of the
// `ACAD_FIELD` dictionary in a TEXT's, MTEXT's, ATTDEF's or ATTRIB's extension dictionary, or a
// MULTILEADER's for its text (M4-23; AcDbObject::setField's "TEXT" property, as an MTEXT's),
// mapped onto the text as `DrawingField` (DXF Reference, "FIELD"):
//
//   1  evaluator id (`_text` for the root)       2, 3  field code
//   90 child count, 360 each child               97 object count, 331 each object
//   91 when it may be evaluated (63 all of: open, save, plot, eTransmit, regeneration, on demand)
//   7  ACFD_FIELD_VALUE, the value (a date's 310 SYSTEMTIME among its groups)
//   301, 9  the value as shown
//
// A table cell's FIELD tree is not in a dictionary: the cell's content names its root (DXF 344 in
// the ACAD_TABLE codes, acad-ts 0186), and `fieldTree` maps it onto the cell (M4-23 part 2).
//
// The FIELD objects stay in the passthrough store as read; a save writes new values onto them
// (export/fields.ts). A tree whose children or objects cannot be followed is mapped without
// what is missing, which `fieldText` then shows as an unevaluated field.
import { CadDictionary, Field, type CadObject } from '@node-projects/acad-ts';
import { FIELD_OPTIONS_ALL, type DrawingField } from '@triya/engine';
import { hex } from './common';

export const ACAD_FIELD = 'ACAD_FIELD';
/** The entry of ACAD_FIELD that holds a text's own fields. */
export const FIELD_TEXT = 'TEXT';

/** The root FIELD of an object's text, if its extension dictionary holds one. */
export function rootField(o: CadObject): Field | undefined {
  const dict = o.xDictionary?.getEntry<CadDictionary>(ACAD_FIELD);
  const f = dict instanceof CadDictionary ? dict.getEntry<Field>(FIELD_TEXT) : undefined;
  return f instanceof Field ? f : undefined;
}

function mapField(f: Field, depth: number): DrawingField {
  const v = f.value.value;
  const time = v instanceof Date && Number.isFinite(v.getTime()) ? v.getTime() : undefined;
  return {
    evaluator: f.evaluatorId,
    code: f.fieldCode,
    // A FIELD that names itself among its own children (no file should) stops there.
    children: depth > 32 ? [] : f.children.map((c) => mapField(c, depth + 1)),
    objects: f.cadObjects.filter((o) => o && o.handle !== 0).map((o) => hex(o.handle)),
    ...(f.formatString !== '' ? { value: f.formatString } : {}),
    ...(time === undefined ? {} : { time }),
    // M4-10 part 3: FIELDEVAL updates only the fields whose options allow the event.
    ...(Number(f.evaluationOptionFlags) === FIELD_OPTIONS_ALL
      ? {}
      : { options: Number(f.evaluationOptionFlags) }),
  };
}

/** A FIELD tree as the model holds it: a table cell's (M4-23 part 2), whose content names it. */
export function fieldTree(f: Field): DrawingField {
  return mapField(f, 0);
}

/** `field` for a text's geometry: its FIELD tree, when it has one. */
export function textField(o: CadObject): { field: DrawingField } | Record<string, never> {
  const f = rootField(o);
  return f ? { field: mapField(f, 0) } : {};
}
