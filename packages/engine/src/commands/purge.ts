// -PURGE (M5-09 part 1), with AutoCAD 2024's prompts (AutoCAD Help, "-PURGE (Command)"):
//
//   Enter type of unused objects to purge [Blocks/DEtailviewstyles/Dimstyles/Groups/LAyers/
//   LTypes/MAterials/MUltileaderstyles/Plotstyles/SHapes/textSTyles/Mlinestyles/
//   SEctionviewstyles/Tablestyles/Visualstyles/Regapps/Zero-length geometry/Empty text objects/
//   Orphaned data/All]:
//   Enter name(s) to purge <*>:
//   Verify each name to be purged? [Yes/No] <Yes>:
//   Purge layer "X"? [Yes/No] <No>:
//
// Each item goes with "Deleting layer "X"." and each category ends with "1 layer deleted." or
// "No unreferenced layers found.", the wording AutoCAD's command line uses. The help says -PURGE
// removes "one level of nested references at a time": what a purged block alone used goes on the
// next run (the dialog's Purge Nested Items takes them at once, `purgeClosure`). The zero-length
// and empty text counts are worded "N zero-length geometry objects deleted." (the help does not
// quote AutoCAD's message).
//
// What the categories hold and what never goes is `edit/purge.ts`. Detail and section view
// styles are model documentation's (PRD non-goal 1), shape files and orphaned DGN linestyle data
// stay as read (the save keeps them; post-launch work if drafters ask): those options say so.
//
// PURGE without the dash opens the Purge dialog (M5-09 part 2; AutoCAD Help, "Purge Dialog
// Box"), `PurgeRequest`:
//   - Purgeable Items: "Named Items Not Used", a tree of the categories with their counts and the
//     items to check; Preview; Options "Confirm each item to be purged" (the Confirm Purge dialog,
//     `PurgeConfirmRequest`: Purge this item, Purge all items, Skip this item) and "Purge nested
//     items"; Purge Unnamed Objects "Zero-length geometry", "Empty text objects" and "Orphaned
//     data"; Purge Checked Items and Purge All.
//   - Find Non-Purgeable Items: "Named Items In Use", with each item's Possible Reasons, its
//     Details ("the object's size, location, and the total number of those objects in your
//     drawing": the objects using it, the spaces they are in and the extents of those in the
//     current one) and Select Objects, which "closes the purge dialog box, selects the
//     non-purgeable objects, and zooms in to them" (those in the current space).
// The whole run is one undo step. The dialog's settings are kept for the next PURGE, as AutoCAD
// keeps them.
//
// Settled for the common drafter expectation (noted in the PR): the help says Purge Nested Items
// works "only when you select ... All Items or Blocks in the tree view" or Purge All; Triya applies
// it to every purge, so a checked block's layers go with it. Registered applications are left to
// -PURGE, as the help's note says. Orphaned data stays as read (the option is shown unavailable):
// the DGN linestyle data the reader keeps is M5-09's next part. Esc in Confirm Purge skips the
// item, as the dialog's close button does in a task dialog. Unnamed objects are not confirmed.
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { Handle } from '../model/handle';
import type { EntityId } from '../model/entity-ids';
import {
  PURGE_RULES,
  emptyTextObjects,
  objectsUsing,
  purgeClosure,
  purgeInto,
  purgeState,
  zeroLengthObjects,
  type PurgeCategory,
  type PurgeItem,
} from '../edit/purge';
import { eraseObjects } from '../edit/edit';
import { wcmatch } from './modify/attributes';

type Asking<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The type prompt's keywords, with the category each names. */
const TYPES: readonly (readonly [string, PurgeCategory | string])[] = [
  ['Blocks', 'blocks'],
  ['DEtailviewstyles', 'detail view styles'],
  ['Dimstyles', 'dimStyles'],
  ['Groups', 'groups'],
  ['LAyers', 'layers'],
  ['LTypes', 'linetypes'],
  ['MAterials', 'materials'],
  ['MUltileaderstyles', 'mleaderStyles'],
  ['Plotstyles', 'plotStyles'],
  ['SHapes', 'shapes'],
  ['textSTyles', 'textStyles'],
  ['Mlinestyles', 'mlineStyles'],
  ['SEctionviewstyles', 'section view styles'],
  ['Tablestyles', 'tableStyles'],
  ['Visualstyles', 'visualStyles'],
  ['Regapps', 'appIds'],
  ['Zero-length geometry', 'zero'],
  ['Empty text objects', 'empty'],
  ['Orphaned data', 'orphaned'],
  ['All', 'all'],
];

