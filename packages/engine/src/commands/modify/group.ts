// Groups (M3-08): GROUP, -GROUP, UNGROUP, GROUPEDIT and CLASSICGROUP, with AutoCAD 2024's
// prompts (AutoCAD Help, "GROUP (Command)", "-GROUP (Command)", "UNGROUP (Command)",
// "GROUPEDIT (Command)", "Object Grouping Dialog Box"):
//
//   GROUP      Select objects or [Name/Description]:
//                (objects selected first are grouped at once, unnamed)
//   -GROUP     Enter a group option [?/Order/Add/Remove/Explode/REName/Selectable/Create] <Create>:
//   UNGROUP    Select group or [Name]:
//   GROUPEDIT  Select group or [Name]:  then  Enter an option [Add objects/Remove objects/REName]:
//   CLASSICGROUP  the Object Grouping dialog
//
// A group is named by picking one of its members (taken alone, whatever PICKSTYLE says); an
// object in more than one group offers them in turn ("Object is a member of more than one
// group": Accept, Next). The edits are `edit/groups.ts`'s.
//
// Ambiguities, settled for the common drafter expectation: Help does not word GROUP's
// confirmations or the refusal of a name in use, so they read "Group "DOORS" has been created.",
// "Unnamed group has been created." and "A group with this name already exists."; a name is
// asked for again after a refusal.
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { EntityId } from '../../model/entity-ids';
import type { Group } from '../../model/types';
import type { GroupRow, Prompt, PromptAnswer } from '../prompt';
import { wcmatch } from './attributes';
import {
  addToGroup,
  changeGroup,
  createGroup,
  explodeGroup,
  findGroup,
  groupNameProblem,
  groupsOf,
  isUnnamedGroup,
  removeFromGroup,
  reorderGroup,
} from '../../edit/groups';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const NO_DICTIONARY = 'This drawing cannot hold groups.';
const NAME_IN_USE = 'A group with this name already exists.';
const NOT_GROUPED = 'Object is not a member of any group.';

const quoted = (g: Pick<Group, 'name'>) => `"${g.name}"`;
const notDefined = (name: string) => `Group "${name.toUpperCase()}" has not been defined.`;

/** The groups listing any of `ids`, the largest first (UNGROUP's "highest level"). */
function groupsHolding(ctx: CommandContext, ids: readonly EntityId[]): Group[] {
  const handles = new Set(ids.map((id) => ctx.model.ids.handleOf(id)));
  return groupsOf(ctx.model)
    .filter((g) => g.entities.some((h) => handles.has(h)))
    .sort((a, b) => b.entities.length - a.entities.length);
}

/** `?`: the groups whose names match the patterns typed, with their descriptions. */
async function* listGroups(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({
    message: 'Enter group name(s) to list',
    default: { kind: 'string', value: '*' },
  });
  if (a.kind !== 'string') return;
  const found = groupsOf(ctx.model).filter((g) => wcmatch(g.name, a.value || '*'));
  if (found.length === 0) return ctx.message('No matching groups found.');
  ctx.message('Defined groups.');
  for (const g of found) {
    ctx.message(`  ${g.name}${g.description ? `  ${g.description}` : ''}`);
  }
}

/** "Enter a group name or [?]": an existing group by name; undefined at Enter or Esc. */
async function* namedGroup(ctx: CommandContext, message: string): Sub<Group | undefined> {
  for (;;) {
    const a = yield ctx.prompt.string({ message, options: ['?'] });
    if (a.kind === 'keyword') {
      yield* listGroups(ctx);
      continue;
    }
    if (a.kind !== 'string' || a.value.trim() === '') return undefined;
    const g = findGroup(ctx.model, a.value);
    if (g) return g;
    ctx.message(notDefined(a.value.trim()));
  }
}

/**
 * A name for a new group (or a renamed one, `except` its old name): valid and not in use;
 * empty at Enter, undefined at Esc.
 */
