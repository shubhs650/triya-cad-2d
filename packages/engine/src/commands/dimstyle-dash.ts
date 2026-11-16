// -DIMSTYLE (M4-03 part 2): dimension styles at the command line (AutoCAD 2024 Help, "-DIMSTYLE
// (Command)"):
//
//   Current dimension style: <name>
//   Enter a dimension style option
//   [Save/Restore/STatus/Variables/Apply/?] <Restore>:
//
// - Save makes a style of the current settings (the current style with its overrides) and makes
//   it current; an existing name is redefined once the drafter says so.
// - Restore makes a style current, by name or by selecting a dimension; `~name` lists how the
//   named style differs from the current settings instead.
// - STatus lists the current settings, Variables a style's (or `~name`'s differences), without
//   changing anything.
// - Apply gives the selected dimensions, leaders and tolerances the current style and settings,
//   their own overrides replaced.
// - ? lists the named styles matching a pattern.
//
// AutoCAD's ANnotative option makes annotative styles, which Triya does not create (DEC-013,
// DEC-058); it is left out. Each option ends the command, as AutoCAD's does.
import type { CommandContext, CommandDef } from './command';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { ChangeSet } from '../model/changeset';
import type { DimStyleRecord, DimVarValue, Entity, Xdata, XdataApp } from '../model/types';
import type { Prompt, PromptAnswer } from './prompt';
import {
  DIMSTYLE_LISTED_VARS,
  DIMVAR_DESCRIPTIONS,
  formatDimStyleVar,
  listedDimStyleVars,
} from '../annotation/dimstyle-compare';
import { DIMVAR_BY_CODE } from '../annotation/dimvars';
import { acadAppId, withDimvarOverride } from '../annotation/dstyle';
import { currentDimStyle, headerDimvarOverrides } from '../edit/dimension';
import { wcmatch } from './modify/attributes';
import { regenerateRestyled } from './modify/dimensions';
import { dialogValue, dimStyleAct, nameProblem, styleNamed, styleVars } from './dimstyle';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;
type Vars = Readonly<Record<string, DimVarValue>>;

const OPTIONS = ['Save', 'Restore', 'STatus', 'Variables', 'Apply', '?'];

/** The kinds of object a dimension style styles. */
const STYLED = new Set([
  'DIMENSION',
  'ARC_DIMENSION',
  'LARGE_RADIAL_DIMENSION',
  'LEADER',
  'TOLERANCE',
]);

type Styled = Entity & { readonly geom: { readonly style: string } };
const isStyled = (e: Entity | undefined): e is Styled => e !== undefined && STYLED.has(e.geom.kind);

/** A referenced record's name as the listings show it. */
function recordName(model: DocumentModel, name: string, handle: string): string {
  if (name === 'DIMTXSTY') return model.tables.textStyles.get(handle)?.name ?? '';
  if (name === 'DIMLTYPE' || name === 'DIMLTEX1' || name === 'DIMLTEX2')
    return handle === '' ? 'BYBLOCK' : (model.tables.linetypes.get(handle)?.name ?? '');
  return handle === '' ? 'ClosedFilled' : (model.blocks.get(handle)?.name ?? '');
}

/** The current settings: the current style's variables with the header's overrides. */
function currentSettings(model: DocumentModel, current: DimStyleRecord): Vars {
  const out: Record<string, DimVarValue> = { ...styleVars(model, current) };
  for (const [name, v] of Object.entries(headerDimvarOverrides(model, current))) {
    const was = current.vars[name];
    const value = dialogValue(name, v);
    out[name] = typeof was === 'boolean' && typeof value === 'number' ? value !== 0 : value;
  }
  return out;
}

/** A dimension's variables: its style's with its own overrides. */
function objectSettings(model: DocumentModel, e: Styled): Vars {
  const style = model.tables.dimStyles.get(e.geom.style);
  const out: Record<string, DimVarValue> = { ...(style ? styleVars(model, style) : {}) };
  // Its DSTYLE overrides, read as the dimension engine reads them.
  const acad = acadAppId(model);
  const app = e.xdata?.find((a) => a.appId === acad);
  for (const [code, value] of dstylePairs(app)) {
    const name = DIMVAR_BY_CODE[code];
    if (name) out[name] = dialogValue(name, value as DimVarValue);
  }
  return out;
}

