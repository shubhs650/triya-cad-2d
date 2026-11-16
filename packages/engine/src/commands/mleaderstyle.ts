// MLEADERSTYLE (MLS; M4-04 part 2): the Multileader Style Manager (AutoCAD 2024 Help,
// "MLEADERSTYLE (Command)", "Multileader Style Manager", "Create New Multileader Style Dialog
// Box", "Modify Multileader Style Dialog Box").
//
// The manager lists the drawing's multileader styles (all, or those in use) with the current one
// (CMLEADERSTYLE); Set Current, New..., Modify... and Delete, and the list's shortcut menu (Set
// current, Rename, Delete), act on the style selected. New... asks Create New Multileader Style
// (New style name, Start with) and opens the Modify Multileader Style tabs on the Start with
// style's settings; OK makes the style. Each action is made at once and the manager opens again
// on the style it left selected; Close ends the command, everything it did one undo step.
//
// Modify gives the style's multileaders its new values wherever they do not override them, as
// AutoCAD updates them: the Properties palette's style change (`multiLeaderStyleChange`), its
// text measured by the canvas first. An AutoCAD arrowhead or built-in content block
// (`_TagCircle`, …) the drawing lacks is added with the style that names it.
//
// A drawing with no multileader style (one from before R2007) lists AutoCAD's Standard, which the
// first Set Current or Modify adds, as MLEADER adds it. A drawing that keeps no CMLEADERSTYLE
// variable cannot record another current style: a new variable would be a new object, which the
// save does not write (FILE_FIDELITY.md, DICTIONARYVAR), so Set Current says so.
//
// AutoCAD has no -MLEADERSTYLE; SETVAR CMLEADERSTYLE makes a style current at the command line.
import type { CommandContext, CommandDef } from './command';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { Entity, MLeaderStyleRecord } from '../model/types';
import type { PromptAnswer } from './prompt';
import {
  MLEADERSTYLE_RECORD_KEYS,
  mleaderStyleFields,
  mleaderStyleProblem,
  mleaderStyleSettings,
  type MLeaderStyleLists,
  type MLeaderStyleOption,
  type MLeaderStyleSettings,
} from '../annotation/mleaderstyle-fields';
import { currentMLeaderStyle, standardLinetype, standardMLeaderStyle } from '../edit/mleader';
import {
  BUILTIN_MLEADER_BLOCKS,
  addBuiltinMLeaderBlock,
  builtinMLeaderBlock,
  builtinMLeaderBlockName,
} from '../edit/mleader-blocks';
import { addArrowheadBlock, arrowheadBlock, arrowheadBlockName } from '../edit/arrowhead-blocks';
import { arrowheadOptions } from '../properties/dimension';
import { isContentBlock } from '../properties/multileader-block';
import {
  STYLE_KEY,
  multiLeaderStyleChange,
  multiLeaderStylesToMeasure,
} from '../properties/multileader-style';
import type { MultiLeaderWidths } from '../properties/multileader';
import { validViewName } from '../edit/named-view';
import { currentTextStyle } from './draw/text';
import { freeStyleName } from './draw/mleader';

/** One style in the manager's list. */
export interface MLeaderStyleRow {
  readonly name: string;
  readonly settings: MLeaderStyleSettings;
  /** A multileader names it ("Styles in use"). */
  readonly used: boolean;
  readonly annotative: boolean;
  /** AutoCAD's Standard, listed for a drawing without styles until an action adds it. */
  readonly unsaved?: true;
}

/** The Multileader Style Manager as MLEADERSTYLE opens it. */
export interface MLeaderStyleRequest {
  readonly type: 'mleaderstyle';
  readonly styles: readonly MLeaderStyleRow[];
  /** CMLEADERSTYLE's style. */
  readonly current: string;
  readonly selected: string;
  readonly lists: MLeaderStyleLists;
  /** Why the last action did nothing. */
  readonly note?: string;
}

/** What a manager button, shortcut menu choice or the Modify dialog's OK asks of MLEADERSTYLE. */
export type MLeaderStyleAction =
  | { readonly op: 'current'; readonly name: string }
  /** New...'s name and Start with style, with the settings the Modify tabs gave. */
  | {
      readonly op: 'new';
      readonly name: string;
      readonly from?: string;
      readonly settings: MLeaderStyleSettings;
    }
  | { readonly op: 'modify'; readonly name: string; readonly settings: MLeaderStyleSettings }
  | { readonly op: 'rename'; readonly name: string; readonly to: string }
  | { readonly op: 'delete'; readonly name: string };

