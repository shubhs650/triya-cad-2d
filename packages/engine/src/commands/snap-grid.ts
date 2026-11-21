// SNAP and GRID (M3-06 part 2), on AutoCAD 2024's prompts (AutoCAD 2024 Help, "SNAP (Command)",
// "GRID (Command)"):
//   SNAP  Specify snap spacing or [ON/OFF/Aspect] <10.0000>:
//         Aspect: Specify horizontal spacing <10.0000>:  Specify vertical spacing <10.0000>:
//   GRID  Specify grid spacing(X) or [ON/OFF/Snap/Major/Aspect] <10.0000>:
//         Major: Specify the number of grid lines per major grid line <5>:
//         Aspect: Specify the horizontal spacing(X) <10.0000>:  Specify the vertical spacing(Y) …
// A spacing typed sets both X and Y and turns SNAP (or GRID) on, as AutoCAD's does; GRID takes
// `2x` for twice the snap spacing and Snap for spacing 0 (the grid follows the snap spacing).
// ON and OFF turn SNAPMODE and GRIDMODE, which the status bar shows; the spacing and Major are the
// drawing's `*Active` VPORT's (`edit/snap-grid.ts`), one undo step; in a layout they are the
// current layout viewport's, or paper space's (M6-02 part 17), and so are ON and OFF (part 19).
// SNAP's Type (M3-06 part 3): "Enter snap type [Polar/Grid] <Grid>:" sets SNAPTYPE, the app's
// per-user setting (AutoCAD keeps it in the registry), and ends the command.
// GRID's aDaptive, Limits and Follow (M3-06 part 6) set the viewport's GRIDDISPLAY bits:
//   aDaptive  Turn adaptive behavior on [Yes/No] <Yes>:
//             Allow subdivision below grid spacing [Yes/No] <Yes>:   (asked only after Yes)
//   Limits    Display grid beyond Limits [Yes/No] <Yes>:
//   Follow    Follow Dynamic UCS [Yes/No] <No>:   (kept for the file; Triya has no dynamic UCS)
// Left out: SNAP's Style (isometric snap is PRD non-goal 7, DEC-026, DEC-060) and Legacy.
// AutoCAD's command line refuses a spacing of 0 or less with "Value must be positive and
// nonzero."
import {
  GRID_DISPLAY,
  GRID_MAJOR,
  snapGridHolder,
  snapGridOf,
  snapGridPatch,
  type SnapGridHolder,
} from '../edit/snap-grid';
import type { Vec2 } from '../geom/types';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer, SnapGridSettings } from './prompt';

const NOT_POSITIVE = 'Value must be positive and nonzero.';
const NO_VPORT = 'The drawing has no current viewport to keep the spacing in.';

/**
 * SNAPMODE or GRIDMODE turned on or off in the viewport worked in, which keeps them (M6-02 part
 * 19: VPORT 75 and 76, VIEWPORT 90 bits 256 and 512); a drawing with no viewport to keep them in
 * turns the status bar's own, as F9 and F7 do.
 */
async function toggle(ctx: CommandContext, name: 'SNAPMODE' | 'GRIDMODE', on: boolean) {
  const h = holderOf(ctx);
  if (h) {
    const key = name === 'SNAPMODE' ? 'snapOn' : 'gridOn';
    if (h.state[key] !== on) ctx.edit((b) => h.write(b, { [key]: on }));
    return;
  }
  const r = await ctx.view.request({ op: 'sysvar', name, value: on ? 1 : 0 });
  if (!r.ok) ctx.message(r.message);
}

/** Where the viewport worked in keeps its snap and grid settings (M6-02 part 17). */
const holderOf = (ctx: CommandContext): SnapGridHolder | undefined =>
  snapGridHolder(ctx.model, ctx.viewport);

/** Sets `change` in the current viewport's settings; false (with a message) without one. */
function setSettings(
  ctx: CommandContext,
  change: (s: SnapGridSettings) => Partial<SnapGridSettings>,
): boolean {
  const h = holderOf(ctx);
  if (!h) {
    ctx.message(NO_VPORT);
    return false;
  }
  const s = snapGridOf(h.state);
  const patch = snapGridPatch(h.state, { ...s, ...change(s) });
  if (patch) ctx.edit((b) => h.write(b, patch));
  return true;
}

