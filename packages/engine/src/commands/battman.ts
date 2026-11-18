// BATTMAN (M5-03 part 2; COMMANDS.md "Blocks and references"), the Block Attribute Manager, as
// AutoCAD 2024's (AutoCAD Help, "BATTMAN (Command)", "Block Attribute Manager", "Edit Attribute
// Dialog Box (BATTMAN)", "Block Attribute Settings Dialog Box"):
//
//   Select block   closes the dialog for "Select a block:", then shows the block picked
//   Block          the drawing's blocks with attribute definitions
//   the list       the selected block's definitions (Tag, Prompt, Default, Modes by default)
//   Found in drawing: n   Found in model space: n
//   Sync, Move Up, Move Down, Edit..., Remove, Settings..., OK, Cancel, Apply
//
// The dialog keeps its changes until Apply, OK or Sync (the front-end holds them; Cancel drops
// what was not applied). Each Apply changes the definitions (`changeDefinitions`) and, with the
// Block Attribute Settings' "Apply changes to existing references", gives every reference the
// definitions as ATTSYNC does; Sync does that whatever the setting. A drawing without attributed
// blocks says "This drawing contains no attributed blocks." and opens nothing. The whole
// session is one BATTMAN undo step.
//
// Settled for the common drafter expectation, where Help is silent (noted in the PR):
// - choosing another block in the Block list, or Select block, with changes not applied applies
//   them first, so nothing made in the dialog is lost without Cancel;
// - "Apply changes to existing references" is on at first, the Settings dialog's own state kept
//   by the front-end;
// - a block reference picked with Select block whose block has no attribute definitions is
//   refused ("That block has no attribute definitions.") and the prompt asks again; Enter or Esc
//   there returns to the dialog on the block it showed;
// - a dynamic block's reference stands for its definition, as EATTEDIT's block name does.
//
// Edit Attribute's "Auto preview changes" (M5-03 part 3; Help: "Controls whether or not the
// drawing area is immediately updated to display any visible attribute changes you make ... not
// available if Apply Changes to Existing References is not selected"): the dialog answers
// `preview` with its changes as they stand, which are put on the definitions and the references
// (the Edit Attribute changes; Move and Remove wait for Apply), and the same dialog is shown
// again. Every answer, and the command's end however it ends, takes the preview back first, so
// Apply and OK make the changes once and Cancel leaves the drawing as it was (the undo step then
// holds the preview and its taking back, which cancel out).
import type { ChangeSet } from '../model/changeset';
import type { Handle } from '../model/handle';
import type { BlockTableRecord, TextGeometry } from '../model/types';
import { dynamicBlockOf } from '../model/dynamic-block';
import { ChangeSetBuilder } from '../model/builder';
import { colorBooks } from '../properties/color-books';
import { insertableBlocks } from '../edit/blocks';
import { syncAttributes } from '../edit/attsync';
import { revertChanges } from '../edit/edit';
import {
  changeDefinitions,
  definitionManagerEntry,
  definitionsOf,
  referencesTo,
  type DefinitionChanges,
} from '../edit/attribute-definitions';
import type { CommandContext, CommandDef } from './command';
import type {
  AttributeDefinitionPatch,
  BattmanAnswer,
  BattmanResume,
  DialogRequest,
  Prompt,
  PromptAnswer,
} from './prompt';
import { textWithFields, type FieldContext } from '../edit/fields';
import { askMarkedField, fieldContextOf, fieldValuesOf } from './draw/field';
import type { TextOutline } from './view/host';
import { modelSpaceOf } from './bus';
import { plotStyleChoices, records, valueEntry } from './modify/attributes';
import type { AttdefGeometry, DrawingField } from '../model/types';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The named blocks with attribute definitions BATTMAN lists: insertable, not an xref's. */
export function attributedBlocks(ctx: CommandContext): BlockTableRecord[] {
  return insertableBlocks(ctx.model).filter(
    (r) => !r.name.includes('|') && definitionsOf(ctx.model, r.handle).length > 0,
  );
}

/** The block a reference stands for: a dynamic block's definition, not its state. */
function blockOf(ctx: CommandContext, block: Handle): Handle {
  return dynamicBlockOf(ctx.model.blocks, block)?.handle ?? block;
}

/** The pre-selected reference's block, when one reference to an attributed block is selected. */
function preselected(ctx: CommandContext, blocks: readonly BlockTableRecord[]): Handle | undefined {
  for (const id of ctx.preselected) {
    const g = ctx.model.entity(id)?.geom;
    if (g?.kind !== 'INSERT') continue;
    const h = blockOf(ctx, g.block);
    if (blocks.some((r) => r.handle === h)) return h;
  }
  return undefined;
}

