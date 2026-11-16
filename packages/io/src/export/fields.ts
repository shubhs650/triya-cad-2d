// A text's fields on save (M4-10), the inverse of map/fields.ts.
//
// Part 1, values: when only the values changed (UPDATEFIELD), each FIELD of the text's
// ACAD_FIELD tree takes its new value as shown (DXF 301 and the value's 302) and, for a date,
// its new time (the value's 310 SYSTEMTIME). The codes, flags, objects and every other value
// stay as the file had them; a FIELD whose code is not the model's (a tree the model no longer
// matches) is left as read. AutoCAD evaluates the fields again when it opens the drawing
// (FIELDEVAL), so a raw value Triya does not rework (a Filename field's full path) only waits
// for that.
//
// Part 2, trees: a text given fields it did not have (FIELD, Insert Field, a copy of a text with
// fields) gets the tree AutoCAD keeps them in: the text's extension dictionary (made when it has
// none: hard owner, 280 = 1, 281 = 1, as AutoCAD makes it), its `ACAD_FIELD` dictionary, and
// the root `_text` FIELD under `TEXT` with a FIELD per child, numbered above every handle the
// engine handed out. Fields whose codes changed get a new tree in the old one's place, and a
// text whose fields are gone loses its tree, so AutoCAD does not put field values back over
// what was typed. The drawing's FIELDLIST (ACAD_FIELDLIST), when it has one, lists the FIELDs
// it holds, as AutoCAD's does.
import {
  CadDictionary,
  CadObject,
  CadValueType,
  DictionaryCloningFlags,
  EvaluationStatusFlags,
  Field,
  FieldList,
  FieldStateFlags,
} from '@node-projects/acad-ts';
import type { EvaluationOptionFlags } from '@node-projects/acad-ts';
import { fieldFormat, type DrawingField } from '@triya/engine';
import { ACAD_FIELD, FIELD_TEXT, rootField } from '../map/fields';
import { resolve, type Resolver } from './entities';

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

/** Whether two field trees are the same fields (codes and objects), whatever their values. */
function sameFields(a: DrawingField, b: DrawingField): boolean {
  return (
    a.evaluator === b.evaluator &&
    a.code === b.code &&
    a.objects.join() === b.objects.join() &&
    a.children.length === b.children.length &&
    a.children.every((c, i) => sameFields(c, b.children[i]!))
  );
}

/** A tree's FIELDs, the root first. */
function fieldsOf(f: Field): Field[] {
  return [f, ...f.children.flatMap(fieldsOf)];
}

function fieldList(o: CadObject): FieldList | undefined {
  const list = o.document?.rootDictionary?.getEntry(CadDictionary.acadFieldList);
  return list instanceof FieldList ? list : undefined;
}

/** Takes the text's field tree out of its ACAD_FIELD dictionary and the FIELDLIST. */
function removeTree(o: CadObject, root: Field): void {
  const gone = new Set(fieldsOf(root));
  const list = fieldList(o);
  if (list) list.fields = list.fields.filter((f) => !gone.has(f));
  const dict = o.xDictionary?.getEntry<CadDictionary>(ACAD_FIELD);
  if (!(dict instanceof CadDictionary)) return;
  dict.remove(FIELD_TEXT);
  if (dict.entryNames.length === 0) o.xDictionary!.remove(ACAD_FIELD);
}

/** One FIELD as AutoCAD writes a field it has evaluated (FIELD, DXF Reference). */
function newField(r: Resolver, d: DrawingField, owner: CadObject | null): Field {
  const f = new Field();
  f.handle = r.allocate();
  f.owner = owner;
  f.evaluatorId = d.evaluator;
  f.fieldCode = d.code;
  // Evaluated on open, save, plot, eTransmit, regeneration and on demand: FIELDEVAL decides.
  f.evaluationOptionFlags = 63 as EvaluationOptionFlags;
  f.fieldStateFlags =
    d.value === undefined
      ? FieldStateFlags.Initialized
      : ((FieldStateFlags.Initialized | FieldStateFlags.Evaluated) as FieldStateFlags);
  f.evaluationStatusFlags =
    d.value === undefined ? EvaluationStatusFlags.NotEvaluated : EvaluationStatusFlags.Success;
  // An object no longer in the drawing is left out: AutoCAD shows such a field as ####.
  f.cadObjects = d.objects.flatMap((h) => {
    const o = resolve(r, h, CadObject);
    return o ? [o] : [];
  });
  f.children = d.children.map((c) => newField(r, c, f));
  const shown = d.value ?? '';
  f.formatString = shown;
  if (d.time !== undefined) {
    f.value.setValue(new Date(d.time), CadValueType.Date);
    f.value.format = fieldFormat(d.code);
    f.value.formattedValue = shown;
  } else if (d.value !== undefined) {
    f.value.setValue(d.value, CadValueType.String);
    f.value.formattedValue = d.evaluator === '_text' ? '' : shown;
  }
  return f;
}

/** A dictionary as AutoCAD makes an extension dictionary: hard owner, keep existing. */
function newDictionary(r: Resolver): CadDictionary {
  const d = new CadDictionary();
  d.handle = r.allocate();
  d.hardOwnerFlag = true;
  d.clonningFlags = DictionaryCloningFlags.KeepExisting;
  return d;
}

/** Gives the text `o` the field tree of `d`, making the dictionaries it lacks. */
function addTree(r: Resolver, o: CadObject, d: DrawingField): void {
  let dict = o.xDictionary?.getEntry<CadDictionary>(ACAD_FIELD);
  const root = newField(r, d, null);
  if (dict instanceof CadDictionary) {
    dict.addByKey(FIELD_TEXT, root);
  } else {
    dict = newDictionary(r);
    dict.addByKey(FIELD_TEXT, root);
    if (o.xDictionary) o.xDictionary.addByKey(ACAD_FIELD, dict);
    else {
      const x = newDictionary(r);
      x.addByKey(ACAD_FIELD, dict);
      // Joining the text last registers the dictionaries with the drawing.
      o.xDictionary = x;
    }
    dict.addReactor(o.xDictionary!);
  }
  root.addReactor(dict);
  fieldList(o)?.fields.push(...fieldsOf(root));
}

/**
 * Writes a text's fields: their new values onto the tree it has when the fields are the same
 * (`before`'s), else a new tree in place of the old (none when `after` has no fields).
 */
export function writeFields(
  r: Resolver,
  o: CadObject,
  before: DrawingField | undefined,
  after: DrawingField | undefined,
): void {
  const root = rootField(o);
  if (root && before && after && sameFields(before, after)) {
    writeValues(root, after);
    return;
  }
  if (root) removeTree(o, root);
  if (after) addTree(r, o, after);
}