/** "Specify horizontal spacing" and "vertical spacing", each above 0 (`zero`: 0 allowed). */
async function* aspect(
  ctx: CommandContext,
  now: Vec2,
  messages: readonly [string, string],
  zero: boolean,
): AsyncGenerator<Prompt, Vec2 | undefined, PromptAnswer> {
  const values: number[] = [];
  for (const [i, message] of messages.entries()) {
    for (;;) {
      const a = yield ctx.prompt.distance({
        message,
        default: { kind: 'distance', value: i === 0 ? now.x : now.y },
      });
      if (a.kind !== 'distance') return undefined;
      if (a.value > 0 || (zero && a.value === 0)) {
        values.push(a.value);
        break;
      }
      ctx.message(NOT_POSITIVE);
    }
  }
  return { x: values[0]!, y: values[1]! };
}

/** SNAP Type: PolarSnap (SNAPTYPE 1) or grid snap (0), the current one the default. */
async function* snapType(ctx: CommandContext): AsyncGenerator<Prompt, void, PromptAnswer> {
  const now = await ctx.view.request({ op: 'sysvar', name: 'SNAPTYPE' });
  const current = now.ok && now.value === 1 ? 'Polar' : 'Grid';
  const a = yield ctx.prompt.keyword({
    message: 'Enter snap type',
    options: ['Polar', 'Grid'],
    default: { kind: 'keyword', keyword: current },
  });
  if (a.kind !== 'keyword') return;
  const type = a.keyword;
  const r = await ctx.view.request({
    op: 'sysvar',
    name: 'SNAPTYPE',
    value: type === 'Polar' ? 1 : 0,
  });
  if (!r.ok) ctx.message(r.message);
}

/** "message [Yes/No] <current>:", true for Yes; undefined when cancelled. */
async function* yesNo(
  ctx: CommandContext,
  message: string,
  now: boolean,
): AsyncGenerator<Prompt, boolean | undefined, PromptAnswer> {
  const a = yield ctx.prompt.keyword({
    message,
    options: ['Yes', 'No'],
    default: { kind: 'keyword', keyword: now ? 'Yes' : 'No' },
  });
  return a.kind === 'keyword' ? a.keyword === 'Yes' : undefined;
}

/**
 * GRID's aDaptive, Limits and Follow: the GRIDDISPLAY bits asked about, set in the current
 * viewport's settings in one undo step. Without one, says why before asking anything.
 */
async function* gridBehavior(
  ctx: CommandContext,
  option: 'aDaptive' | 'Limits' | 'Follow',
): AsyncGenerator<Prompt, void, PromptAnswer> {
  const v = holderOf(ctx)?.state;
  if (!v) {
    ctx.message(NO_VPORT);
    return;
  }
  let flags = v.gridFlags;
  const has = (bit: number) => (flags & bit) !== 0;
  const turn = (bit: number, on: boolean) => (flags = on ? flags | bit : flags & ~bit);
  if (option === 'aDaptive') {
    const on = yield* yesNo(ctx, 'Turn adaptive behavior on', has(GRID_DISPLAY.adaptive));
    if (on === undefined) return;
    turn(GRID_DISPLAY.adaptive, on);
    if (on) {
      const sub = yield* yesNo(
        ctx,
        'Allow subdivision below grid spacing',
        has(GRID_DISPLAY.subdivide),
      );
      if (sub === undefined) return;
      turn(GRID_DISPLAY.subdivide, sub);
    }
  } else {
    const bit = option === 'Limits' ? GRID_DISPLAY.beyondLimits : GRID_DISPLAY.follow;
    const message = option === 'Limits' ? 'Display grid beyond Limits' : 'Follow Dynamic UCS';
    const on = yield* yesNo(ctx, message, has(bit));
    if (on === undefined) return;
    turn(bit, on);
  }
  setSettings(ctx, () => ({ gridDisplay: flags }));
}

const spacingNow = (ctx: CommandContext, key: 'snapSpacing' | 'gridSpacing'): Vec2 =>
  holderOf(ctx)?.state[key] ?? { x: 10, y: 10 };

