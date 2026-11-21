// -VPORTS (M6-02 part 10): model space's tiled viewports and their named configurations, on
// AutoCAD's prompts (AutoCAD 2024 Help, "-VPORTS - Model Space Viewports"):
//   Enter an option [Save/Restore/Delete/SIngle/?/2/3/4/Toggle/MOde] <3>:
//     Save:     Enter name for new viewport configuration or [?]:
//     Restore:  Enter name of viewport configuration to restore or [?]:
//     Delete:   Enter name(s) of viewport configurations to delete <none>:
//     SIngle:   one viewport showing the current viewport's view
//     ?:        Enter name(s) of viewport configuration(s) to list <*>:
//     2:        Enter a configuration option [Horizontal/Vertical] <Vertical>:
//     3:        Enter a configuration option [Horizontal/Vertical/Above/Below/Left/Right] <Right>:
//     4:        the current viewport (or the display) in four
//     Toggle:   the previous configuration of several viewports and one viewport in turn; four
//               when there was none
//     MOde:     Enter a viewport configuration mode [Display/Current viewport] <Current viewport>:
// A configuration is the VPORT records sharing a name, each tile's corners (DXF 10/11) and view;
// the current one is the `*Active` records, the first being the current viewport. Save writes
// what each tile shows now (the canvases' views, `tiles` request), Restore puts a named one in
// place of the current one, and the new viewports of SIngle, 2, 3, 4 and Toggle start with the
// current viewport's view (the Viewports dialog's 2D setup). Each is one undo step. Help gives
// no messages and no prompt for MOde; those here are chosen for the common expectation. Join,
// which takes a click in each of two tiles, is a later part (the canvas does not yet say which
// tile a pick fell in); in a layout -VPORTS is MVIEW (AutoCAD 2024 Help, "-VPORTS - Layout
// Viewports"), whose prompts it shows.
import type { Box } from '../geom/bounds';
import {
  configurationLines,
  configurationTiles,
  configurationsMatching,
  deleteConfiguration,
  viewInTile,
  viewportConfiguration,
  writeConfiguration,
  type ConfigTile,
} from '../edit/viewport-configs';
import { validViewName } from '../edit/named-view';
import { ACTIVE_VPORT, isActiveVport } from '../layout/model-tiles';
import { isPaperSpace, modelSpaceOf } from './bus';
import type { CommandContext, CommandDef } from './command';
import { mviewCommand, viewportArrangement, type ViewportArrangement } from './mview';
import type { Prompt, PromptAnswer } from './prompt';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const WHOLE: Box = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

export const NO_MODEL_VIEWPORT = 'The drawing has no model viewport to arrange.';
export const VPORTS_IN_BLOCK_EDITOR = '** Command not allowed in the Block Editor **';
export const NO_MATCHING_CONFIGURATIONS = 'No matching viewport configurations found.';
export const INVALID_CONFIGURATION_NAME = 'Invalid viewport configuration name.';

type Mode = 'Display' | 'Current viewport';

/**
 * What -VPORTS and the VPORTS dialog keep while the drawing is open: MOde, the tiles Toggle
 * brings back, and the configuration last saved or restored (the dialog's Current name).
 */
export interface VportsState {
  mode: Mode;
  previous?: readonly ConfigTile[];
  current?: string | undefined;
}
type State = VportsState;

/**
 * The current configuration's tiles as the canvases show them, the current one first: the
 * canvas answers each tile's view and which tile is current; without an answer, each record's
 * own view and the first tile.
 */
export async function liveTiles(ctx: CommandContext): Promise<ConfigTile[]> {
  const r = await ctx.view.request({ op: 'tiles' });
  const live = r.ok ? r.tiles : undefined;
  const tiles = configurationTiles(
    ctx.model.tables.vports.values(),
    ACTIVE_VPORT,
    live?.views.map((v) => v && { center: v.center, height: v.height, width: v.width }),
  );
  const current = live && tiles[live.current] ? live.current : 0;
  return [tiles[current]!, ...tiles.filter((_, i) => i !== current)];
}

