// SNAP and GRID (M3-06 part 2), on AutoCAD 2024's prompts (AutoCAD 2024 Help, "SNAP (Command)",
// "GRID (Command)"):
//   SNAP  Specify snap spacing or [ON/OFF/Aspect] <10.0000>:
//         Aspect: Specify horizontal spacing <10.0000>:  Specify vertical spacing <10.0000>:
//   GRID  Specify grid spacing(X) or [ON/OFF/Snap/Major/Aspect] <10.0000>:
//         Major: Specify the number of grid lines per major grid line <5>:
//         Aspect: Specify the horizontal spacing(X) <10.0000>:  Specify the vertical spacing(Y) …
// A spacing typed sets both X and Y and turns SNAP (or GRID) on, as AutoCAD's does; GRID takes
// `2x` for twice the snap spacing and Snap for spacing 0 (the grid follows the snap spacing).
// ON and OFF are the status bar's toggles (SNAPMODE, GRIDMODE: the app's, as SETVAR sets them);
// the spacing and Major are the drawing's `*Active` VPORT's (`edit/snap-grid.ts`), one undo step.
// Left out: SNAP's Style (isometric snap is PRD non-goal 7, DEC-026, DEC-060), Type and Legacy (PolarSnap
// comes with a later M3-06 part); GRID's aDaptive, Limits and Follow (Triya's grid is always
// adaptive and runs past the limits; no dynamic UCS). AutoCAD's command line refuses a spacing
// of 0 or less with "Value must be positive and nonzero."
import { GRID_MAJOR, currentVport, snapGridOf, snapGridPatch } from '../edit/snap-grid';
import type { Vec2 } from '../geom/types';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer, SnapGridSettings } from './prompt';

const NOT_POSITIVE = 'Value must be positive and nonzero.';
const NO_VPORT = 'The drawing has no current viewport to keep the spacing in.';

/** SNAPMODE or GRIDMODE turned on or off through the app, as F9 and F7 do. */
async function toggle(ctx: CommandContext, name: 'SNAPMODE' | 'GRIDMODE', on: boolean) {
  const r = await ctx.view.request({ op: 'sysvar', name, value: on ? 1 : 0 });
  if (!r.ok) ctx.message(r.message);
}

/** Sets `change` in the `*Active` VPORT's settings; false (with a message) without one. */
function setSettings(
  ctx: CommandContext,
  change: (s: SnapGridSettings) => Partial<SnapGridSettings>,
): boolean {
  const v = currentVport(ctx.model);
  if (!v) {
    ctx.message(NO_VPORT);
    return false;
  }
  const s = snapGridOf(v);
  const patch = snapGridPatch(v, { ...s, ...change(s) });
  if (patch) ctx.edit((b) => b.updateTableRecord('vports', v.handle, patch));
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

const spacingNow = (ctx: CommandContext, key: 'snapSpacing' | 'gridSpacing'): Vec2 =>
  currentVport(ctx.model)?.[key] ?? { x: 10, y: 10 };

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
          options: ['ON', 'OFF', 'Aspect'],
          default: { kind: 'distance', value: now.x },
        });
        if (a.kind === 'keyword' && (a.keyword === 'ON' || a.keyword === 'OFF'))
          return await toggle(ctx, 'SNAPMODE', a.keyword === 'ON');
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
          options: ['ON', 'OFF', 'Snap', 'Major', 'Aspect'],
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
            default: { kind: 'number', value: currentVport(ctx.model)?.gridMajor ?? 5 },
          });
          if (m.kind !== 'number') return;
          if (m.value < GRID_MAJOR.min || m.value > GRID_MAJOR.max) {
            ctx.message(`Requires an integer between ${GRID_MAJOR.min} and ${GRID_MAJOR.max}.`);
            return;
          }
          setSettings(ctx, () => ({ gridMajor: m.value }));
          return;
        }
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
