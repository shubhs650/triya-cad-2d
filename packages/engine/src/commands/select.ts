// SELECT (M2-03): "Select objects" on its own. The set it makes is the Previous set the next
// command can take with P (AutoCAD 2024 Help, "SELECT (Command)").
import type { CommandDef } from './command';

export function selectCommand(): CommandDef {
  return {
    name: 'SELECT',
    usesSelection: 'during',
    async *run(ctx) {
      yield ctx.prompt.selection({ message: 'Select objects' });
    },
  };
}
