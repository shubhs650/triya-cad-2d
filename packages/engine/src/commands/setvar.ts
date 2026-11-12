// SETVAR (M2-42), and a system variable's name typed at `Command:`, with AutoCAD 2024's prompts
// (AutoCAD 2024 Help, "SETVAR (Command)"):
//   Enter variable name or [?] <LTSCALE>:        (the default is the variable SETVAR last took)
//   Enter new value for MIRRTEXT <0>:            (Enter keeps it; a bad value asks again)
//   DWGCODEPAGE = "ANSI_1252" (read only)
//   Enter variable(s) to list <*>:               (?: wild-card names, as WCMATCH takes them)
// Which variables there are and where each is kept is `sysvars.ts`'s.
import type { Vec2 } from '../geom/types';
import type { WipeoutFrame } from '../model/types';
import type { CommandContext, CommandDef } from './command';
import { setWipeoutFrame, wipeoutFrame } from './draw/wipeout';
import { wcmatch } from './modify/attributes';
import type { Prompt, PromptAnswer } from './prompt';
import {
  formatValue,
  headerEntry,
  headerValue,
  parseValue,
  systemVariable,
  systemVariables,
  type SystemVariable,
  type ValueFormat,
  type VariableValue,
} from './sysvars';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

export const UNKNOWN_VARIABLE = 'Unknown variable name.  Type SETVAR ? for a list of variables.';

/** LUPREC and AUPREC, as the drawing has them (AutoCAD's initial 4 and 0 otherwise). */
function valueFormat(ctx: CommandContext): ValueFormat {
  const n = (key: string, fallback: number): number => {
    const v = ctx.model.header.get(key);
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 8 ? v : fallback;
  };
  return { precision: n('$LUPREC', 4), anglePrecision: n('$AUPREC', 0) };
}

/** What a variable holds now, or the reason it cannot be read (no app to ask). */
async function read(
  ctx: CommandContext,
  v: SystemVariable,
): Promise<{ value: VariableValue } | { problem: string }> {
  switch (v.store) {
    case 'header':
      return { value: headerValue(v, ctx.model.header.get(v.key!)!) };
    case 'wipeout':
      return { value: wipeoutFrame(ctx.model) };
    case 'app': {
      const r = await ctx.view.request({ op: 'sysvar', name: v.name });
      if (!r.ok) return { problem: r.message };
      return r.value === undefined ? { problem: `${v.name} has no value.` } : { value: r.value };
    }
  }
}

/** Sets a variable to a value `parseValue` took. */
async function write(ctx: CommandContext, v: SystemVariable, value: VariableValue): Promise<void> {
  switch (v.store) {
    case 'header': {
      const key = v.key!;
      const was = ctx.model.header.get(key);
      const next = headerEntry(v, value, was);
      if (JSON.stringify(next) !== JSON.stringify(was)) ctx.edit((b) => b.setHeader(key, next));
      return;
    }
    case 'wipeout':
      setWipeoutFrame(ctx, value as WipeoutFrame);
      return;
    case 'app': {
      const r = await ctx.view.request({ op: 'sysvar', name: v.name, value: value as number });
      if (!r.ok) ctx.message(r.message);
      return;
    }
  }
}

/** "Enter new value for X <current>:" until a value is taken or Enter keeps the current one. */
async function* setValue(ctx: CommandContext, v: SystemVariable): Sub<void> {
  const current = await read(ctx, v);
  if ('problem' in current) {
    ctx.message(current.problem);
    return;
  }
  const shown = formatValue(v, current.value, valueFormat(ctx));
  if (v.readOnly) {
    ctx.message(`${v.name} = ${shown} (read only)`);
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
  const f = valueFormat(ctx);
  for (const v of systemVariables(ctx.model)) {
    if (!wcmatch(v.name, patterns)) continue;
    const r = await read(ctx, v);
    // A variable the app keeps is left out where no app answers (scripts, tests).
    if ('problem' in r) continue;
    const line = `${v.name.padEnd(18)}${formatValue(v, r.value, f)}`;
    ctx.message(v.readOnly ? `${line.padEnd(36)}(read only)` : line);
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