/** The named categories "All" goes through, in the prompt's order (Regapps too, as AutoCAD does). */
const ALL: readonly PurgeCategory[] = TYPES.map(([, c]) => c).filter(
  (c): c is PurgeCategory => c in PURGE_RULES,
);

const isCategory = (c: string): c is PurgeCategory => c in PURGE_RULES;

/** Asks Yes or No, `def` when Enter. */
async function* yesNo(ctx: CommandContext, message: string, def: boolean): Asking<boolean> {
  const a = yield ctx.prompt.keyword({
    message,
    options: ['Yes', 'No'],
    default: { kind: 'keyword', keyword: def ? 'Yes' : 'No' },
  });
  if (a.kind === 'keyword') return a.keyword === 'Yes';
  return def;
}

/**
 * Purges the unreferenced items of `categories` whose names match `pattern`, asking for each
 * when `verify`: one undo step for the run.
 */
async function* purgeNamed(
  ctx: CommandContext,
  categories: readonly PurgeCategory[],
  pattern: string,
  verify: boolean,
): Asking<void> {
  const purgeable = purgeState(ctx.model).purgeable;
  for (const category of categories) {
    const rules = PURGE_RULES[category];
    const chosen: PurgeItem[] = [];
    for (const item of purgeable) {
      if (item.category !== category || !wcmatch(item.name, pattern)) continue;
      if (verify && !(yield* yesNo(ctx, `Purge ${rules.one} "${item.name}"?`, false))) continue;
      chosen.push(item);
    }
    if (chosen.length === 0) {
      if (!purgeable.some((i) => i.category === category && wcmatch(i.name, pattern)))
        ctx.message(`No unreferenced ${rules.many} found.`);
      continue;
    }
    const items = purgeClosure(
      ctx.model,
      chosen.map((i) => i.handle),
      false,
    );
    ctx.edit((b) => purgeInto(b, ctx.model, items));
    for (const i of items) ctx.message(`Deleting ${rules.one} "${i.name}".`);
    ctx.message(`${items.length} ${items.length === 1 ? rules.one : rules.many} deleted.`);
  }
}

/** Zero-length geometry or empty text objects deleted. */
function purgeUnnamed(ctx: CommandContext, what: 'zero' | 'empty'): void {
  const ids = what === 'zero' ? zeroLengthObjects(ctx.model) : emptyTextObjects(ctx.model);
  const label = what === 'zero' ? 'zero-length geometry' : 'empty text';
  if (ids.length === 0) {
    ctx.message(
      what === 'zero' ? 'No zero-length geometry found.' : 'No empty text objects found.',
    );
    return;
  }
  ctx.edit((b) => eraseObjects(b, ctx.model, ids));
  ctx.message(`${ids.length} ${label} object${ids.length === 1 ? '' : 's'} deleted.`);
}

// ── The Purge dialog ───────────────────────────────────────────────────────────────────────

/** The Purge dialog's options, as it opens and as it answers. */
export interface PurgeSettings {
  /** Confirm each item to be purged. */
  readonly confirm: boolean;
  /** Purge nested items. */
  readonly nested: boolean;
  /** Purge Unnamed Objects. */
  readonly zeroLength: boolean;
  readonly emptyText: boolean;
  readonly orphaned: boolean;
}

/** One item of "Named Items In Use", with its Possible Reasons and how many objects use it. */
export interface PurgeInUseRow extends PurgeItem {
  readonly reasons: readonly string[];
}

/** Details of an item in use. */
export interface PurgeDetails {
  readonly handle: Handle;
  /** The objects in model space and the layouts using it. */
  readonly objects: number;
  /** Where they are: each space's name (Model, a layout's) with how many. */
  readonly spaces: readonly { readonly name: string; readonly objects: number }[];
  /** Those in the space shown, which Select Objects selects. */
  readonly here: number;
  /** Their extents, when the canvas measured them. */
  readonly extents?: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
}

export type PurgeView = 'purgeable' | 'inUse';

/** PURGE's Purge dialog. */
export interface PurgeRequest {
  readonly type: 'purge';
  readonly view: PurgeView;
  /** Named Items Not Used, by category then name. */
  readonly purgeable: readonly PurgeItem[];
  /** Named Items In Use. */
  readonly inUse: readonly PurgeInUseRow[];
  /** How many zero-length and empty text objects a purge would delete. */
  readonly zeroLength: number;
  readonly emptyText: number;
  readonly settings: PurgeSettings;
  /** The item in use whose Details were asked for. */
  readonly details?: PurgeDetails;
  /** What the last purge did ("3 items purged."). */
  readonly note?: string;
}

