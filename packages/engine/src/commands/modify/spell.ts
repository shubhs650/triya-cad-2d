// SPELL (M4-09 part 4): AutoCAD 2024's Check Spelling dialog (AutoCAD Help, "SPELL (Command)",
// "Check Spelling Dialog Box", "Check Spelling Settings Dialog Box", "Dictionaries Dialog
// Box"). It checks single-line and multiline text, multileader and table text, and, as its
// settings say, dimension text, block attributes and the text of loaded xrefs, in the entire
// drawing, the current space or layout, or the objects selected (`edit/spelling.ts` cuts the
// text as it shows into words).
//
//   Start             finds the first word in neither dictionary: zoomed to, its object
//                     highlighted, with the main dictionary's suggestions
//   Ignore            goes on to the next
//   Ignore All        passes every later instance of the word, and goes on
//   Add to Dictionary adds the word to the custom dictionary (the user's, which the app keeps:
//                     the dialog sends it with each button, SPELL sends back what it added)
//   Change            replaces the word with the one in the Suggestions box
//   Change All        replaces it, as a whole word with its case, in all the text checked
//   Undo              reverses the last of these, one at a time
//
// "Spelling check complete." when no word is left. The changes SPELL makes are one undo step.
//
// Where AutoCAD's documentation is silent (the most common drafter expectation is taken):
// text on layers off or frozen and invisible objects are not checked (they cannot be shown);
// text inside block definitions is not checked (only attributes, as the settings name); a word
// on a locked layer or in an xref is shown but never changed (FIND's rule); Add to Dictionary
// and the custom dictionary match words whatever their case.
import type { EntityId } from '../../model/entity-ids';
import type { Handle } from '../../model/handle';
import type { Entity } from '../../model/types';
import { XREF_FLAG } from '../../model/xref';
import {
  DEFAULT_FIND_OPTIONS,
  displayText,
  findInText,
  hiddenEntity,
  lockedEntity,
  lockedSlot,
  slotSyntax,
  slotText,
  textPiecesOf,
  type FindOptions,
  type FindTextType,
  type TextSlot,
} from '../../edit/find-text';
import {
  DEFAULT_SPELL_OPTIONS,
  misspelledWords,
  type SpellChecker,
  type SpellOptions,
  type SpellWord,
} from '../../edit/spelling';
import { typeLabel } from '../../properties/sheet';
import type { CommandContext, CommandDef } from '../command';
import type { PromptAnswer } from '../prompt';
import { replaceInSlots, writeEntities, type SlotMatches } from './find';

/** Where to Check. */
export type SpellWhere = 'drawing' | 'space' | 'selection';

/** The dialog's Where to Check and its Check Spelling Settings. */
export interface SpellSettings extends SpellOptions {
  readonly where: SpellWhere;
  /** Include: Dimension Text. */
  readonly dimensions: boolean;
  /** Include: Block Attributes. */
  readonly attributes: boolean;
  /** Include: External References. */
  readonly xrefs: boolean;
}

/** Entire drawing; dimension text and attributes checked, xrefs (not changed) not. */
export const DEFAULT_SPELL_SETTINGS: SpellSettings = {
  where: 'drawing',
  dimensions: true,
  attributes: true,
  xrefs: false,
  ...DEFAULT_SPELL_OPTIONS,
};

/** The word shown: Not in Dictionary, the Suggestions, and the text it is in. */
export interface SpellWordShown {
  readonly word: string;
  readonly suggestions: readonly string[];
  /** The text it is in, as a results list shows it, the word at [start, end). */
  readonly context: { readonly text: string; readonly start: number; readonly end: number };
  readonly location: string;
  readonly objectType: string;
  /** On a locked layer or in an xref: Change and Change All do nothing. */
  readonly readOnly?: true;
}

/** The Check Spelling dialog SPELL opens. */
export interface SpellRequest {
  readonly type: 'spell';
  readonly settings: SpellSettings;
  /** How many objects Selected objects checks. */
  readonly selected: number;
  /** The Main Dictionary. */
  readonly dictionary: string;
  /** The custom dictionary as SPELL has it, once the dialog has sent it. */
  readonly custom?: readonly string[];
  readonly word?: SpellWordShown;
  /** Whether Undo has something to undo. */
  readonly undo: boolean;
  readonly note?: string;
}

