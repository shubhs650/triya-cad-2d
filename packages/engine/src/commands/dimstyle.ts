// DIMSTYLE (D, DST, DIMSTY; M4-03): the Dimension Style Manager (AutoCAD 2024 Help, "DIMSTYLE
// (Command)", "Dimension Style Manager", "Create New Dimension Style Dialog Box" and "New,
// Modify, and Override Dimension Style Dialog Boxes"). The manager lists the drawing's styles
// (all, or those in use) with the current one and its "<style overrides>"; Set Current, New...,
// Modify... and Override... act on the style selected, and its shortcut menu renames and
// deletes. Each action is made at once, as AutoCAD's are, and the manager opens again on the
// style it left selected; Close ends the command, and everything it did is one undo step.
//
// The current style's DIMVARs are also the header's ($DIMSCALE, …): Set Current copies the
// style's into it, Override sets the ones that differ there ("<style overrides>"), which each
// new dimension carries as its `DSTYLE` overrides (M2-31, `headerDimensionXdata`), and Modify of
// the current style moves the header's along with it, overrides kept. Dimensions of a style
// Modify changed are drawn again once the command ends (M2-30 part 2).
//
// A style named `PARENT$n` is one of AutoCAD's child styles (a style for one kind of dimension);
// the list shows its parent only, and Delete takes the children with the parent.
import type { CommandContext, CommandDef } from './command';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { Color, DimStyleRecord, DimVarValue, HeaderValue } from '../model/types';
import type { PromptAnswer } from './prompt';
import type { ChangeSet } from '../model/changeset';
import { regenerateRestyled } from './modify/dimensions';
import { DIMVAR_BY_CODE } from '../annotation/dimvars';
import {
  DIMSTYLE_REFERENCES,
  dialogVars,
  type DimStyleLists,
  type DimStyleOption,
  type DimStyleVars,
} from '../annotation/dimstyle-fields';
import { addArrowheadBlock, arrowheadBlockName } from '../edit/arrowhead-blocks';
import { currentDimStyle, headerDimvarOverrides } from '../edit/dimension';
import { validViewName } from '../edit/named-view';
import { arrowheadOptions } from '../properties/dimension';

/** One style in the manager's list. */
export interface DimStyleRow {
  readonly name: string;
  /** The style's DIMVARs as its record holds them. */
  readonly vars: DimStyleVars;
  /** A dimension, leader or tolerance uses it (the list's "Styles in use"). */
  readonly used: boolean;
}

/** The Dimension Style Manager as DIMSTYLE opens it. */
export interface DimStyleRequest {
  readonly type: 'dimstyle';
  readonly styles: readonly DimStyleRow[];
  /** The current style's name (DIMSTYLE). */
  readonly current: string;
  /** The header's DIMVARs that differ from the current style ("<style overrides>"). */
  readonly overrides: DimStyleVars;
  /** The style the list opens on. */
  readonly selected: string;
  readonly lists: DimStyleLists;
  /** Why the last action did nothing ("Style in use, can't be deleted."). */
  readonly note?: string;
}

/** What a Dimension Style Manager button or shortcut menu choice asks of DIMSTYLE. */
export type DimStyleAction =
  | { readonly op: 'current'; readonly name: string }
  | {
      readonly op: 'new';
      readonly name: string;
      /** The Start With style. */
      readonly from: string;
      /** The New Dimension Style dialog's DIMVARs as OK closed it. */
      readonly vars: DimStyleVars;
    }
  | { readonly op: 'modify'; readonly name: string; readonly vars: DimStyleVars }
  /** Override...: the current style's DIMVARs as the Override dialog's OK left them. */
  | { readonly op: 'override'; readonly vars: DimStyleVars }
  /** The overrides' shortcut menu: Save to current style. */
  | { readonly op: 'save-overrides' }
  | { readonly op: 'rename'; readonly name: string; readonly to: string }
  | { readonly op: 'delete'; readonly name: string };

type Vars = Record<string, DimVarValue>;

