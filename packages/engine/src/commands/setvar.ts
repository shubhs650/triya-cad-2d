// SETVAR (M2-42), and a system variable's name typed at `Command:`, with AutoCAD 2024's prompts
// (AutoCAD 2024 Help, "SETVAR (Command)"):
//   Enter variable name or [?] <LTSCALE>:        (the default is the variable SETVAR last took)
//   Enter new value for MIRRTEXT <0>:            (Enter keeps it; a bad value asks again)
//   DWGCODEPAGE = "ANSI_1252" (read only)
//   Enter variable(s) to list <*>:               (?: wild-card names, as WCMATCH takes them)
// Which variables there are and where each is kept is `sysvars.ts`'s.
import type { Vec2 } from '../geom/types';
import type { HeaderValue, WipeoutFrame } from '../model/types';
import type { CommandContext, CommandDef } from './command';
import { setWipeoutFrame, wipeoutFrame } from './draw/wipeout';
import { wcmatch } from './modify/attributes';
import type { Prompt, PromptAnswer } from './prompt';
import { modelSpaceOf } from './bus';
import {
  annotationScaleValue,
  calendarDate,
  dictionaryTwin,
  formatValue,
  headerEntry,
  headerValue,
  julianDate,
  parseValue,
  systemVariable,
  systemVariables,
  type SystemVariable,
  type VariableValue,
} from './sysvars';
import { drawingUnits } from './units';
import { currentVport, snapGridOf, snapGridPatch, snapGridProblem } from '../edit/snap-grid';
import type { VportRecord } from '../model/types';
import { inquiryResults } from './inquiry/inquiry';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

export const UNKNOWN_VARIABLE = 'Unknown variable name.  Type SETVAR ? for a list of variables.';

/** What a variable holds now, or the reason it cannot be read (no app to ask). */
async function read(
  ctx: CommandContext,
  v: SystemVariable,
): Promise<{ value: VariableValue } | { problem: string }> {
  switch (v.store) {
    case 'header':
      return { value: headerValue(v, ctx.model.header.get(v.key!) ?? v.initial!) };
    case 'wipeout':
      return { value: wipeoutFrame(ctx.model) };
    case 'app': {
      const r = await ctx.view.request({ op: 'sysvar', name: v.name });
      if (!r.ok) return { problem: r.message };
      return r.value === undefined ? { problem: `${v.name} has no value.` } : { value: r.value };
    }
    case 'computed':
      return computed(ctx, v.name);
    case 'vport': {
      const vport = currentVport(ctx.model);
      if (!vport) return { problem: noVport(v) };
      return { value: vportValue(vport, v.name) };
    }
  }
}

const noVport = (v: SystemVariable) => `The drawing has no current viewport to keep ${v.name} in.`;

/** A `VPORT_VARIABLES` variable as the `*Active` VPORT holds it. */
function vportValue(vport: VportRecord, name: string): VariableValue {
  switch (name) {
    case 'SNAPUNIT':
      return { x: vport.snapSpacing.x, y: vport.snapSpacing.y };
    case 'GRIDUNIT':
      return { x: vport.gridSpacing.x, y: vport.gridSpacing.y };
    case 'SNAPBASE':
      return { x: vport.snapBase.x, y: vport.snapBase.y };
    case 'GRIDMAJOR':
      return vport.gridMajor;
    case 'SNAPANG':
      // Shown in degrees, as SETVAR shows the header's angles.
      return (vport.snapRotation * 180) / Math.PI;
    case 'UCSICON':
      return vport.ucsIcon;
    default:
      return vport.gridFlags;
  }
}

/**
 * Sets a `VPORT_VARIABLES` variable in the `*Active` VPORT, one undo step; the Snap and Grid
 * tab's checks refuse what it would refuse (a typed point is not checked on the way here).
 */