async function* newName(
  ctx: CommandContext,
  message: string,
  o: { readonly except?: Group; readonly defaultLabel?: string } = {},
): Sub<string | undefined> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message,
      options: ['?'],
      ...(o.defaultLabel !== undefined && { defaultLabel: o.defaultLabel }),
    });
    if (a.kind === 'keyword') {
      yield* listGroups(ctx);
      continue;
    }
    if (a.kind === 'enter') return '';
    if (a.kind !== 'string') return undefined;
    const name = a.value.trim();
    if (name === '') return '';
    const problem = groupNameProblem(name);
    const other = findGroup(ctx.model, name);
    if (problem) ctx.message(problem);
    else if (other && other !== o.except) ctx.message(NAME_IN_USE);
    else return name.toUpperCase();
  }
}

/** One of `groups` in turn, Accept taking it and Next showing the next (UNGROUP, GROUPEDIT). */
async function* acceptNext(ctx: CommandContext, groups: readonly Group[]): Sub<Group | undefined> {
  if (groups.length === 1) return groups[0];
  ctx.message('Object is a member of more than one group.');
  for (let i = 0; ; i = (i + 1) % groups.length) {
    const g = groups[i]!;
    const a = yield ctx.prompt.keyword({
      message: `Group ${quoted(g)}`,
      options: ['Accept', 'Next'],
      default: { kind: 'keyword', keyword: 'Accept' },
    });
    if (a.kind !== 'keyword') return undefined;
    if (a.keyword === 'Accept') return g;
  }
}

/** "Select group or [Name]": a group by one of its members, or by name. */
async function* chooseGroup(ctx: CommandContext, pre: readonly EntityId[]): Sub<Group | undefined> {
  let ids = pre;
  for (;;) {
    if (ids.length === 0) {
      const a = yield ctx.prompt.selection({
        message: 'Select group or',
        options: ['Name'],
        single: true,
        ungrouped: true,
      });
      if (a.kind === 'keyword') return yield* namedGroup(ctx, 'Enter a group name or');
      if (a.kind !== 'selection' || a.ids.length === 0) return undefined;
      ids = a.ids;
    }
    const groups = groupsHolding(ctx, ids);
    ids = [];
    if (groups.length > 0) return yield* acceptNext(ctx, groups);
    ctx.message(NOT_GROUPED);
  }
}

/** Objects for a group's Add or Remove; Remove takes members alone. */
async function* objects(ctx: CommandContext, remove: boolean): Sub<readonly EntityId[]> {
  const a = yield ctx.prompt.selection(
    remove ? { message: 'Remove objects', ungrouped: true } : { message: 'Select objects' },
  );
  return a.kind === 'selection' ? a.ids : [];
}

/** What GROUP says; the commands make a group only in a drawing with ACAD_GROUP. */
function created(ctx: CommandContext, g: Group): void {
  ctx.message(
    isUnnamedGroup(g) ? 'Unnamed group has been created.' : `Group ${quoted(g)} has been created.`,
  );
}

/** GROUP: Select objects or [Name/Description]. */
async function* group(ctx: CommandContext): CommandGenerator {
  if (ctx.model.meta.groupDictionary === undefined) return ctx.message(NO_DICTIONARY);
  if (ctx.preselected.length > 0) {
    const ids = ctx.preselected;
    let made: Group | undefined;
    ctx.edit((b) => {
      made = createGroup(b, ctx.model, { ids });
    });
    return created(ctx, made!);
  }
  let name: string | undefined;
  let description = '';
  for (;;) {
    const a = yield ctx.prompt.selection({
      message: 'Select objects or',
      options: ['Name', 'Description'],
    });
    if (a.kind === 'keyword' && a.keyword === 'Name') {
      const n = yield* newName(ctx, 'Enter a group name or');
      if (n === undefined) return;
      if (n !== '') name = n;
      continue;
    }
    if (a.kind === 'keyword') {
      const d = yield ctx.prompt.string({ message: 'Enter group description', spaces: true });
      if (d.kind === 'string') description = d.value.trim();
      else if (d.kind !== 'enter') return;
      continue;
    }
    if (a.kind !== 'selection' || a.ids.length === 0) return;
    const ids = a.ids;
    let made: Group | undefined;
    ctx.edit((b) => {
      made = createGroup(b, ctx.model, {
        ...(name !== undefined && { name }),
        description,
        ids,
      });
    });
    return created(ctx, made!);
  }
}

