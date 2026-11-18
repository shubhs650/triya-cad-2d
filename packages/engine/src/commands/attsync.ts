// ATTSYNC (M5-02 part 2), as AutoCAD 2024 has it (AutoCAD Help, "ATTSYNC (Command)"):
//
//   Enter an option [?/Name/Select] <Select>:
//     ?       Enter block name(s) to list <*>:   the blocks with attributes
//     Name    Enter name of block to update:     that block, at once
//     Select  Select a block:   then   ATTSYNC block NAME? [Yes/No] <Yes>:
//
// then every reference to the block is given the attributes its definition now has
// (`syncAttributes`: values kept, new ones at their defaults, removed ones gone), in one undo
// step. Decision (noted in the PR; AutoCAD's documentation does not say): a block whose
// definition has no attribute definitions is still taken while a reference carries attributes,
// so taking the last ATTDEF out of a block and running ATTSYNC strips them, the drafter's usual
// expectation; a block with neither is refused ("Block "X" has no attributes."). An xref's
// blocks, layout blocks and anonymous blocks are not offered, as AutoCAD offers named blocks.
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { Handle } from '../model/handle';
import type { BlockTableRecord } from '../model/types';
import { blockNamed, insertableBlocks } from '../edit/blocks';
import { hasAttributes, syncAttributes } from '../edit/attsync';
import { wcmatch } from './modify/attributes';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The named blocks ATTSYNC can take: insertable, not an xref's dependent. */
function namedBlocks(ctx: CommandContext): BlockTableRecord[] {
  return insertableBlocks(ctx.model).filter((r) => !r.name.includes('|'));
}

/** Why `r` cannot be synchronized, or undefined. */
function refusal(ctx: CommandContext, r: BlockTableRecord): string | undefined {
  return hasAttributes(ctx.model, r.handle) ? undefined : `Block "${r.name}" has no attributes.`;
}

async function* listBlocks(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({
    message: 'Enter block name(s) to list',
    default: { kind: 'string', value: '*' },
  });
  const pattern = (a as { readonly value: string }).value;
  ctx.message('Blocks with attributes.');
  for (const r of namedBlocks(ctx)) {
    if (wcmatch(r.name, pattern) && !refusal(ctx, r)) ctx.message(`  "${r.name}"`);
  }
}

/** Name: the block typed, or undefined when the prompt ended or it was refused. */
async function* byName(ctx: CommandContext): Sub<BlockTableRecord | undefined> {
  const a = yield ctx.prompt.string({ message: 'Enter name of block to update' });
  if (a.kind !== 'string' || a.value.trim() === '') return undefined;
  const name = a.value.trim();
  const r = blockNamed(ctx.model, name);
  if (!r || !namedBlocks(ctx).includes(r)) {
    ctx.message(`Block "${name}" not found.`);
    return undefined;
  }
  const why = refusal(ctx, r);
  if (why) ctx.message(why);
  return why ? undefined : r;
}

/** Select: a reference picked, then the Yes/No question; undefined when it ended or was refused. */
async function* bySelection(ctx: CommandContext): Sub<BlockTableRecord | undefined> {
  let r: BlockTableRecord;
  for (;;) {
    const s = yield ctx.prompt.selection({ message: 'Select a block', single: true });
    const ids = s.kind === 'selection' ? s.ids : [];
    if (ids.length === 0) return undefined;
    const g = ctx.model.entity(ids[0]!)?.geom;
    if (g?.kind !== 'INSERT') {
      ctx.message('That object is not a block.');
      continue;
    }
    const found = namedBlocks(ctx).find((x) => x.handle === g.block);
    const why = found
      ? refusal(ctx, found)
      : `Block "${ctx.model.tables.blockRecords.get(g.block)?.name ?? ''}" cannot be synchronized.`;
    if (found && !why) {
      r = found;
      break;
    }
    ctx.message(why!);
  }
  const a = yield ctx.prompt.keyword({
    message: `ATTSYNC block ${r.name}?`,
    options: ['Yes', 'No'],
    default: { kind: 'keyword', keyword: 'Yes' },
  });
  return a.kind === 'keyword' && a.keyword === 'Yes' ? r : undefined;
}

/** Gives every reference to `block` its definition's attributes, in this command's undo step. */
export function synchronize(ctx: CommandContext, block: Handle): void {
  ctx.edit((b) => syncAttributes(b, ctx.model, block));
  ctx.message('ATTSYNC complete.');
}

export function attsyncCommand(): CommandDef {
  return {
    name: 'ATTSYNC',
    usesSelection: 'none',
    async *run(ctx) {
      for (;;) {
        const a = yield ctx.prompt.keyword({
          message: 'Enter an option',
          options: ['?', 'Name', 'Select'],
          default: { kind: 'keyword', keyword: 'Select' },
        });
        if (a.kind !== 'keyword') return;
        if (a.keyword === '?') {
          yield* listBlocks(ctx);
          continue;
        }
        const r = a.keyword === 'Name' ? yield* byName(ctx) : yield* bySelection(ctx);
        if (r) synchronize(ctx, r.handle);
        return;
      }
    },
  };
}
