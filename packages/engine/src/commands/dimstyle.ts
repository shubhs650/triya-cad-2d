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
// A style named `PARENT$n` is one of AutoCAD's sub-styles (Use for, part 2: a style for one kind
// of dimension, dimstyle-family.ts): the list shows it under its parent, New with a Use for makes
// one (or edits the one there is), Modify and Delete act on it alone, and Delete of the parent
// takes them with it. The settings AutoCAD keeps in the record's `ACAD_DSTYLE_*` xdata (part 2,
// dimstyle-xdata.ts) are DIMVARs to the dialog, written to the xdata here; Override leaves them,
// as the header has no variable for them.
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
  childStyleName,
  childStyleUse,
  DIMSTYLE_USE_SUFFIX,
  type DimStyleUse,
} from '../annotation/dimstyle-family';
import {
  DIMSTYLE_XDATA_VARS,
  dimStyleXdataVars,
  isDimStyleXdataVar,
  withDimStyleXdata,
} from '../annotation/dimstyle-xdata';
import {
  DIMSTYLE_REFERENCES,
  dialogVars,
  type DimStyleLists,
  type DimStyleOption,
  type DimStyleVars,
} from '../annotation/dimstyle-fields';
import { addArrowheadBlock, arrowheadBlockName } from '../edit/arrowhead-blocks';
import type { Clipboard } from '../edit/clipboard';
import { importDimStyles, type DimStyleImport } from '../edit/dimstyle-import';
import { currentDimStyle, headerDimvarOverrides } from '../edit/dimension';
import { validViewName } from '../edit/named-view';
import { arrowheadOptions } from '../properties/dimension';

/** One style in the manager's list. */
export interface DimStyleRow {
  readonly name: string;
  /**
   * The style's DIMVARs as its record holds them, with the settings its `ACAD_DSTYLE_*` xdata
   * states (DIMBREAK, DIMJAG, DIMTALN, DIMMZF, …).
   */
  readonly vars: DimStyleVars;
  /** A dimension, leader or tolerance uses it (the list's "Styles in use"). */
  readonly used: boolean;
  /** A sub-style: its parent and what it is used for; listed after the parent. */
  readonly parent?: string;
  readonly use?: Exclude<DimStyleUse, 'all'>;
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
      /** Ignored for a sub-style, which is named after its parent. */
      readonly name: string;
      /** The Start With style. */
      readonly from: string;
      /** The New Dimension Style dialog's DIMVARs as OK closed it. */
      readonly vars: DimStyleVars;
      /** Use for: absent or `all` a style of its own, else Start With's sub-style for that use. */
      readonly use?: DimStyleUse;
    }
  | { readonly op: 'modify'; readonly name: string; readonly vars: DimStyleVars }
  /** Override...: the current style's DIMVARs as the Override dialog's OK left them. */
  | { readonly op: 'override'; readonly vars: DimStyleVars }
  /** The overrides' shortcut menu: Save to current style. */
  | { readonly op: 'save-overrides' }
  | { readonly op: 'rename'; readonly name: string; readonly to: string }
  | { readonly op: 'delete'; readonly name: string }
  /**
   * Import... (part 3): another drawing's styles as `copyDimStyles` carries them; the ones this
   * drawing has a style of that name for are ignored.
   */
  | { readonly op: 'import'; readonly styles: Clipboard };

type Vars = Record<string, DimVarValue>;

/** DIMVARs AutoCAD no longer uses, which the header and the dialog leave alone. */
const OBSOLETE = new Set(['DIMFIT', 'DIMUNIT']);
const ALL_DIMVARS = new Set(Object.values(DIMVAR_BY_CODE));
const DIMVAR_NAMES = [...ALL_DIMVARS].filter((n) => !OBSOLETE.has(n));
const XDATA_NAMES = DIMSTYLE_XDATA_VARS.map((v) => v.name);
const BLOCK_VARS = new Set(['DIMBLK', 'DIMBLK1', 'DIMBLK2', 'DIMLDRBLK']);
const LINETYPE_VARS = new Set(['DIMLTYPE', 'DIMLTEX1', 'DIMLTEX2']);

const upper = (s: string) => s.toUpperCase();
const isChild = (s: DimStyleRecord) => s.name.includes('$');

export function styleNamed(model: DocumentModel, name: string): DimStyleRecord | undefined {
  for (const s of model.tables.dimStyles.values()) if (upper(s.name) === upper(name)) return s;
  return undefined;
}