/** -GROUP. */
async function* dashGroup(ctx: CommandContext): CommandGenerator {
  if (ctx.model.meta.groupDictionary === undefined) return ctx.message(NO_DICTIONARY);
  const a = yield ctx.prompt.keyword({
    message: 'Enter a group option',
    options: ['?', 'Order', 'Add', 'Remove', 'Explode', 'REName', 'Selectable', 'Create'],
    default: { kind: 'keyword', keyword: 'Create' },
  });
  if (a.kind !== 'keyword') return;
  switch (a.keyword) {
    case '?':
      return yield* listGroups(ctx);
    case 'Create': {
      const n = yield* newName(ctx, 'Enter a group name or');
      if (n === undefined) return;
      const d = yield ctx.prompt.string({ message: 'Enter a group description', spaces: true });
      if (d.kind !== 'string' && d.kind !== 'enter') return;
      const s = yield ctx.prompt.selection({ message: 'Select objects' });
      if (s.kind !== 'selection' || s.ids.length === 0) return;
      let made: Group | undefined;
      ctx.edit((b) => {
        made = createGroup(b, ctx.model, {
          ...(n !== '' && { name: n }),
          description: d.kind === 'string' ? d.value.trim() : '',
          ids: s.ids,
        });
      });
      return created(ctx, made!);
    }
    case 'REName': {
      const g = yield* namedGroup(ctx, 'Enter old group name or');
      if (!g) return;
      const n = yield* newName(ctx, 'Enter new group name or', { except: g });
      if (n) ctx.edit((b) => changeGroup(b, g, { name: n }));
      return;
    }
  }
  const g = yield* namedGroup(ctx, 'Enter a group name or');
  if (!g) return;
  switch (a.keyword) {
    case 'Explode':
      ctx.edit((b) => explodeGroup(b, ctx.model, g));
      return;
    case 'Add':
    case 'Remove': {
      const remove = a.keyword === 'Remove';
      ctx.message(`Select objects to ${remove ? 'remove from' : 'add to'} group...`);
      const ids = yield* objects(ctx, remove);
      if (ids.length === 0) return;
      ctx.edit((b) =>
        remove ? removeFromGroup(b, ctx.model, g, ids) : addToGroup(b, ctx.model, g, ids),
      );
      return;
    }
    case 'Selectable': {
      const on = g.selectable;
      const y = yield ctx.prompt.keyword({
        message: `This group is ${on ? 'selectable' : 'unselectable'}. Do you want to make it ${on ? 'unselectable' : 'selectable'}?`,
        options: ['Yes', 'No'],
        default: { kind: 'keyword', keyword: 'Yes' },
      });
      if (y.kind === 'keyword' && y.keyword === 'Yes') {
        ctx.edit((b) => changeGroup(b, g, { selectable: !on }));
      }
      return;
    }
    default:
      return yield* order(ctx, g);
  }
}

/** -GROUP Order: positions from 0, as AutoCAD numbers a group's objects. */
async function* order(ctx: CommandContext, g: Group): CommandGenerator {
  const top = g.entities.length - 1;
  if (top < 1) return ctx.message('There is nothing to reorder.');
  const range = `(0-${top})`;
  for (;;) {
    const a = yield ctx.prompt.integer({
      message: `Enter position number of the object to reorder ${range} or`,
      options: ['Reverse order'],
    });
    if (a.kind === 'keyword') {
      ctx.edit((b) => reorderGroup(b, g, 'reverse'));
      return;
    }
    if (a.kind !== 'number') return;
    const from = a.value;
    if (from < 0 || from > top) {
      ctx.message(`Value must be between 0 and ${top}.`);
      continue;
    }
    const t = yield ctx.prompt.integer({ message: `Replace at position <0-${top}>` });
    if (t.kind !== 'number') return;
    const n = yield ctx.prompt.integer({
      message: 'Number of objects to reorder',
      default: { kind: 'number', value: 1 },
    });
    if (n.kind !== 'number') return;
    const to = Math.min(Math.max(t.value, 0), top);
    const count = Math.min(Math.max(n.value, 1), g.entities.length - from);
    ctx.edit((b) => reorderGroup(b, g, { from, to, count }));
    return;
  }
}

