// VPORTS (M6-02 part 11): the Viewports dialog (AutoCAD 2024 Help, "VPORTS (Command)": "Creates
// multiple viewports in model space or paper space"; "Viewports Dialog Box"). The dialog is the
// app's; this command opens it with the drawing's configurations and named views and does what
// its OK answers, with -VPORTS' and MVIEW's edits:
//   New Viewports, on the Model tab: the Standard viewports arrangement applied to the Display or
//     the Current Viewport (Apply to), each new viewport showing the current view or the named
//     view Change view to gives it, the first (the large one) current; with a New name the
//     configuration is saved under it too ("If you do not enter a name, the viewport
//     configuration is applied but not saved"). *Active Model Configuration* is the current one,
//     so it only gives views and saves.
//   New Viewports, in a layout: the arrangement made as layout viewports with Viewport Spacing
//     between them, in an area asked after OK ("Specify first corner or [Fit] <Fit>:", MVIEW's),
//     each showing model space's extents or its named view; *Active Model Configuration* lays
//     out model space's current tiles as MVIEW Restore does.
//   Named Viewports: the configuration selected restored (Model tab) or laid out in an area (a
//     layout, MVIEW Restore); its shortcut menu's Rename and Delete are done at OK, first.
// All of it is one VPORTS undo step; Cancel changes nothing. The Setup list (3D) and Visual Style
// are 3D, which Triya leaves out (PRD non-goals). In the Block Editor AutoCAD refuses it.
import type { Box } from '../geom/bounds';
import type { DocumentModel } from '../model/document';
import type { ViewRecord } from '../model/types';
import { PAPER_VIEW, validViewName, type ViewExtent } from '../edit/named-view';
import {
  configurationTiles,
  cornersIn,
  viewInTile,
  viewportConfiguration,
  viewportConfigurations,
  writeConfiguration,
  type ConfigTile,
} from '../edit/viewport-configs';
import { ACTIVE_VPORT, isActiveVport } from '../layout/model-tiles';
import { isPaperSpace, modelSpaceOf } from './bus';
import type { CommandContext, CommandDef } from './command';
import { addViewports, tileViews, viewportArea, viewportFit } from './mview';
import type { Prompt, PromptAnswer } from './prompt';
import {
  ACTIVE_MODEL_CONFIGURATION,
  spacedViewports,
  standardViewports,
  type NewViewportsChoice,
  type StandardViewports,
  type ViewportsDialogChoice,
} from './standard-viewports';
import {
  NO_MODEL_VIEWPORT,
  VPORTS_IN_BLOCK_EDITOR,
  dashVportsCommand,
  liveTiles,
  spelled,
  type VportsState,
} from './vports';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const WHOLE: Box = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

const plan = (v: ViewRecord): boolean => {
  const d = v.direction;
  return d.z > 0 && d.x === 0 && d.y === 0 && v.twist === 0;
};

/**
 * The named views Change view to lists: model-space views in plan (a layout's own views and 3D
 * ones a viewport here cannot show are left out), by name.
 */
export function modelViews(model: DocumentModel): ViewRecord[] {
  return [...model.tables.views.values()]
    .filter((v) => ((v.flags ?? 0) & PAPER_VIEW) === 0 && plan(v) && v.height > 0)
    .sort((a, b) => (a.name.toUpperCase() < b.name.toUpperCase() ? -1 : 1));
}

const viewNamed = (model: DocumentModel, name: string): ViewRecord | undefined =>
  modelViews(model).find((v) => v.name.toUpperCase() === name.toUpperCase());

/** A named view's window in world coordinates (its centre is in display coordinates). */
const extentOf = (v: ViewRecord): ViewExtent => ({
  center: { x: v.center.x + v.target.x, y: v.center.y + v.target.y },
  height: v.height,
  width: v.width,
});

const ratio = (b: Box): number => (b.maxX - b.minX) / (b.maxY - b.minY);

/**
 * `view` shown whole in a tile of `corners`: when the canvas told the screen's shape (the current
 * tile's live view), high enough for its width too, as -VIEW Restore fits a view; else its own
 * height and width.
 */
