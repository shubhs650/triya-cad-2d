// The Block Editor (M5-02 part 1): BEDIT, -BEDIT, BSAVE and BCLOSE, as AutoCAD 2024 has them
// (AutoCAD Help, "BEDIT (Command)", "Edit Block Definition Dialog Box", "BSAVE (Command)",
// "BCLOSE (Command)", "Block - Changes Not Saved Dialog Box", "BLOCKEDITOR (System Variable)"):
//
// - BEDIT opens the Edit Block Definition dialog on the drawing's blocks (one block reference
//   selected first names its block), -BEDIT asks "Enter block name or [?]"; the block chosen is
//   shown in the Block Editor, where every command draws and edits in its definition, so each
//   reference follows at once;
// - BSAVE keeps the edits made so far; BCLOSE closes the editor, asking first, when there are
//   edits not saved, whether to save them or discard them (Discard takes them all back, in the
//   BCLOSE undo step);
// - BLOCKEDITOR is 1 while the editor is open (setvar.ts).
//
// Decisions (noted in the PR): the editor shows the definition in its own coordinates, the base
// point where the definition keeps it (AutoCAD's documentation does not say whether the editor
// moves the base point to 0,0; the stored coordinates keep a save byte-for-byte unless edited).
// Not yet (later M5-02 parts): a new block named in the dialog or at -BEDIT (AutoCAD makes an
// empty one), <Current Drawing>, opening another block while the editor is open, the authoring
// palettes and parameters (dynamic block authoring is a PRD non-goal), REFEDIT and ATTSYNC.
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { Handle } from '../model/handle';
import type { BlockTableRecord } from '../model/types';
import { blockNamed, insertableBlocks } from '../edit/blocks';
import { wcmatch } from './modify/attributes';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** A block the Edit Block Definition dialog lists. */
export interface BlockEditEntry {
  readonly name: string;
  /** Its BLOCK_RECORD, for the preview (`StylePreview` kind 'block'). */
  readonly handle: Handle;
  /** The block's description (BLOCK DXF 4), shown under the preview. */
  readonly description: string;
}

/** BEDIT's Edit Block Definition dialog. OK answers `bedit` with the block chosen. */
export interface BlockEditRequest {
  readonly type: 'bedit';
  readonly blocks: readonly BlockEditEntry[];
  /** The block the list opens on. */
  readonly name: string;
  /** Why the last OK opened nothing. */
  readonly note?: string;
}

/**
 * BCLOSE's Block - Changes Not Saved question: answers `bclose` 'save' or 'discard'; Cancel
 * (escape) leaves the editor open.
 */
export interface BlockCloseRequest {
  readonly type: 'bclose';
  readonly name: string;
}

/** The blocks the editor opens: named ones, not a layout's, an xref's or an xref's dependent. */
export function editableBlocks(ctx: CommandContext): BlockTableRecord[] {
  return insertableBlocks(ctx.model).filter((r) => !r.name.includes('|'));
}

/** Why the block named `name` cannot be edited, or undefined. */
function editRefusal(ctx: CommandContext, name: string): string | undefined {
  const r = blockNamed(ctx.model, name);
  if (!r || !editableBlocks(ctx).includes(r)) return `Block "${name}" not found.`;
  return undefined;
}

/** The block the editor shows, by name, for messages. */
const shownName = (ctx: CommandContext): string =>
  ctx.model.tables.blockRecords.get(ctx.blockEditor.block!)?.name ?? '';

/** The block a reference selected first names (BEDIT on a selected block reference). */
function selectedBlock(
  ctx: CommandContext,
  blocks: readonly BlockTableRecord[],
): string | undefined {
  if (ctx.preselected.length !== 1) return undefined;
  const g = ctx.model.entity(ctx.preselected[0]!)?.geom;
  if (g?.kind !== 'INSERT') return undefined;
  return blocks.find((r) => r.handle === g.block)?.name;
}

/** Shows `r` in the Block Editor. */
async function open(ctx: CommandContext, r: BlockTableRecord): Promise<void> {
  ctx.blockEditor.open(r.handle);
  // The app shows the block; without one (a script, a test) the engine draws in it all the same.
  await ctx.view.request({ op: 'blockEditor', block: r.handle, name: r.name });
}