const upper = (s: string) => s.toUpperCase();
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/** AutoCAD's Standard as MLEADER adds it to a drawing without styles; undefined with a style. */
function unsavedStandard(model: DocumentModel): MLeaderStyleRecord | undefined {
  if (model.tables.mleaderStyles.size > 0) return undefined;
  const text = currentTextStyle(model);
  // A multileader style names a text style (an R1 or R2.5 drawing has none).
  if (!text) return undefined;
  return {
    handle: '' as Handle,
    ...standardMLeaderStyle(
      model.meta.measurement !== 'imperial',
      text.handle,
      standardLinetype(model),
    ),
    name: freeStyleName(model, 'Standard'),
  };
}

/** The styles the manager lists: the drawing's, else the unsaved Standard. */
function listedStyles(model: DocumentModel): MLeaderStyleRecord[] {
  const own = [...model.tables.mleaderStyles.values()];
  const standard = unsavedStandard(model);
  return (own.length > 0 ? own : standard ? [standard] : []).sort((a, b) => byName(a.name, b.name));
}

function styleNamed(model: DocumentModel, name: string): MLeaderStyleRecord | undefined {
  if (typeof name !== 'string') return undefined;
  return listedStyles(model).find((s) => upper(s.name) === upper(name));
}

/** The multileader styles a multileader (in any block) names. */
export function usedMLeaderStyles(model: DocumentModel): Set<Handle> {
  const out = new Set<Handle>();
  for (const e of model.entities())
    if (e.geom.kind === 'MULTILEADER' && e.geom.style !== undefined) out.add(e.geom.style);
  return out;
}

/** The style CMLEADERSTYLE makes current (the unsaved Standard in a drawing without styles). */
function currentStyle(model: DocumentModel): MLeaderStyleRecord | undefined {
  return currentMLeaderStyle(model) ?? unsavedStandard(model);
}

/** The records the Modify dialog's lists offer. */
export function mleaderStyleLists(
  model: DocumentModel,
  shown: readonly MLeaderStyleRecord[],
): MLeaderStyleLists {
  const linetypes: MLeaderStyleOption[] = [...model.tables.linetypes.values()]
    .map((l) => ({ value: l.handle as string, label: l.name }))
    .sort((a, b) => {
      // ByBlock and ByLayer first, as AutoCAD lists them.
      const rank = (o: MLeaderStyleOption) =>
        upper(o.label) === 'BYBLOCK' ? 0 : upper(o.label) === 'BYLAYER' ? 1 : 2;
      return rank(a) - rank(b) || byName(a.label, b.label);
    });
  const textStyles = [...model.tables.textStyles.values()]
    .filter((s) => ((s.flags ?? 0) & 1) === 0)
    .map((s) => ({ value: s.handle as string, label: s.name }))
    .sort((a, b) => byName(a.label, b.label));
  const arrowheads = arrowheadOptions(
    model,
    shown.map((s) => s.arrowhead),
  );
  const own = [...model.blocks.values()]
    .filter((b) => isContentBlock(b) && !arrowheadBlockName(b.name))
    .map((b) => ({ value: b.handle as string, label: b.name }))
    .sort((a, b) => byName(a.label, b.label));
  const builtins = BUILTIN_MLEADER_BLOCKS.filter(
    (n) => !own.some((o) => upper(o.label) === upper(n)),
  ).map((n) => ({ value: n as string, label: BUILTIN_LABELS[n] }));
  return { linetypes, textStyles, arrowheads, blocks: [...own, ...builtins] };
}

/** The Source block list's names for AutoCAD's built-in blocks. */
const BUILTIN_LABELS: Record<(typeof BUILTIN_MLEADER_BLOCKS)[number], string> = {
  _DetailCallout: 'Detail Callout',
  _TagCircle: 'Circle',
  _TagBox: 'Box',
  _TagSlot: 'Slot',
  _TagHexagon: 'Hexagon',
  _TagTriangle: 'Triangle',
};

/** The manager as it opens on `selected`. */
export function mleaderStyleRequest(
  model: DocumentModel,
  selected?: string,
  note?: string,
): MLeaderStyleRequest {
  const listed = listedStyles(model);
  const used = usedMLeaderStyles(model);
  const current = currentStyle(model);
  const shown = selected === undefined ? undefined : styleNamed(model, selected);
  return {
    type: 'mleaderstyle',
    styles: listed.map((s) => ({
      name: s.name,
      settings: mleaderStyleSettings(s),
      used: used.has(s.handle),
      annotative: s.annotative,
      ...(s.handle === '' && { unsaved: true as const }),
    })),
    current: current?.name ?? '',
    selected: shown?.name ?? current?.name ?? listed[0]?.name ?? '',
    lists: mleaderStyleLists(model, listed),
    ...(note !== undefined && { note }),
  };
}