function writeVport(ctx: CommandContext, v: SystemVariable, value: VariableValue): void {
  const vport = currentVport(ctx.model);
  if (!vport) {
    ctx.message(noVport(v));
    return;
  }
  // SNAPANG (radians, finite) and UCSICON (0–3, which the variable's range checked) are
  // patched as they are (M3-06 part 7).
  if (v.name === 'SNAPANG' || v.name === 'UCSICON') {
    const n = v.name === 'SNAPANG' ? ((value as number) * Math.PI) / 180 : (value as number);
    if (!Number.isFinite(n)) return;
    const patch = v.name === 'SNAPANG' ? { snapRotation: n } : { ucsIcon: n };
    if ((v.name === 'SNAPANG' ? vport.snapRotation : vport.ucsIcon) === n) return;
    ctx.edit((b) => b.updateTableRecord('vports', vport.handle, patch));
    return;
  }
  if (v.name === 'SNAPBASE') {
    const p = value as Vec2;
    if (!(Number.isFinite(p.x) && Number.isFinite(p.y))) return;
    if (p.x === vport.snapBase.x && p.y === vport.snapBase.y) return;
    ctx.edit((b) => b.updateTableRecord('vports', vport.handle, { snapBase: { x: p.x, y: p.y } }));
    return;
  }
  const now = snapGridOf(vport);
  const point = (p: VariableValue) => ({ x: (p as Vec2).x, y: (p as Vec2).y });
  const settings = {
    ...now,
    ...(v.name === 'SNAPUNIT' && { snapSpacing: point(value) }),
    ...(v.name === 'GRIDUNIT' && { gridSpacing: point(value) }),
    ...(v.name === 'GRIDMAJOR' && { gridMajor: value as number }),
    ...(v.name === 'GRIDDISPLAY' && { gridDisplay: value as number }),
  };
  const problem = snapGridProblem(settings);
  if (problem) {
    ctx.message(problem);
    return;
  }
  const patch = snapGridPatch(vport, settings);
  if (patch) ctx.edit((b) => b.updateTableRecord('vports', vport.handle, patch));
}

/** A variable the engine works out (`COMPUTED_VARIABLES`). */
async function computed(
  ctx: CommandContext,
  name: string,
): Promise<{ value: VariableValue } | { problem: string }> {
  switch (name) {
    case 'DATE':
      return { value: julianDate(ctx.clock.now()) };
    case 'CDATE':
      return { value: calendarDate(ctx.clock.now()) };
    case 'CTAB':
      return { value: shownLayout(ctx)?.name ?? 'Model' };
    case 'TILEMODE':
      return { value: ctx.space === modelSpaceOf(ctx.model) ? 1 : 0 };
    case 'AREA':
      return { value: inquiryResults(ctx.model).area };
    case 'PERIMETER':
      return { value: inquiryResults(ctx.model).perimeter };
    case 'DISTANCE':
      return { value: inquiryResults(ctx.model).distance };
    default: {
      // VIEWSIZE and VIEWCTR: the view the canvas shows; SCREENSIZE: its size in pixels, X and Y.
      const r = await ctx.view.request({ op: 'get' });
      if (!r.ok) return { problem: r.message };
      if (name === 'SCREENSIZE') {
        return r.screen
          ? { value: { x: r.screen.width, y: r.screen.height } }
          : { problem: 'No view is shown.' };
      }
      if (!r.view) return { problem: 'No view is shown.' };
      const { center, height } = r.view;
      return { value: name === 'VIEWSIZE' ? height : { x: center.x, y: center.y, z: 0 } };
    }
  }
}

/** The layout of the space commands draw in: the tab shown. */
function shownLayout(ctx: CommandContext) {
  return ctx.model.layouts.find((l) => l.blockRecord === ctx.space);
}

/**
 * CTAB or TILEMODE set (M2-59 part 5): the app shows the tab, unless it shows it already. The
 * Model tab is the layout of model space; TILEMODE 0 is the layout tab the app showed last.
 */
async function showTab(ctx: CommandContext, name: string, value: VariableValue): Promise<void> {
  const model = ctx.model.layouts.find((l) => l.blockRecord === modelSpaceOf(ctx.model));
  const shown = shownLayout(ctx)?.name ?? model?.name;
  let request: { name?: string };
  if (name === 'CTAB') {
    if (value === shown) return;
    request = { name: String(value) };
  } else {
    const onModel = ctx.space === modelSpaceOf(ctx.model);
    if ((value === 1) === onModel) return;
    request = value === 1 ? { name: model?.name ?? 'Model' } : {};
  }
  const r = await ctx.view.request({ op: 'tab', ...request });
  if (!r.ok) ctx.message(r.message);
}

