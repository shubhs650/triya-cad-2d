// FIND (M4-09 part 2): AutoCAD 2024's Find and Replace dialog (AutoCAD Help, "FIND (Command)",
// "Find and Replace Dialog Box"). It searches the text of the current space or layout, the
// entire drawing or the objects selected (the selection FIND opens on, or Select objects):
// attribute values, dimension and multileader text, text and multiline text, table cells and
// hyperlinks, as the Text Types say, read as they show (`edit/find-text.ts`).
//
//   Find / Find Next  steps through the matches: each is zoomed to and its object highlighted
//   Replace           replaces the match shown and goes on to the next
//   Replace All       replaces every match, as one undo step, and says how many
//   List results      lists Location, Object Type and Text; Zoom to highlighted result
//   Create selection set (all / highlighted) ends with those objects selected
//
// The dialog keeps its settings from one FIND to the next, as AutoCAD's does. Text on a locked
// layer is found but never replaced. A table's rows fit their replaced text and its block is
// drawn again; a dimension is drawn again with its new text.
//
// Where AutoCAD's documentation is silent: a match inside a block definition (Search blocks) is
// shown and zoomed to through the first reference to it that was searched; replacing it changes
// the definition, so every reference shows it. Anonymous blocks (dimensions', tables', dynamic
// block states) and xrefs are not searched.
import type { EntityId } from '../../model/entity-ids';
import type { Handle } from '../../model/handle';
import type { Entity } from '../../model/types';
import {
  DEFAULT_FIND_OPTIONS,
  displayText,
  findInText,
  hiddenEntity,
  lockedEntity,
  replaceInText,
  sameSlot,
  slotSyntax,
  slotText,
  textPiecesOf,
  withSlotText,
  type FindOptions,
  type FindTextType,
  type TextMatch,
  type TextSlot,
} from '../../edit/find-text';
import { fitTableRow, tableDrawingOf, writeTableBlock } from '../../edit/table';
import { tableCellText } from '../../annotation/table';
import { typeLabel } from '../../properties/sheet';
import type { CommandContext, CommandDef } from '../command';
import type { PromptAnswer } from '../prompt';
import { linesOf } from '../draw/table-cells';
import { regenerateDimensions } from './dimensions';

/** Find where. */
export type FindWhere = 'space' | 'drawing' | 'selection';

/** What the dialog holds: its fields and options. */
export interface FindSettings {
  readonly find: string;
  readonly replace: string;
  readonly where: FindWhere;
  readonly listResults: boolean;
  readonly options: FindOptions;
}

export const DEFAULT_FIND_SETTINGS: FindSettings = {
  find: '',
  replace: '',
  where: 'space',
  listResults: false,
  options: DEFAULT_FIND_OPTIONS,
};