export function snapCommand(): CommandDef {
  return {
    name: 'SNAP',
    transparent: true,
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      const now = spacingNow(ctx, 'snapSpacing');
      for (;;) {
        const a = yield ctx.prompt.distance({
          message: 'Specify snap spacing or',
          options: ['ON', 'OFF', 'Aspect', 'Type'],
          default: { kind: 'distance', value: now.x },
        });
        if (a.kind === 'keyword' && (a.keyword === 'ON' || a.keyword === 'OFF'))
          return await toggle(ctx, 'SNAPMODE', a.keyword === 'ON');
        if (a.kind === 'keyword' && a.keyword === 'Type') return yield* snapType(ctx);
        if (a.kind === 'keyword') {
          const v = yield* aspect(
            ctx,
            now,
            ['Specify horizontal spacing', 'Specify vertical spacing'],
            false,
          );
          if (v) setSettings(ctx, () => ({ snapSpacing: v }));
          return;
        }
        if (a.kind !== 'distance') return;
        if (!(a.value > 0)) {
          ctx.message(NOT_POSITIVE);
          continue;
        }
        const d = a.value;
        if (setSettings(ctx, () => ({ snapSpacing: { x: d, y: d } })))
          await toggle(ctx, 'SNAPMODE', true);
        return;
      }
    },
  };
}

export function gridCommand(): CommandDef {
  return {
    name: 'GRID',
    transparent: true,
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      const now = spacingNow(ctx, 'gridSpacing');
      for (;;) {
        const a = yield ctx.prompt.distance({
          message: 'Specify grid spacing(X) or',
          options: ['ON', 'OFF', 'Snap', 'Major', 'aDaptive', 'Limits', 'Follow', 'Aspect'],
          default: { kind: 'distance', value: now.x },
          arbitrary: true,
        });
        if (a.kind === 'keyword' && (a.keyword === 'ON' || a.keyword === 'OFF'))
          return await toggle(ctx, 'GRIDMODE', a.keyword === 'ON');
        if (a.kind === 'keyword' && a.keyword === 'Snap') {
          if (setSettings(ctx, () => ({ gridSpacing: { x: 0, y: 0 } })))
            await toggle(ctx, 'GRIDMODE', true);
          return;
        }
        if (a.kind === 'keyword' && a.keyword === 'Major') {
          const m = yield ctx.prompt.integer({
            message: 'Specify the number of grid lines per major grid line',
            default: { kind: 'number', value: holderOf(ctx)?.state.gridMajor ?? 5 },
          });
          if (m.kind !== 'number') return;
          if (m.value < GRID_MAJOR.min || m.value > GRID_MAJOR.max) {
            ctx.message(`Requires an integer between ${GRID_MAJOR.min} and ${GRID_MAJOR.max}.`);
            return;
          }
          setSettings(ctx, () => ({ gridMajor: m.value }));
          return;
        }
        if (
          a.kind === 'keyword' &&
          (a.keyword === 'aDaptive' || a.keyword === 'Limits' || a.keyword === 'Follow')
        )
          return yield* gridBehavior(ctx, a.keyword);
        if (a.kind === 'keyword') {
          const v = yield* aspect(
            ctx,
            now,
            ['Specify the horizontal spacing(X)', 'Specify the vertical spacing(Y)'],
            true,
          );
          if (v) setSettings(ctx, () => ({ gridSpacing: v }));
          return;
        }
        // `2x`: that many times the snap spacing (AutoCAD: "Entering x after the value sets the
        // grid spacing to the value multiplied by the snap interval").
        const times = a.kind === 'string' ? /^\s*(\d+\.?\d*|\.\d+)\s*x\s*$/i.exec(a.value) : null;
        if (a.kind === 'string' && !times) {
          ctx.message('Requires a distance, a number followed by x, or an option keyword.');
          continue;
        }
        if (a.kind !== 'distance' && !times) return;
        const n = times ? Number(times[1]) : undefined;
        const d = a.kind === 'distance' ? a.value : undefined;
        if ((d !== undefined && d < 0) || (n !== undefined && !(n > 0))) {
          ctx.message(NOT_POSITIVE);
          continue;
        }
        const set = setSettings(ctx, (s) => ({
          gridSpacing:
            n === undefined ? { x: d!, y: d! } : { x: n * s.snapSpacing.x, y: n * s.snapSpacing.y },
        }));
        if (set) await toggle(ctx, 'GRIDMODE', true);
        return;
      }
    },
  };
}

export const SNAP_GRID_COMMANDS: readonly (() => CommandDef)[] = [snapCommand, gridCommand];