export function groupCommand(): CommandDef {
  return {
    name: 'GROUP',
    dashVariant: true,
    usesSelection: 'before',
    async *run(ctx) {
      if (ctx.dash) return yield* dashGroup(ctx);
      return yield* group(ctx);
    },
  };
}

function exploded(ctx: CommandContext, g: Group): void {
  ctx.edit((b) => explodeGroup(b, ctx.model, g));
  ctx.message(`Group ${quoted(g)} has been exploded.`);
}

export function ungroupCommand(): CommandDef {
  return {
    name: 'UNGROUP',
    usesSelection: 'before',
    async *run(ctx) {
      // Objects selected first: every group they belong to goes.
      if (ctx.preselected.length > 0) {
        const groups = groupsHolding(ctx, ctx.preselected);
        if (groups.length === 0) return ctx.message(NOT_GROUPED);
        for (const g of groups) exploded(ctx, g);
        return;
      }
      for (;;) {
        const a = yield ctx.prompt.selection({
          message: 'Select group or',
          options: ['Name'],
          ungrouped: true,
        });
        if (a.kind === 'keyword') {
          const g = yield* namedGroup(ctx, 'Enter a group name or');
          if (g) exploded(ctx, g);
          return;
        }
        if (a.kind !== 'selection' || a.ids.length === 0) return;
        const groups = groupsHolding(ctx, a.ids);
        if (groups.length === 0) {
          ctx.message(NOT_GROUPED);
          continue;
        }
        // One object picked in nested groups: Accept or Next; several objects (a window, ALL):
        // every group they belong to.
        if (a.ids.length === 1) {
          const g = yield* acceptNext(ctx, groups);
          if (g) exploded(ctx, g);
        } else for (const g of groups) exploded(ctx, g);
        return;
      }
    },
  };
}

export function groupeditCommand(): CommandDef {
  return {
    name: 'GROUPEDIT',
    usesSelection: 'before',
    async *run(ctx) {
      const g = yield* chooseGroup(ctx, ctx.preselected.slice(0, 1));
      if (!g) return;
      const a = yield ctx.prompt.keyword({
        message: 'Enter an option',
        options: ['Add objects', 'Remove objects', 'REName'],
      });
      if (a.kind !== 'keyword') return;
      if (a.keyword === 'REName') {
        const n = yield* newName(ctx, 'Enter new name for group or', {
          except: g,
          defaultLabel: g.name,
        });
        if (n) ctx.edit((b) => changeGroup(b, g, { name: n }));
        return;
      }
      const remove = a.keyword === 'Remove objects';
      const ids = yield* objects(ctx, remove);
      if (ids.length === 0) return;
      ctx.edit((b) =>
        remove ? removeFromGroup(b, ctx.model, g, ids) : addToGroup(b, ctx.model, g, ids),
      );
    },
  };
}

/** The Object Grouping dialog's rows. */
export function groupRows(ctx: Pick<CommandContext, 'model'>): GroupRow[] {
  return groupsOf(ctx.model).map((g) => ({
    name: g.name,
    description: g.description,
    selectable: g.selectable,
    unnamed: isUnnamedGroup(g),
    members: g.entities.length,
  }));
}