const NAME_IN_USE = 'A multileader style with this name already exists.';
const NAME_INVALID = 'Invalid multileader style name.';

/** Why `name` cannot name a new or renamed style (`except`: the style being renamed). */
function nameProblem(model: DocumentModel, name: string, except?: Handle): string | undefined {
  if (!validViewName(name) || name.includes('|')) return NAME_INVALID;
  const other = styleNamed(model, name);
  if (other && other.handle !== except) return NAME_IN_USE;
  // An entry the drawing keeps and Triya does not map (an R13/R14 proxy STANDARD, M2-29).
  if ((model.meta.keptEntryNames?.mleaderStyles ?? []).some((n) => upper(n) === upper(name)))
    return NAME_IN_USE;
  return undefined;
}

/** Whether the bus brought settings the dialog can give (it takes any object). */
function wellFormed(s: unknown): s is MLeaderStyleSettings {
  return (
    typeof s === 'object' &&
    s !== null &&
    mleaderStyleProblem(s as MLeaderStyleSettings) === undefined
  );
}

/**
 * Why `s` names a record the drawing lacks (a linetype, text style or block that is neither the
 * drawing's nor one Triya adds); undefined when every one resolves.
 */
function refsProblem(model: DocumentModel, s: MLeaderStyleSettings): string | undefined {
  if (s.linetype !== '' && !model.tables.linetypes.has(s.linetype as Handle))
    return 'Linetype: not in the drawing.';
  if (s.textStyle !== '' && !model.tables.textStyles.has(s.textStyle as Handle))
    return 'Text style: not in the drawing.';
  if (
    s.arrowhead !== '' &&
    !model.blocks.has(s.arrowhead as Handle) &&
    !arrowheadBlockName(s.arrowhead)
  )
    return 'Symbol: not an arrowhead.';
  if (s.block !== '') {
    const b = model.blocks.get(s.block as Handle);
    if (b ? !isContentBlock(b) : !builtinMLeaderBlockName(s.block))
      return 'Source block: not a block the drawing has.';
  }
  return undefined;
}

/**
 * The handles `s` names, adding to the drawing what it lacks: AutoCAD's arrowhead blocks and
 * built-in content blocks (sized from the style's text height, in its text style).
 */
function resolveRefs(b: ChangeSetBuilder, model: DocumentModel, s: MLeaderStyleSettings) {
  const textStyle = s.textStyle !== '' ? (s.textStyle as Handle) : currentTextStyle(model)?.handle;
  let arrowhead: Handle | undefined;
  if (s.arrowhead !== '') {
    arrowhead = model.blocks.has(s.arrowhead as Handle)
      ? (s.arrowhead as Handle)
      : (arrowheadBlock(model.blocks, s.arrowhead)?.handle ??
        addArrowheadBlock(b, model, s.arrowhead));
  }
  let block: Handle | undefined;
  if (s.block !== '') {
    if (model.blocks.has(s.block as Handle)) block = s.block as Handle;
    else {
      const def =
        textStyle === undefined ? undefined : builtinMLeaderBlock(s.block, s.textHeight, textStyle);
      if (def) {
        const zero = [...model.tables.layers.values()].find((l) => l.name === '0');
        if (zero) block = addBuiltinMLeaderBlock(b, def, zero.handle).block;
      }
    }
  }
  return {
    linetype: s.linetype !== '' ? (s.linetype as Handle) : standardLinetype(model),
    textStyle,
    arrowhead,
    block,
  };
}

/** The record patch `s` makes of `style`: only the fields whose settings changed. */
function changedFields(
  b: ChangeSetBuilder,
  model: DocumentModel,
  style: MLeaderStyleRecord,
  s: MLeaderStyleSettings,
): Partial<MLeaderStyleRecord> | undefined {
  const was = mleaderStyleSettings(style);
  const changed = (keys: readonly string[]) =>
    keys.some((k) => was[k as keyof MLeaderStyleSettings] !== s[k as keyof MLeaderStyleSettings]);
  const keys = Object.keys(MLEADERSTYLE_RECORD_KEYS).filter((f) =>
    changed(MLEADERSTYLE_RECORD_KEYS[f]!),
  );
  if (keys.length === 0) return undefined;
  const fields: Record<string, unknown> = mleaderStyleFields(s, resolveRefs(b, model, s));
  const patch: Record<string, unknown> = {};
  for (const k of keys) patch[k] = fields[k];
  return patch as Partial<MLeaderStyleRecord>;
}