/** The current space as the dialog's "Found in" names it. */
function spaceName(ctx: CommandContext): string {
  if (ctx.space === modelSpaceOf(ctx.model)) return 'model space';
  const layout = ctx.model.layouts.find((l) => l.blockRecord === ctx.space);
  return layout?.name ?? ctx.model.tables.blockRecords.get(ctx.space)?.name ?? '';
}

function request(
  ctx: CommandContext,
  blocks: readonly BlockTableRecord[],
  block: Handle,
  selected: Handle | undefined,
  resume?: BattmanResume,
): DialogRequest {
  const attributes = definitionsOf(ctx.model, block).map(definitionManagerEntry);
  const refs = referencesTo(ctx.model, block);
  const plotStyles = plotStyleChoices(ctx);
  const books = colorBooks(ctx.model);
  const keep = selected !== undefined && attributes.some((a) => a.handle === selected);
  return {
    type: 'battman',
    blocks: records(blocks),
    block,
    attributes,
    ...(keep && { selected }),
    ...(resume && { resume }),
    inDrawing: refs.length,
    inSpace: refs.filter((id) => ctx.model.entity(id)!.owner === ctx.space).length,
    space: spaceName(ctx),
    styles: records(ctx.model.tables.textStyles.values()),
    layers: records(ctx.model.tables.layers.values()),
    linetypes: records(ctx.model.tables.linetypes.values()),
    ...(plotStyles && { plotStyles }),
    ...(books.length > 0 && { colorBooks: books }),
  };
}

/** Select block: the block of the reference picked, or undefined to go back as it was. */
async function* pickBlock(ctx: CommandContext): Sub<Handle | undefined> {
  for (;;) {
    const a = yield ctx.prompt.selection({ message: 'Select a block', single: true });
    const ids = a.kind === 'selection' ? a.ids : [];
    if (ids.length === 0) return undefined;
    const g = ctx.model.entity(ids[0]!)?.geom;
    if (g?.kind !== 'INSERT') {
      ctx.message('That object is not a block.');
      continue;
    }
    const h = blockOf(ctx, g.block);
    if (attributedBlocks(ctx).some((r) => r.handle === h)) return h;
    ctx.message('That block has no attribute definitions.');
  }
}

/**
 * The tags as drawn now of the single-line definitions whose justification `m` changes, so a
 * new justification keeps the insertion point (as EATTEDIT's does).
 */
async function outlinesFor(
  ctx: CommandContext,
  m: BattmanAnswer,
): Promise<Map<Handle, TextOutline>> {
  const defs = new Map(definitionsOf(ctx.model, m.block).map((e) => [e.handle, e]));
  const moving = m.attributes.flatMap((p) => {
    const e = defs.get(p.handle);
    const d = e?.geom as AttdefGeometry | undefined;
    if (!e || !d || d.mtext || e.annotative) return [];
    const h = p.halign ?? d.halign;
    const v = p.valign ?? d.valign;
    return h !== d.halign || v !== d.valign ? [e] : [];
  });
  const out = new Map<Handle, TextOutline>();
  if (moving.length === 0) return out;
  const texts = moving.map((e) => {
    const { kind: _k, prompt: _p, tag, ...fields } = e.geom as AttdefGeometry;
    return { ...fields, kind: 'TEXT', value: tag } as TextGeometry;
  });
  const r = await ctx.view.request({ op: 'textOutlines', texts });
  moving.forEach((e, i) => {
    const o = r.ok ? r.outlines?.[i] : undefined;
    if (o) out.set(e.handle, o);
  });
  return out;
}

/**
 * The dialog's patches with each changed default the text it shows, and that default's fields
 * (M5-03 part 4: the list and Edit Attribute hold a default's fields as codes); a default left
 * as it was is not changed.
 */
async function resolved(
  ctx: CommandContext,
  block: Handle,
  patches: readonly AttributeDefinitionPatch[],
): Promise<Pick<DefinitionChanges, 'attributes' | 'fields'>> {
  if (!patches.some((p) => p.value !== undefined)) return { attributes: patches };
  const fc: FieldContext = { ...(await fieldContextOf(ctx)), space: block };
  const defs = new Map(definitionsOf(ctx.model, block).map((e) => [e.handle, e]));
  const fields = new Map<Handle, DrawingField | undefined>();
  const attributes = patches.map((p) => {
    const d = defs.get(p.handle)?.geom as AttdefGeometry | undefined;
    if (!d || p.value === undefined) return p;
    const { value, ...rest } = p;
    if (value === valueEntry(d).value) return rest;
    const t = textWithFields(value, fc, d.field);
    fields.set(p.handle, t.field);
    return { ...p, value: t.text };
  });
  return { attributes, fields };
}

