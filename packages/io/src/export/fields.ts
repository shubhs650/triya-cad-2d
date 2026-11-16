// A text's field values on save (M4-10 part 1), the inverse of map/fields.ts for what UPDATEFIELD
// changes: each FIELD of the text's ACAD_FIELD tree takes its new value as shown (DXF 301 and
// the value's 302) and, for a date, its new time (the value's 310 SYSTEMTIME). The codes,
// flags, objects and every other value stay as the file had them; a FIELD whose code is not
// the model's (a tree the model no longer matches) is left as read. AutoCAD evaluates the
// fields again when it opens the drawing (FIELDEVAL), so a raw value Triya does not rework (a
// Filename field's full path) only waits for that.
import { CadValueType, type CadObject, type Field } from '@node-projects/acad-ts';
import type { DrawingField } from '@triya/engine';
import { rootField } from '../map/fields';

function writeValues(f: Field, d: DrawingField): void {
  if (f.fieldCode !== d.code || f.children.length !== d.children.length) return;
  if (d.value !== undefined && f.formatString !== d.value) {
    f.formatString = d.value;
    if (f.value.formattedValue !== '') f.value.formattedValue = d.value;
  }
  if (d.time !== undefined && f.value.valueType === CadValueType.Date) {
    const was = f.value.value;
    if (!(was instanceof Date) || was.getTime() !== d.time) f.value.value = new Date(d.time);
  }
  f.children.forEach((c, i) => writeValues(c, d.children[i]!));
}

/** Writes `field`'s values onto the FIELD tree of the text `o`, when it has one. */
export function writeFieldValues(o: CadObject, field: DrawingField | undefined): void {
  const root = rootField(o);
  if (root && field) writeValues(root, field);
}
