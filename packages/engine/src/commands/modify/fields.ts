// UPDATEFIELD (M4-10 part 1), as AutoCAD 2024 Help, "UPDATEFIELD (Command)": "Manually updates
// fields in selected objects in the drawing."
//
//   Select objects:
//   2 field(s) found.
//   2 field(s) updated.
//
// The fields of the TEXT, MTEXT and attribute definitions selected, and of the attributes of
// the block references selected, are evaluated again (edit/fields.ts) and each text shows the
// new values, as one undo step. A field Triya cannot evaluate keeps its value and is not
// counted as updated; one already up to date is (AutoCAD counts the fields it evaluated). The
// file name comes from the app (DWGNAME, DWGPREFIX); the date from the command's clock.
import { evaluateFields, type FieldContext } from '../../edit/fields';
import type { EntityId } from '../../model/entity-ids';
import type { Handle } from '../../model/handle';
import type { EntityGeometry, InsertAttribute, MTextGeometry, TextFields } from '../../model/types';
import type { CommandDef, CommandGenerator } from '../command';
import { fieldContextOf } from '../draw/field';

/** A text's fields evaluated again: the text with its new value and fields, and the counts. */
interface Updated<T> {
  readonly geom: T;
  readonly found: number;
  readonly evaluated: number;
}

function updateText<T extends TextFields>(t: T, ctx: FieldContext): Updated<T> {
  const r = evaluateFields(t.field!, ctx);
  // A multiline attribute shows its embedded MTEXT, which holds the same text.
  const mtext: MTextGeometry | undefined = (t as { mtext?: MTextGeometry }).mtext;
  const geom = {
    ...t,
    field: r.field,
    ...(mtext ? { mtext: { ...mtext, contents: r.text } } : { value: r.text }),
  };
  return { geom, found: r.found, evaluated: r.evaluated };
}

/** The geometry with its fields (and its attributes' fields) updated, undefined if none. */
function updated(
  g: EntityGeometry,
  base: Omit<FieldContext, 'space'>,
  space: Handle,
): Updated<EntityGeometry> | undefined {
  const ctx: FieldContext = { ...base, space };
  if ((g.kind === 'TEXT' || g.kind === 'ATTDEF') && g.field) return updateText(g, ctx);
  if (g.kind === 'MTEXT' && g.field) {
    const r = evaluateFields(g.field, ctx);
    return {
      geom: { ...g, contents: r.text, field: r.field },
      found: r.found,
      evaluated: r.evaluated,
    };
  }
  if (g.kind === 'INSERT' && g.attributes.some((a) => a.field)) {
    let found = 0;
    let evaluated = 0;
    const attributes = g.attributes.map((a): InsertAttribute => {
      if (!a.field) return a;
      const u = updateText(a, ctx);
      found += u.found;
      evaluated += u.evaluated;
      return u.geom;
    });
    return { geom: { ...g, attributes }, found, evaluated };
  }
  return undefined;
}

export function updateFieldCommand(): CommandDef {
  return {
    name: 'UPDATEFIELD',
    usesSelection: 'during',
    async *run(ctx): CommandGenerator {
      const a = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
      const ids = (a as { readonly ids?: readonly EntityId[] }).ids ?? [];
      if (ids.length === 0) return;
      const base = await fieldContextOf(ctx);
      let found = 0;
      let evaluated = 0;
      const changes: [EntityId, EntityGeometry][] = [];
      for (const id of ids) {
        const e = ctx.model.entity(id);
        const u = e && updated(e.geom, base, e.owner);
        if (!u) continue;
        found += u.found;
        evaluated += u.evaluated;
        if (JSON.stringify(u.geom) !== JSON.stringify(e.geom)) changes.push([id, u.geom]);
      }
      ctx.message(`${found} field(s) found.`);
      if (found === 0) return;
      ctx.message(`${evaluated} field(s) updated.`);
      if (changes.length > 0) {
        ctx.edit((b) => {
          for (const [id, geom] of changes) b.updateEntity(id, { geom });
        });
      }
    },
  };
}