const isList = (a: PromptAnswer): boolean =>
  a.kind === 'keyword' || (a.kind === 'string' && a.value.trim() === '?');

function list(ctx: CommandContext, patterns: string): void {
  for (const line of configurationLines(ctx.model.tables.vports.values(), patterns))
    ctx.message(line);
}

/** A configuration name typed after `?` lists them; undefined at Enter. */
async function* configurationName(ctx: CommandContext, message: string): Sub<string | undefined> {
  for (;;) {
    const a = yield ctx.prompt.string({ message, options: ['?'], spaces: true });
    if (isList(a)) {
      list(ctx, '*');
      continue;
    }
    if (a.kind !== 'string' || a.value.trim() === '') return undefined;
    return a.value.trim();
  }
}

/** `tiles` written as the current configuration, which then has no name of its own. */
function arrange(ctx: CommandContext, tiles: readonly ConfigTile[], state?: State): void {
  ctx.edit((b) => writeConfiguration(b, ctx.model, ACTIVE_VPORT, tiles));
  if (state) state.current = undefined;
}

/** The configuration's name as the drawing spells it, after it was written as `name`. */
export const spelled = (ctx: CommandContext, name: string): string =>
  viewportConfiguration(ctx.model, name)?.name ?? name;

/** One viewport showing the current tile's view. */
const single = (current: ConfigTile): ConfigTile[] => [
  {
    source: current.source,
    corners: WHOLE,
    ...(current.view && { view: viewInTile(current.view, current.corners, WHOLE) }),
  },
];

/**
 * 2, 3 and 4: the current tile (MOde Current viewport) or the display divided, each new viewport
 * starting with the current view; the first of them (3's large one) becomes the current one,
 * and the other tiles stay where they were under Current viewport.
 */
function divided(
  tiles: readonly ConfigTile[],
  mode: Mode,
  count: 2 | 3 | 4,
  arrangement?: ViewportArrangement,
): ConfigTile[] {
  const current = tiles[0]!;
  const area = mode === 'Display' ? WHOLE : current.corners;
  const pieces = viewportArrangement(area, count, arrangement).map((corners): ConfigTile => ({
    source: current.source,
    corners,
    ...(current.view && { view: viewInTile(current.view, current.corners, corners) }),
  }));
  return mode === 'Display' ? pieces : [...pieces, ...tiles.slice(1)];
}

