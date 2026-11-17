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
import { updateEntityFields } from '../../edit/field-eval';
import type { EntityId } from '../../model/entity-ids';
import type { EntityGeometry } from '../../model/types';
import type { CommandDef, CommandGenerator } from '../command';
import { fieldContextOf } from '../draw/field';

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
        const u = e && updateEntityFields(e.geom, base, e.owner);
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
