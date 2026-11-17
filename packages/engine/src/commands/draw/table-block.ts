// TINSERT (M4-16), as AutoCAD 2024's "TINSERT (Command)": "Pick a table cell:", then the Insert a
// Block in a Table Cell dialog (Name; Properties: Scale, AutoFit, Rotation angle, Overall cell
// alignment), and the block goes into the cell in place of what it held. The Table Cell menu's
// Insert Block (TABLECELL's BLock option) opens the same dialog on the cell selected.
//
// Where AutoCAD's documentation is silent: the dialog opens on what a block cell holds, else on
// the first block and AutoFit; a drawing without a block to insert says so and ends (the
// dialog's Browse..., which inserts another drawing as a block, waits for INSERT, M5); without
// AutoFit only the cell's row grows to hold the block (`fitTableBlockRow`).
import { contentLocked } from '../../edit/table-locks';
import { isContentBlock } from '../../properties/multileader-block';
import { tableCellStyle } from '../../annotation/table';
import {
  tableDrawingOf,
  withCellBlock,
  writeTableBlock,
  type TableCellBlock,
} from '../../edit/table';
import type { EntityId } from '../../model/entity-ids';
import type { Handle } from '../../model/handle';
import type { CommandContext, CommandDef } from '../command';
import type { NamedRecord, Prompt, PromptAnswer } from '../prompt';
import { pickTableCell, tableOf } from './table-cells';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The Insert a Block in a Table Cell dialog's fields; `block` absent until one is chosen. */
export interface TableBlockSettings extends Omit<TableCellBlock, 'block' | 'alignment'> {
  readonly block?: Handle;
  readonly alignment: number;
}

/** TINSERT's Insert a Block in a Table Cell dialog, opened on `settings`. */
export interface TableBlockRequest {
  readonly type: 'tinsert';
  /** The drawing's blocks a cell can hold, by name. */
  readonly blocks: readonly NamedRecord[];
  readonly settings: TableBlockSettings;
}

/** The drawing's named blocks, as the dialog's Name list offers them. */
function insertableBlocks(ctx: CommandContext): NamedRecord[] {
  return [...ctx.model.blocks.values()]
    .filter(isContentBlock)
    .map((b) => ({ handle: b.handle, name: b.name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** What the dialog opens on for cell (`i`, `j`) of table `id`. */
function settingsFor(
  ctx: CommandContext,
  id: EntityId,
  i: number,
  j: number,
  blocks: readonly NamedRecord[],
): TableBlockSettings | undefined {
  const t = tableOf(ctx, id);
  const c = t?.g.cells[i]?.[j];
  if (!t || !c) return undefined;
  const alignment = c.format?.alignment ?? tableCellStyle(t.g, t.style, i, j)?.alignment ?? 1;
  const held = c.type === 'block' && blocks.some((b) => b.handle === c.block);
  return {
    ...((held ? c.block : blocks[0]?.handle) !== undefined && {
      block: held ? c.block! : blocks[0]!.handle,
    }),
    scale: held && c.blockScale !== undefined && c.blockScale > 0 ? c.blockScale : 1,
    autoFit: held ? c.autoFit !== false : true,
    rotation: c.rotation,
    alignment,
  };
}

/**
 * The Insert a Block in a Table Cell dialog on cell (`i`, `j`) of table `id`, and its block put
 * in the cell on OK (one undo step); nothing on Cancel.
 */
export async function* insertCellBlock(
  ctx: CommandContext,
  id: EntityId,
  i: number,
  j: number,
): Sub<void> {
  // A cell whose content is locked takes no block (M4-16 part 6).
  if (contentLocked(tableOf(ctx, id)?.g.cells[i]?.[j])) {
    ctx.message('The cell’s content is locked.');
    return;
  }
  const blocks = insertableBlocks(ctx);
  if (blocks.length === 0) {
    ctx.message('The drawing has no blocks to insert in a table cell.');
    return;
  }
  const settings = settingsFor(ctx, id, i, j, blocks);
  if (!settings) return;
  const a = yield ctx.prompt.dialog({
    message: 'Insert a Block in a Table Cell',
    dialog: { type: 'tinsert', blocks, settings },
  });
  if (a.kind !== 'dialog' || a.action !== 'ok' || !a.tableBlock) return;
  const s = a.tableBlock;
  const block = s.block;
  const t = tableOf(ctx, id);
  if (!t || block === undefined || !blocks.some((b) => b.handle === block)) return;
  if (!s.autoFit && !(s.scale > 0)) {
    ctx.message('The scale must be greater than 0.');
    return;
  }
  const g = withCellBlock(t.g, t.style, tableDrawingOf(ctx.model), i, j, {
    block,
    scale: s.scale,
    autoFit: s.autoFit,
    rotation: s.rotation,
    alignment: s.alignment,
  });
  ctx.edit((b) => {
    b.updateEntity(id, { geom: g });
    writeTableBlock(b, ctx.model, id);
  });
}

/** TINSERT: "Pick a table cell:", then the dialog on the cell picked. */
export function tinsertCommand(): CommandDef {
  return {
    name: 'TINSERT',
    usesSelection: 'before',
    async *run(ctx) {
      const picked = yield* pickTableCell(ctx);
      if (picked) yield* insertCellBlock(ctx, picked.id, picked.cell[0], picked.cell[1]);
    },
  };
}