/** Applies the dialog's changes to its block, then the references as the settings say. */
async function apply(ctx: CommandContext, m: BattmanAnswer): Promise<void> {
  if (!ctx.model.hasBlock(m.block)) return;
  const all = definitionsOf(ctx.model, m.block);
  let removed = m.removed.filter((h) => all.some((e) => e.handle === h));
  if (removed.length >= all.length) {
    // The Remove button is not offered for a block's last definition.
    ctx.message('A block keeps at least one attribute definition.');
    removed = [];
  }
  const changes: DefinitionChanges = {
    order: m.order,
    removed,
    ...(await resolved(ctx, m.block, m.attributes)),
  };
  const outlines = await outlinesFor(ctx, m);
  // Tried on a builder that is never applied first, so a dialog closed with nothing changed
  // makes no change set.
  const changes0 = changeDefinitions(new ChangeSetBuilder(ctx.model), ctx.model, m.block, changes);
  if (changes0) {
    ctx.edit((b) => changeDefinitions(b, ctx.model, m.block, changes, outlines, m.applyToExisting));
  }
  const sync = m.sync === true || (m.applyToExisting && changes0);
  if (sync && referencesTo(ctx.model, m.block).length > 0) {
    ctx.edit((b) => syncAttributes(b, ctx.model, m.block));
  }
}

/**
 * Auto preview: the Edit Attribute changes `m` holds put on the definitions and, as "Apply
 * changes to existing references" asks, the references; the change sets made go into `out`.
 */
async function preview(ctx: CommandContext, m: BattmanAnswer, out: ChangeSet[]): Promise<void> {
  if (!m.applyToExisting || !ctx.model.hasBlock(m.block)) return;
  const order = definitionsOf(ctx.model, m.block).map((e) => e.handle);
  const changes: DefinitionChanges = {
    order,
    removed: [],
    ...(await resolved(ctx, m.block, m.attributes)),
  };
  if (!changeDefinitions(new ChangeSetBuilder(ctx.model), ctx.model, m.block, changes)) return;
  const outlines = await outlinesFor(ctx, m);
  out.push(ctx.edit((b) => changeDefinitions(b, ctx.model, m.block, changes, outlines, true)));
  if (referencesTo(ctx.model, m.block).length > 0) {
    out.push(ctx.edit((b) => syncAttributes(b, ctx.model, m.block)));
  }
}

export function battmanCommand(): CommandDef {
  return {
    name: 'BATTMAN',
    usesSelection: 'before',
    async *run(ctx) {
      let blocks = attributedBlocks(ctx);
      if (blocks.length === 0) {
        ctx.message('This drawing contains no attributed blocks.');
        return;
      }
      let block = preselected(ctx, blocks) ?? blocks[0]!.handle;
      let selected: Handle | undefined;
      // The Auto preview showing, taken back before anything else happens.
      const previewed: ChangeSet[] = [];
      const takeBack = () => {
        for (const cs of previewed.splice(0).reverse()) ctx.edit((b) => revertChanges(b, cs));
      };
      let shown: DialogRequest | undefined;
      let resume: BattmanResume | undefined;
      try {
        for (;;) {
          const dialog = shown ?? request(ctx, blocks, block, selected, resume);
          shown = undefined;
          resume = undefined;
          const d = yield ctx.prompt.dialog({ message: 'Block Attribute Manager', dialog });
          takeBack();
          if (d.kind !== 'dialog') return;
          const m = d.battman;
          if (d.action === 'field' && d.resume) {
            // Edit Attribute's Insert Field or Edit Field (M5-03 part 4): the Field dialog, then
            // the manager again as it stood, nothing applied, the Default holding the field.
            const r: BattmanResume = d.resume;
            const def = definitionsOf(ctx.model, block).find((e) => e.handle === r.editing.handle);
            const fc: FieldContext = { ...(await fieldContextOf(ctx)), space: block };
            const value: string = yield* askMarkedField(ctx, fc, r.editing.value);
            const old = (def?.geom as AttdefGeometry | undefined)?.field;
            const fields = fieldValuesOf(value, fc, old);
            resume = { ...r, editing: { ...r.editing, value, fields } };
            selected = r.selected;
            continue;
          }
          if (d.action === 'preview') {
            if (m) await preview(ctx, m, previewed);
            // The same request: the dialog keeps the changes it holds.
            shown = dialog;
            continue;
          }
          if (m) await apply(ctx, m);
          if (d.action === 'ok') return;
          if (d.action === 'select') {
            block = (yield* pickBlock(ctx)) ?? block;
            selected = undefined;
          } else if (m?.next !== undefined && m.next !== block) {
            block = m.next;
            selected = undefined;
          } else selected = m?.selected;
          blocks = attributedBlocks(ctx);
          if (blocks.length === 0) return;
          if (!blocks.some((r) => r.handle === block)) block = blocks[0]!.handle;
        }
      } finally {
        // Esc, Cancel or another command: the drawing as the last Apply left it.
        takeBack();
      }
    },
  };
}
