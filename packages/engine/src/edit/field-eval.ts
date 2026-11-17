// Fields evaluated as the drawing is opened, saved and plotted (M4-10 part 3), as AutoCAD 2024
// Help, "FIELDEVAL (System Variable)": "Controls how fields are updated." Saved in the drawing,
// initially 31:
//
//   0  Not updated                       4  Updated on plot
//   1  Updated on open                   8  Updated on use of ETRANSMIT
//   2  Updated on save                  16  Updated on regeneration
//
// Each FIELD also says when it may be evaluated (DXF 91: the same bits, and 32 on demand). A field
// is evaluated on an event only when FIELDEVAL and its own options both have the event's bit, so
// a Date field, which AutoCAD makes for on demand only, waits for UPDATEFIELD. The update is the
// drawing's, not the drafter's: not an undo step, as AutoCAD's own evaluation is none.
//
// Triya opens, saves and plots in the app, which asks for the update (the session's `fields`
// edit). REGEN and REGENALL update fields themselves (M4-10 part 4), as their own undo step:
// AutoCAD lists REGEN on the undo list, and U after it shows the values from before. eTransmit
// has no counterpart.
// FIELDEVAL is kept where AutoCAD keeps it, as a DICTIONARYVAR (text) of the drawing's variable
// dictionary; a drawing without one has the initial 31.
import { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type {
  EntityGeometry,
  InsertAttribute,
  MTextGeometry,
  TableCell,
  TextFields,
} from '../model/types';
import { evaluateFields, type FieldContext } from './fields';
import { writeTableBlock } from './table';

/** FIELDEVAL's name, the drawing's DICTIONARYVAR. */
export const FIELDEVAL = 'FIELDEVAL';
/** FIELDEVAL's initial value: open, save, plot, eTransmit and regeneration. */
export const FIELDEVAL_INITIAL = 31;

/** The events that evaluate fields on their own, and their bits (FIELDEVAL's, DXF 91's). */
export const FIELD_EVENTS = { open: 1, save: 2, plot: 4, regen: 16 } as const;
export type FieldEvent = keyof typeof FIELD_EVENTS;

/** The drawing's FIELDEVAL: its DICTIONARYVAR's value, else the initial 31. */
export function fieldEval(model: { readonly header: DocumentModel['header'] }): number {
  const v = model.header.get(FIELDEVAL);
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : FIELDEVAL_INITIAL;
}

/** A text's fields evaluated again: the text with its new value and fields, and the counts. */
export interface UpdatedFields<T> {
  readonly geom: T;
  readonly found: number;
  readonly evaluated: number;
}

function updateText<T extends TextFields>(
  t: T,
  ctx: FieldContext,
  when: number | undefined,
): UpdatedFields<T> {
  const r = evaluateFields(t.field!, ctx, when);
  // A multiline attribute shows its embedded MTEXT, which holds the same text.
  const mtext: MTextGeometry | undefined = (t as { mtext?: MTextGeometry }).mtext;
  const geom = {
    ...t,
    field: r.field,
    ...(mtext ? { mtext: { ...mtext, contents: r.text } } : { value: r.text }),
  };
  return { geom, found: r.found, evaluated: r.evaluated };
}

/**
 * The geometry with its fields (and its attributes' fields) evaluated again, undefined if it has
 * none: the TEXT, MTEXT and attribute definitions, the multileaders' text (M4-23), the tables'
 * cells (M4-23 part 2), and the block references' attributes. `when`
 * evaluates only the fields whose options include that bit (`evaluateFields`).
 */
export function updateEntityFields(
  g: EntityGeometry,
  base: Omit<FieldContext, 'space'>,
  space: Handle,
  when?: number,
): UpdatedFields<EntityGeometry> | undefined {
  const ctx: FieldContext = { ...base, space };
  if ((g.kind === 'TEXT' || g.kind === 'ATTDEF') && g.field) return updateText(g, ctx, when);
  if (g.kind === 'MTEXT' && g.field) {
    const r = evaluateFields(g.field, ctx, when);
    return {
      geom: { ...g, contents: r.text, field: r.field },
      found: r.found,
      evaluated: r.evaluated,
    };
  }
  if (g.kind === 'MULTILEADER' && g.text?.field) {
    // A multileader's text (M4-23), as an MTEXT's.
    const r = evaluateFields(g.text.field, ctx, when);
    return {
      geom: { ...g, text: { ...g.text, content: r.text, field: r.field } },
      found: r.found,
      evaluated: r.evaluated,
    };
  }
  if (g.kind === 'ACAD_TABLE' && g.cells.some((row) => row.some((c) => c.field))) {
    // A table's cells (M4-23 part 2), each as an MTEXT's text: the cell shows the values.
    let found = 0;
    let evaluated = 0;
    const cells = g.cells.map((row) =>
      row.map((c): TableCell => {
        if (!c.field) return c;
        const r = evaluateFields(c.field, ctx, when);
        found += r.found;
        evaluated += r.evaluated;
        return { ...c, text: r.text, field: r.field };
      }),
    );
    return { geom: { ...g, cells }, found, evaluated };
  }
  if (g.kind === 'INSERT' && g.attributes.some((a) => a.field)) {
    let found = 0;
    let evaluated = 0;
    const attributes = g.attributes.map((a): InsertAttribute => {
      if (!a.field) return a;
      const u = updateText(a, ctx, when);
      found += u.found;
      evaluated += u.evaluated;
      return u.geom;
    });
    return { geom: { ...g, attributes }, found, evaluated };
  }
  return undefined;
}

/**
 * The texts an event changes: every text in every space and block whose fields FIELDEVAL and
 * their own options let the event evaluate, with its new geometry; none when FIELDEVAL leaves the
 * event out or every value is already up to date. Saving takes the save's time for SaveDate,
 * plotting the plot's for PlotDate.
 */
export function fieldEventUpdates(
  base: Omit<FieldContext, 'space'>,
  event: FieldEvent,
): { readonly id: EntityId; readonly geom: EntityGeometry }[] {
  const bit = FIELD_EVENTS[event];
  const model = base.model;
  if ((fieldEval(model) & bit) === 0) return [];
  const ctx: Omit<FieldContext, 'space'> = {
    ...base,
    ...(event === 'save' && { saveDate: base.now }),
    ...(event === 'plot' && { plotDate: base.now }),
  };
  const out: { id: EntityId; geom: EntityGeometry }[] = [];
  for (const e of model.entities()) {
    const u = updateEntityFields(e.geom, ctx, e.owner, bit);
    // A text none of whose fields the event evaluates stays exactly as it was.
    if (!u || u.evaluated === 0 || JSON.stringify(u.geom) === JSON.stringify(e.geom)) continue;
    out.push({ id: e.id, geom: u.geom });
  }
  return out;
}

/**
 * Whether an event may update any field: FIELDEVAL has its bit and some text holds a field. REGEN
 * asks before it asks the app for the file name (M4-10 part 4).
 */
export function fieldEventMayUpdate(model: DocumentModel, event: FieldEvent): boolean {
  if ((fieldEval(model) & FIELD_EVENTS[event]) === 0) return false;
  for (const e of model.entities()) {
    const g = e.geom;
    if ('field' in g && g.field) return true;
    if (g.kind === 'INSERT' && g.attributes.some((a) => a.field)) return true;
    if (g.kind === 'MULTILEADER' && g.text?.field) return true;
    if (g.kind === 'ACAD_TABLE' && g.cells.some((row) => row.some((c) => c.field))) return true;
  }
  return false;
}

/** The change an event makes to the drawing's fields (`fieldEventUpdates`), undefined for none. */
export function fieldEventChange(
  base: Omit<FieldContext, 'space'>,
  event: FieldEvent,
): ChangeSet | undefined {
  const updates = fieldEventUpdates(base, event);
  if (updates.length === 0) return undefined;
  const b = new ChangeSetBuilder(base.model);
  for (const u of updates) writeFieldUpdate(b, base.model, u.id, u.geom);
  return b.build();
}

/**
 * Gives entity `id` its geometry with fields evaluated again; a table's `*T` block, which AutoCAD
 * draws the table from, is drawn again with the cells' new values (M4-23 part 2).
 */
export function writeFieldUpdate(
  b: ChangeSetBuilder,
  model: DocumentModel,
  id: EntityId,
  geom: EntityGeometry,
): void {
  b.updateEntity(id, { geom });
  if (geom.kind === 'ACAD_TABLE') writeTableBlock(b, model, id);
}