/** Sets a variable to a value `parseValue` took. */
async function write(ctx: CommandContext, v: SystemVariable, value: VariableValue): Promise<void> {
  switch (v.store) {
    case 'header': {
      const key = v.key!;
      const was = ctx.model.header.get(key) ?? v.initial;
      const next = headerEntry(v, value, was);
      const entries: [string, HeaderValue][] = [];
      if (JSON.stringify(next) !== JSON.stringify(was)) entries.push([key, next]);
      // The DICTIONARYVAR beside a HEADER variable follows it (M2-59 part 4).
      const twin = dictionaryTwin(ctx.model, v);
      if (twin) {
        const before = ctx.model.header.get(twin.key!);
        const after = headerEntry(twin, value, before);
        if (after !== before) entries.push([twin.key!, after]);
      }
      // CANNOSCALEVALUE is the CANNOSCALE scale's value ("Returns the value of the current
      // annotation scale"): it follows in the same undo step.
      const ratio =
        key === 'CANNOSCALE' ? annotationScaleValue(ctx.model, String(next)) : undefined;
      if (ratio !== undefined && entries.length > 0) entries.push(['CANNOSCALEVALUE', ratio]);
      if (entries.length > 0) ctx.edit((b) => entries.forEach(([k, e]) => b.setHeader(k, e)));
      return;
    }
    case 'wipeout':
      setWipeoutFrame(ctx, value as WipeoutFrame);
      return;
    case 'app': {
      const r = await ctx.view.request(
        typeof value === 'string'
          ? { op: 'sysvar', name: v.name, text: value }
          : { op: 'sysvar', name: v.name, value: value as number },
      );
      if (!r.ok) ctx.message(r.message);
      return;
    }
    case 'computed':
      return showTab(ctx, v.name, value);
    case 'vport':
      return writeVport(ctx, v, value);
  }
}

/** "Enter new value for X <current>:" until a value is taken or Enter keeps the current one. */
async function* setValue(ctx: CommandContext, v: SystemVariable): Sub<void> {
  const current = await read(ctx, v);
  if ('problem' in current) {
    ctx.message(current.problem);
    return;
  }
  const shown = formatValue(v, current.value, drawingUnits(ctx.model.header));
  if (v.readOnly) {
    ctx.message(`${v.name} = ${shown} (read only)`);
    return;
  }
  // The tab shown is the space the command running draws in, so it stays while one runs.
  // AutoCAD's documentation does not say whether 'CTAB may switch tabs inside a command; Triya
  // keeps the space a command started in, as its prompts and osnaps assume it.
  if (v.store === 'computed' && ctx.transparent) {
    ctx.message(`${v.name} = ${shown} (read only while a command runs)`);
    return;
  }
  const message = `Enter new value for ${v.name}`;
  for (;;) {
    const a: PromptAnswer = yield v.kind === 'point'
      ? ctx.prompt.point({ message, defaultLabel: shown })
      : ctx.prompt.string({
          message,
          defaultLabel: shown,
          ...((v.kind === 'text' || v.kind === 'name') && { spaces: true }),
        });
    if (a.kind === 'point') {
      const p: Vec2 = a.point;
      await write(ctx, v, { x: p.x, y: p.y });
      return;
    }
    if (a.kind !== 'string') return; // Enter keeps the value
    const parsed = parseValue(ctx.model, v, a.value);
    if ('problem' in parsed) {
      ctx.message(parsed.problem);
      continue;
    }
    await write(ctx, v, parsed.value);
    return;
  }
}

/** SETVAR ?: the variables whose names match the patterns, with their values. */
async function* list(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({
    message: 'Enter variable(s) to list',
    default: { kind: 'string', value: '*' },
  });
  const patterns = a.kind === 'string' && a.value.trim() !== '' ? a.value.trim() : '*';
  const f = drawingUnits(ctx.model.header);
  for (const v of systemVariables(ctx.model)) {
    if (!wcmatch(v.name, patterns)) continue;
    const r = await read(ctx, v);
    // A variable the app keeps is left out where no app answers (scripts, tests).
    if ('problem' in r) continue;
    const line = `${v.name.padEnd(18)}${formatValue(v, r.value, f)}`;
    ctx.message(v.readOnly ? `${line.padEnd(35)} (read only)` : line);
  }
}

/** SETVAR: per drawing, it remembers the last variable it took as its default. */
export function setvarCommand(): CommandDef {
  let last: string | undefined;
  return {
    name: 'SETVAR',
    transparent: true,
    usesSelection: 'none',
    async *run(ctx) {
      const a = yield ctx.prompt.string({
        message: 'Enter variable name or',
        options: ['?'],
        ...(last !== undefined && { default: { kind: 'string', value: last } }),
      });
      if (a.kind === 'keyword') return yield* list(ctx);
      if (a.kind !== 'string') return;
      const v = systemVariable(ctx.model, a.value);
      if (!v) {
        ctx.message(UNKNOWN_VARIABLE);
        return;
      }
      last = v.name;
      yield* setValue(ctx, v);
    },
  };
}

/**
 * A system variable's name typed at `Command:` (or transparently, `'ORTHOMODE`): its value, as
 * SETVAR with that name given, which the bus starts when no command has the name.
 */
export function variableCommand(v: SystemVariable): CommandDef {
  return {
    name: v.name,
    transparent: true,
    usesSelection: 'none',
    run: (ctx) => setValue(ctx, v),
  };
}