/** The dimension styles the drawing's dimensions, leaders and tolerances use. */
export function usedStyles(model: DocumentModel): Set<Handle> {
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

/** A style's DIMVARs with the settings its xdata states, as the dialog edits them. */
export function styleVars(model: DocumentModel, s: DimStyleRecord): DimStyleVars {
  const own = dimStyleXdataVars(model, s.xdata);
  return Object.keys(own).length > 0 ? { ...s.vars, ...own } : s.vars;
}

/** A DSTYLE-form value as the dialog shows it: DIMDSEP as its character. */
export const dialogValue = (name: string, v: DimVarValue): DimVarValue =>
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
  const parents = all.filter((s) => !isChild(s)).sort((a, b) => a.name.localeCompare(b.name));
  // Each parent, then its sub-styles in Use for's order.
  const listed = parents.flatMap((p) => [
    p,
    ...all
      .map((c) => ({ c, u: childStyleUse(c.name) }))
      .filter(({ u }) => u !== undefined && upper(u.parent) === upper(p.name))
      .sort((a, b) => DIMSTYLE_USE_SUFFIX[a.u!.use] - DIMSTYLE_USE_SUFFIX[b.u!.use])
      .map(({ c }) => c),
  ]);
  const overrides: Vars = {};
  if (current) {
    for (const [name, v] of Object.entries(headerDimvarOverrides(model, current)))
      overrides[name] = dialogValue(name, v);
  }
  const shown = listed.find((s) => selected && upper(s.name) === upper(selected));
  return {
    type: 'dimstyle',
    styles: listed.map((s) => {
      const child = childStyleUse(s.name);
      return {
        name: s.name,
        vars: styleVars(model, s),
        used:
          used.has(s.handle) ||
          all.some((c) => isChild(c) && used.has(c.handle) && c.name.startsWith(`${s.name}$`)),
        ...(child && { parent: listed.find((p) => upper(p.name) === upper(child.parent))!.name }),
        ...(child && { use: child.use }),
      };
    }),
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
  if (name === 'DIMMZS' || name === 'DIMALTMZS') return typeof v === 'string' && v.length <= 255;
  if (name === 'DIMTALN') return v === 0 || v === 1;
  if (name === 'DIMMZF' || name === 'DIMALTMZF' || name === 'DIMJAG')
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (name === 'DIMBREAK') return typeof v === 'number' && Number.isFinite(v) && v >= 0;
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
  for (const name of [...DIMVAR_NAMES, ...XDATA_NAMES]) {
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
  for (const key of Object.keys(e))
    if (!ALL_DIMVARS.has(key) && !isDimStyleXdataVar(key)) return undefined;
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

/** `changes` split into the record's DIMVARs and the settings its xdata keeps. */
function split(changes: ReadonlyMap<string, DimVarValue | undefined>): {
  vars: Map<string, DimVarValue | undefined>;
  xdata: Map<string, DimVarValue>;
} {
  const vars = new Map<string, DimVarValue | undefined>();
  const xdata = new Map<string, DimVarValue>();
  for (const [name, v] of changes) {
    if (!isDimStyleXdataVar(name)) vars.set(name, v);
    else if (v !== undefined) xdata.set(name, v);
  }
  return { vars, xdata };
}

/** The xdata of `record` an edit keeps or a new style copies: its `ACAD_DSTYLE_*` settings. */
function settingsXdata(model: DocumentModel, record: DimStyleRecord): DimStyleRecord['xdata'] {
  const apps = new Set(DIMSTYLE_XDATA_VARS.map((v) => v.app));
  const kept = (record.xdata ?? []).filter((a) =>
    apps.has(model.tables.appIds.get(a.appId)?.name.toUpperCase() ?? ''),
  );
  return kept.length > 0 ? kept : undefined;
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

export const NAME_IN_USE = 'A dimension style with this name already exists.';
const NAME_INVALID = 'Invalid dimension style name.';

/** Why `name` cannot name a new or renamed style (`except`: the style being renamed). */
export function nameProblem(
  model: DocumentModel,
  name: string,
  except?: Handle,
): string | undefined {
  // `$` names AutoCAD's child styles; the manager does not let a user make one.
  if (!validViewName(name) || name.includes('$')) return NAME_INVALID;
  const other = styleNamed(model, name);
  return other && other.handle !== except ? NAME_IN_USE : undefined;
}

/**
 * Makes `a`; what to show next (the style left selected, a refusal) and the change that restyled
 * dimensions, which are drawn again at once.
 */
export function dimStyleAct(
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
      const use = a.use === undefined || a.use === 'all' ? undefined : a.use;
      if (use !== undefined && !Object.hasOwn(DIMSTYLE_USE_SUFFIX, use)) return {};
      // A sub-style is named after its Start With style; one there already is edited.
      if (use !== undefined && from && !isChild(from)) {
        const child = styleNamed(model, childStyleName(from.name, use));
        if (child) return dimStyleAct(ctx, { op: 'modify', name: child.name, vars: a.vars });
      } else if (use !== undefined) return {};
      const name = use
        ? childStyleName(from!.name, use)
        : typeof a.name === 'string'
          ? a.name.trim()
          : '';
      const problem = use ? undefined : nameProblem(model, name);
      if (problem) return { note: problem };
      const changes = from && changedVars(model, styleVars(model, from), a.vars);
      if (!from || !changes) return {};
      const { vars: varChanges, xdata: settings } = split(changes);
      const colors = keptTrueColors(from, varChanges);
      const trueColors = 'trueColors' in colors ? colors.trueColors : from.trueColors;
      const restyled = ctx.edit((b) => {
        const kept = settingsXdata(model, from);
        const xdata =
          settings.size > 0 ? withDimStyleXdata(b, model, { xdata: kept }, settings) : kept;
        b.addTableRecord('dimStyles', {
          name,
          flags: 0,
          vars: withObsoleteOfStandard(model, withChanges(b, model, from.vars, varChanges)),
          ...(trueColors && { trueColors }),
          ...(xdata && { xdata }),
        });
      });
      // A new sub-style redraws its parent's dimensions of its kind.
      return { selected: name, ...(use && { restyled }) };
    }
    case 'modify': {
      const s = styleNamed(model, a.name);
      const changes = s && changedVars(model, styleVars(model, s), a.vars);
      if (!s || !changes) return {};
      if (changes.size === 0) return { selected: s.name };
      const isCurrent = s.handle === current?.handle;
      const overridden = isCurrent ? headerDimvarOverrides(model, s) : {};
      const { vars: varChanges, xdata: settings } = split(changes);
      const restyled = ctx.edit((b) => {
        const vars = withChanges(b, model, s.vars, varChanges);
        b.updateTableRecord('dimStyles', s.handle, {
          vars,
          ...keptTrueColors(s, varChanges),
          ...(settings.size > 0 && { xdata: withDimStyleXdata(b, model, s, settings) }),
        });
        // The header follows the current style, its own overrides kept.
        if (isCurrent) {
          setHeaderVars(b, model, vars, (n, inHeader) => inHeader && !Object.hasOwn(overridden, n));
        }
      });
      return { selected: s.name, restyled };
    }
    case 'override': {
      if (!current) return {};
      const all = changedVars(model, styleVars(model, current), a.vars);
      if (!all) return {};
      const changes = split(all).vars;
      if (changes.size === 0) return { selected: current.name };
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
      if (!s) return {};
      // A sub-style goes alone; a parent takes its sub-styles with it.
      const family = isChild(s)
        ? [s]
        : [...model.tables.dimStyles.values()].filter(
            (c) => c === s || c.name.startsWith(`${s.name}$`),
          );
      const parentOf = childStyleUse(s.name)?.parent;
      const selectedAfter = parentOf ? styleNamed(model, parentOf)?.name : current?.name;
      const used = usedStyles(model);
      if (upper(s.name) === 'STANDARD')
        return { selected: s.name, note: 'Standard cannot be deleted.' };
      if (s.handle === current?.handle)
        return { selected: s.name, note: 'The current style cannot be deleted.' };
      if (family.some((c) => used.has(c.handle)))
        return { selected: s.name, note: 'Style in use, can’t be deleted.' };
      const restyled = ctx.edit((b) => {
        for (const c of family) b.removeTableRecord('dimStyles', c.handle);
      });
      return { selected: selectedAfter ?? '', ...(parentOf && { restyled }) };
    }
    case 'import': {
      const clip = a.styles as Partial<Clipboard> | undefined;
      if (!isStyleClipboard(clip)) return {};
      let result: DimStyleImport = { added: [], ignored: [] };
      ctx.edit((b) => {
        result = importDimStyles(b, model, clip);
      });
      const first = result.added.find((n) => childStyleUse(n) === undefined) ?? result.added[0];
      // DesignCenter's message for a duplicate, which it ignores.
      const note =
        result.ignored.length > 0
          ? `Dimension style${result.ignored.length > 1 ? 's' : ''} already in the drawing: ${result.ignored.join(', ')}. Duplicate definitions were ignored.`
          : undefined;
      return { ...(first !== undefined && { selected: first }), ...(note && { note }) };
    }
  }
}

/** Whether the UI sent styles shaped as `copyDimStyles` makes them. */
function isStyleClipboard(c: Partial<Clipboard> | undefined): c is Clipboard {
  return (
    typeof c === 'object' &&
    c !== null &&
    typeof c.tables === 'object' &&
    c.tables !== null &&
    Array.isArray(c.tables.dimStyles) &&
    Array.isArray(c.blocks) &&
    Array.isArray(c.blockEntities) &&
    typeof c.base === 'object'
  );
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
        const shown = dimStyleAct(ctx, a.dimstyle);
        // AutoCAD redraws a style's dimensions as Modify's OK closes.
        if (shown.restyled) await regenerateRestyled(ctx, [shown.restyled]);
        selected = shown.selected ?? selected;
        note = shown.note;
      }
    },
  };
}