/** The Confirm Purge dialog: "Purge layer "OLD"?" */
export interface PurgeConfirmRequest {
  readonly type: 'purgeconfirm';
  /** What the item is ("layer"), and its name. */
  readonly one: string;
  readonly name: string;
}

/**
 * What the Purge dialog answers: its view and options, with `run` (Purge Checked Items, the
 * `checked` handles; or Purge All) or `details` (an item in use clicked; with action `select`,
 * Select Objects). Confirm Purge answers `confirm`.
 */
export interface PurgeAnswer {
  readonly view?: PurgeView;
  readonly settings?: PurgeSettings;
  readonly run?: 'checked' | 'all';
  readonly checked?: readonly Handle[];
  readonly details?: Handle;
  readonly confirm?: 'this' | 'all' | 'skip';
}

/** The categories the dialog lists: all but registered applications (-PURGE's alone). */
const DIALOG_CATEGORIES: ReadonlySet<PurgeCategory> = new Set(
  (Object.keys(PURGE_RULES) as PurgeCategory[]).filter((c) => c !== 'appIds'),
);

const DEFAULT_SETTINGS: PurgeSettings = {
  confirm: true,
  nested: false,
  zeroLength: false,
  emptyText: false,
  orphaned: false,
};

/** Confirm Purge for each item going: those accepted, with what only they use when nested. */
async function* confirmed(
  ctx: CommandContext,
  chosen: readonly Handle[],
  nested: boolean,
): Asking<PurgeItem[]> {
  const accepted = new Set<Handle>();
  const skipped = new Set<Handle>();
  let all = false;
  let round = purgeClosure(ctx.model, chosen, false);
  while (round.length > 0) {
    for (const item of round) {
      if (all) {
        accepted.add(item.handle);
        continue;
      }
      const a = yield ctx.prompt.dialog({
        message: 'Confirm Purge',
        escape: true,
        dialog: { type: 'purgeconfirm', one: PURGE_RULES[item.category].one, name: item.name },
      });
      const said = a.kind === 'dialog' ? (a.purge?.confirm ?? 'skip') : 'skip';
      if (said === 'skip') skipped.add(item.handle);
      else accepted.add(item.handle);
      if (said === 'all') all = true;
    }
    if (!nested || accepted.size === 0) break;
    // What only the accepted items use is asked for in turn; what a skipped one uses stays.
    round = purgeClosure(ctx.model, [...accepted], true, skipped).filter(
      (i) => !accepted.has(i.handle),
    );
  }
  return purgeClosure(ctx.model, [...accepted], nested, skipped);
}

/** Purges `chosen` (and the unnamed objects the options say) for the dialog: what it did. */
async function* purgeFromDialog(
  ctx: CommandContext,
  chosen: readonly Handle[],
  settings: PurgeSettings,
): Asking<string> {
  const items = settings.confirm
    ? yield* confirmed(ctx, chosen, settings.nested)
    : purgeClosure(ctx.model, chosen, settings.nested);
  const said: string[] = [];
  if (items.length > 0) {
    ctx.edit((b) => purgeInto(b, ctx.model, items));
    for (const i of items) ctx.message(`Deleting ${PURGE_RULES[i.category].one} "${i.name}".`);
    said.push(`${items.length} item${items.length === 1 ? '' : 's'} purged.`);
  }
  for (const [on, ids, label] of [
    [settings.zeroLength, zeroLengthObjects, 'zero-length geometry'],
    [settings.emptyText, emptyTextObjects, 'empty text'],
  ] as const) {
    if (!on) continue;
    const found = ids(ctx.model);
    if (found.length === 0) continue;
    ctx.edit((b) => eraseObjects(b, ctx.model, found));
    said.push(`${found.length} ${label} object${found.length === 1 ? '' : 's'} deleted.`);
  }
  const note = said.length > 0 ? said.join(' ') : 'Nothing was purged.';
  if (said.length > 0) ctx.message(note);
  return note;
}

/** The space each block record is (Model, a layout's name), for Details. */
function spaceNames(ctx: CommandContext): Map<Handle, string> {
  return new Map(ctx.model.layouts.map((l) => [l.blockRecord, l.name]));
}

