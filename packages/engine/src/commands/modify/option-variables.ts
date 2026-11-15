// The modify commands' option variables (M3-12): OFFSETDIST, OFFSETERASE, OFFSETGAPTYPE,
// TRIMEXTENDMODE, EDGEMODE, PROJMODE, TRIMMODE, CHAMMODE and PEDITACCEPT are the app's
// (`APP_VARIABLES`), as ARRAYASSOCIATIVITY is: SETVAR sets them, a command reads them as it starts
// and sets them when its option changes. Where no app answers (scripts, tests) a command keeps
// its own value for the drawing, as it did before the variables were the app's.
import type { CommandContext } from '../command';

/** The app's value of variable `name`, or `fallback` when the app keeps none. */
export async function optionVariable(
  ctx: CommandContext,
  name: string,
  fallback: number,
): Promise<number> {
  const r = await ctx.view.request({ op: 'sysvar', name });
  return r.ok && typeof r.value === 'number' ? r.value : fallback;
}

/** Sets variable `name` in the app, where there is one to keep it. */
export async function setOptionVariable(
  ctx: CommandContext,
  name: string,
  value: number,
): Promise<void> {
  await ctx.view.request({ op: 'sysvar', name, value });
}