function fitted(view: ViewExtent, corners: Box, screen: number | undefined): ViewExtent {
  if (!screen || !(screen > 0)) return view;
  const aspect = screen * ratio(corners);
  const height = Math.max(view.height, view.width / aspect);
  return { center: view.center, height, width: height * aspect };
}

/** Renames and deletes the Named Viewports tab gave, refusing a name AutoCAD would not take. */
function renameAndDelete(ctx: CommandContext, choice: ViewportsDialogChoice, state: VportsState) {
  const valid = choice.renamed.filter(({ from, to }) => {
    const ok =
      validViewName(to) &&
      to.toUpperCase() !== ACTIVE_VPORT.toUpperCase() &&
      (to.toUpperCase() === from.toUpperCase() || !viewportConfiguration(ctx.model, to));
    if (!ok) ctx.message(`Invalid viewport configuration name "${to}".`);
    return ok && viewportConfiguration(ctx.model, from) !== undefined;
  });
  const deleted = choice.deleted.filter((n) => viewportConfiguration(ctx.model, n));
  if (valid.length === 0 && deleted.length === 0) return;
  ctx.edit((b) => {
    const named = viewportConfigurations(ctx.model.tables.vports.values());
    for (const { from, to } of valid) {
      const c = named.find((n) => n.name.toUpperCase() === from.toUpperCase());
      for (const r of c?.records ?? []) b.updateTableRecord('vports', r.handle, { name: to });
    }
    for (const name of deleted) {
      const c = named.find((n) => n.name.toUpperCase() === name.toUpperCase());
      for (const r of c?.records ?? []) b.removeTableRecord('vports', r.handle);
    }
  });
  const key = state.current?.toUpperCase();
  const to = valid.find((r) => r.from.toUpperCase() === key)?.to;
  if (to) state.current = to;
  if (deleted.some((n) => n.toUpperCase() === key)) state.current = undefined;
}

/** New Viewports on the Model tab. */
async function newModelViewports(
  ctx: CommandContext,
  choice: NewViewportsChoice,
  state: VportsState,
): Promise<void> {
  const tiles = await liveTiles(ctx);
  const current = tiles[0]!;
  const screen = current.view && current.view.width / current.view.height / ratio(current.corners);
  const viewFor = (i: number, corners: Box, fallback: ViewExtent | undefined) => {
    const name = choice.views[i];
    const named = name ? viewNamed(ctx.model, name) : undefined;
    return named ? fitted(extentOf(named), corners, screen) : fallback;
  };
  let arranged: ConfigTile[];
  if (choice.standard === ACTIVE_MODEL_CONFIGURATION) {
    arranged = tiles.map((t, i) => {
      const view = viewFor(i, t.corners, t.view);
      return { ...t, ...(view && { view }) };
    });
  } else {
    const area = choice.applyTo === 'Display' ? WHOLE : current.corners;
    const pieces = standardViewports(choice.standard, area).map((corners, i): ConfigTile => {
      const view = viewFor(
        i,
        corners,
        current.view && viewInTile(current.view, current.corners, corners),
      );
      return { source: current.source, corners, ...(view && { view }) };
    });
    arranged = choice.applyTo === 'Display' ? pieces : [...pieces, ...tiles.slice(1)];
    if (tiles.length > 1) state.previous = tiles;
  }
  const changes = choice.standard !== ACTIVE_MODEL_CONFIGURATION || choice.views.some((v) => v);
  const name = choice.name?.trim();
  ctx.edit((b) => {
    if (changes) writeConfiguration(b, ctx.model, ACTIVE_VPORT, arranged);
    if (name) writeConfiguration(b, ctx.model, name, arranged);
  });
  if (name) state.current = spelled(ctx, name);
  else if (changes) state.current = undefined;
}