/** The (code, value) pairs of an ACAD application's DSTYLE list. */
function dstylePairs(app: XdataApp | undefined): [number, unknown][] {
  const v = app?.values ?? [];
  const at = v.findIndex((x) => x.code === 1000 && x.value === 'DSTYLE');
  if (at < 0) return [];
  const out: [number, unknown][] = [];
  for (let i = at + 2; i + 1 < v.length && v[i]!.code === 1070; i += 2) {
    out.push([Number(v[i]!.value), v[i + 1]!.value]);
  }
  return out;
}

/** `e`'s xdata without its DSTYLE overrides. */
function withoutOverrides(xdata: Xdata | undefined, acad: string | undefined): Xdata | undefined {
  if (!xdata || acad === undefined) return xdata;
  const out = xdata.flatMap((app) => {
    if (app.appId !== acad) return [app];
    const v = app.values;
    const at = v.findIndex((x) => x.code === 1000 && x.value === 'DSTYLE');
    if (at < 0) return [app];
    let end = at + 2;
    while (end + 1 < v.length && v[end]!.code === 1070) end += 2;
    if (end < v.length && v[end]!.code === 1002) end++;
    const values = [...v.slice(0, at), ...v.slice(end)];
    return values.length > 0 ? [{ ...app, values }] : [];
  });
  return out.length > 0 ? out : undefined;
}

/** Lists `vars` as STatus and Variables do: name, value and description. */
function list(ctx: CommandContext, vars: Vars): void {
  const shown = listedDimStyleVars(vars);
  for (const name of DIMSTYLE_LISTED_VARS) {
    const value = formatDimStyleVar(name, shown[name], (n, h) => recordName(ctx.model, n, h));
    ctx.message(`${name.padEnd(16)}${value.padEnd(16)}${DIMVAR_DESCRIPTIONS[name] ?? ''}`);
  }
}

/** `~name`: the variables the named style sets other than `vars` (the current settings). */
function listDifferences(ctx: CommandContext, s: DimStyleRecord, vars: Vars): void {
  const a = listedDimStyleVars(styleVars(ctx.model, s));
  const b = listedDimStyleVars(vars);
  const names = (n: string, h: string) => recordName(ctx.model, n, h);
  ctx.message(`Differences between ${s.name} and current settings:`);
  ctx.message(`${''.padEnd(16)}${s.name.padEnd(16)}Current Setting`);
  let any = false;
  for (const name of DIMSTYLE_LISTED_VARS) {
    const x = formatDimStyleVar(name, a[name], names);
    const y = formatDimStyleVar(name, b[name], names);
    if (x === y) continue;
    any = true;
    ctx.message(`${name.padEnd(16)}${x.padEnd(16)}${y}`);
  }
  if (!any) ctx.message('No differences.');
}

/** `?`: the styles whose names match the patterns typed. */
async function* listStyles(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({
    message: 'Enter dimension style(s) to list',
    default: { kind: 'string', value: '*' },
  });
  if (a.kind !== 'string') return;
  const pattern = a.value.trim() || '*';
  const found = [...ctx.model.tables.dimStyles.values()]
    .filter((s) => wcmatch(s.name, pattern))
    .sort((x, y) => x.name.localeCompare(y.name));
  if (found.length === 0) return ctx.message('No matching dimension styles found.');
  ctx.message('Named dimension styles:');
  for (const s of found) ctx.message(`  ${s.name}`);
}

/** "Select dimension": a picked dimension, leader or tolerance. */
async function* pickStyled(ctx: CommandContext): Sub<Styled | undefined> {
  const a = yield ctx.prompt.selection({ message: 'Select dimension', single: true });
  if (a.kind !== 'selection') return undefined;
  const e = a.ids.map((id) => ctx.model.entity(id)).find(isStyled);
  if (!e) ctx.message('That object is not a dimension.');
  return e;
}

/**
 * "Enter a dimension style name, [?] or <select dimension>": a style (by name or a dimension's),
 * `~name` read as a comparison, `undefined` at Esc or a name that names none.
 */
async function* askStyle(
  ctx: CommandContext,
): Sub<{ style: DimStyleRecord; compare: boolean; object?: Styled } | undefined> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter a dimension style name',
      options: ['?'],
      defaultLabel: 'select dimension',
    });
    if (a.kind === 'keyword') {
      yield* listStyles(ctx);
      continue;
    }
    if (a.kind === 'enter' || (a.kind === 'string' && a.value.trim() === '')) {
      const e = yield* pickStyled(ctx);
      const style = e && ctx.model.tables.dimStyles.get(e.geom.style);
      return style && e ? { style, compare: false, object: e } : undefined;
    }
    if (a.kind !== 'string') return undefined;
    const typed = a.value.trim();
    const compare = typed.startsWith('~');
    const name = compare ? typed.slice(1) : typed;
    const style = styleNamed(ctx.model, name);
    if (style) return { style, compare };
    ctx.message(`Dimension style ${name} not found.`);
  }
}

