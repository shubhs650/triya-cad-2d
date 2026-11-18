// In-place reference editing (M5-02 part 3): REFEDIT, -REFEDIT, REFSET and REFCLOSE for block
// references, as AutoCAD 2024 has them (AutoCAD Help, "REFEDIT (Command)", "-REFEDIT",
// "Reference Edit Dialog Box", "REFSET (Command)", "REFCLOSE (Command)", "REFEDITNAME (System
// Variable)"):
//
// - REFEDIT: "Select reference:", then the Reference Edit dialog. Its Identify Reference tab lists
//   the reference picked and the references nested in it under the pick (the one to edit is
//   chosen there), with "Automatically select all nested objects" or "Prompt to select nested
//   objects" ("Select nested objects:"); its Settings tab "Display attribute definitions for
//   editing" and "Lock objects not in working set" ("Create unique layer, style, and block names"
//   is for xrefs). -REFEDIT asks the same at the command line: "Select nesting level [Ok/Next]",
//   "Enter object selection method [All/Nested] <All>", "Display attribute definitions
//   [Yes/No] <No>".
// - The working set is edited in place (edit/refedit.ts); objects drawn meanwhile join it.
//   REFSET Add and Remove move objects between it and the drawing; REFCLOSE Save carries it back
//   into the block, so every reference shows the edits, and Discard takes every change back.
//
// - An attached or overlaid xref, once loaded, is edited the same way (M5-02 part 6): REFCLOSE
//   Save also writes the edits to the xref's own file (edit/xref-save.ts), which the app reads
//   (`xrefDrawing`) and writes (`writeXref`); the host keeps them as the xref's loaded content.
//
// - A block a loaded xref brought in (`xref|name`, a reference nested in the xref's) is edited the
//   same way (M5-02 part 7): REFCLOSE Save writes the edits to that block in the xref's file.
//
// - A reference scaled differently in X and Y is edited the same way (M5-02 part 8): its objects
//   carried by the scale, a circle or an arc as an ellipse standing in for it (edit/refedit.ts).
//
// Decisions (noted in the PRs): REFSET
// Remove keeps an xref's own objects, and those of a block it brought in, in the working set (outside it they would be the host's on the
// xref's layers, which the host does not save); the names stay `xref|name` while an xref is
// edited, whatever "Create unique layer, style, and block names" says (that renaming is
// AutoCAD's way of showing the xref's names in the host, which Triya's loads already do); the
// reference's own attributes stay shown, where AutoCAD hides them while
// the definitions are shown; Discard takes back what was done to the drawing outside the working
// set too (only possible with Lock objects not in working set off), as the Block Editor's does.
import type { CommandContext, CommandDef, RefEditSession } from './command';
import type { Prompt, PromptAnswer, SelectionTake } from './prompt';
import type { DocumentInit, DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { InsertGeometry } from '../model/types';
import { isXrefRecord, xrefBringing } from '../model/xref';
import { blockReaches } from '../edit/blocks';
import { contentHandles, xrefWrite } from '../edit/xref-save';
import {
  extractWorkingSet,
  pathPlacement,
  returnWorkingSet,
  wholeWorkingSet,
  type Placement,
} from '../edit/refedit';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;
// What each prompt answers (Esc ends the command instead, so no other kind arrives).
type SelectionAnswer = Extract<PromptAnswer, { kind: 'selection' }>;
type KeywordAnswer = Extract<PromptAnswer, { kind: 'keyword' }>;
type DialogAnswer = Extract<PromptAnswer, { kind: 'dialog' }>;

/** One reference of the Reference Edit dialog's Reference name tree. */
export interface RefEditEntry {
  readonly name: string;
  /** Its BLOCK_RECORD, for the preview. */
  readonly block: Handle;
}

/** The Reference Edit dialog's settings (REFEDIT keeps them for the next time, as AutoCAD does). */
export interface RefEditSettings {
  /** Prompt to select nested objects; false: Automatically select all nested objects. */
  readonly prompt: boolean;
  /** Create unique layer, style, and block names (xrefs only). */
  readonly unique: boolean;
  /** Display attribute definitions for editing. */
  readonly attributes: boolean;
  /** Lock objects not in working set. */
  readonly lock: boolean;
}

/** REFEDIT's Reference Edit dialog: OK answers `refedit` with the reference chosen. */
export interface RefEditRequest {
  readonly type: 'refedit';
  /** The reference picked, then each nested one under the pick, outermost first. */
  readonly references: readonly RefEditEntry[];
  /** The one the tree opens on. */
  readonly chosen: number;
  readonly settings: RefEditSettings;
  /** Why the last OK opened nothing. */
  readonly note?: string;
}

export interface RefEditAnswer {
  /** The reference chosen, an index into `references`. */
  readonly chosen: number;
  readonly settings: RefEditSettings;
}

const DEFAULTS: RefEditSettings = { prompt: false, unique: true, attributes: false, lock: true };
const remembered = new WeakMap<DocumentModel, RefEditSettings>();

const insertOf = (ctx: CommandContext, id: EntityId): InsertGeometry | undefined => {
  const g = ctx.model.entity(id)?.geom;
  return g?.kind === 'INSERT' ? g : undefined;
};

const blockName = (ctx: CommandContext, block: Handle): string =>
  ctx.model.tables.blockRecords.get(block)!.name;

/** Why a reference edit cannot start now, or undefined. */
function startRefusal(ctx: CommandContext, name: string): string | undefined {
  if (ctx.refEdit.session)
    return `** ${name} is not allowed while a reference is edited in place **`;
  if (ctx.blockEditor.block !== undefined)
    return `** ${name} is not allowed in the Block Editor **`;
  return undefined;
}

/**
 * "Select reference:": the reference picked and the references nested in it under the pick,
 * outermost first, as the canvas finds what the pick hit inside it (the `nested` request).
 */
async function* selectReference(ctx: CommandContext): Sub<EntityId[] | undefined> {
  for (;;) {
    const a = (yield ctx.prompt.selection({
      message: 'Select reference',
      single: true,
      pickfirst: true,
    })) as SelectionAnswer;
    if (a.ids.length === 0) return undefined;
    const id = a.ids[0]!;
    if (!insertOf(ctx, id)) {
      ctx.message('Selected object is not a reference.');
      continue;
    }
    const pick = a.pick;
    const path: EntityId[] = [id];
    if (pick) {
      const r = await ctx.view.request({ op: 'nested', point: pick, id });
      const hit = r.ok && r.nested?.path[0] === id ? r.nested.path : [];
      for (const inner of hit.slice(1)) if (insertOf(ctx, inner)) path.push(inner);
    }
    return path;
  }
}

/** The objects of the edited block that "Select nested objects:" picks take. */
async function* nestedObjects(ctx: CommandContext, path: readonly EntityId[]): Sub<EntityId[]> {
  const a = (yield ctx.prompt.selection({
    message: 'Select nested objects',
    pickfirst: false,
  })) as SelectionAnswer;
  const takes: readonly SelectionTake[] = a.takes ?? [];
  const out = new Set<EntityId>();
  const top = path[0]!;
  for (const take of takes) {
    if (!take.pick || !take.ids.includes(top)) continue;
    const r = await ctx.view.request({ op: 'nested', point: take.pick, id: top });
    const hit = r.ok ? (r.nested?.path ?? []) : [];
    // The pick must go through the references chosen; what it hit next is the block's own.
    if (!path.every((p, i) => hit[i] === p)) continue;
    const own = hit[path.length];
    if (own !== undefined) out.add(own);
  }
  return [...out];
}

/** Why a reference cannot be edited, as the command line says it. */
const refusal = (why: string): string => `** ${why[0]!.toUpperCase()}${why.slice(1)} **`;

/** Starts the edit of the innermost of `path`, which `pathPlacement` places. */
function start(
  ctx: CommandContext,
  path: readonly EntityId[],
  t: Placement,
  settings: RefEditSettings,
  chosen?: readonly EntityId[],
): void {
  const block = insertOf(ctx, path.at(-1)!)!.block;
  const all = wholeWorkingSet(ctx.model, block, settings.attributes);
  const wanted = chosen ? new Set(chosen) : undefined;
  const ids = wanted ? ctx.model.blockEntities(block).filter((id) => wanted.has(id)) : all;
  const firstNew = ctx.model.handles.handSeed;
  const order = [...ctx.model.blockEntities(block)];
  let refused = 0;
  let standIns = 0;
  let originals: RefEditSession['originals'] = new Map();
  const extraction = ctx.edit((b) => {
    const ex = extractWorkingSet(b, ctx.model, ids, t, ctx.space);
    refused = ex.refused;
    standIns = ex.standIns;
    originals = ex.originals;
  });
  const session: RefEditSession = {
    name: blockName(ctx, block),
    block,
    space: ctx.space,
    t,
    path,
    lock: settings.lock,
    extraction,
    originals,
    order,
    firstNew,
  };
  ctx.refEdit.open(session);
  ctx.message('Use REFCLOSE or the Edit Reference bar to end reference editing session.');
  ctx.message(
    `${originals.size} ${originals.size === 1 ? 'object' : 'objects'} in the working set.`,
  );
  if (refused > 0) ctx.message(`${refused} could not be edited in place and stayed in the block.`);
  if (standIns > 0)
    ctx.message(
      `${standIns} ${standIns === 1 ? 'circle or arc is' : 'circles or arcs are'} edited as ${standIns === 1 ? 'an ellipse' : 'ellipses'} while the block is scaled differently in X and Y.`,
    );
}

async function* refeditDialog(ctx: CommandContext, path: EntityId[]): Sub<void> {
  let settings = remembered.get(ctx.model) ?? DEFAULTS;
  let chosen = 0;
  let note: string | undefined;
  for (;;) {
    const a = (yield ctx.prompt.dialog({
      message: 'Reference Edit',
      dialog: {
        type: 'refedit',
        references: path.map((id) => {
          const block = insertOf(ctx, id)!.block;
          return { name: blockName(ctx, block), block };
        }),
        chosen,
        settings,
        ...(note !== undefined && { note }),
      },
    })) as DialogAnswer;
    if (!a.refedit) return;
    chosen = Math.max(0, Math.min(path.length - 1, a.refedit.chosen));
    settings = a.refedit.settings;
    remembered.set(ctx.model, settings);
    const levels = path.slice(0, chosen + 1);
    const t = pathPlacement(ctx.model, levels);
    if (typeof t === 'string') {
      note = refusal(t);
      continue;
    }
    const objects = settings.prompt ? yield* nestedObjects(ctx, levels) : undefined;
    start(ctx, levels, t, settings, objects);
    return;
  }
}

async function* noOrYes(ctx: CommandContext, message: string): Sub<boolean> {
  const a = (yield ctx.prompt.keyword({
    message,
    options: ['Yes', 'No'],
    default: { kind: 'keyword', keyword: 'No' },
  })) as KeywordAnswer;
  return a.keyword === 'Yes';
}

async function* dashRefedit(ctx: CommandContext, path: EntityId[]): Sub<void> {
  let level = 0;
  if (path.length > 1) {
    for (;;) {
      const r = insertOf(ctx, path[level]!)!;
      ctx.message(`Nesting level: ${blockName(ctx, r.block)}`);
      const a = (yield ctx.prompt.keyword({
        message: 'Select nesting level',
        options: ['Ok', 'Next'],
        default: { kind: 'keyword', keyword: 'Next' },
      })) as KeywordAnswer;
      if (a.keyword === 'Ok') break;
      level = (level + 1) % path.length;
    }
  }
  const levels = path.slice(0, level + 1);
  const t = pathPlacement(ctx.model, levels);
  if (typeof t === 'string') {
    ctx.message(refusal(t));
    return;
  }
  const how = (yield ctx.prompt.keyword({
    message: 'Enter object selection method',
    options: ['All', 'Nested'],
    default: { kind: 'keyword', keyword: 'All' },
  })) as KeywordAnswer;
  const objects = how.keyword === 'Nested' ? yield* nestedObjects(ctx, levels) : undefined;
  const was = remembered.get(ctx.model) ?? DEFAULTS;
  const attributes = yield* noOrYes(ctx, 'Display attribute definitions');
  start(ctx, levels, t, { ...was, attributes }, objects);
}

export function refeditCommand(): CommandDef {
  return {
    name: 'REFEDIT',
    dashVariant: true,
    usesSelection: 'before',
    async *run(ctx) {
      const refusal = startRefusal(ctx, 'REFEDIT');
      if (refusal) {
        ctx.message(refusal);
        return;
      }
      const path = yield* selectReference(ctx);
      if (!path) return;
      yield* ctx.dash ? dashRefedit(ctx, path) : refeditDialog(ctx, path);
    },
  };
}

/** The message of a reference-edit command run with no reference open. */
const notOpen = (ctx: CommandContext, name: string): boolean => {
  if (ctx.refEdit.session) return false;
  ctx.message(`** ${name} is only allowed while a reference is edited in place **`);
  return true;
};

/** The objects of `ids` that hold a reference to the block edited (they cannot go into it). */
const reaching = (ctx: CommandContext, s: RefEditSession, ids: readonly EntityId[]) =>
  ids.filter((id) => {
    const g = insertOf(ctx, id);
    return g !== undefined && blockReaches(ctx.model, g.block, s.block);
  });

export function refsetCommand(): CommandDef {
  return {
    name: 'REFSET',
    usesSelection: 'before',
    async *run(ctx) {
      if (notOpen(ctx, 'REFSET')) return;
      const s = ctx.refEdit.session!;
      ctx.message('Transfer objects between the RefEdit working set and host drawing...');
      const a = (yield ctx.prompt.keyword({
        message: 'Enter an option',
        options: ['Add', 'Remove'],
        default: { kind: 'keyword', keyword: 'Add' },
      })) as KeywordAnswer;
      const add = a.keyword === 'Add';
      const sel = (yield ctx.prompt.selection({ message: 'Select objects' })) as SelectionAnswer;
      const working = ctx.refEdit.working;
      const inSpace = sel.ids.filter((id) => ctx.model.entity(id)?.owner === s.space);
      if (add) {
        const loops = new Set(reaching(ctx, s, inSpace));
        const ids = inSpace.filter((id) => !working.has(id) && !loops.has(id));
        if (loops.size > 0)
          ctx.message(
            `${loops.size} ${loops.size === 1 ? 'holds' : 'hold'} a reference to "${s.name}".`,
          );
        ctx.refEdit.add(ids);
        ctx.message(`${ids.length} Added to working set`);
      } else {
        let ids = inSpace.filter((id) => working.has(id));
        // An xref's own objects stay its (see the decisions above).
        const xref = xrefOf(ctx, s);
        if (xref !== undefined) {
          const own = ids.filter((id) => s.originals.has(id));
          if (own.length > 0) {
            ctx.message(
              `${own.length} ${own.length === 1 ? 'belongs' : 'belong'} to xref "${blockName(ctx, xref)}" and ${own.length === 1 ? 'stays' : 'stay'} in the working set.`,
            );
            ids = ids.filter((id) => !s.originals.has(id));
          }
        }
        ctx.refEdit.remove(ids);
        ctx.message(`${ids.length} Removed from working set`);
      }
    },
  };
}

/**
 * The xref whose file holds the block edited: the xref itself, or the one that brought the block
 * in (`xref|name`); undefined for a block of the drawing's own.
 */
function xrefOf(ctx: CommandContext, s: RefEditSession): Handle | undefined {
  if (isXrefRecord(ctx.model.tables.blockRecords.get(s.block))) return s.block;
  return xrefBringing(ctx.model, s.block)?.handle;
}

/**
 * What each xref's writes added to its file this session, `[host, file]` handles, kept outside
 * the undo history: U after REFCLOSE takes the block's own list back, but not the file.
 */
const written = new WeakMap<DocumentModel, Map<Handle, Map<Handle, Handle>>>();

/** The xref's file as the app reads it now, or undefined (said why) when it has none. */
async function xrefFile(ctx: CommandContext, xref: Handle): Promise<DocumentInit | undefined> {
  const path = ctx.model.blocks.get(xref)?.xrefPath ?? '';
  const r = await ctx.view.request({ op: 'xrefDrawing', block: xref });
  if (!r.ok) {
    ctx.message(`** ${r.message} **`);
    return undefined;
  }
  if (!r.xrefDrawing) {
    ctx.message(
      `** The file of xref "${blockName(ctx, xref)}" (${path}) is not at hand: drop it on the window, then REFCLOSE again **`,
    );
    return undefined;
  }
  return r.xrefDrawing.init;
}

/**
 * REFCLOSE Save of an xref (or of a block it brought in), once the working set is back in its
 * block: the edits written to the xref's file, the objects new to it made the xref's content
 * (`xrefLoaded`, so the host never saves them) and, once written, matched with their handles in
 * the file (`xrefHandles`).
 */
async function writeXref(
  ctx: CommandContext,
  s: RefEditSession,
  xref: Handle,
  drawing: DocumentInit,
): Promise<void> {
  const def = ctx.model.blocks.get(xref)!;
  const xrefName = blockName(ctx, xref);
  let byFile = written.get(ctx.model);
  if (!byFile) written.set(ctx.model, (byFile = new Map()));
  const before = byFile.get(xref) ?? new Map<Handle, Handle>();
  let w;
  try {
    w = xrefWrite(ctx.model, xref, drawing, before, s.block);
  } catch (e) {
    ctx.message(`** ${e instanceof Error ? e.message : String(e)} **`);
    return;
  }
  if (w.refused > 0)
    ctx.message(
      `${w.refused} ${w.refused === 1 ? 'object' : 'objects'} could not be written to the xref's file.`,
    );
  // The content the host shows is the xref's, whether or not the write below succeeds.
  const loaded = new Set(def.xrefLoaded ?? []);
  const fresh = ctx.model
    .blockEntities(s.block)
    .flatMap((id) => contentHandles(ctx.model.entity(id)!))
    .filter((h) => !loaded.has(h));
  const listed = (pairs: readonly (readonly [Handle, Handle])[]) => {
    if (fresh.length === 0 && pairs.length === 0) return;
    ctx.edit((b) =>
      b.updateBlock(xref, {
        xrefLoaded: [...(def.xrefLoaded ?? []), ...fresh],
        xrefHandles: [...(def.xrefHandles ?? []), ...pairs],
      }),
    );
  };
  if (w.changes.length === 0) {
    listed([]);
    ctx.message(`Xref "${xrefName}": no reference edits to save.`);
    return;
  }
  const file = def.xrefPath ?? '';
  const r = await ctx.view.request({ op: 'writeXref', block: xref, file, changes: w.changes });
  if (!r.ok) {
    listed([]);
    ctx.message(`** ${r.message} **`);
    return;
  }
  listed(w.added);
  byFile.set(xref, new Map([...before, ...w.added]));
  const name = r.written?.file ?? file;
  const what = xref === s.block ? 'reference edits' : `reference edits to "${s.name}"`;
  ctx.message(`Xref "${xrefName}" saved: ${what} written to ${name}.`);
  if (r.written?.downloaded)
    ctx.message(`${name} was downloaded: put it in place of the xref's file to keep the edits.`);
}

/** The working set in the order it goes back: the objects carried out first, as the block had them. */
function returning(ctx: CommandContext, s: RefEditSession): EntityId[] {
  const working = ctx.refEdit.working;
  const here = (id: EntityId) => working.has(id) && ctx.model.entity(id)?.owner === s.space;
  const out = [...s.originals.keys()].filter(here);
  const first = new Set(out);
  for (const id of ctx.model.blockEntities(s.space)) if (here(id) && !first.has(id)) out.push(id);
  return out;
}

export function refcloseCommand(): CommandDef {
  return {
    name: 'REFCLOSE',
    usesSelection: 'none',
    async *run(ctx) {
      if (notOpen(ctx, 'REFCLOSE')) return;
      const s = ctx.refEdit.session!;
      const a = (yield ctx.prompt.keyword({
        message: 'Enter option',
        options: ['Save', 'Discard reference changes'],
        default: { kind: 'keyword', keyword: 'Save' },
      })) as KeywordAnswer;
      if (a.keyword !== 'Save') {
        ctx.refEdit.close({ discard: true });
        ctx.message('Reference edits discarded.');
        return;
      }
      const ids = returning(ctx, s);
      const loops = reaching(ctx, s, ids);
      if (loops.length > 0) {
        ctx.message(
          `** The working set holds a reference to "${s.name}", which cannot reference itself **`,
        );
        return;
      }
      // An xref's edits go to its file, which must be at hand before anything changes.
      const xref = xrefOf(ctx, s);
      const drawing = xref !== undefined ? await xrefFile(ctx, xref) : undefined;
      if (xref !== undefined && !drawing) return;
      const touched = ctx.refEdit.touched();
      let left: EntityId[] = [];
      const saved = ctx.edit((b) => {
        left = returnWorkingSet(b, ctx.model, { ...s, touched }, ids);
      });
      ctx.refEdit.close({ saved });
      if (left.length > 0)
        ctx.message(
          `${left.length} ${left.length === 1 ? 'object' : 'objects'} could not be carried back into a block scaled differently in X and Y and ${left.length === 1 ? 'stays' : 'stay'} in the drawing.`,
        );
      if (xref !== undefined && drawing) await writeXref(ctx, s, xref, drawing);
      else ctx.message(`Block "${s.name}" redefined: reference edits saved.`);
    },
  };
}

/** The reference-edit commands, for `builtinCommands`. */
export const REFEDIT_COMMANDS: readonly (() => CommandDef)[] = [
  refeditCommand,
  refsetCommand,
  refcloseCommand,
];