export function classicGroupCommand(): CommandDef {
  return {
    name: 'CLASSICGROUP',
    async *run(ctx) {
      if (ctx.model.meta.groupDictionary === undefined) return ctx.message(NO_DICTIONARY);
      let includeUnnamed = false;
      let selected: string | undefined;
      let memberOf: readonly string[] | undefined;
      let note: string | undefined;
      for (;;) {
        const d: PromptAnswer = yield ctx.prompt.dialog({
          message: 'Object Grouping',
          dialog: {
            type: 'objectgrouping',
            groups: groupRows(ctx),
            includeUnnamed,
            ...(selected !== undefined && { selected }),
            ...(memberOf && { memberOf }),
            ...(note !== undefined && { note }),
          },
        });
        if (d.kind !== 'dialog') return;
        includeUnnamed = d.includeUnnamed ?? includeUnnamed;
        memberOf = note = undefined;
        const act = d.grouping;
        if (!act) return;
        if (act.op === 'find') {
          const s = yield ctx.prompt.selection({
            message: 'Pick a member of a group',
            single: true,
            ungrouped: true,
          });
          if (s.kind === 'selection' && s.ids.length > 0) {
            memberOf = groupsHolding(ctx, s.ids.slice(0, 1)).map((g) => g.name);
          }
          continue;
        }
        if (act.op === 'new') {
          const name = act.name.trim();
          const problem = act.unnamed
            ? undefined
            : name === ''
              ? 'A group needs a name, or check Unnamed.'
              : (groupNameProblem(name) ?? (findGroup(ctx.model, name) ? NAME_IN_USE : undefined));
          if (problem) {
            note = problem;
            continue;
          }
          const s = yield ctx.prompt.selection({ message: 'Select objects for grouping' });
          if (s.kind !== 'selection' || s.ids.length === 0) continue;
          let made: Group | undefined;
          ctx.edit((b) => {
            made = createGroup(b, ctx.model, {
              ...(!act.unnamed && { name }),
              description: act.description.trim(),
              selectable: act.selectable,
              ids: s.ids,
            });
          });
          selected = made?.name;
          if (made && isUnnamedGroup(made)) includeUnnamed = true;
          continue;
        }
        const g = findGroup(ctx.model, act.group);
        if (!g) {
          note = notDefined(act.group);
          continue;
        }
        selected = g.name;
        switch (act.op) {
          case 'add':
          case 'remove': {
            const ids = yield* objects(ctx, act.op === 'remove');
            if (ids.length > 0) {
              ctx.edit((b) =>
                act.op === 'remove'
                  ? removeFromGroup(b, ctx.model, g, ids)
                  : addToGroup(b, ctx.model, g, ids),
              );
            }
            continue;
          }
          case 'highlight': {
            // The members shown selected until Enter, as AutoCAD shows them until its OK.
            const shown = g.entities.flatMap((h) => {
              const id = ctx.model.ids.idOf(h);
              return id !== undefined && ctx.model.entity(id)?.owner === ctx.space ? [id] : [];
            });
            ctx.select(shown);
            yield ctx.prompt.keyword({ message: 'Press ENTER to continue' });
            ctx.select([]);
            continue;
          }
          case 'explode':
            ctx.edit((b) => explodeGroup(b, ctx.model, g));
            selected = undefined;
            continue;
          case 'rename': {
            const name = act.name.trim();
            const other = findGroup(ctx.model, name);
            note = groupNameProblem(name) ?? (other && other !== g ? NAME_IN_USE : undefined);
            // A name makes an unnamed group a named one.
            if (note === undefined) {
              ctx.edit((b) => changeGroup(b, g, { name }));
              selected = name.toUpperCase();
            }
            continue;
          }
          case 'description':
            ctx.edit((b) => changeGroup(b, g, { description: act.description.trim() }));
            continue;
          case 'selectable':
            ctx.edit((b) => changeGroup(b, g, { selectable: act.selectable }));
            continue;
          case 'reorder':
            ctx.edit((b) => reorderGroup(b, g, act));
            continue;
          case 'reverse':
            ctx.edit((b) => reorderGroup(b, g, 'reverse'));
            continue;
        }
      }
    },
  };
}

export const GROUP_COMMANDS = [groupCommand, ungroupCommand, groupeditCommand, classicGroupCommand];
