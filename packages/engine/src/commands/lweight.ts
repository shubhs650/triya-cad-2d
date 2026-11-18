// LWEIGHT and -LWEIGHT (M5-08 part 3; COMMANDS.md "Properties"), as AutoCAD 2024's (AutoCAD Help,
// "LWEIGHT (Command)", "Lineweight Settings Dialog Box", "-LWEIGHT (Command)", "LWDEFAULT",
// "LWUNITS"), alias LW:
//
//   - LWEIGHT opens Lineweight Settings (`LineweightRequest`), opened on the current lineweight
//     (CELWEIGHT). What else it sets is the app's per-user settings, which AutoCAD keeps in the
//     registry and Triya in its preferences: Units for Listing (LWUNITS), Display Lineweight
//     (LWDISPLAY, the status bar's LWT), Default (LWDEFAULT) and Adjust Display Scale. The dialog
//     sets those itself, as DSETTINGS' does; the command only makes the lineweight chosen current,
//     one LWEIGHT undo step when it changed.
//   - -LWEIGHT: "Current lineweight: <current>", then "Enter default lineweight for new objects
//     or [lIst]:". ByLayer, ByBlock and Default are typed by name; a number is in the units
//     LWUNITS lists them in, and one that is not a lineweight takes the nearest one ("If you
//     enter a value that is not valid, the current default lineweight is set to the nearest fixed
//     lineweight value"). lIst shows the lineweights in those units.
import type { Lineweight } from '../model/types';
import { currentHeader, currentProps } from '../properties/current';
import { LINEWEIGHTS } from '../properties/sheet';
import type { CommandContext, CommandDef } from './command';

/** LWUNITS: 1 lists lineweights in millimetres (AutoCAD's initial value), 0 in inches. */
export const LWUNITS = 'LWUNITS';
/** LWDEFAULT: what Default draws as, hundredths of a millimetre (AutoCAD's initial 25). */
export const LWDEFAULT = 'LWDEFAULT';
export const LWDEFAULT_INITIAL = 25;

export type LineweightUnits = 'mm' | 'in';

/** LWEIGHT's Lineweight Settings, opened on the current lineweight (CELWEIGHT). */
export interface LineweightRequest {
  readonly type: 'lweight';
  readonly lineweight: Lineweight;
}

/**
 * A lineweight as AutoCAD lists it in `units`: ByLayer, ByBlock, Default, "0.25 mm", or inches
 * to three places (0.25 mm is 0.010").
 */
export function lineweightText(w: Lineweight, units: LineweightUnits = 'mm'): string {
  if (typeof w !== 'number') return w;
  return units === 'mm' ? `${(w / 100).toFixed(2)} mm` : `${(w / 2540).toFixed(3)}"`;
}

/**
 * A lineweight typed in `units`: ByLayer, ByBlock or Default by name (any case), else the
 * lineweight nearest the number (ties to the thinner); undefined for anything else.
 */
export function lineweightTyped(
  text: string,
  units: LineweightUnits = 'mm',
): Lineweight | undefined {
  const t = text.trim();
  const u = t.toUpperCase();
  if (u === 'BYLAYER') return 'ByLayer';
  if (u === 'BYBLOCK') return 'ByBlock';
  if (u === 'DEFAULT') return 'Default';
  const n = Number(t.replace(/(mm|"|in)$/i, '').trim());
  if (t === '' || !Number.isFinite(n) || n < 0) return undefined;
  return nearestLineweight(units === 'mm' ? n * 100 : n * 2540);
}

/** The lineweight nearest `hundredths` (of a millimetre), the thinner on a tie. */
export function nearestLineweight(hundredths: number): number {
  let best = LINEWEIGHTS[0]!;
  for (const w of LINEWEIGHTS) if (Math.abs(w - hundredths) < Math.abs(best - hundredths)) best = w;
  return best;
}

/** LWUNITS as the app keeps it: millimetres unless it says 0. */
export async function lineweightUnitsOf(ctx: CommandContext): Promise<LineweightUnits> {
  const r = await ctx.view.request({ op: 'sysvar', name: LWUNITS });
  return r.ok && r.value === 0 ? 'in' : 'mm';
}

/** CELWEIGHT set to `w` when it differs, as one undo step. */
function setCurrent(ctx: CommandContext, w: Lineweight): void {
  if (currentProps(ctx.model).lineweight === w) return;
  const header = currentHeader(ctx.model, { lineweight: w });
  if (typeof header === 'string') return;
  ctx.edit((b) => {
    for (const [k, v] of header) b.setHeader(k, v);
  });
}

/** LWEIGHT (LW) and -LWEIGHT. */
export function lweightCommand(): CommandDef {
  return {
    name: 'LWEIGHT',
    dashVariant: true,
    transparent: true,
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      const current = currentProps(ctx.model).lineweight;
      if (!ctx.dash) {
        const a = yield ctx.prompt.dialog({
          message: 'Lineweight Settings',
          dialog: { type: 'lweight', lineweight: current },
        });
        if (a.kind === 'dialog' && a.action === 'ok' && a.lineweight !== undefined)
          setCurrent(ctx, a.lineweight);
        return;
      }
      const units = await lineweightUnitsOf(ctx);
      ctx.message(`Current lineweight: ${lineweightText(current, units)}`);
      for (;;) {
        const a = yield ctx.prompt.string({
          message: 'Enter default lineweight for new objects',
          options: ['lIst'],
        });
        if (a.kind === 'keyword') {
          ctx.message(
            (['ByLayer', 'ByBlock', 'Default', ...LINEWEIGHTS] as const)
              .map((w) => lineweightText(w, units))
              .join(', '),
          );
          continue;
        }
        if (a.kind !== 'string' || a.value.trim() === '') return;
        const w = lineweightTyped(a.value, units);
        if (w === undefined) {
          ctx.message('Invalid lineweight.');
          continue;
        }
        setCurrent(ctx, w);
        return;
      }
    },
  };
}