/** Details of `item`, and the ids of its objects in the space shown. */
async function details(ctx: CommandContext, item: Handle): Promise<[PurgeDetails, EntityId[]]> {
  const names = spaceNames(ctx);
  const counts = new Map<string, number>();
  const here: EntityId[] = [];
  const objects = objectsUsing(ctx.model, item);
  for (const h of objects) {
    const e = ctx.model.entityByHandle(h)!;
    const name = names.get(e.owner) ?? 'Model';
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (e.owner === ctx.space) here.push(e.id);
  }
  const bounds = here.length > 0 ? await ctx.view.request({ op: 'bounds', ids: here }) : undefined;
  const box = bounds?.ok ? bounds.box : undefined;
  return [
    {
      handle: item,
      objects: objects.length,
      spaces: [...counts].map(([name, n]) => ({ name, objects: n })),
      here: here.length,
      ...(box && {
        extents: { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY },
      }),
    },
    here,
  ];
}

/** PURGE: the Purge dialog, until Close (or Select Objects). */
async function* purgeDialog(
  ctx: CommandContext,
  memory: { settings: PurgeSettings },
): Asking<void> {
  let view: PurgeView = 'purgeable';
  let note: string | undefined;
  let shown: PurgeDetails | undefined;
  for (;;) {
    const state = purgeState(ctx.model);
    const listed = <T extends PurgeItem>(items: readonly T[]) =>
      items.filter((i) => DIALOG_CATEGORIES.has(i.category));
    const a: PromptAnswer = yield ctx.prompt.dialog({
      message: 'Purge',
      escape: true,
      dialog: {
        type: 'purge',
        view,
        purgeable: listed(state.purgeable),
        inUse: listed(state.inUse),
        zeroLength: zeroLengthObjects(ctx.model).length,
        emptyText: emptyTextObjects(ctx.model).length,
        settings: memory.settings,
        ...(shown && { details: shown }),
        ...(note !== undefined && { note }),
      },
    });
    note = undefined;
    shown = undefined;
    if (a.kind !== 'dialog') return;
    const answer: PurgeAnswer = a.purge ?? {};
    if (answer.settings) memory.settings = { ...answer.settings, orphaned: false };
    if (answer.view) view = answer.view;
    if (a.action === 'ok') return;
    if (a.action === 'select' && answer.details !== undefined) {
      const [, ids] = await details(ctx, answer.details);
      ctx.select(ids);
      if (ids.length > 0) await ctx.view.request({ op: 'objects', ids });
      ctx.message(`${ids.length} found.`);
      return;
    }
    if (answer.details !== undefined) {
      [shown] = await details(ctx, answer.details);
      continue;
    }
    if (answer.run === undefined) continue;
    const purgeable = new Set(listed(state.purgeable).map((i) => i.handle));
    const chosen =
      answer.run === 'all'
        ? [...purgeable]
        : (answer.checked ?? []).filter((h) => purgeable.has(h));
    note = yield* purgeFromDialog(ctx, chosen, memory.settings);
  }
}

/** PURGE (the Purge dialog) and -PURGE: unused named objects and unnamed objects removed. */
export function purgeCommand(): CommandDef {
  const memory = { settings: DEFAULT_SETTINGS };
  return {
    name: 'PURGE',
    dashVariant: true,
    // Select Objects leaves the objects using an item selected at `Command:` as it ends (it does
    // not keep the selection it started with: PURGE's start deselects, and Enter repeats it).
    usesSelection: 'none',
    async *run(ctx) {
      if (!ctx.dash) {
        yield* purgeDialog(ctx, memory);
        return;
      }
      const a = yield ctx.prompt.keyword({
        message: 'Enter type of unused objects to purge',
        options: TYPES.map(([k]) => k),
      });
      if (a.kind !== 'keyword') return;
      const type = TYPES.find(([k]) => k === a.keyword)![1];
      if (type === 'zero' || type === 'empty') {
        purgeUnnamed(ctx, type);
        return;
      }
      if (type === 'shapes' || type === 'orphaned') {
        ctx.message(
          type === 'shapes'
            ? 'Shape files are kept as read: Triya does not purge them.'
            : 'Orphaned data is kept as read: Triya does not purge it.',
        );
        return;
      }
      if (!isCategory(type) && type !== 'all') {
        ctx.message(`No unreferenced ${type} found.`);
        return;
      }
      const n = yield ctx.prompt.string({
        message: 'Enter name(s) to purge',
        default: { kind: 'string', value: '*' },
      });
      if (n.kind !== 'string') return;
      const pattern = n.value.trim() === '' ? '*' : n.value.trim();
      const verify = yield* yesNo(ctx, 'Verify each name to be purged?', true);
      yield* purgeNamed(ctx, type === 'all' ? ALL : [type], pattern, verify);
    },
  };
}