async function* modelOptions(ctx: CommandContext, state: State): Sub<void> {
  const a = yield ctx.prompt.keyword({
    message: 'Enter an option',
    options: ['Save', 'Restore', 'Delete', 'SIngle', '?', '2', '3', '4', 'Toggle', 'MOde'],
    default: { kind: 'keyword', keyword: '3' },
  });
  if (a.kind !== 'keyword') return;
  switch (a.keyword) {
    case '?': {
      const p = yield ctx.prompt.string({
        message: 'Enter name(s) of viewport configuration(s) to list',
        default: { kind: 'string', value: '*' },
        spaces: true,
      });
      if (p.kind !== 'string') return;
      const r = await ctx.view.request({ op: 'tiles' });
      const lines = configurationLines(
        ctx.model.tables.vports.values(),
        p.value.trim() || '*',
        r.ok ? (r.tiles?.current ?? 0) : 0,
      );
      for (const line of lines) ctx.message(line);
      return;
    }
    case 'Save': {
      let name: string | undefined;
      for (;;) {
        name = yield* configurationName(ctx, 'Enter name for new viewport configuration or');
        if (name === undefined) return;
        // `*Active` names the current configuration's own records.
        if (validViewName(name) && name.toUpperCase() !== ACTIVE_VPORT.toUpperCase()) break;
        ctx.message(INVALID_CONFIGURATION_NAME);
      }
      // A name the drawing has is replaced, as -VIEW Save replaces a view: Help says nothing of
      // asking first.
      const tiles = await liveTiles(ctx);
      const saved = name;
      ctx.edit((b) => writeConfiguration(b, ctx.model, saved, tiles));
      state.current = spelled(ctx, saved);
      return;
    }
    case 'Restore': {
      for (;;) {
        const name = yield* configurationName(
          ctx,
          'Enter name of viewport configuration to restore or',
        );
        if (name === undefined) return;
        const found = viewportConfiguration(ctx.model, name);
        if (found) {
          const tiles = configurationTiles(ctx.model.tables.vports.values(), found.name);
          const now = await liveTiles(ctx);
          if (now.length > 1) state.previous = now;
          arrange(ctx, tiles);
          state.current = found.name;
          return;
        }
        ctx.message(`Cannot find viewport configuration "${name}".`);
      }
    }
    case 'Delete': {
      const p = yield ctx.prompt.string({
        message: 'Enter name(s) of viewport configurations to delete',
        default: { kind: 'string', value: '' },
        spaces: true,
      });
      if (p.kind !== 'string' || p.value.trim() === '') return;
      const found = configurationsMatching(ctx.model.tables.vports.values(), p.value);
      if (found.length === 0) return ctx.message(NO_MATCHING_CONFIGURATIONS);
      ctx.edit((b) => {
        for (const c of found) deleteConfiguration(b, ctx.model, c.name);
      });
      const key = state.current?.toUpperCase();
      if (found.some((c) => c.name.toUpperCase() === key)) state.current = undefined;
      return;
    }
    case 'SIngle':
    case 'Toggle': {
      const tiles = await liveTiles(ctx);
      if (tiles.length > 1) {
        state.previous = tiles;
        return arrange(ctx, single(tiles[0]!), state);
      }
      if (a.keyword === 'SIngle') return;
      // Toggle from one viewport: the previous configuration, else four (Help).
      return arrange(ctx, state.previous ?? divided(tiles, 'Display', 4), state);
    }
    case '2':
    case '3': {
      const two = a.keyword === '2';
      const options: ViewportArrangement[] = two
        ? ['Horizontal', 'Vertical']
        : ['Horizontal', 'Vertical', 'Above', 'Below', 'Left', 'Right'];
      const k = yield ctx.prompt.keyword({
        message: 'Enter a configuration option',
        options,
        default: { kind: 'keyword', keyword: two ? 'Vertical' : 'Right' },
      });
      if (k.kind !== 'keyword') return;
      const tiles = await liveTiles(ctx);
      const arrangement = k.keyword as ViewportArrangement;
      return arrange(ctx, divided(tiles, state.mode, two ? 2 : 3, arrangement), state);
    }
    case '4':
      return arrange(ctx, divided(await liveTiles(ctx), state.mode, 4), state);
    case 'MOde': {
      const m = yield ctx.prompt.keyword({
        message: 'Enter a viewport configuration mode',
        options: ['Display', 'Current viewport'],
        default: { kind: 'keyword', keyword: state.mode },
      });
      if (m.kind === 'keyword') state.mode = m.keyword as Mode;
      return;
    }
  }
}

export function dashVportsCommand(state: State = { mode: 'Current viewport' }): CommandDef {
  const mview = mviewCommand();
  return {
    name: '-VPORTS',
    async *run(ctx) {
      if (isPaperSpace(ctx.model, ctx.space) || ctx.viewport.current !== undefined)
        return yield* mview.run(ctx);
      if (ctx.space !== modelSpaceOf(ctx.model)) return ctx.message(VPORTS_IN_BLOCK_EDITOR);
      if (![...ctx.model.tables.vports.values()].some(isActiveVport))
        return ctx.message(NO_MODEL_VIEWPORT);
      yield* modelOptions(ctx, state);
    },
  };
}
