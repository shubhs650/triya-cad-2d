// LINETYPE, -LINETYPE and LTSCALE (M5-08; COMMANDS.md "Properties"), as AutoCAD 2024's (AutoCAD
// Help, "LINETYPE (Command)", "Linetype Manager", "Load or Reload Linetypes Dialog Box",
// "-LINETYPE (Command)", "LTSCALE (Command)"), aliases LT and LTYPE, LTS:
//
//   - LINETYPE opens the Linetype Manager (`LinetypeRequest`): the drawing's linetypes with
//     their appearance and description, which are used, Load... (the app's Load or Reload
//     Linetypes dialog, reading the bundled set and the user's .lin files), Delete, Current and
//     the details (Global scale factor LTSCALE, Current object scale CELTSCALE, Use paper space
//     units for scaling PSLTSCALE). OK makes the changes as one LINETYPE undo step.
//   - -LINETYPE: "Enter an option [?/Load/Set]". ? lists a file's linetypes, Load loads the
//     names typed (wild cards, commas) from a file, asking "Reload it?" for each one loaded
//     already, Set makes one current (CELTYPE), loading it from the bundled file when the drawing
//     lacks it. The file is asked for at the command line ("Enter name of linetype file"), the
//     bundled triya-iso.lin by default; the app reads it (view request `linetypeFile`).
//   - -LINETYPE Create (M5-08 part 4): "Enter name of linetype to create", the file ("Enter name
//     of linetype file", one of the user's .lin files, new or kept already; the bundled files are
//     not changed), "Wish to overwrite it?" when the file defines the name already, "Descriptive
//     text" (47 characters at most) and "Enter linetype pattern (on next line):" after "A,". The
//     app checks and writes the definition (view request `linetypeCreate`); the drawing is not
//     changed, so Load loads it, as AutoCAD's Help says ("you must load it").
//   - The Linetype Manager's Details rename and describe the linetype selected (M5-08 part 4,
//     `editLinetypes`), with its other changes.
//   - LTSCALE: "Enter new linetype scale factor <current>:", then "Regenerating model.".
//   - Other... at the end of the Properties palette's Linetype list (M5-08 part 2, as the ribbon's
//     Properties panel offers it in AutoCAD 2024) opens the same Linetype Manager
//     (`otherLinetype`); its OK also gives the linetype highlighted to the objects the palette
//     shows, or makes it current with none, all in the palette's one PROPERTIES undo step.
//
// AutoCAD's Help gives no wording for -LINETYPE's reports; settled on the common drafter
// expectation (noted in the PR): "Linetype X loaded.", "Linetype X is already loaded.  Reload
// it?", "Linetype X reloaded.", "Linetype X not found in <file>.", and why a definition stays
// out.
import type { ChangeSetBuilder } from '../model/builder';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { EntityType, LinetypeElement } from '../model/types';
import {
  currentLinetypeName,
  deleteLinetypes,
  editLinetypes,
  isFixedLinetype,
  isXrefLinetype,
  LINETYPE_DESCRIPTION_MAX,
  linetypeNameProblem,
  linetypeNamed,
  linetypesInUse,
  loadLinetypes,
  type LinetypeDefinition,
  type LinetypeEdit,
  type LinetypeLoadReport,
} from '../edit/linetypes';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import { wcmatch } from './modify/attributes';
import { applyProperty } from './modify/property-edit';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The bundled linetype file, which -LINETYPE offers first (AutoCAD's acad.lin / acadiso.lin). */
export const BUNDLED_LINETYPE_FILE = 'triya-iso.lin';

/** One linetype as the Linetype Manager lists it. */
export interface LinetypeRow {
  readonly handle: Handle;
  readonly name: string;
  readonly description: string;
  readonly elements: readonly LinetypeElement[];
  /** Xref-dependent (listed with Show all Xref dependent linetypes, never deleted). */
  readonly xref: boolean;
  /** Referenced by an object, a layer, a style or CELTYPE: not deleted. */
  readonly used: boolean;
}

/** LINETYPE's Linetype Manager, opened on the drawing's linetypes and scales. */
export interface LinetypeRequest {
  readonly type: 'linetype';
  /** ByLayer and ByBlock first, then the others by name. */
  readonly linetypes: readonly LinetypeRow[];
  /** CELTYPE: ByLayer, ByBlock or a linetype's name. */
  readonly current: string;
  /** LTSCALE, CELTSCALE and PSLTSCALE. */
  readonly ltscale: number;
  readonly celtscale: number;
  readonly psltscale: boolean;
  /**
   * Opened by the Properties palette's Other... (M5-08 part 2): OK also applies the linetype
   * highlighted (`LinetypeAnswer.apply`), to the objects the palette shows or, with none, as the
   * current linetype.
   */
  readonly apply?: true;
}

/** What the Linetype Manager's OK changes; absent fields stay as they are. */
export interface LinetypeAnswer {
  /** Linetypes the Load dialog loaded (or reloaded, where the drafter said so). */
  readonly load?: readonly LinetypeDefinition[];
  /**
   * Linetypes renamed or described in Details (M5-08 part 4), of those the drawing had; one
   * loaded in the dialog comes renamed in `load`.
   */
  readonly edit?: readonly LinetypeEdit[];
  /** Linetypes Delete took (of those the drawing had). */
  readonly delete?: readonly Handle[];
  /** The linetype Current set, by name. */
  readonly current?: string;
  readonly ltscale?: number;
  readonly celtscale?: number;
  readonly psltscale?: boolean;
  /** Other... (`LinetypeRequest.apply`): the linetype, by name, the palette's objects take. */
  readonly apply?: string;
}

const upper = (s: string) => s.toUpperCase();

/** The Linetype Manager's rows: ByLayer, ByBlock, then the others by name (Continuous among them). */
export function linetypeRows(ctx: Pick<CommandContext, 'model'>): LinetypeRow[] {
  const used = linetypesInUse(ctx.model);
  const order = (name: string) =>
    upper(name) === 'BYLAYER' ? 0 : upper(name) === 'BYBLOCK' ? 1 : 2;
  return [...ctx.model.tables.linetypes.values()]
    .map((l) => ({
      handle: l.handle,
      name: l.name,
      description: l.description,
      elements: l.elements,
      xref: isXrefLinetype(l),
      used: used.has(l.handle),
    }))
    .sort(
      (a, b) =>
        order(a.name) - order(b.name) ||
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    );
}

const numberOf = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;

/**
 * CELTYPE set to `name`: ByLayer and ByBlock as the drawing spells them, else a linetype it has
 * or one `loaded` in the same step.
 */
function setCurrent(
  b: ChangeSetBuilder,
  ctx: CommandContext,
  name: string,
  loaded: readonly string[] = [],
): boolean {
  const record = linetypeNamed(ctx.model, name)?.name;
  const fresh = loaded.find((n) => upper(n) === upper(name));
  const by = upper(name) === 'BYLAYER' ? 'ByLayer' : upper(name) === 'BYBLOCK' ? 'ByBlock' : '';
  // A name loaded or given in the same step wins over one the drawing has (a swap of names).
  const set = fresh ?? record ?? by;
  if (set === '') return false;
  b.setHeader('$CELTYPE', set);
  return true;
}

function reportLoad(ctx: CommandContext, r: LinetypeLoadReport): void {
  for (const n of r.loaded) ctx.message(`Linetype ${n} loaded.`);
  for (const n of r.reloaded) ctx.message(`Linetype ${n} reloaded.`);
  for (const f of r.refused) ctx.message(`Linetype ${f.name} not loaded: ${f.reason}.`);
}

/** Applies the Linetype Manager's OK, in the command's undo step. */
function applyManager(ctx: CommandContext, a: LinetypeAnswer): void {
  const header = ctx.model.header;
  let load: LinetypeLoadReport | undefined;
  let removed: { deleted: readonly string[]; refused: readonly string[] } | undefined;
  let unknown: string | undefined;
  let edited: ReturnType<typeof editLinetypes> | undefined;
  const ltscale = a.ltscale !== undefined && a.ltscale > 0 ? a.ltscale : undefined;
  const celtscale = a.celtscale !== undefined && a.celtscale > 0 ? a.celtscale : undefined;
  const changes =
    (a.load?.length ?? 0) > 0 ||
    (a.edit?.length ?? 0) > 0 ||
    (a.delete?.length ?? 0) > 0 ||
    (a.current !== undefined && upper(a.current) !== upper(currentLinetypeName(ctx.model))) ||
    (ltscale !== undefined && ltscale !== numberOf(header.get('$LTSCALE'), 1)) ||
    (celtscale !== undefined && celtscale !== numberOf(header.get('$CELTSCALE'), 1)) ||
    (a.psltscale !== undefined && a.psltscale !== (header.get('$PSLTSCALE') !== 0));
  if (!changes) return;
  ctx.edit((b) => {
    if (a.load?.length) load = loadLinetypes(b, ctx.model, a.load);
    // Names as the step leaves them: Details' renames (CELTYPE follows one), then Current.
    const renamed = new Map<string, string>();
    if (a.edit?.length) {
      edited = editLinetypes(b, ctx.model, a.edit, load?.loaded);
      for (const r of edited.renamed) renamed.set(upper(r.to), r.from);
    }
    // Current goes first: a linetype made current is not deleted, and one no longer current is.
    let current = currentLinetypeName(ctx.model);
    if (a.current !== undefined && upper(a.current) !== upper(current)) {
      const fresh = [...(load?.loaded ?? []), ...(edited?.renamed.map((r) => r.to) ?? [])];
      if (setCurrent(b, ctx, a.current, fresh)) current = a.current;
      else unknown = a.current;
    }
    // Delete judges by the drawing's names: a renamed current linetype by its old name.
    const currentWas = renamed.get(upper(current)) ?? current;
    if (a.delete?.length) removed = deleteLinetypes(b, ctx.model, a.delete, currentWas);
    if (ltscale !== undefined && ltscale !== numberOf(header.get('$LTSCALE'), 1))
      b.setHeader('$LTSCALE', ltscale);
    if (celtscale !== undefined && celtscale !== numberOf(header.get('$CELTSCALE'), 1))
      b.setHeader('$CELTSCALE', celtscale);
    if (a.psltscale !== undefined && a.psltscale !== (header.get('$PSLTSCALE') !== 0))
      b.setHeader('$PSLTSCALE', a.psltscale ? 1 : 0);
  });
  if (load)
    for (const f of load.refused) ctx.message(`Linetype ${f.name} not loaded: ${f.reason}.`);
  for (const why of edited?.refused ?? []) ctx.message(why);
  if (unknown !== undefined) ctx.message(`Linetype ${unknown} not found.`);
  for (const why of removed?.refused ?? []) ctx.message(`${why} It was not deleted.`);
}

/** A linetype file read by the app: its name as found and its definitions, or undefined. */
async function readFile(
  ctx: CommandContext,
  file: string | undefined,
): Promise<{ name: string; linetypes: readonly LinetypeDefinition[] } | undefined> {
  const r = await ctx.view.request({ op: 'linetypeFile', ...(file ? { file } : {}) });
  if (!r.ok) {
    ctx.message(r.message);
    return undefined;
  }
  if (!r.linetypeFile) {
    ctx.message(`Linetype file ${file ?? BUNDLED_LINETYPE_FILE} not found.`);
    return undefined;
  }
  return r.linetypeFile;
}

/** "Enter name of linetype file <triya-iso.lin>:", read by the app. */
async function* askFile(
  ctx: CommandContext,
): Sub<{ name: string; linetypes: readonly LinetypeDefinition[] } | undefined> {
  const a = yield ctx.prompt.string({
    message: 'Enter name of linetype file',
    defaultLabel: BUNDLED_LINETYPE_FILE,
    spaces: true,
  });
  if (a.kind !== 'string' && a.kind !== 'enter') return undefined;
  const name = a.kind === 'string' && a.value.trim() !== '' ? a.value.trim() : undefined;
  return readFile(ctx, name);
}

async function* dashList(ctx: CommandContext): Sub<void> {
  const file = yield* askFile(ctx);
  if (!file) return;
  const p = yield ctx.prompt.string({
    message: 'Enter linetype(s) to list',
    default: { kind: 'string', value: '*' },
  });
  const patterns = p.kind === 'string' && p.value.trim() !== '' ? p.value.trim() : '*';
  ctx.message(`Linetypes defined in file ${file.name}:`);
  ctx.message(`${'Name'.padEnd(24)}Description`);
  for (const l of file.linetypes)
    if (wcmatch(l.name, patterns)) ctx.message(`${l.name.padEnd(24)}${l.description}`);
}

async function* dashLoad(ctx: CommandContext): Sub<void> {
  const n = yield ctx.prompt.string({ message: 'Enter linetype(s) to load' });
  if (n.kind !== 'string' || n.value.trim() === '') return;
  const patterns = n.value.trim();
  const file = yield* askFile(ctx);
  if (!file) return;
  const found = file.linetypes.filter((l) => wcmatch(l.name, patterns));
  if (found.length === 0) {
    ctx.message(`Linetype ${patterns} not found in ${file.name}.`);
    return;
  }
  const reload = new Set<string>();
  for (const l of found) {
    const had = linetypeNamed(ctx.model, l.name);
    if (!had || isXrefLinetype(had)) continue;
    const a = yield ctx.prompt.keyword({
      message: `Linetype ${had.name} is already loaded.  Reload it?`,
      options: ['Yes', 'No'],
      default: { kind: 'keyword', keyword: 'Yes' },
    });
    if (a.kind !== 'keyword') return;
    if (a.keyword === 'Yes') reload.add(upper(had.name));
  }
  let report: LinetypeLoadReport | undefined;
  const loads = found.filter((l) => !linetypeNamed(ctx.model, l.name) || reload.has(upper(l.name)));
  const refusedOnly = loads.length === 0;
  if (refusedOnly) return;
  ctx.edit((b) => {
    report = loadLinetypes(b, ctx.model, loads, (name) => reload.has(upper(name)));
  });
  reportLoad(ctx, report!);
}

async function* dashSet(ctx: CommandContext): Sub<void> {
  for (;;) {
    const current = currentLinetypeName(ctx.model);
    const a = yield ctx.prompt.string({
      message: 'Specify linetype name or [?]',
      defaultLabel: current,
      spaces: true,
    });
    if (a.kind !== 'string' || a.value.trim() === '') return;
    const name = a.value.trim();
    if (name === '?') {
      const p = yield ctx.prompt.string({
        message: 'Enter linetype(s) to list',
        default: { kind: 'string', value: '*' },
      });
      const patterns = p.kind === 'string' && p.value.trim() !== '' ? p.value.trim() : '*';
      for (const r of linetypeRows(ctx))
        if (wcmatch(r.name, patterns)) ctx.message(`${r.name.padEnd(24)}${r.description}`);
      continue;
    }
    if (linetypeNamed(ctx.model, name) || /^by(layer|block)$/i.test(name)) {
      ctx.edit((b) => setCurrent(b, ctx, name));
      return;
    }
    // AutoCAD looks for a linetype it lacks in its own file and loads it.
    const file = await readFile(ctx, undefined);
    const def = file?.linetypes.find((l) => upper(l.name) === upper(name));
    if (!def) {
      ctx.message(`Linetype ${name} not found.  Use the Load option to load it.`);
      continue;
    }
    let report: LinetypeLoadReport | undefined;
    ctx.edit((b) => {
      report = loadLinetypes(b, ctx.model, [def]);
      if (report.loaded.length > 0) setCurrent(b, ctx, def.name, report.loaded);
    });
    reportLoad(ctx, report!);
    return;
  }
}

/** The file -LINETYPE Create offers (AutoCAD offers acad.lin; Triya's own files stay as shipped). */
export const CREATE_LINETYPE_FILE = 'custom.lin';

async function* dashCreate(ctx: CommandContext): Sub<void> {
  const n = yield ctx.prompt.string({ message: 'Enter name of linetype to create' });
  if (n.kind !== 'string' || n.value.trim() === '') return;
  const name = n.value.trim();
  if (isFixedLinetype(name)) {
    ctx.message(`${name} is a reserved linetype name.`);
    return;
  }
  const bad = linetypeNameProblem(name);
  if (bad) {
    ctx.message(bad);
    return;
  }
  const f = yield ctx.prompt.string({
    message: 'Enter name of linetype file',
    defaultLabel: CREATE_LINETYPE_FILE,
    spaces: true,
  });
  if (f.kind !== 'string' && f.kind !== 'enter') return;
  const typed =
    f.kind === 'string' && f.value.trim() !== '' ? f.value.trim() : CREATE_LINETYPE_FILE;
  const asked = /\.lin$/i.test(typed) ? typed : `${typed}.lin`;
  const r = await ctx.view.request({ op: 'linetypeFile', file: asked });
  if (!r.ok) {
    ctx.message(r.message);
    return;
  }
  const file = r.linetypeFile?.name ?? asked;
  if (r.linetypeFile?.bundled) {
    ctx.message(`${file} is bundled with Triya and cannot be changed.`);
    return;
  }
  const had = r.linetypeFile?.linetypes.find((l) => upper(l.name) === upper(name));
  if (had) {
    const o = yield ctx.prompt.keyword({
      message: `Linetype ${had.name} already exists in ${file}.  Overwrite it?`,
      options: ['Yes', 'No'],
      default: { kind: 'keyword', keyword: 'No' },
    });
    if (o.kind !== 'keyword' || o.keyword !== 'Yes') return;
  }
  let description: string;
  for (;;) {
    const d = yield ctx.prompt.string({ message: 'Descriptive text', spaces: true });
    if (d.kind !== 'string' && d.kind !== 'enter') return;
    description = d.kind === 'string' ? d.value.trim() : '';
    if (description.length <= LINETYPE_DESCRIPTION_MAX) break;
    ctx.message(`A description cannot exceed ${LINETYPE_DESCRIPTION_MAX} characters.`);
  }
  ctx.message('Enter linetype pattern (on next line):');
  const p = yield ctx.prompt.string({ message: 'A,', spaces: true });
  if (p.kind !== 'string' || p.value.trim() === '') return;
  // "A," is written already; a drafter typing it again means the same pattern.
  const pattern = `A,${p.value.trim().replace(/^a\s*,/i, '')}`;
  const w = await ctx.view.request({ op: 'linetypeCreate', file, name, description, pattern });
  if (!w.ok) {
    ctx.message(w.message);
    return;
  }
  ctx.message(`New linetype definition saved to file ${w.linetypeFile?.name ?? file}.`);
}

async function* dashLinetype(ctx: CommandContext): Sub<void> {
  for (;;) {
    ctx.message(`Current line type:  "${currentLinetypeName(ctx.model)}"`);
    const a = yield ctx.prompt.keyword({
      message: 'Enter an option',
      options: ['?', 'Create', 'Load', 'Set'],
    });
    if (a.kind !== 'keyword') return;
    if (a.keyword === '?') yield* dashList(ctx);
    else if (a.keyword === 'Create') yield* dashCreate(ctx);
    else if (a.keyword === 'Load') yield* dashLoad(ctx);
    else yield* dashSet(ctx);
  }
}

/** The Linetype Manager's request on the drawing as it is. */
function managerRequest(ctx: CommandContext, apply = false): LinetypeRequest {
  const h = ctx.model.header;
  return {
    type: 'linetype',
    linetypes: linetypeRows(ctx),
    current: currentLinetypeName(ctx.model),
    ltscale: numberOf(h.get('$LTSCALE'), 1),
    celtscale: numberOf(h.get('$CELTSCALE'), 1),
    psltscale: h.get('$PSLTSCALE') !== 0,
    ...(apply && { apply: true as const }),
  };
}

/**
 * The Properties palette's Other... (M5-08 part 2): the Linetype Manager, whose OK makes its
 * changes and then gives the linetype highlighted to `ids` (of the type `filter`), or makes it
 * current with none, as the palette's Linetype list does. A linetype loaded in the dialog is in
 * the drawing by then, so the objects name the new record.
 */
export async function* otherLinetype(
  ctx: CommandContext,
  ids: readonly EntityId[],
  filter: EntityType | undefined,
): Sub<void> {
  const a = yield ctx.prompt.dialog({
    message: 'Linetype Manager',
    dialog: managerRequest(ctx, true),
  });
  if (a.kind !== 'dialog' || a.action !== 'ok' || !a.linetype) return;
  applyManager(ctx, a.linetype);
  const name = a.linetype.apply;
  if (name === undefined) return;
  // The palette's options: ByLayer and ByBlock by name, the others by their record's handle.
  const by = upper(name) === 'BYLAYER' ? 'ByLayer' : upper(name) === 'BYBLOCK' ? 'ByBlock' : '';
  const value = by || linetypeNamed(ctx.model, name)?.handle;
  if (value === undefined) {
    ctx.message(`Linetype ${name} not found.`);
    return;
  }
  await applyProperty(ctx, ids, { key: 'linetype', value }, filter);
}

/** LINETYPE (and -LINETYPE), with AutoCAD's aliases LT and LTYPE. */
export function linetypeCommand(): CommandDef {
  return {
    name: 'LINETYPE',
    dashVariant: true,
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      if (ctx.dash) {
        yield* dashLinetype(ctx);
        return;
      }
      const a = yield ctx.prompt.dialog({
        message: 'Linetype Manager',
        dialog: managerRequest(ctx),
      });
      if (a.kind !== 'dialog' || a.action !== 'ok' || !a.linetype) return;
      applyManager(ctx, a.linetype);
    },
  };
}

/** "Value must be positive and nonzero." (LTSCALE's range, as SETVAR words it). */
const NOT_POSITIVE = 'Value must be positive and nonzero.';

/** LTSCALE (LTS): the global linetype scale factor. */
export function ltscaleCommand(): CommandDef {
  return {
    name: 'LTSCALE',
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      for (;;) {
        const current = numberOf(ctx.model.header.get('$LTSCALE'), 1);
        const a = yield ctx.prompt.real({
          message: 'Enter new linetype scale factor',
          defaultLabel: current.toFixed(4),
        });
        if (a.kind !== 'number') return;
        if (!(a.value > 0)) {
          ctx.message(NOT_POSITIVE);
          continue;
        }
        if (a.value !== current) ctx.edit((b) => b.setHeader('$LTSCALE', a.value));
        ctx.message('Regenerating model.');
        return;
      }
    },
  };
}
