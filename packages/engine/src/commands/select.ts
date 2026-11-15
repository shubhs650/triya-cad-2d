// SELECT (M2-03): "Select objects" on its own. The set it makes is the Previous set the next
// command can take with P (AutoCAD 2024 Help, "SELECT (Command)"); with PICKADD 2 it is also
// left selected after SELECT ends (M3-04 part 4; AutoCAD Help, "PICKADD (System Variable)").
import type { CommandDef } from './command';
import { pickaddOf } from './filter';

export function selectCommand(): CommandDef {
  return {
    name: 'SELECT',
    usesSelection: 'during',
    async *run(ctx) {
      const a = yield ctx.prompt.selection({ message: 'Select objects' });
      if (a.kind === 'selection' && a.ids.length > 0 && (await pickaddOf(ctx)) === 2) {
        ctx.select(a.ids);
      }
    },
  };
}