/** DIMVARs AutoCAD no longer uses, which the header and the dialog leave alone. */
const OBSOLETE = new Set(['DIMFIT', 'DIMUNIT']);
const ALL_DIMVARS = new Set(Object.values(DIMVAR_BY_CODE));
const DIMVAR_NAMES = [...ALL_DIMVARS].filter((n) => !OBSOLETE.has(n));
const BLOCK_VARS = new Set(['DIMBLK', 'DIMBLK1', 'DIMBLK2', 'DIMLDRBLK']);
const LINETYPE_VARS = new Set(['DIMLTYPE', 'DIMLTEX1', 'DIMLTEX2']);

const upper = (s: string) => s.toUpperCase();
const isChild = (s: DimStyleRecord) => s.name.includes('$');

function styleNamed(model: DocumentModel, name: string): DimStyleRecord | undefined {
  for (const s of model.tables.dimStyles.values()) if (upper(s.name) === upper(name)) return s;
  return undefined;
}

/** The dimension styles the drawing's dimensions, leaders and tolerances use. */
function usedStyles(model: DocumentModel): Set<Handle> {
  const out = new Set<Handle>();
  for (const e of model.entities()) {
    const g = e.geom;
    if (
      g.kind === 'DIMENSION' ||
      g.kind === 'LARGE_RADIAL_DIMENSION' ||
      g.kind === 'ARC_DIMENSION' ||
      g.kind === 'LEADER' ||
      g.kind === 'TOLERANCE'
    )
      out.add(g.style);
  }
  return out;
}

/** A DSTYLE-form value as the dialog shows it: DIMDSEP as its character. */
const dialogValue = (name: string, v: DimVarValue): DimVarValue =>
  name === 'DIMDSEP' && typeof v === 'number' ? String.fromCharCode(v) : v;

