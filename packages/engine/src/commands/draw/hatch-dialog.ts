// The Hatch and Gradient dialog (HATCH's seTtings, GRADIENT) and the Hatch Edit dialog
// (HATCHEDIT), M4-07 part 5, with AutoCAD 2024's structure (AutoCAD 2024 Help, "Hatch and
// Gradient Dialog Box", "Hatch Edit Dialog Box", "HPDLGMODE (System Variable)"). The app draws
// them (apps/web `HatchDialog.tsx`); the command keeps what they hold between openings.
//
//   Hatch tab      Type and pattern (Predefined, User defined, Custom; Pattern, Color and
//                  background colour), Angle and scale (Double, Spacing), Hatch origin (Use
//                  current origin, or Specified origin: Click to set new origin, Default to
//                  boundary extents, Store as default origin)
//   Gradient tab   One color or Two color, Shade/Tint, the nine gradients, Centered, Angle
//   Boundaries     Add: Pick points, Add: Select objects, Remove boundaries, Recreate boundary
//                  (Hatch Edit), View Selections
//   Options        Annotative (never: DEC-013, DEC-058), Associative (never: DEC-015), Create
//                  separate hatches, Draw order, Layer, Transparency
//   Inherit Properties, Preview; More options: Islands, Boundary retention, Boundary set, Gap
//   tolerance, Inherit options
//
// A button that picks in the drawing closes the dialog until the picking is done, then opens it
// again, as AutoCAD's do:
//   Pick internal point or [Select objects/remove Boundaries/Undo]:  (Enter: back to the dialog)
//   Select objects or [picK internal point/remove Boundaries/Undo]:
//   Select objects or [Add boundaries]:                                       (Remove boundaries)
//   <Hit enter or right-click to return to the dialog>:                         (View Selections)
//   Pick or press Esc to return to dialog or <Right-click to accept hatch>:            (Preview)
//   Select hatch object:                                                 (Inherit Properties)
//   Specify origin point:                                          (Click to set new origin)
//   Select objects:                                                     (Boundary set: New)
// OK makes the hatch (HATCH) or changes it (HATCHEDIT, hatchedit.ts), as one undo step; Cancel
// cancels the command. HPDLGMODE (the app's, kept per user; AutoCAD's initial 2 opens the
// dialogs whenever the ribbon is closed, and Triya has no ribbon until M7-01) decides whether
// HATCH, GRADIENT and HATCHEDIT open them at once; 0 keeps HATCH on the command line, where
// seTtings opens the dialog, and HATCHEDIT on -HATCHEDIT's prompts.
//
// Where AutoCAD's documentation is silent: OK with no boundary closes the dialog and makes
// nothing; Inherit Properties takes the transparency with the pattern, colours and layer, and
// then picks internal points as AutoCAD's does; View Selections shows each boundary found as an
// outline.
import type { Vec2 } from '../../geom/types';
import { retainedBoundary } from '../../edit/hatch-retain';
import type { EntityGeometry, HatchGeometry, HatchLoop } from '../../model/types';
import type { CommandContext } from '../command';
import type { PromptAnswer } from '../prompt';
import { HPTRANSPARENCY, keyword, settingsOf, transparencyText } from './hatch-options';
import type { HatchSettings, Sub } from './hatch-options';
import type { HatchRun } from './hatch';

/** A dialog button that closes it to pick in the drawing. */
export type HatchDialogButton =
  /** Add: Pick points. */
  | 'pick'
  /** Add: Select objects. */
  | 'select'
  /** Remove boundaries. */
  | 'remove'
  /** Recreate boundary (Hatch Edit). */
  | 'recreate'
  /** View Selections. */
  | 'view'
  /** Inherit Properties. */
  | 'inherit'
  | 'preview'
  /** Click to set new origin. */
  | 'origin'
  /** Boundary set's New. */
  | 'boundarySet';

/** What the dialog holds: the settings it shows and its own fields. */
export interface HatchDialogState {
  /**
   * HATCH's settings; Hatch Edit's: the hatch's. `drawOrder` 'none' is Hatch Edit's Do not
   * change, `separate` there separates the hatch.
   */
  readonly settings: HatchSettings;
  /** HPTRANSPARENCY as -HATCH's prompt shows it: use current, ByLayer, ByBlock or 0–90. */
  readonly transparency: string;
  /** Specified origin (or Use current origin). */
  readonly specified: boolean;
  /** The origin Click to set new origin set: the hatch's own origin. */
  readonly origin: Vec2;
  /** Default to boundary extents: 0 off, 1–5 HPORIGINMODE's positions. */
  readonly extents: number;
  /** Store as default origin. */
  readonly storeOrigin: boolean;
  /** Inherit options: Use source hatch origin (or Use current origin). */
  readonly inheritOrigin: boolean;
  /** The tab shown. */
  readonly tab: 'hatch' | 'gradient';
  /** More options shown. */
  readonly more: boolean;
}