/** Save: the current settings as a style, new or redefined, made current. */
async function* save(ctx: CommandContext, current: DimStyleRecord): Sub<ChangeSet[]> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter name for new dimension style',
      options: ['?'],
    });
    if (a.kind === 'keyword') {
      yield* listStyles(ctx);
      continue;
    }
    if (a.kind !== 'string' || a.value.trim() === '') return [];
    const name = a.value.trim();
    const vars = currentSettings(ctx.model, current);
    const existing = styleNamed(ctx.model, name);
    if (!existing) {
      const problem = nameProblem(ctx.model, name);
      if (problem) {
        ctx.message(problem);
        continue;
      }
      dimStyleAct(ctx, { op: 'new', name, from: current.name, vars });
      dimStyleAct(ctx, { op: 'current', name });
      return [];
    }
    if (existing.name.includes('$')) {
      ctx.message('Invalid dimension style name.');
      continue;
    }
    const y = yield ctx.prompt.keyword({
      message: 'That name is already in use, redefine it?',
      options: ['Yes', 'No'],
      default: { kind: 'keyword', keyword: 'No' },
    });
    if (y.kind !== 'keyword' || y.keyword !== 'Yes') return [];
    const modified = dimStyleAct(ctx, { op: 'modify', name: existing.name, vars });
    dimStyleAct(ctx, { op: 'current', name: existing.name });
    return modified.restyled ? [modified.restyled] : [];
  }
}

/** Apply: the selected objects take the current style and settings. */
function apply(
  ctx: CommandContext,
  current: DimStyleRecord,
  ids: readonly EntityId[],
): ChangeSet[] {
  const model = ctx.model;
  const acad = acadAppId(model);
  const overrides = headerDimvarOverrides(model, current);
  const targets = ids.map((id) => model.entity(id)).filter(isStyled);
  if (targets.length === 0) return [];
  const cs = ctx.edit((b) => {
    for (const e of targets) {
      let xdata = withoutOverrides(e.xdata, acad);
      for (const [name, value] of Object.entries(overrides)) {
        const next = withDimvarOverride(xdata ? { xdata } : {}, current.handle, model, name, value);
        if (next !== 'no-acad') xdata = next;
      }
      b.updateEntity(e.id, { geom: { ...e.geom, style: current.handle } as Entity['geom'], xdata });
    }
  });
  return [cs];
}

/** -DIMSTYLE: dimension styles at the command line. */
export function dashDimstyleCommand(): CommandDef {
  return {
    name: '-DIMSTYLE',
    usesSelection: 'none',
    async *run(ctx) {
      const current = currentDimStyle(ctx.model);
      if (!current) {
        ctx.message('The drawing has no dimension style.');
        return;
      }
      ctx.message(`Current dimension style: ${current.name}`);
      const a: PromptAnswer = yield ctx.prompt.keyword({
        message: 'Enter a dimension style option',
        options: OPTIONS,
        default: { kind: 'keyword', keyword: 'Restore' },
      });
      if (a.kind !== 'keyword') return;
      let changes: ChangeSet[] = [];
      switch (a.keyword) {
        case 'Save':
          changes = yield* save(ctx, current);
          break;
        case 'Restore': {
          const got = yield* askStyle(ctx);
          if (!got) return;
          if (got.compare) listDifferences(ctx, got.style, currentSettings(ctx.model, current));
          else if (got.style.name.includes('$')) ctx.message('Invalid dimension style name.');
          else dimStyleAct(ctx, { op: 'current', name: got.style.name });
          break;
        }
        case 'STatus':
          list(ctx, currentSettings(ctx.model, current));
          break;
        case 'Variables': {
          const got = yield* askStyle(ctx);
          if (!got) return;
          if (got.compare) listDifferences(ctx, got.style, currentSettings(ctx.model, current));
          else
            list(
              ctx,
              got.object ? objectSettings(ctx.model, got.object) : styleVars(ctx.model, got.style),
            );
          break;
        }
        case 'Apply': {
          const s = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
          if (s.kind !== 'selection') return;
          changes = apply(ctx, current, s.ids);
          break;
        }
        case '?':
          yield* listStyles(ctx);
          break;
      }
      if (changes.length > 0) await regenerateRestyled(ctx, changes);
    },
  };
}