/** The lists the dialog's reference fields choose from. */
function dimStyleLists(model: DocumentModel, styles: readonly DimStyleRecord[]): DimStyleLists {
  const named = (records: Iterable<{ handle: Handle; name: string }>): DimStyleOption[] =>
    [...records]
      .filter((r) => r.name !== '')
      .map((r) => ({ value: r.handle as string, label: r.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  const linetypes = named(model.tables.linetypes.values());
  // ByBlock, the default a style states by holding none, first; ByLayer next.
  const rank = (o: DimStyleOption) => ['BYBLOCK', 'BYLAYER'].indexOf(upper(o.label));
  const byBlock = linetypes.find((o) => rank(o) === 0);
  const lt = [
    { value: '', label: byBlock?.label ?? 'ByBlock' },
    ...linetypes.filter((o) => rank(o) === 1),
    ...linetypes.filter((o) => rank(o) < 0),
  ];
  const blocks = styles.flatMap((s) =>
    [...BLOCK_VARS].map((n) => s.vars[n]).filter((v): v is string => typeof v === 'string'),
  );
  return {
    textStyles: named(model.tables.textStyles.values()),
    linetypes: lt,
    arrowheads: arrowheadOptions(model, blocks),
  };
}

/** The manager as it opens on `selected`. */
export function dimStyleRequest(
  model: DocumentModel,
  selected?: string,
  note?: string,
): DimStyleRequest {
  const all = [...model.tables.dimStyles.values()];
  const used = usedStyles(model);
  const current = currentDimStyle(model);
  const listed = all.filter((s) => !isChild(s)).sort((a, b) => a.name.localeCompare(b.name));
  const overrides: Vars = {};
  if (current) {
    for (const [name, v] of Object.entries(headerDimvarOverrides(model, current)))
      overrides[name] = dialogValue(name, v);
  }
  const shown = listed.find((s) => selected && upper(s.name) === upper(selected));
  return {
    type: 'dimstyle',
    styles: listed.map((s) => ({
      name: s.name,
      vars: s.vars,
      used:
        used.has(s.handle) ||
        all.some((c) => isChild(c) && used.has(c.handle) && c.name.startsWith(`${s.name}$`)),
    })),
    current: current?.name ?? '',
    overrides,
    selected: shown?.name ?? current?.name ?? listed[0]?.name ?? '',
    lists: dimStyleLists(model, all),
    ...(note !== undefined && { note }),
  };
}

/** Whether `v` can be DIMVAR `name`'s value in a style of `model` (the bus takes any object). */
function validValue(model: DocumentModel, name: string, v: unknown): v is DimVarValue {
  if (DIMSTYLE_REFERENCES.has(name)) {
    if (typeof v !== 'string') return false;
    if (v === '') return name !== 'DIMTXSTY';
    if (name === 'DIMTXSTY') return model.tables.textStyles.has(v);
    if (LINETYPE_VARS.has(name)) return model.tables.linetypes.has(v);
    return model.blocks.has(v) || arrowheadBlockName(v) === v;
  }
  if (name === 'DIMDSEP') return typeof v === 'string' && [...v].length === 1;
  if (name === 'DIMPOST' || name === 'DIMAPOST') return typeof v === 'string';
  return typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
}

/**
 * The DIMVARs of `record` the dialog's `edited` changes, each in the type the record holds it in
 * (a switch read as a boolean stays one); undefined when `edited` is not something the dialog can
 * give.
 */
function changedVars(
  model: DocumentModel,
  record: DimStyleVars,
  edited: unknown,
): Map<string, DimVarValue | undefined> | undefined {
  if (typeof edited !== 'object' || edited === null) return undefined;
  const e = edited as Record<string, unknown>;
  const shown = dialogVars(record);
  const out = new Map<string, DimVarValue | undefined>();
  for (const name of DIMVAR_NAMES) {
    const now = e[name];
    if (now === undefined) {
      // A reference the dialog left at its default (closed filled, ByBlock); a style always
      // names its text style.
      if (
        DIMSTYLE_REFERENCES.has(name) &&
        name !== 'DIMTXSTY' &&
        record[name] !== undefined &&
        record[name] !== '0'
      )
        out.set(name, undefined);
      continue;
    }
    if (!validValue(model, name, now)) return undefined;
    const was = record[name] ?? shown[name];
    const value = typeof was === 'boolean' && typeof now === 'number' ? now !== 0 : now;
    if (DIMSTYLE_REFERENCES.has(name) && value === '') {
      if (record[name] !== undefined && record[name] !== '0') out.set(name, undefined);
    } else if (value !== shown[name]) out.set(name, value);
  }
  // The obsolete DIMFIT and DIMUNIT come back as the style held them, and are left so.
  for (const key of Object.keys(e)) if (!ALL_DIMVARS.has(key)) return undefined;
  return out;
}

/** `vars` with `changes` made, arrowheads the drawing lacks added to it by `b`. */
function withChanges(
  b: ChangeSetBuilder,
  model: DocumentModel,
  vars: DimStyleVars,
  changes: ReadonlyMap<string, DimVarValue | undefined>,
): Vars {
  const out: Vars = { ...vars };
  const added = new Map<string, Handle>();
  for (const [name, value] of changes) {
    if (value === undefined) {
      delete out[name];
      continue;
    }
    let v = value;
    if (BLOCK_VARS.has(name) && typeof v === 'string' && !model.blocks.has(v)) {
      // An AutoCAD arrowhead first chosen here: added, as AutoCAD adds `_DOT` (M2-35 part 22).
      const block = added.get(v) ?? addArrowheadBlock(b, model, v);
      if (block === undefined) continue;
      added.set(v, block);
      v = block;
    }
    out[name] = v;
  }
  return out;
}

/**
 * What a DXF reader gives a style that does not store the obsolete DIMFIT and DIMUNIT (the
 * DIMSTYLE defaults of acad-ts, which `@triya/io` reads with).
 */
const OBSOLETE_UNSTORED: Readonly<Record<string, DimVarValue>> = { DIMFIT: 0, DIMUNIT: 2 };

/**
 * A new style's obsolete DIMFIT and DIMUNIT as the drawing's Standard holds them, or as a style
 * that does not store them reads, whatever the style it started from held: AutoCAD no longer
 * sets them, and a save measures a new style's against Standard (export dim-styles.ts).
 */
function withObsoleteOfStandard(model: DocumentModel, vars: Vars): Vars {
  const standard = styleNamed(model, 'Standard');
  for (const name of OBSOLETE) vars[name] = standard?.vars[name] ?? OBSOLETE_UNSTORED[name]!;
  return vars;
}

/** The style's true colours without those `changes` set an ACI for. */
function keptTrueColors(
  record: DimStyleRecord,
  changes: ReadonlyMap<string, unknown>,
): { trueColors?: Readonly<Record<string, Color>> | undefined } {
  if (!record.trueColors) return {};
  const kept = Object.entries(record.trueColors).filter(([n]) => !changes.has(n));
  if (kept.length === Object.keys(record.trueColors).length) return {};
  return { trueColors: kept.length > 0 ? Object.fromEntries(kept) : undefined };
}

/** DIMVAR `name` as the header holds it: references by name, DIMDSEP by its character code. */
function headerValue(
  model: DocumentModel,
  name: string,
  v: DimVarValue | undefined,
  was: HeaderValue | undefined,
): HeaderValue | undefined {
  if (DIMSTYLE_REFERENCES.has(name)) {
    const h = typeof v === 'string' && v !== '0' ? v : '';
    if (name === 'DIMTXSTY') return h ? model.tables.textStyles.get(h)?.name : 'Standard';
    if (LINETYPE_VARS.has(name)) return h ? model.tables.linetypes.get(h)?.name : 'ByBlock';
    return h ? model.blocks.get(h)?.name : '';
  }
  if (v === undefined) return undefined;
  if (name === 'DIMDSEP') return typeof v === 'string' ? v.charCodeAt(0) : v;
  if (typeof was === 'boolean') return typeof v === 'number' ? v !== 0 : v;
  return typeof v === 'boolean' ? Number(v) : v;
}

/**
 * Sets the header's DIMVARs `which` takes (given whether the header has it) to `vars` (the
 * current style's, overrides included) where they say something else.
 */
function setHeaderVars(
  b: ChangeSetBuilder,
  model: DocumentModel,
  vars: DimStyleVars,
  which: (name: string, inHeader: boolean) => boolean,
): void {
  for (const name of DIMVAR_NAMES) {
    const key = '$' + name;
    const was = model.header.get(key);
    if (!which(name, was !== undefined)) continue;
    const v = headerValue(model, name, vars[name], was);
    if (v === undefined) continue;
    const same =
      typeof v === 'string' && typeof was === 'string' ? upper(v) === upper(was) : v === was;
    if (!same) b.setHeader(key, v);
  }
}

const NAME_IN_USE = 'A dimension style with this name already exists.';
const NAME_INVALID = 'Invalid dimension style name.';

/** Why `name` cannot name a new or renamed style (`except`: the style being renamed). */
function nameProblem(model: DocumentModel, name: string, except?: Handle): string | undefined {
  // `$` names AutoCAD's child styles; the manager does not let a user make one.
  if (!validViewName(name) || name.includes('$')) return NAME_INVALID;
  const other = styleNamed(model, name);
  return other && other.handle !== except ? NAME_IN_USE : undefined;
}

/**
 * Makes `a`; what to show next (the style left selected, a refusal) and the change that restyled
 * dimensions, which are drawn again at once.
 */
function act(
  ctx: CommandContext,
  a: DimStyleAction,
): { selected?: string; note?: string; restyled?: ChangeSet } {
  const model = ctx.model;
  const current = currentDimStyle(model);
  switch (a.op) {
    case 'current': {
      const s = styleNamed(model, a.name);
      if (!s || isChild(s)) return {};
      ctx.edit((b) => {
        b.setHeader('$DIMSTYLE', s.name);
        setHeaderVars(b, model, s.vars, (_, inHeader) => inHeader);
      });
      return { selected: s.name };
    }
    case 'new': {
      const from = styleNamed(model, a.from);
      const name = typeof a.name === 'string' ? a.name.trim() : '';
      const problem = nameProblem(model, name);
      if (problem) return { note: problem };
      const changes = from && changedVars(model, from.vars, a.vars);
      if (!from || !changes) return {};
      const colors = keptTrueColors(from, changes);
      const trueColors = 'trueColors' in colors ? colors.trueColors : from.trueColors;
      ctx.edit((b) => {
        b.addTableRecord('dimStyles', {
          name,
          flags: 0,
          vars: withObsoleteOfStandard(model, withChanges(b, model, from.vars, changes)),
          ...(trueColors && { trueColors }),
        });
      });
      return { selected: name };
    }
    case 'modify': {
      const s = styleNamed(model, a.name);
      const changes = s && changedVars(model, s.vars, a.vars);
      if (!s || !changes) return {};
      if (changes.size === 0) return { selected: s.name };
      const isCurrent = s.handle === current?.handle;
      const overridden = isCurrent ? headerDimvarOverrides(model, s) : {};
      const restyled = ctx.edit((b) => {
        const vars = withChanges(b, model, s.vars, changes);
        b.updateTableRecord('dimStyles', s.handle, { vars, ...keptTrueColors(s, changes) });
        // The header follows the current style, its own overrides kept.
        if (isCurrent) {
          setHeaderVars(b, model, vars, (n, inHeader) => inHeader && !Object.hasOwn(overridden, n));
        }
      });
      return { selected: s.name, restyled };
    }
    case 'override': {
      if (!current) return {};
      const changes = changedVars(model, current.vars, a.vars);
      if (!changes) return {};
      ctx.edit((b) => {
        const vars = withChanges(b, model, current.vars, changes);
        setHeaderVars(b, model, vars, (n, inHeader) => inHeader || changes.has(n));
      });
      return { selected: current.name };
    }
    case 'save-overrides': {
      if (!current) return {};
      const overrides = headerDimvarOverrides(model, current);
      if (Object.keys(overrides).length === 0) return {};
      const vars: Vars = { ...current.vars };
      for (const [name, v] of Object.entries(overrides)) {
        const was = current.vars[name];
        const value = dialogValue(name, v);
        vars[name] = typeof was === 'boolean' && typeof value === 'number' ? value !== 0 : value;
      }
      const changes = new Map(Object.keys(overrides).map((n) => [n, vars[n]]));
      const restyled = ctx.edit((b) =>
        b.updateTableRecord('dimStyles', current.handle, {
          vars,
          ...keptTrueColors(current, changes),
        }),
      );
      return { selected: current.name, restyled };
    }
    case 'rename': {
      const s = styleNamed(model, a.name);
      const to = typeof a.to === 'string' ? a.to.trim() : '';
      if (!s || isChild(s)) return {};
      if (upper(s.name) === 'STANDARD')
        return { selected: s.name, note: 'Standard cannot be renamed.' };
      if (to === s.name) return { selected: s.name };
      const problem = nameProblem(model, to, s.handle);
      if (problem) return { selected: s.name, note: problem };
      const children = [...model.tables.dimStyles.values()].filter((c) =>
        c.name.startsWith(`${s.name}$`),
      );
      ctx.edit((b) => {
        b.updateTableRecord('dimStyles', s.handle, { name: to });
        for (const c of children)
          b.updateTableRecord('dimStyles', c.handle, { name: to + c.name.slice(s.name.length) });
        if (s.handle === current?.handle) b.setHeader('$DIMSTYLE', to);
      });
      return { selected: to };
    }
    case 'delete': {
      const s = styleNamed(model, a.name);
      if (!s || isChild(s)) return {};
      const family = [...model.tables.dimStyles.values()].filter(
        (c) => c === s || c.name.startsWith(`${s.name}$`),
      );
      const used = usedStyles(model);
      if (upper(s.name) === 'STANDARD')
        return { selected: s.name, note: 'Standard cannot be deleted.' };
      if (s.handle === current?.handle)
        return { selected: s.name, note: 'The current style cannot be deleted.' };
      if (family.some((c) => used.has(c.handle)))
        return { selected: s.name, note: 'Style in use, can’t be deleted.' };
      ctx.edit((b) => {
        for (const c of family) b.removeTableRecord('dimStyles', c.handle);
      });
      return { selected: current?.name ?? '' };
    }
  }
}

/** DIMSTYLE (D, DST, DIMSTY): the Dimension Style Manager. */
export function dimstyleCommand(): CommandDef {
  return {
    name: 'DIMSTYLE',
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      let selected: string | undefined;
      let note: string | undefined;
      for (;;) {
        const a: PromptAnswer = yield ctx.prompt.dialog({
          message: 'Dimension Style Manager',
          dialog: dimStyleRequest(ctx.model, selected, note),
        });
        if (a.kind !== 'dialog' || a.action !== 'apply' || !a.dimstyle) return;
        const shown = act(ctx, a.dimstyle);
        // AutoCAD redraws a style's dimensions as Modify's OK closes.
        if (shown.restyled) await regenerateRestyled(ctx, [shown.restyled]);
        selected = shown.selected ?? selected;
        note = shown.note;
      }
    },
  };
}