/** The dialog HATCH (`edit` false) or HATCHEDIT opens. */
export interface HatchDialogRequest extends HatchDialogState {
  readonly type: 'hatch';
  /** Hatch Edit. */
  readonly edit: boolean;
  /** The drawing's layers, for Layer. */
  readonly layers: readonly string[];
  /** How many boundaries there are (areas found; Hatch Edit: the hatch's loops). */
  readonly boundaries: number;
  /** Boundary set: Existing set (New chose one), or Current viewport. */
  readonly boundarySet: boolean;
}

/** The dialog's answer: its state as a button (or OK) left it. */
export interface HatchDialogAnswer {
  readonly state: HatchDialogState;
  readonly button?: HatchDialogButton;
}

const RETURN = 'Hit enter or right-click to return to the dialog';

/** The dialog opened on `request`; its answer (a button, or OK when none). */
export async function* openHatchDialog(
  ctx: CommandContext,
  request: HatchDialogRequest,
): Sub<HatchDialogAnswer> {
  const a = (yield ctx.prompt.dialog({
    message: request.edit ? 'Hatch Edit' : 'Hatch and Gradient',
    dialog: request,
  })) as Extract<PromptAnswer, { kind: 'dialog' }>;
  return a.hatch ?? { state: request };
}

/** The drawing's layer names, for the dialog's Layer list. */
export const layerNames = (ctx: CommandContext): string[] =>
  [...ctx.model.tables.layers.values()].map((l) => l.name);

/** The dialog's state as HATCH opens it on `run`. */
export function initialState(
  run: HatchRun,
  tab: 'hatch' | 'gradient',
  transparency: string,
): HatchDialogState {
  return {
    settings: copySettings(run.s),
    transparency,
    specified: false,
    origin: run.origin,
    extents: run.s.originMode,
    storeOrigin: false,
    inheritOrigin: false,
    tab,
    more: false,
  };
}

/** A copy of `s` the dialog can hold while `s` changes. */
export const copySettings = (s: HatchSettings): HatchSettings => ({
  ...s,
  gradient: { ...s.gradient },
});

/** `s` set to `to`, in place (the command's settings are one object the commands share). */
export function assignSettings(s: HatchSettings, to: HatchSettings): void {
  Object.assign(s, copySettings(to));
}

/**
 * Picking boundaries for the dialog (Add: Pick points or Select objects, `selecting`), until
 * Enter goes back to it.
 */
export async function* addBoundaries(
  ctx: CommandContext,
  run: HatchRun,
  selecting: boolean,
  preview: () => Promise<void> = () => run.preview(),
): Sub<void> {
  for (;;) {
    await preview();
    const a = selecting
      ? yield ctx.prompt.selection({
          message: 'Select objects or',
          options: ['picK internal point', 'remove Boundaries', 'Undo'],
        })
      : yield ctx.prompt.point({
          message: 'Pick internal point or',
          options: ['Select objects', 'remove Boundaries', 'Undo'],
        });
    const k = keyword(a);
    if (k === 'Select objects') selecting = true;
    else if (k === 'picK internal point') selecting = false;
    else if (k === 'Undo') run.undo();
    else if (k === 'remove Boundaries') yield* removeFromRun(ctx, run);
    else if (a.kind === 'point') await run.pick(a.point);
    else if (a.kind === 'selection' && a.ids.length > 0) run.select(a.ids);
    else break;
  }
  ctx.preview([]);
}

/** Remove boundaries: the objects picked come out of the areas, until Enter. */
export async function* removeFromRun(ctx: CommandContext, run: HatchRun): Sub<void> {
  for (;;) {
    await run.preview();
    const a = yield ctx.prompt.selection({
      message: 'Select objects or',
      options: ['Add boundaries'],
    });
    if (a.kind !== 'selection' || a.ids.length === 0) return;
    await run.remove(a.ids);
  }
}

/** View Selections: each boundary as an outline, until Enter (or Esc) goes back. */
export async function* viewSelections(ctx: CommandContext, loops: readonly HatchLoop[]): Sub<void> {
  ctx.preview(loops.flatMap((l): EntityGeometry[] => retainedBoundary(l)));
  yield ctx.prompt.point({ message: '', defaultLabel: RETURN, escape: true });
  ctx.preview([]);
}

/**
 * Preview: the hatch as it would be made, until a pick or Esc goes back to the dialog (false) or
 * Enter (AutoCAD's right-click) accepts it (true).
 */
