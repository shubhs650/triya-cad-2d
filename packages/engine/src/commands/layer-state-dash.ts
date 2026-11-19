// -LAYER's stAte option (M5-18 part 2): the Layer States Manager's actions at the command line
// (AutoCAD 2024 Help, "-LAYER (Command)", State: "Saves and restores the state and property
// settings of the layers in a drawing"). It asks "Enter an option [?/Save/Restore/Edit/Name/
// Delete]" until Enter, which goes back to -LAYER's options; each change is part of -LAYER's one
// LAYER undo step. The engine's layer state edits (edit/layer-states.ts, M5-07) do the work, so
// the dialog and the command line save, restore and check names alike.
//
//   - Save saves every layer's settings and the current layer under a new name; "Enter states to
//     change" then turns the layer properties to restore on and off (all on, as the manager's
//     New saves them), Enter accepting. A name the drawing has is overwritten after a Yes.
//   - Restore restores a state's layer properties, those its "properties to restore" name, and
//     its current layer, as the manager's Restore does without "Turn off layers not found".
//   - Edit changes which properties a state restores ("Changes the saved layer settings for a
//     specified layer state. When the layer state is restored, the specified settings are
//     used"), Name renames one and Delete deletes one.
//
// Ambiguities, settled for the common drafter expectation (Help gives the options but no prompts
// or messages): ? lists the drawing's layer states (Help's "named layer state (LAS) files in the
// support path for the drawing": a browser has no support path), each with its space and
// description; a name prompt takes ? to list them and ask again; a name that matches no state
// says `Cannot find layer state "X".`. Import and EXport, which need the app to read or write a
// `.las` file, and the hidden states of views' layer snapshots are not offered (M5-18 part 3,
// M5-07). MATerial is not a property to restore (no materials, issue #195), nor is VP Freeze in
// the current viewport, which waits for MSPACE (M6-02) and is kept as saved.
import type { CommandContext } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import { LAYER_STATE_MASK, type LayerState } from '../model/types';
import {
  deleteLayerStateChange,
  editLayerStateChange,
  layerStates,
  restoreLayerStateChange,
  saveLayerState,
} from '../edit/layer-states';
import { patchBack } from '../edit/edit';
import { wcmatch } from './modify/attributes';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const OPTIONS = ['?', 'Save', 'Restore', 'Edit', 'Name', 'Delete'];

/** "Enter states to change": each keyword, its mask bit and the name a list gives it. */
const PROPERTIES = [
  ['On', LAYER_STATE_MASK.on, 'On'],
  ['Frozen', LAYER_STATE_MASK.frozen, 'Frozen'],
  ['Lock', LAYER_STATE_MASK.locked, 'Lock'],
  ['Plot', LAYER_STATE_MASK.plot, 'Plot'],
  ['Newvpfreeze', LAYER_STATE_MASK.newVpFrozen, 'New VP Freeze'],
  ['Color', LAYER_STATE_MASK.color, 'Color'],
  ['lineType', LAYER_STATE_MASK.linetype, 'Linetype'],
  ['lineWeight', LAYER_STATE_MASK.lineweight, 'Lineweight'],
  ['TRansparency', LAYER_STATE_MASK.transparency, 'Transparency'],
  ['plotStyle', LAYER_STATE_MASK.plotStyle, 'Plot Style'],
] as const;

const quoted = (s: string) => `"${s}"`;
const typed = (a: PromptAnswer): string => (a.kind === 'string' ? a.value.trim() : '');

/**
 * A change the layer state edits built on their own (`*Change`), made again into the command's
 * edit: they update layers, layer states and $CLAYER and remove layer states only.
 */
function replay(b: ChangeSetBuilder, cs: ChangeSet): void {
  for (const u of cs.tables?.layers?.updated ?? [])
    b.updateTableRecord('layers', u.after.handle, patchBack(u.after, u.before));
  for (const h of cs.header ?? []) b.setHeader(h.name, h.after);
  for (const u of cs.objects?.updated ?? [])
    b.updateObject(u.after.handle, patchBack(u.after, u.before));
  for (const r of cs.objects?.removed ?? []) b.removeObject(r.handle);
}

/** The change, made in the command's edit, or why not (said). */
function commit(ctx: CommandContext, cs: ChangeSet | string): void {
  if (typeof cs === 'string') ctx.message(cs);
  else ctx.edit((b) => replay(b, cs));
}

/** The layer states the manager lists (views' snapshots hidden), by name. */
const states = (ctx: CommandContext) => layerStates(ctx.model);

function stateNamed(ctx: CommandContext, name: string): LayerState | undefined {
  const key = name.toUpperCase();
  return states(ctx).find((s) => s.name.toUpperCase() === key);
}