/** New Viewports in a layout: the viewports in an area asked for after OK. */
async function* newLayoutViewports(ctx: CommandContext, choice: NewViewportsChoice): Sub<void> {
  const active = choice.standard === ACTIVE_MODEL_CONFIGURATION;
  const tiles = active ? configurationTiles(ctx.model.tables.vports.values()) : [];
  const area = yield* viewportArea(ctx);
  if (!area) return;
  const placed = active
    ? tiles.map((t) => cornersIn(t.corners, area))
    : standardViewports(choice.standard as StandardViewports, area);
  const frames = spacedViewports(placed, area, choice.spacing);
  const own = active ? tileViews(tiles) : [];
  const views = frames.map((frame, i) => {
    const name = choice.views[i];
    const named = name ? viewNamed(ctx.model, name) : undefined;
    if (!named) return own[i];
    const e = extentOf(named);
    const { x, y } = e.center;
    const extents = {
      minX: x - e.width / 2,
      minY: y - e.height / 2,
      maxX: x + e.width / 2,
      maxY: y + e.height / 2,
    };
    return viewportFit(frame, extents) ?? { center: e.center, height: e.height };
  });
  await addViewports(ctx, frames, undefined, views);
}

/** Named Viewports in a layout: MVIEW Restore of the configuration selected. */
async function* namedLayoutViewports(ctx: CommandContext, name: string): Sub<void> {
  const tiles = configurationTiles(ctx.model.tables.vports.values(), name);
  if (tiles.length === 0) return ctx.message(`Cannot find viewport configuration "${name}".`);
  const area = yield* viewportArea(ctx);
  if (!area) return;
  await addViewports(
    ctx,
    tiles.map((t) => cornersIn(t.corners, area)),
    undefined,
    tileViews(tiles),
  );
}

/** Named Viewports on the Model tab: the configuration selected in place of the current one. */
async function restoreNamed(ctx: CommandContext, name: string, state: VportsState) {
  const found = viewportConfiguration(ctx.model, name);
  if (!found) return ctx.message(`Cannot find viewport configuration "${name}".`);
  const now = await liveTiles(ctx);
  if (now.length > 1) state.previous = now;
  const tiles = configurationTiles(ctx.model.tables.vports.values(), found.name);
  ctx.edit((b) => writeConfiguration(b, ctx.model, ACTIVE_VPORT, tiles));
  state.current = found.name;
}

/** VPORTS: the Viewports dialog, sharing -VPORTS' state. */
export function vportsCommand(state: VportsState): CommandDef {
  return {
    name: 'VPORTS',
    async *run(ctx) {
      // A layout's model space worked in through a viewport is still the layout (-VPORTS too).
      const layout = isPaperSpace(ctx.model, ctx.space) || ctx.viewport.current !== undefined;
      if (!layout && ctx.space !== modelSpaceOf(ctx.model))
        return ctx.message(VPORTS_IN_BLOCK_EDITOR);
      const vports = [...ctx.model.tables.vports.values()];
      if (!layout && !vports.some(isActiveVport)) return ctx.message(NO_MODEL_VIEWPORT);
      const active = layout
        ? configurationTiles(vports).map((t) => t.corners)
        : (await liveTiles(ctx)).map((t) => t.corners);
      const reply = await ctx.view.request({
        op: 'viewportsDialog',
        layout,
        current: state.current ?? ACTIVE_VPORT,
        configurations: viewportConfigurations(vports).map((c) => ({
          name: c.name,
          tiles: configurationTiles(vports, c.name).map((t) => t.corners),
        })),
        active,
        views: modelViews(ctx.model).map((v) => v.name),
      });
      const choice = reply.ok ? reply.viewports : undefined;
      if (!choice) return;
      renameAndDelete(ctx, choice, state);
      const apply = choice.apply;
      if (!apply) return;
      if (!layout) {
        if (apply.tab === 'named') return restoreNamed(ctx, apply.name, state);
        return newModelViewports(ctx, apply, state);
      }
      // Viewports are paper space's objects: from a viewport made current, the layout goes back
      // to paper space for them, as MVIEW does (M6-02 part 3).
      if (ctx.viewport.current !== undefined) await ctx.viewport.set(undefined);
      if (apply.tab === 'named') return yield* namedLayoutViewports(ctx, apply.name);
      return yield* newLayoutViewports(ctx, apply);
    },
  };
}

/** -VPORTS and VPORTS, sharing what -VPORTS keeps (MOde, Toggle's tiles, the current name). */
export function vportsCommands(): CommandDef[] {
  const state: VportsState = { mode: 'Current viewport' };
  return [dashVportsCommand(state), vportsCommand(state)];
}