/** Adds a style named `name` with `s`, as the manager's New... makes one. */
function addStyle(
  b: ChangeSetBuilder,
  model: DocumentModel,
  name: string,
  s: MLeaderStyleSettings,
  base: MLeaderStyleRecord | undefined,
): MLeaderStyleRecord {
  const metric = model.meta.measurement !== 'imperial';
  const template = base ?? {
    handle: '' as Handle,
    ...standardMLeaderStyle(metric, undefined, undefined),
  };
  // What ties the template to the drawing (its reactors, extension dictionary, the file's copy)
  // is its own, not the new style's.
  const { handle: _h, xdata: _x, reactors: _r, extDict: _e, raw: _w, ...rest } = template;
  const fields = mleaderStyleFields(s, resolveRefs(b, model, s));
  const record: Record<string, unknown> = { ...rest, ...fields, name, annotative: false };
  // A style holds no undefined reference: absent means none.
  for (const k of ['linetype', 'arrowhead', 'textStyle', 'block'])
    if (record[k] === undefined) delete record[k];
  return b.addTableRecord('mleaderStyles', record as unknown as Omit<MLeaderStyleRecord, 'handle'>);
}

/** The multileaders in any block that name `style`. */
function multiLeadersOf(model: DocumentModel, style: Handle): Entity[] {
  return [...model.entities()].filter(
    (e) => e.geom.kind === 'MULTILEADER' && e.geom.style === style,
  );
}

/**
 * Gives the style's multileaders its values again (after Modify), the text measured by the
 * canvas first; says what it could not change.
 */
async function restyleMultiLeaders(ctx: CommandContext, style: Handle): Promise<void> {
  const model = ctx.model;
  const leaders = multiLeadersOf(model, style);
  if (leaders.length === 0) return;
  const measure = multiLeaderStylesToMeasure(model, leaders, style, true);
  let widths: MultiLeaderWidths | undefined;
  if (measure.length > 0) {
    const texts = measure.flatMap((l) => [l.before, l.after].filter((t) => t !== undefined));
    const r = await ctx.view.request({ op: 'textWidths', texts });
    const got = r.ok ? (r.widths ?? []) : [];
    let i = 0;
    const next = (t: unknown) => (t === undefined ? undefined : (got[i++] ?? undefined));
    widths = new Map(
      measure.map((l) => {
        const before = next(l.before);
        const after = next(l.after);
        return [
          l.id,
          {
            ...(before !== undefined && { before }),
            ...(after !== undefined && { after }),
          },
        ];
      }),
    );
  }
  let refused = 0;
  ctx.edit((b) => {
    for (const e of leaders) {
      const r = multiLeaderStyleChange(model, e, STYLE_KEY, style, widths, true);
      if (r === undefined || r === 'invalid' || 'skip' in r) continue;
      if ('refuse' in r) {
        refused++;
        continue;
      }
      b.updateEntity(e.id, { geom: r });
    }
  });
  if (refused > 0)
    ctx.message(
      `${refused} multileader${refused === 1 ? '' : 's'} kept ${refused === 1 ? 'its' : 'their'} ` +
        'look: annotative, or its text could not be measured.',
    );
}

