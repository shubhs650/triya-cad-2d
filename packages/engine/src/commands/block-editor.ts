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
//
// M5-02 part 2: a name no block has, typed in the dialog or at -BEDIT, makes an empty block (base
// point 0,0, the drawing's units) and opens it, as AutoCAD does ("Block to create or edit");
// making it counts as an edit not saved, so BCLOSE's Discard takes the block away again and
// BSAVE keeps it (AutoCAD keeps a new block only once it is saved).
//
// M5-02 part 4: BEDIT inside the editor (AutoCAD's Block Editor tab, Open/Save panel, "Edit
// Block") opens the dialog on the block shown; another block replaces it, asking first, when
// there are edits not saved, whether to save or discard them (AutoCAD Help, "Block - Changes Not
// Saved Dialog Box": shown when the editor closes "or you open another block definition");
// Cancel there leaves the block shown open. The dialog offers <Current Drawing> above the
// blocks: the drawing itself in the editor, its model space, where BASE sets INSBASE as it does
// outside the editor and BCLOSE's Discard takes back every change made since. -BEDIT takes block
// names only ("<Current Drawing>" is not one); AutoCAD's documentation names it for the dialog.
// Not yet: the authoring palettes and parameters (dynamic block authoring is a PRD non-goal).
// REFEDIT (M5-02 part 3, refedit.ts) edits a block in place instead; the two refuse each other.
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { Handle } from '../model/handle';
import type { BlockTableRecord } from '../model/types';
import { blockNameProblem, blockNamed, defineBlock, insertableBlocks } from '../edit/blocks';
import { modelSpaceOf } from './bus';
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
  /** The block the list opens on (`CURRENT_DRAWING` for the drawing itself). */
  readonly name: string;
  /**
   * The drawing's model space, offered above the blocks as <Current Drawing> (M5-02 part 4):
   * OK with `CURRENT_DRAWING` opens the drawing itself in the editor.
   */
  readonly currentDrawing?: Handle;
  /** Why the last OK opened nothing. */
  readonly note?: string;
}

/** The Edit Block Definition entry that opens the drawing itself (M5-02 part 4). */
export const CURRENT_DRAWING = '<Current Drawing>';

/**
 * BCLOSE's Block - Changes Not Saved question: answers `bclose` 'save' or 'discard'; Cancel
 * (escape) leaves the editor open.
 */
export interface BlockCloseRequest {
  readonly type: 'bclose';
  readonly name: string;
  /**
   * The block BEDIT opens next, when it asks before replacing the block shown (M5-02 part 4):
   * Discard then opens it instead of closing the editor.
   */
  readonly next?: string;
}

/** The blocks the editor opens: named ones, not a layout's, an xref's or an xref's dependent. */
export function editableBlocks(ctx: CommandContext): BlockTableRecord[] {
  return insertableBlocks(ctx.model).filter((r) => !r.name.includes('|'));
}

/**
 * Why the block named `name` cannot be edited, or undefined: a name no block has is a new block,
 * when it may name one.
 */
function editRefusal(ctx: CommandContext, name: string): string | undefined {
  const r = blockNamed(ctx.model, name);
  if (!r) return blockNameProblem(name);
  if (!editableBlocks(ctx).includes(r)) return `Block "${name}" not found.`;
  return undefined;
}

/** The name the editor shows `block` by: <Current Drawing> for model space. */
const editorName = (ctx: CommandContext, block: Handle): string =>
  block === modelSpaceOf(ctx.model)
    ? CURRENT_DRAWING
    : (ctx.model.tables.blockRecords.get(block)?.name ?? '');

/** The block the editor shows, by name, for messages. */
const shownName = (ctx: CommandContext): string => editorName(ctx, ctx.blockEditor.block!);

/** Whether `name` is <Current Drawing> (as the dialog answers it, any case). */
const isCurrentDrawing = (name: string) => name.toUpperCase() === CURRENT_DRAWING.toUpperCase();

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

/**
 * Shows the block named `name` in the Block Editor (the drawing's model space for
 * <Current Drawing>), making an empty block if there is none. Inside the editor, another block
 * replaces the one shown, after asking about edits not saved (Cancel keeps the one shown).
 */
async function* open(ctx: CommandContext, name: string): Sub<void> {
  const shown = ctx.blockEditor.block;
  const target = isCurrentDrawing(name)
    ? modelSpaceOf(ctx.model)
    : blockNamed(ctx.model, name)?.handle;
  if (shown !== undefined) {
    // The block shown: the editor stays as it is.
    if (target === shown) return;
    let discard = false;
    if (ctx.blockEditor.unsaved) {
      const next = target === undefined ? name : editorName(ctx, target);
      const a = yield ctx.prompt.dialog({
        message: 'Block - Changes Not Saved',
        escape: true,
        dialog: { type: 'bclose', name: shownName(ctx), next },
      });
      if (a.kind !== 'dialog' || (a.bclose !== 'save' && a.bclose !== 'discard')) return;
      discard = a.bclose === 'discard';
    }
    ctx.blockEditor.close(discard);
  }
  let block = target;
  if (block !== undefined && ctx.model.hasBlock(block)) ctx.blockEditor.open(block);
  else {
    // A new block (or one a Discard just took away: made again under the same name).
    const made = ctx.edit((b) => {
      block = defineBlock(b, ctx.model, { name, base: { x: 0, y: 0 }, ids: [] }).block;
    });
    ctx.blockEditor.open(block!, made);
  }
  // The app shows the block; without one (a script, a test) the engine draws in it all the same.
  await ctx.view.request({ op: 'blockEditor', block: block!, name: editorName(ctx, block!) });
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
    yield* open(ctx, name);
    return;
  }
}

async function* beditDialog(ctx: CommandContext): Sub<void> {
  const blocks = editableBlocks(ctx);
  const shown = ctx.blockEditor.block;
  const currentDrawing = modelSpaceOf(ctx.model);
  let name =
    selectedBlock(ctx, blocks) ??
    (shown !== undefined ? editorName(ctx, shown) : undefined) ??
    blocks[0]?.name ??
    CURRENT_DRAWING;
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
        currentDrawing,
        ...(note !== undefined && { note }),
      },
    });
    if (a.kind !== 'dialog' || a.action !== 'ok' || typeof a.bedit?.name !== 'string') return;
    name = a.bedit.name.trim();
    note = isCurrentDrawing(name) ? undefined : editRefusal(ctx, name);
    if (note) continue;
    yield* open(ctx, name);
    return;
  }
}

export function beditCommand(): CommandDef {
  return {
    name: 'BEDIT',
    dashVariant: true,
    usesSelection: 'before',
    async *run(ctx) {
      if (ctx.refEdit.session) {
        ctx.message('** BEDIT is not allowed while a reference is edited in place **');
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