/** A Check Spelling button. Close is the dialog's `ok`. */
export type SpellAction =
  | { readonly op: 'start' }
  | { readonly op: 'select' }
  | { readonly op: 'ignore' }
  | { readonly op: 'ignoreAll' }
  | { readonly op: 'add' }
  | { readonly op: 'change'; readonly to: string }
  | { readonly op: 'changeAll'; readonly to: string }
  | { readonly op: 'undo' };

export const SPELL_COMPLETE = 'Spelling check complete.';
export const NO_DICTIONARY = 'No spelling dictionary is available.';
/** Dictionaries Dialog Box: "The maximum length is 63 characters." */
export const CUSTOM_WORD_MAX = 63;

/** One piece of text checked. */
interface Piece {
  readonly id: EntityId;
  readonly slot: TextSlot;
  readonly space: Handle;
  /** The object zoomed to and highlighted: the xref's reference for its text. */
  readonly target: EntityId;
  readonly location: string;
  readonly objectType: string;
  readonly xref?: true;
}

/** Where checking is: a piece, and a shown character in it. */
interface Place {
  readonly piece: number;
  readonly at: number;
}

interface Current {
  readonly piece: number;
  readonly word: SpellWord;
}

/** What Undo puts back. */
interface Step {
  readonly at: Place;
  readonly ignoredAll: readonly string[];
  readonly custom: readonly string[] | undefined;
  readonly before?: ReadonlyMap<EntityId, Entity>;
}

const DIMENSION_KINDS = new Set(['DIMENSION', 'ARC_DIMENSION', 'LARGE_RADIAL_DIMENSION']);

function spaceName(ctx: CommandContext, space: Handle): string {
  return ctx.model.layouts.find((l) => l.blockRecord === space)?.name ?? 'Model';
}

/** Every piece of text the settings check, in the order the dialog steps through them. */
function piecesOf(ctx: CommandContext, s: SpellSettings, selection: readonly EntityId[]): Piece[] {
  const { model } = ctx;
  const types: FindTextType[] = ['text', 'table', 'dimension'];
  if (s.attributes) types.push('attribute');
  const o: FindOptions = { ...DEFAULT_FIND_OPTIONS, ignoreHidden: true, types };
  // A drawing with no layouts listed (as some writers leave it) is its current space.
  const layouts = [...model.layouts].sort((a, b) => a.tabOrder - b.tabOrder);
  const spaces =
    s.where === 'drawing' && layouts.length > 0 ? layouts.map((l) => l.blockRecord) : [ctx.space];
  const only = s.where === 'selection' ? new Set(selection) : undefined;
  const out: Piece[] = [];
  const seen = new Set<Handle>();
  const visit = (e: Entity, space: Handle, target: EntityId, location: string, xref?: true) => {
    if (hiddenEntity(model, e)) return;
    for (const p of textPiecesOf(model, e, o)) {
      // A multileader's text is text; a dimension's is Dimension Text.
      if (p.slot.kind === 'dimension' && !s.dimensions) continue;
      const objectType = p.slot.kind === 'attribute' ? 'Attribute' : typeLabel(e.geom.kind);
      out.push({
        id: e.id,
        slot: p.slot,
        space,
        target,
        location,
        objectType,
        ...(xref && { xref }),
      });
    }
    if (!s.xrefs || e.geom.kind !== 'INSERT') return;
    const def = model.blocks.get(e.geom.block);
    if (!def || ((def.flags ?? 0) & XREF_FLAG) === 0 || seen.has(def.handle)) return;
    if (!model.hasBlock(def.handle)) return;
    seen.add(def.handle);
    const inner = xref ? location : `${location} (xref ${def.name})`;
    for (const id of [...model.blockEntities(def.handle)]) {
      visit(model.entity(id)!, space, target, inner, true);
    }
  };
  for (const space of spaces.filter((h) => model.hasBlock(h))) {
    const location = spaceName(ctx, space);
    for (const id of [...model.blockEntities(space)]) {
      if (only && !only.has(id)) continue;
      visit(model.entity(id)!, space, id, location);
    }
  }
  return out;
}