/** Makes `a`; what to show next (the style left selected, a refusal). */
async function act(
  ctx: CommandContext,
  a: MLeaderStyleAction,
): Promise<{ selected?: string; note?: string }> {
  const model = ctx.model;
  const current = currentStyle(model);
  switch (a.op) {
    case 'current': {
      const s = styleNamed(model, a.name);
      if (!s) return {};
      const variable = model.header.get('CMLEADERSTYLE');
      if (s.handle === '') {
        // The unsaved Standard is current once it is in the drawing.
        ctx.edit((b) => {
          const { handle: _h, ...standard } = s;
          b.addTableRecord('mleaderStyles', standard);
        });
        return { selected: s.name };
      }
      if (typeof variable === 'string' && upper(variable) === upper(s.name))
        return { selected: s.name };
      if (variable === undefined) {
        if (s.handle === current?.handle) return { selected: s.name };
        return {
          selected: s.name,
          note: 'This drawing keeps no CMLEADERSTYLE variable, so another style cannot be made current.',
        };
      }
      ctx.edit((b) => b.setHeader('CMLEADERSTYLE', s.name));
      return { selected: s.name };
    }
    case 'new': {
      const name = typeof a.name === 'string' ? a.name.trim() : '';
      if (!wellFormed(a.settings))
        return { note: mleaderStyleProblem(a.settings) ?? 'Invalid input.' };
      const problem = nameProblem(model, name) ?? refsProblem(model, a.settings);
      if (problem) return { note: problem };
      if (listedStyles(model).length === 0)
        return { note: 'The drawing has no text style, which a multileader style needs.' };
      ctx.edit((b) => {
        // The unsaved Standard comes with the first style the drawing gets, as MLEADER adds it.
        const standard = unsavedStandard(model);
        if (standard) {
          const { handle: _h, ...rest } = standard;
          b.addTableRecord('mleaderStyles', rest);
        }
        const from = typeof a.from === 'string' ? styleNamed(model, a.from) : undefined;
        addStyle(b, model, name, a.settings, from ?? current);
      });
      return { selected: name };
    }
    case 'modify': {
      const s = styleNamed(model, a.name);
      if (!s) return {};
      if (!wellFormed(a.settings))
        return { selected: s.name, note: mleaderStyleProblem(a.settings) ?? 'Invalid input.' };
      const problem = refsProblem(model, a.settings);
      if (problem) return { selected: s.name, note: problem };
      if (s.handle === '') {
        ctx.edit((b) => {
          const { handle: _h, name, ...rest } = s;
          const made = b.addTableRecord('mleaderStyles', { name, ...rest });
          const patch = changedFields(b, model, s, a.settings);
          if (patch) b.updateTableRecord('mleaderStyles', made.handle, patch);
        });
        return { selected: s.name };
      }
      let changed = false;
      ctx.edit((b) => {
        const patch = changedFields(b, model, s, a.settings);
        if (!patch) return;
        b.updateTableRecord('mleaderStyles', s.handle, patch);
        changed = true;
      });
      if (changed) await restyleMultiLeaders(ctx, s.handle);
      return { selected: s.name };
    }
    case 'rename': {
      const s = styleNamed(model, a.name);
      const to = typeof a.to === 'string' ? a.to.trim() : '';
      if (!s) return {};
      if (upper(s.name) === 'STANDARD' || s.handle === '')
        return { selected: s.name, note: 'Standard cannot be renamed.' };
      if (to === s.name) return { selected: s.name };
      const problem = nameProblem(model, to, s.handle);
      if (problem) return { selected: s.name, note: problem };
      ctx.edit((b) => {
        b.updateTableRecord('mleaderStyles', s.handle, { name: to });
        // CMLEADERSTYLE names the current style, and follows its rename (M1-95).
        const variable = model.header.get('CMLEADERSTYLE');
        if (typeof variable === 'string' && upper(variable) === upper(s.name))
          b.setHeader('CMLEADERSTYLE', to);
      });
      return { selected: to };
    }
    case 'delete': {
      const s = styleNamed(model, a.name);
      if (!s) return {};
      if (upper(s.name) === 'STANDARD' || s.handle === '')
        return { selected: s.name, note: 'Standard cannot be deleted.' };
      if (s.handle === current?.handle)
        return { selected: s.name, note: 'The current multileader style cannot be deleted.' };
      if (usedMLeaderStyles(model).has(s.handle))
        return { selected: s.name, note: 'Style in use, can’t be deleted.' };
      ctx.edit((b) => b.removeTableRecord('mleaderStyles', s.handle));
      return { selected: current?.name ?? '' };
    }
  }
  return {};
}

/** MLEADERSTYLE (MLS): the Multileader Style Manager. */
export function mleaderstyleCommand(): CommandDef {
  return {
    name: 'MLEADERSTYLE',
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      let selected: string | undefined;
      let note: string | undefined;
      for (;;) {
        const a: PromptAnswer = yield ctx.prompt.dialog({
          message: 'Multileader Style Manager',
          dialog: mleaderStyleRequest(ctx.model, selected, note),
        });
        if (a.kind !== 'dialog' || a.action !== 'apply' || !a.mleaderstyle) return;
        const shown = await act(ctx, a.mleaderstyle);
        selected = shown.selected ?? selected;
        note = shown.note;
      }
    },
  };
}