/** One row of the results list. `start`/`end`: the match within `text`. */
export interface FindResultRow {
  readonly location: string;
  readonly objectType: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** The Find and Replace dialog FIND opens. */
export interface FindRequest {
  readonly type: 'find';
  readonly settings: FindSettings;
  /** How many objects Selected objects searches. */
  readonly selected: number;
  /** The matches found, listed when List results is checked. */
  readonly results?: readonly FindResultRow[];
  /** The match shown (zoomed to, its object highlighted). */
  readonly current?: number;
  /** What the last action had to say ("3 matches were replaced."). */
  readonly note?: string;
}

/** A Find and Replace button. Done is the dialog's `ok`. */
export type FindAction =
  | { readonly op: 'find' }
  | { readonly op: 'replace' }
  | { readonly op: 'replaceAll' }
  | { readonly op: 'select' }
  | { readonly op: 'zoom'; readonly index: number }
  /** Create selection set: of every match's object, or of those listed at `indexes`. */
  | { readonly op: 'selectionSet'; readonly indexes?: readonly number[] };

export const NOT_FOUND = 'Find and Replace could not find the string you are searching for.';
export const FINISHED = 'Find and Replace has finished searching for the text.';

/** A match. */
interface Hit {
  /** The object holding the text (inside a block, the block's object). */
  readonly id: EntityId;
  readonly slot: TextSlot;
  readonly type: FindTextType;
  readonly match: TextMatch;
  /** The space it shows in and the object Zoom to shows and highlights. */
  readonly space: Handle;
  readonly target: EntityId;
  readonly location: string;
  /** The block it is defined in, under Search blocks. */
  readonly block?: string;
}

const XREF = 4;

function spaceName(ctx: CommandContext, space: Handle): string {
  return ctx.model.layouts.find((l) => l.blockRecord === space)?.name ?? 'Model';
}

/** Every match of the settings' text, in the order the dialog steps through them. */
function search(ctx: CommandContext, s: FindSettings, selection: readonly EntityId[]): Hit[] {
  const { model } = ctx;
  const o = s.options;
  const spaces =
    s.where === 'drawing'
      ? [...model.layouts].sort((a, b) => a.tabOrder - b.tabOrder).map((l) => l.blockRecord)
      : [ctx.space];
  const only = s.where === 'selection' ? new Set(selection) : undefined;
  const hits: Hit[] = [];
  const seenBlocks = new Set<Handle>();
  const visit = (e: Entity, space: Handle, target: EntityId, location: string, block?: string) => {
    if (o.ignoreHidden && hiddenEntity(model, e)) return;
    for (const p of textPiecesOf(model, e, o)) {
      for (const match of findInText(p.raw, p.syntax, s.find, o)) {
        hits.push({
          id: e.id,
          slot: p.slot,
          type: p.type,
          match,
          space,
          target,
          location,
          ...(block !== undefined && { block }),
        });
      }
    }
    if (!o.searchBlocks || e.geom.kind !== 'INSERT') return;
    const def = model.blocks.get(e.geom.block);
    if (!def || def.name.startsWith('*') || ((def.flags ?? 0) & XREF) !== 0) return;
    if (seenBlocks.has(def.handle) || !model.hasBlock(def.handle)) return;
    seenBlocks.add(def.handle);
    for (const id of [...model.blockEntities(def.handle)]) {
      const inner = model.entity(id);
      if (inner) visit(inner, space, target, location, def.name);
    }
  };
  if (s.find === '') return hits;
  for (const space of spaces) {
    if (!model.hasBlock(space)) continue;
    const location = spaceName(ctx, space);
    for (const id of [...model.blockEntities(space)]) {
      if (only && !only.has(id)) continue;
      const e = model.entity(id);
      if (e) visit(e, space, id, location);
    }
  }
  return hits;
}

function row(ctx: CommandContext, h: Hit): FindResultRow {
  const e = ctx.model.entity(h.id)!;
  const raw = slotText(ctx.model, e, h.slot) ?? '';
  const shown = displayText(raw, slotSyntax(e, h.slot), h.match);
  const kind = h.slot.kind === 'attribute' ? 'Attribute' : typeLabel(e.geom.kind);
  return {
    location: h.block !== undefined ? `${h.location} (block ${h.block})` : h.location,
    objectType: kind,
    ...shown,
  };
}

/** Whether a match may be replaced: neither its object nor the one it shows through is locked. */
function lockedHit(ctx: CommandContext, h: Hit): boolean {
  const e = ctx.model.entity(h.id);
  const t = ctx.model.entity(h.target);
  return (
    (e !== undefined && lockedEntity(ctx.model, e)) ||
    (t !== undefined && lockedEntity(ctx.model, t))
  );
}

/**
 * Replaces `hits` (matches as found in the drawing as it is now) by `replacement`, as one edit;
 * returns how many were replaced. Tables are fitted and drawn again, dimensions regenerated.
 */
async function replaceHits(
  ctx: CommandContext,
  hits: readonly Hit[],
  replacement: string,
): Promise<number> {
  const groups: { id: EntityId; slot: TextSlot; matches: TextMatch[] }[] = [];
  for (const h of hits) {
    const g = groups.find((x) => x.id === h.id && sameSlot(x.slot, h.slot));
    if (g) g.matches.push(h.match);
    else groups.push({ id: h.id, slot: h.slot, matches: [h.match] });
  }
  const changes = new Map<EntityId, Entity>();
  const tables = new Set<EntityId>();
  const dimensions: EntityId[] = [];
  const drawing = tableDrawingOf(ctx.model);
  for (const g of groups) {
    const e = changes.get(g.id) ?? ctx.model.entity(g.id);
    if (!e) continue;
    const raw = slotText(ctx.model, e, g.slot);
    if (raw === undefined) continue;
    const next = replaceInText(raw, slotSyntax(e, g.slot), g.matches, replacement);
    let changed: Entity = { ...e, ...withSlotText(ctx.model, e, g.slot, next) };
    if (changed.geom.kind === 'ACAD_TABLE' && g.slot.kind === 'cell') {
      const { row: i, column: j } = g.slot;
      const t = changed.geom;
      const style = t.style !== undefined ? ctx.model.tables.tableStyles.get(t.style) : undefined;
      const lines = await linesOf(ctx, tableCellText(t, style, drawing, i, j));
      if (lines !== undefined) changed = { ...changed, geom: fitTableRow(t, style, i, j, lines) };
      tables.add(g.id);
    }
    if (g.slot.kind === 'dimension') dimensions.push(g.id);
    changes.set(g.id, changed);
  }
  if (changes.size === 0) return 0;
  ctx.edit((b) => {
    for (const [id, e] of changes) b.updateEntity(id, { geom: e.geom, xdata: e.xdata });
    for (const id of tables) writeTableBlock(b, ctx.model, id);
  });
  await regenerateDimensions(ctx, dimensions);
  return hits.length;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The key a search is stale by: what it searched for, where and how. */
const searchKey = (s: FindSettings, selection: readonly EntityId[]) =>
  JSON.stringify([s.find, s.where, s.options, s.where === 'selection' ? selection : []]);

export function findCommand(): CommandDef {
  // The dialog opens as it was left, as AutoCAD's does.
  let settings: FindSettings = DEFAULT_FIND_SETTINGS;
  return {
    name: 'FIND',
    usesSelection: 'before',
    keepsSelection: true,
    async *run(ctx) {
      let selection = [...ctx.preselected];
      if (selection.length > 0) settings = { ...settings, where: 'selection' };
      else if (settings.where === 'selection') settings = { ...settings, where: 'space' };
      let hits: Hit[] | undefined;
      let key = '';
      let current: number | undefined;
      let note: string | undefined;
      let keep = false;
      const searched = () => {
        hits = search(ctx, settings, selection);
        key = searchKey(settings, selection);
        return hits;
      };
      const show = async (h: Hit) => {
        if (h.space !== ctx.space) await ctx.view.request({ op: 'tab', name: h.location });
        await ctx.view.request({ op: 'objects', ids: [h.target] });
        ctx.select(h.space === ctx.space ? [h.target] : []);
      };
      /** The next match from `at`; says so at the end, or when there is none. */
      const step = async (at: number, none = NOT_FOUND) => {
        const all = hits ?? [];
        if (all.length === 0) {
          current = undefined;
          note = none;
          ctx.select([]);
        } else if (at >= all.length) {
          current = undefined;
          note = FINISHED;
          ctx.select([]);
        } else {
          current = at;
          await show(all[at]!);
        }
      };
      try {
        for (;;) {
          const d = (yield ctx.prompt.dialog({
            message: 'Find and Replace',
            dialog: {
              type: 'find',
              settings,
              selected: selection.length,
              ...(hits && settings.listResults && { results: hits.map((h) => row(ctx, h)) }),
              ...(current !== undefined && { current }),
              ...(note !== undefined && { note }),
            },
          })) as Extract<PromptAnswer, { kind: 'dialog' }>;
          settings = d.find?.settings ?? settings;
          note = undefined;
          const act = d.find?.action;
          if (d.action === 'ok' || !act) return;
          const stale = hits === undefined || key !== searchKey(settings, selection);
          if (settings.where === 'selection' && selection.length === 0 && act.op !== 'select') {
            note = 'Select objects to search first.';
            continue;
          }
          switch (act.op) {
            case 'select': {
              const s = yield ctx.prompt.selection({ message: 'Select objects', pickfirst: false });
              if (s.kind === 'selection' && s.ids.length > 0) {
                selection = [...s.ids];
                settings = { ...settings, where: 'selection' };
              }
              hits = undefined;
              current = undefined;
              continue;
            }
            case 'find':
              if (stale) {
                searched();
                await step(0);
              } else await step(current === undefined ? 0 : current + 1);
              continue;
            case 'zoom': {
              if (stale) searched();
              const h = hits![act.index];
              if (h) {
                current = act.index;
                await show(h);
              }
              continue;
            }
            case 'replace': {
              // Replace with no match shown finds the first, as AutoCAD's does.
              if (stale || current === undefined) {
                if (stale) searched();
                await step(0);
                continue;
              }
              const h = hits![current]!;
              if (lockedHit(ctx, h)) {
                await step(current + 1);
                note = 'The object is on a locked layer.';
                continue;
              }
              await replaceHits(ctx, [h], settings.replace);
              // On from the end of the replacement: its own text is not searched again. The
              // matches before this object's are as they were, so its own start where they did.
              const same = (x: Hit) => x.id === h.id && sameSlot(x.slot, h.slot);
              let at = hits!.findIndex(same);
              const after = h.match.start + settings.replace.length;
              const next = searched();
              while (at < next.length && same(next[at]!) && next[at]!.match.start < after) at++;
              // The last one replaced: the search has finished, not failed.
              await step(at, FINISHED);
              continue;
            }
            case 'replaceAll': {
              const all = searched();
              const free = all.filter((h) => !lockedHit(ctx, h));
              const n = await replaceHits(ctx, free, settings.replace);
              const locked = all.length - free.length;
              note =
                all.length === 0
                  ? NOT_FOUND
                  : `${plural(n, 'match was', 'matches were')} replaced.` +
                    (locked > 0
                      ? ` ${plural(locked, 'match on a locked layer was', 'matches on locked layers were')} not.`
                      : '');
              ctx.message(note);
              searched();
              current = undefined;
              ctx.select([]);
              continue;
            }
            case 'selectionSet': {
              if (stale) searched();
              const chosen = act.indexes
                ? act.indexes.flatMap((i) => (hits![i] ? [hits![i]!] : []))
                : hits!;
              const ids = [
                ...new Set(chosen.filter((h) => h.space === ctx.space).map((h) => h.target)),
              ];
              ctx.select(ids);
              ctx.message(`${ids.length} item(s) selected.`);
              keep = true;
              return;
            }
          }
        }
      } finally {
        if (!keep) ctx.select([]);
      }
    },
  };
}

export const FIND_COMMANDS: readonly (() => CommandDef)[] = [findCommand];