/** The text a piece holds now, and how it is coded; undefined once it holds none. */
function textOf(ctx: CommandContext, p: Piece) {
  const e = ctx.model.entity(p.id);
  const raw = e && slotText(ctx.model, e, p.slot);
  return e && raw !== undefined ? { raw, syntax: slotSyntax(e, p.slot) } : undefined;
}

/** Why a piece's words cannot be changed; undefined when they can. */
function readOnly(ctx: CommandContext, p: Piece): string | undefined {
  if (p.xref) return 'The text is in an xref and cannot be changed.';
  const locked = (id: EntityId) => {
    const e = ctx.model.entity(id);
    return e !== undefined && lockedEntity(ctx.model, e);
  };
  if (locked(p.id) || locked(p.target)) return 'The object is on a locked layer.';
  const e = ctx.model.entity(p.id);
  // A table cell whose content is locked (M4-16 part 6).
  return e !== undefined && lockedSlot(e, p.slot) ? 'The table cell is locked.' : undefined;
}

export function spellCommand(): CommandDef {
  // The dialog opens with the settings it was left with, as AutoCAD's does.
  let settings: SpellSettings = DEFAULT_SPELL_SETTINGS;
  return {
    name: 'SPELL',
    usesSelection: 'before',
    keepsSelection: true,
    async *run(ctx) {
      let checker: SpellChecker | undefined;
      try {
        checker = await ctx.spelling?.();
      } catch {
        checker = undefined;
      }
      if (!checker) {
        ctx.message(NO_DICTIONARY);
        return;
      }
      const dictionary = checker;
      let selection = [...ctx.preselected];
      if (selection.length > 0) settings = { ...settings, where: 'selection' };
      else if (settings.where === 'selection') settings = { ...settings, where: 'drawing' };
      let custom: readonly string[] | undefined;
      let ignoredAll = new Set<string>();
      let pieces: Piece[] = [];
      let current: Current | undefined;
      let history: Step[] = [];
      let note: string | undefined;
      const accept = (word: string) => {
        if (ignoredAll.has(word)) return true;
        const lower = word.toLowerCase();
        if (custom?.some((c) => c.toLowerCase() === lower)) return true;
        return dictionary.correct(word);
      };
      /** The first word from `from` neither dictionary has. */
      const next = (from: Place): Current | undefined => {
        for (let i = from.piece; i < pieces.length; i++) {
          const t = textOf(ctx, pieces[i]!);
          if (!t) continue;
          for (const word of misspelledWords(t.raw, t.syntax, settings, accept)) {
            if (i > from.piece || word.start >= from.at) return { piece: i, word };
          }
        }
        return undefined;
      };
      /** Shows the next word from `from`, or says the check is complete. */
      const go = async (from: Place) => {
        current = next(from);
        if (!current) {
          note = SPELL_COMPLETE;
          ctx.message(SPELL_COMPLETE);
          ctx.select([]);
          return;
        }
        const p = pieces[current.piece]!;
        if (p.space !== ctx.space) await ctx.view.request({ op: 'tab', name: p.location });
        await ctx.view.request({ op: 'objects', ids: [p.target] });
        ctx.select(p.space === ctx.space ? [p.target] : []);
      };
      const shown = (c: Current): SpellWordShown => {
        const p = pieces[c.piece]!;
        // The word was found in the piece's text as it is now.
        const t = textOf(ctx, p)!;
        return {
          word: c.word.word,
          suggestions: dictionary.suggest(c.word.word),
          context: displayText(t.raw, t.syntax, c.word),
          location: p.location,
          objectType: p.objectType,
          ...(readOnly(ctx, p) !== undefined && { readOnly: true }),
        };
      };
      /** Remembers what Undo puts back, the objects `ids` as they are now among it. */
      const remember = (c: Current, ids: readonly EntityId[] = []) => {
        const before = new Map(ids.map((id) => [id, ctx.model.entity(id)!] as const));
        history.push({
          at: { piece: c.piece, at: c.word.start },
          ignoredAll: [...ignoredAll],
          custom,
          ...(before.size > 0 && { before }),
        });
      };
      try {
        for (;;) {
          const d = (yield ctx.prompt.dialog({
            message: 'Check Spelling',
            dialog: {
              type: 'spell',
              settings,
              selected: selection.length,
              dictionary: dictionary.name,
              ...(custom !== undefined && { custom }),
              ...(current && { word: shown(current) }),
              undo: history.length > 0,
              ...(note !== undefined && { note }),
            },
          })) as Extract<PromptAnswer, { kind: 'dialog' }>;
          settings = d.spell?.settings ?? settings;
          custom = d.spell?.custom ?? custom;
          note = undefined;
          const act = d.spell?.action;
          if (d.action === 'ok' || !act) return;
          if (act.op === 'select') {
            const s = yield ctx.prompt.selection({ message: 'Select objects', pickfirst: false });
            if (s.kind === 'selection' && s.ids.length > 0) {
              selection = [...s.ids];
              settings = { ...settings, where: 'selection' };
            }
            current = undefined;
            history = [];
            continue;
          }
          if (act.op === 'start') {
            if (settings.where === 'selection' && selection.length === 0) {
              settings = { ...settings, where: 'drawing' };
            }
            pieces = piecesOf(ctx, settings, selection);
            ignoredAll = new Set();
            history = [];
            await go({ piece: 0, at: 0 });
            continue;
          }
          if (act.op === 'undo') {
            const step = history.pop();
            if (!step) continue;
            if (step.before) {
              const tables = new Set(
                [...step.before].filter(([, e]) => e.geom.kind === 'ACAD_TABLE').map(([id]) => id),
              );
              const dims = [...step.before]
                .filter(([, e]) => DIMENSION_KINDS.has(e.geom.kind))
                .map(([id]) => id);
              await writeEntities(ctx, step.before, tables, dims);
            }
            ignoredAll = new Set(step.ignoredAll);
            custom = step.custom;
            await go(step.at);
            continue;
          }
          const c = current;
          if (!c) continue;
          const word = c.word.word;
          const after: Place = { piece: c.piece, at: c.word.end };
          switch (act.op) {
            case 'ignore':
              remember(c);
              await go(after);
              break;
            case 'ignoreAll':
              remember(c);
              ignoredAll.add(word);
              await go(after);
              break;
            case 'add':
              if (word.length > CUSTOM_WORD_MAX) {
                note = `A custom dictionary word can have up to ${CUSTOM_WORD_MAX} characters.`;
                break;
              }
              remember(c);
              custom = [...(custom ?? []), word];
              await go(after);
              break;
            case 'change': {
              const p = pieces[c.piece]!;
              const refused = readOnly(ctx, p);
              if (refused !== undefined) {
                note = refused;
                break;
              }
              remember(c, [p.id]);
              const match = { start: c.word.start, end: c.word.end };
              await replaceInSlots(ctx, [{ id: p.id, slot: p.slot, matches: [match] }], act.to);
              await go({ piece: c.piece, at: c.word.start + act.to.length });
              break;
            }
            case 'changeAll': {
              const refused = readOnly(ctx, pieces[c.piece]!);
              if (refused !== undefined) {
                note = refused;
                break;
              }
              // The word as a whole word with its case, in every piece that may change.
              const o = { ...DEFAULT_FIND_OPTIONS, matchCase: true, wholeWords: true };
              const groups: SlotMatches[] = [];
              let shift = 0;
              pieces.forEach((p, i) => {
                const t = textOf(ctx, p);
                if (!t || readOnly(ctx, p) !== undefined) return;
                const matches = findInText(t.raw, t.syntax, word, o);
                if (matches.length === 0) return;
                groups.push({ id: p.id, slot: p.slot, matches });
                if (i === c.piece) {
                  const before = matches.filter((m) => m.start < c.word.start).length;
                  shift = before * (act.to.length - word.length);
                }
              });
              remember(c, [...new Set(groups.map((g) => g.id))]);
              await replaceInSlots(ctx, groups, act.to);
              await go({ piece: c.piece, at: c.word.start + shift + act.to.length });
              break;
            }
          }
        }
      } finally {
        ctx.select([]);
      }
    },
  };
}

export const SPELL_COMMANDS: readonly (() => CommandDef)[] = [spellCommand];