export async function* previewHatch(
  ctx: CommandContext,
  hatch: HatchGeometry | undefined,
): Sub<boolean> {
  ctx.preview(hatch ? [hatch] : []);
  const a = yield ctx.prompt.point({
    message: 'Pick or press Esc to return to dialog or',
    defaultLabel: 'Right-click to accept hatch',
    escape: true,
  });
  ctx.preview([]);
  return a.kind === 'enter';
}

/**
 * Inherit Properties: a hatch picked gives its settings (its origin too with Use source hatch
 * origin) and its transparency; undefined when none is picked.
 */
export async function* inheritFrom(
  ctx: CommandContext,
  state: HatchDialogState,
): Sub<HatchDialogState | undefined> {
  for (;;) {
    const a = yield ctx.prompt.selection({ message: 'Select hatch object', single: true });
    if (a.kind !== 'selection' || a.ids.length === 0) return undefined;
    const e = ctx.model.entity(a.ids[0]!);
    if (e?.geom.kind !== 'HATCH') {
      ctx.message('Object selected is not a hatch.');
      continue;
    }
    const from = settingsOf(ctx, e as typeof e & { geom: HatchGeometry }, state.settings);
    const s = state.settings;
    return {
      ...state,
      settings: {
        ...from,
        // What the dialog's Options set stays: these are not the hatch's properties.
        separate: s.separate,
        drawOrder: s.drawOrder,
        retain: s.retain,
        islands: s.islands,
        gap: s.gap,
        origin: s.origin,
        originMode: s.originMode,
      },
      transparency: transparencyText(e.transparency),
      ...(state.inheritOrigin && { specified: true, extents: 0, origin: from.origin }),
      tab: from.gradient && from.pattern === from.gradient.name ? 'gradient' : 'hatch',
    };
  }
}

/**
 * The Hatch and Gradient dialog HATCH and GRADIENT open: it returns when OK (or Preview's
 * accept) closes it, with `run` set as the dialog left it.
 */
export async function* hatchDialog(
  ctx: CommandContext,
  run: HatchRun,
  tab: 'hatch' | 'gradient',
): Sub<void> {
  let state = initialState(run, tab, run.transparency());
  for (;;) {
    const { state: next, button } = yield* openHatchDialog(ctx, {
      type: 'hatch',
      edit: false,
      ...state,
      layers: layerNames(ctx),
      boundaries: run.areas,
      boundarySet: run.boundarySet !== undefined,
    });
    state = next;
    applyState(ctx, run, state);
    switch (button) {
      case undefined:
        return;
      case 'pick':
      case 'select':
        yield* addBoundaries(ctx, run, button === 'select');
        break;
      case 'remove':
        yield* removeFromRun(ctx, run);
        ctx.preview([]);
        break;
      case 'view':
        yield* viewSelections(ctx, run.found().loops);
        break;
      case 'preview':
        if (yield* previewHatch(ctx, await run.made())) return;
        break;
      case 'inherit': {
        const inherited = yield* inheritFrom(ctx, state);
        if (!inherited) break;
        state = inherited;
        applyState(ctx, run, state);
        yield* addBoundaries(ctx, run, false);
        break;
      }
      case 'origin': {
        const p = yield* originPoint(ctx);
        state = { ...state, specified: true, origin: p, extents: 0 };
        applyState(ctx, run, state);
        break;
      }
      case 'boundarySet': {
        const a = yield ctx.prompt.selection({ message: 'Select objects', pickfirst: false });
        if (a.kind === 'selection' && a.ids.length > 0) run.boundarySet = a.ids;
        break;
      }
      default:
        break;
    }
  }
}

/** Click to set new origin. A point prompt without options or default answers a point. */
export async function* originPoint(ctx: CommandContext): Sub<Vec2> {
  return ((yield ctx.prompt.point({ message: 'Specify origin point' })) as { point: Vec2 }).point;
}

/**
 * The dialog's state made the command's: the settings HATCH keeps, HPTRANSPARENCY (kept in the
 * drawing, as -HATCH's Transparency sets it), and the origin `run` hatches from.
 */
function applyState(ctx: CommandContext, run: HatchRun, state: HatchDialogState): void {
  assignSettings(run.s, state.settings);
  if (state.transparency !== run.transparency()) {
    ctx.edit((b) => b.setHeader(HPTRANSPARENCY, state.transparency));
  }
  if (!state.specified) {
    run.origin = run.s.origin;
    run.extents = run.s.originMode;
    return;
  }
  run.origin = state.origin;
  run.extents = state.extents;
  if (state.storeOrigin) {
    run.s.origin = state.origin;
    run.s.originMode = state.extents;
  }
}
