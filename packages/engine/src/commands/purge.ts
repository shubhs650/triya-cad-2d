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
// PURGE without the dash runs the same prompts until the Purge dialog arrives (M5-09 part 2).
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import {
  PURGE_RULES,
  emptyTextObjects,
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

/** -PURGE (and PURGE until its dialog): unused named objects and unnamed objects removed. */
export function purgeCommand(): CommandDef {
  return {
    name: 'PURGE',
    dashVariant: true,
    usesSelection: 'none',
    async *run(ctx) {
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