/** The states `pattern` matches, one per line: name, space and description. */
function listStates(ctx: CommandContext, pattern: string): void {
  const found = states(ctx).filter((s) => wcmatch(s.name, pattern));
  if (found.length === 0) {
    ctx.message('No matching layer states found.');
    return;
  }
  const width = Math.max(...found.map((s) => s.name.length)) + 4;
  for (const s of found) {
    const space = s.paperSpace ? 'Layout' : 'Model';
    ctx.message(`${quoted(s.name).padEnd(width)}${space.padEnd(8)}${s.description}`.trimEnd());
  }
}

async function* list(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({
    message: 'Enter layer state name(s) to list',
    default: { kind: 'string', value: '*' },
  });
  listStates(ctx, typed(a) || '*');
}

/** "Enter name of layer state to <verb> or [?]": the state named, ? listing them first. */
async function* stateAsked(ctx: CommandContext, verb: string): Sub<LayerState | undefined> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message: `Enter name of layer state to ${verb} or`,
      options: ['?'],
    });
    if (a.kind === 'keyword') {
      listStates(ctx, '*');
      continue;
    }
    const name = typed(a);
    if (name === '') return undefined;
    const s = stateNamed(ctx, name);
    if (!s) ctx.message(`Cannot find layer state ${quoted(name)}.`);
    return s;
  }
}

/** "Enter states to change": `mask` with the properties typed turned on or off, until Enter. */
async function* propertiesAsked(ctx: CommandContext, mask: number): Sub<number> {
  for (;;) {
    const on = PROPERTIES.filter(([, bit]) => (mask & bit) !== 0).map(([, , name]) => name);
    ctx.message(`Layer properties to restore: ${on.length > 0 ? on.join(', ') : 'none'}`);
    const a = yield ctx.prompt.keyword({
      message: 'Enter states to change',
      options: PROPERTIES.map(([k]) => k),
    });
    if (a.kind !== 'keyword') return mask;
    const bit = PROPERTIES.find(([k]) => k === a.keyword)![1];
    mask ^= bit;
  }
}

/** A Yes to "<question> <N>", Enter taking No. */
async function* yes(ctx: CommandContext, message: string): Sub<boolean> {
  const y = yield ctx.prompt.keyword({ message, hiddenOptions: ['Yes', 'No'], defaultLabel: 'N' });
  return y.kind === 'keyword' && y.keyword === 'Yes';
}

async function* save(ctx: CommandContext): Sub<void> {
  const name = typed(yield ctx.prompt.string({ message: 'Enter new layer state name' }));
  if (name === '') return;
  const old = stateNamed(ctx, name);
  if (old && !(yield* yes(ctx, `Layer state ${quoted(old.name)} already exists. Overwrite it?`)))
    return;
  const mask = yield* propertiesAsked(ctx, LAYER_STATE_MASK.all);
  let why: string | undefined;
  ctx.edit((b) => {
    why = saveLayerState(b, ctx.model, old?.name ?? name, { mask });
  });
  if (why) ctx.message(why);
}

async function* restore(ctx: CommandContext): Sub<void> {
  const s = yield* stateAsked(ctx, 'restore');
  if (s) commit(ctx, restoreLayerStateChange(ctx.model, s.handle));
}

async function* edit(ctx: CommandContext): Sub<void> {
  const s = yield* stateAsked(ctx, 'edit');
  if (!s) return;
  const mask = yield* propertiesAsked(ctx, s.mask);
  commit(ctx, editLayerStateChange(ctx.model, s.handle, { mask }));
}

async function* rename(ctx: CommandContext): Sub<void> {
  const s = yield* stateAsked(ctx, 'rename');
  if (!s) return;
  const name = typed(yield ctx.prompt.string({ message: 'Enter new layer state name' }));
  if (name !== '') commit(ctx, editLayerStateChange(ctx.model, s.handle, { name }));
}

async function* remove(ctx: CommandContext): Sub<void> {
  const s = yield* stateAsked(ctx, 'delete');
  if (s) commit(ctx, deleteLayerStateChange(ctx.model, s.handle));
}

function option(ctx: CommandContext, keyword: string): Sub<void> {
  switch (keyword) {
    case '?':
      return list(ctx);
    case 'Save':
      return save(ctx);
    case 'Restore':
      return restore(ctx);
    case 'Edit':
      return edit(ctx);
    case 'Name':
      return rename(ctx);
    default:
      return remove(ctx);
  }
}

/** -LAYER stAte: its options until Enter. */
export async function* layerStateOption(ctx: CommandContext): Sub<void> {
  for (;;) {
    const a = yield ctx.prompt.keyword({ message: 'Enter an option', options: OPTIONS });
    if (a.kind !== 'keyword') return;
    yield* option(ctx, a.keyword);
  }
}