async function* listBlocks(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({
    message: 'Enter block(s) to list',
    default: { kind: 'string', value: '*' },
  });
  const pattern = (a as { readonly value: string }).value;
  ctx.message('Defined blocks.');
  for (const r of editableBlocks(ctx)) if (wcmatch(r.name, pattern)) ctx.message(`  "${r.name}"`);
}

async function* dashBedit(ctx: CommandContext): Sub<void> {
  for (;;) {
    const a = yield ctx.prompt.string({ message: 'Enter block name or', options: ['?'] });
    if (a.kind === 'keyword') {
      yield* listBlocks(ctx);
      continue;
    }
    if (a.kind !== 'string' || a.value.trim() === '') return;
    const name = a.value.trim();
    const refusal = editRefusal(ctx, name);
    if (refusal) {
      ctx.message(refusal);
      continue;
    }
    await open(ctx, blockNamed(ctx.model, name)!);
    return;
  }
}

async function* beditDialog(ctx: CommandContext): Sub<void> {
  const blocks = editableBlocks(ctx);
  let name = selectedBlock(ctx, blocks) ?? blocks[0]?.name ?? '';
  let note: string | undefined;
  for (;;) {
    const a = yield ctx.prompt.dialog({
      message: 'Edit Block Definition',
      dialog: {
        type: 'bedit',
        blocks: blocks.map((r) => ({
          name: r.name,
          handle: r.handle,
          description: ctx.model.blocks.get(r.handle)?.description ?? '',
        })),
        name,
        ...(note !== undefined && { note }),
      },
    });
    if (a.kind !== 'dialog' || a.action !== 'ok' || typeof a.bedit?.name !== 'string') return;
    name = a.bedit.name.trim();
    note = editRefusal(ctx, name);
    if (note) continue;
    await open(ctx, blockNamed(ctx.model, name)!);
    return;
  }
}

export function beditCommand(): CommandDef {
  return {
    name: 'BEDIT',
    dashVariant: true,
    usesSelection: 'before',
    async *run(ctx) {
      if (ctx.blockEditor.block !== undefined) {
        ctx.message('** The Block Editor is already open **');
        return;
      }
      yield* ctx.dash ? dashBedit(ctx) : beditDialog(ctx);
    },
  };
}

/** The message of a Block Editor command run with the editor closed. */
const notOpen = (ctx: CommandContext, name: string): boolean => {
  if (ctx.blockEditor.block !== undefined) return false;
  ctx.message(`** ${name} is only allowed in the Block Editor **`);
  return true;
};

export function bsaveCommand(): CommandDef {
  return {
    name: 'BSAVE',
    usesSelection: 'none',
    keepsSelection: true,
    // eslint-disable-next-line require-yield -- BSAVE asks nothing
    async *run(ctx) {
      if (notOpen(ctx, 'BSAVE')) return;
      ctx.blockEditor.save();
      ctx.message(`Block "${shownName(ctx)}" saved.`);
    },
  };
}

export function bcloseCommand(): CommandDef {
  return {
    name: 'BCLOSE',
    usesSelection: 'none',
    async *run(ctx) {
      if (notOpen(ctx, 'BCLOSE')) return;
      let discard = false;
      if (ctx.blockEditor.unsaved) {
        const a = yield ctx.prompt.dialog({
          message: 'Block - Changes Not Saved',
          escape: true,
          dialog: { type: 'bclose', name: shownName(ctx) },
        });
        if (a.kind !== 'dialog' || (a.bclose !== 'save' && a.bclose !== 'discard')) return;
        discard = a.bclose === 'discard';
      }
      ctx.blockEditor.close(discard);
      await ctx.view.request({ op: 'blockEditor' });
    },
  };
}

/** The Block Editor commands, for `builtinCommands`. */
export const BLOCK_EDITOR_COMMANDS: readonly (() => CommandDef)[] = [
  beditCommand,
  bsaveCommand,
  bcloseCommand,
];
