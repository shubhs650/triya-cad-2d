// ATTREDEF (M5-03 part 3), as AutoCAD 2024 has it (AutoCAD Help, "ATTREDEF (Command)":
// "Redefines a block and updates associated attributes"):
//
//   Enter the name of the block you wish to redefine:
//   Select objects for new Block...
//   Select objects:
//   Specify insertion base point of new Block:
//
// The block becomes the objects selected, based at the point, as -BLOCK's redefinition makes it
// (`defineBlock`), and every reference takes the new definition's attributes as ATTSYNC gives
// them (`syncAttributes`): "New attributes assigned to existing block references use their
// default values. Old attributes in the new block definition retain their old values. Old
// attributes not included in the new block definition are deleted." The attributes take the
// definitions' properties again, as Help warns ("ATTREDEF removes any format or property changes
// made with the ATTEDIT or EATTEDIT commands"). One undo step.
//
// Settled for the common drafter expectation, where Help is silent (noted in the PR):
// - the objects are erased once in the block, as -BLOCK erases them;
// - Help does not word the refusals; they read as -BLOCK's: "Block "B" not found." (a name no
//   insertable block has, a layout's included), "Block "B" is an external reference.",
//   "No objects selected." and "Block "B" references itself.";
// - an ATTRIB kept keeps its xdata, reactors and extension dictionary (the passthrough
//   invariant), though Help says ATTREDEF "deletes any extended data associated with the block".
import type { CommandDef } from './command';
import type { EntityId } from '../model/entity-ids';
import { blockNamed, defineBlock, insertableBlocks, selfReferences } from '../edit/blocks';
import { syncAttributes } from '../edit/attsync';
import { refusalMessages } from '../edit/edit';
import { isXrefRecord } from '../model/xref';
import { currentUcs } from './ucs';

export function attredefCommand(): CommandDef {
  return {
    name: 'ATTREDEF',
    erases: true,
    usesSelection: 'during',
    async *run(ctx) {
      const a = yield ctx.prompt.string({
        message: 'Enter the name of the block you wish to redefine',
        spaces: true,
      });
      if (a.kind !== 'string' || a.value.trim() === '') return;
      const name = a.value.trim();
      const r = blockNamed(ctx.model, name);
      if (r && (isXrefRecord(r) || r.name.includes('|'))) {
        ctx.message(`Block "${r.name}" is an external reference.`);
        return;
      }
      if (!r || !insertableBlocks(ctx.model).includes(r)) {
        ctx.message(`Block "${name}" not found.`);
        return;
      }
      ctx.message('Select objects for new Block...');
      const s = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
      const ids: readonly EntityId[] = s.kind === 'selection' ? s.ids : [];
      if (ids.length === 0) {
        ctx.message('No objects selected.');
        return;
      }
      if (selfReferences(ctx.model, ids, r.handle).length > 0) {
        ctx.message(`Block "${r.name}" references itself.`);
        return;
      }
      const p = yield ctx.prompt.point({ message: 'Specify insertion base point of new Block' });
      if (p.kind !== 'point') return;
      const ucs = currentUcs(ctx);
      let refused: ReadonlyMap<string, number> = new Map();
      ctx.edit((b) => {
        refused = defineBlock(b, ctx.model, {
          name: r.name,
          base: p.point,
          ids,
          ucs,
          erase: true,
        }).refused;
      });
      for (const line of refusalMessages(refused, 'put in the block')) ctx.message(line);
      // A second edit: the builder reads the drawing, not its own pending changes, so the
      // references are synchronized with the definition once it is in the drawing.
      ctx.edit((b) => syncAttributes(b, ctx.model, r.handle));
    },
  };
}
