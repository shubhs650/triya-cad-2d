// VPLAYER (M6-02 part 5): layers frozen, thawed and overridden in layout viewports, on AutoCAD
// 2024's prompts (AutoCAD 2024 Help, "VPLAYER (Command)"):
//
//   Enter an option [?/Color/Ltype/LWeight/TRansparency/Freeze/Thaw/Reset/Newfrz/Vpvisdflt]:
//     ?:            Select a viewport:          its frozen layers listed
//     Color:        Enter a color [Truecolor/COlorbook]:  then the layers and the viewports
//     Ltype:        Enter a loaded linetype name or [?] <Continuous>:  then as Color
//     LWeight:      Enter lineweight (0.0mm - 2.11mm):  then as Color
//     TRansparency: Enter transparency value (0-90):  then as Color
//     Freeze:       Enter layer name(s) to freeze or <select objects>:
//                   Enter an option [All/Select/Current/Except current] <Current>:
//     Thaw, Reset:  Enter layer name(s) to thaw (reset):  Enter an option [All/Select/Current] <Current>:
//     Newfrz:       Enter name(s) of new layers frozen in all viewports:
//     Vpvisdflt:    Enter layer name(s) to change viewport visibility default:
//                   Enter a viewport visibility option [Frozen/Thawed] <Thawed>:
// asked again after each option until Enter, the whole command one VPLAYER undo step (the bus's
// record of the command). Name lists are names or wild-card patterns separated by commas, as
// -LAYER's (`matching`).
//
// Help's viewports: All "applies the changes in all viewports", Select "temporarily switches to
// paper space" to pick them (a clipped viewport by its boundary too), Current "applies the changes
// in the current viewport only", Except current "in all viewports except the current one". Help
// does not say which viewports All takes, nor what Current means in paper space and on the Model
// tab; settled for the common drafter expectation: All is every floating viewport of every layout
// (a layout's own sheet view, 69 = 1, is none), Current and Except current are offered only while
// a layout viewport is current (MSPACE), and Select only on a layout, so the Model tab offers All
// alone; the default is the first of Current, Select, All offered.
//
// Reset sets the layers' visibility in the viewports to their viewport visibility default
// (Vpvisdflt, DXF 70 bit 2); Newfrz makes layers as -LAYER New does (colour 7, Continuous) that
// are frozen in every floating viewport and by default in new ones (MVIEW's). PStyle is not
// offered: Triya does not plot by named plot style yet, so a plot style override would do
// nothing (`layout/viewport-layers.ts` does not read one either).
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { LayerRecord } from '../model/types';
import {
  freezeInViewports,
  NEW_VP_FROZEN,
  layoutViewports,
  resetInViewports,
  setNewViewportFrozen,
  setViewportOverrides,
  type ViewportOverrideProps,
} from '../edit/viewport-layer-edits';
import { parseColorValue, transparencyOf } from '../properties/sheet';
import { lineweightTyped } from './lweight';
import { selectedLayers } from './nested-pick';
import { isPaperSpace } from './bus';
import { viewportOfPick } from './vpclip';
import {
  colorAsked,
  colorLabel,
  linetypeAsked,
  lineweightLabel,
  makeLayer,
  makeProblem,
  matching,
  typed,
} from './layer';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const OPTIONS = [
  '?',
  'Color',
  'Ltype',
  'LWeight',
  'TRansparency',
  'Freeze',
  'Thaw',
  'Reset',
  'Newfrz',
  'Vpvisdflt',
];

const quoted = (s: string) => `"${s}"`;

/**
 * Viewports picked in paper space ("temporarily switches to paper space"): the viewport made
 * current is current again afterwards. `single` takes one ("Select a viewport").
 */
async function* pickViewports(
  ctx: CommandContext,
  message: string,
  single: boolean,
): Sub<Handle[]> {
  const was = ctx.viewport.current;
  if (was !== undefined) await ctx.viewport.set(undefined);
  try {
    const a = yield ctx.prompt.selection({ message, ...(single && { single: true }) });
    const ids = (a as { ids?: readonly EntityId[] }).ids ?? [];
    const out: Handle[] = [];
    for (const id of ids) {
      const v = viewportOfPick(ctx, ctx.model.entity(id));
      if (v && !out.includes(v.handle)) out.push(v.handle);
    }
    return out;
  } finally {
    if (was !== undefined && ctx.model.entityByHandle(was)) await ctx.viewport.set(was);
  }
}

/** "Enter an option [All/Select/Current(/Except current)]": the viewports it names. */
async function* viewportsAsked(ctx: CommandContext, except: boolean): Sub<Handle[]> {
  const current = ctx.viewport.current;
  const onLayout = current !== undefined || isPaperSpace(ctx.model, ctx.space);
  const options = [
    'All',
    ...(onLayout ? ['Select'] : []),
    ...(current !== undefined ? ['Current'] : []),
    ...(current !== undefined && except ? ['Except current'] : []),
  ];
  const fallback = current !== undefined ? 'Current' : onLayout ? 'Select' : 'All';
  const a = yield ctx.prompt.keyword({
    message: 'Enter an option',
    options,
    default: { kind: 'keyword', keyword: fallback },
  });
  // Enter takes the default, so the answer is always a keyword.
  const keyword = (a as { keyword: string }).keyword;
  const all = () => layoutViewports(ctx.model).map((v) => v.handle);
  switch (keyword) {
    case 'Current':
      return [current!];
    case 'Except current':
      return all().filter((h) => h !== current);
    case 'Select':
      return yield* pickViewports(ctx, 'Select objects', false);
    default:
      return all();
  }
}

/** A layer name list, or the layers of the objects selected at Enter (`select`). */
async function* layersAsked(
  ctx: CommandContext,
  message: string,
  select: boolean,
): Sub<LayerRecord[]> {
  const a = yield ctx.prompt.string({
    message: select ? `${message} or <select objects>` : message,
  });
  const list = typed(a);
  if (list !== '') return matching(ctx, list);
  if (!select) return [];
  const s = yield ctx.prompt.selection({ message: 'Select objects' });
  return s.kind === 'selection' ? selectedLayers(ctx, s, 'None') : [];
}

/** ?: the layers frozen in the viewport picked. */
async function* list(ctx: CommandContext): Sub<void> {
  if (ctx.viewport.current === undefined && !isPaperSpace(ctx.model, ctx.space)) {
    ctx.message('** Command not allowed in Model Tab **');
    return;
  }
  const [h] = yield* pickViewports(ctx, 'Select a viewport', true);
  const g = h === undefined ? undefined : ctx.model.entityByHandle(h)?.geom;
  if (g?.kind !== 'VIEWPORT') return;
  const names = g.frozenLayers.flatMap((l) => ctx.model.tables.layers.get(l)?.name ?? []);
  ctx.message(`Layers currently frozen in viewport ${g.id}:`);
  for (const n of names) ctx.message(`  ${n}`);
}

/** Color, Ltype, LWeight and TRansparency: one property overridden. */
async function* override(
  ctx: CommandContext,
  what: string,
  props: ViewportOverrideProps,
): Sub<void> {
  const layers = yield* layersAsked(ctx, `Enter layer name(s) to change ${what}`, true);
  if (layers.length === 0) return;
  const viewports = yield* viewportsAsked(ctx, false);
  if (viewports.length === 0) return;
  ctx.edit((b) =>
    setViewportOverrides(
      b,
      ctx.model,
      layers.map((l) => l.handle),
      viewports,
      props,
    ),
  );
}

async function* color(ctx: CommandContext): Sub<void> {
  const { value } = yield* colorAsked(ctx, 'Enter a color');
  const c = value === undefined ? undefined : parseColorValue(value);
  if (!c || (c.kind !== 'aci' && c.kind !== 'rgb')) {
    ctx.message('Invalid color.');
    return;
  }
  yield* override(ctx, `color to ${colorLabel(c)}`, { color: c });
}

async function* ltype(ctx: CommandContext): Sub<void> {
  const t = yield* linetypeAsked(ctx);
  if (t) yield* override(ctx, `linetype to ${quoted(t.name)}`, { linetype: t.handle });
}

async function* lweight(ctx: CommandContext): Sub<void> {
  const text = typed(yield ctx.prompt.string({ message: 'Enter lineweight (0.0mm - 2.11mm)' }));
  if (text === '') return;
  const w = lineweightTyped(text);
  if (w === undefined || w === 'ByLayer' || w === 'ByBlock') {
    ctx.message('Invalid lineweight.');
    return;
  }
  yield* override(ctx, `lineweight to ${lineweightLabel(w)}`, { lineweight: w });
}

async function* transparency(ctx: CommandContext): Sub<void> {
  const text = typed(yield ctx.prompt.string({ message: 'Enter transparency value (0-90)' }));
  if (text === '') return;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0 || n > 90) {
    ctx.message('Value must be between 0 and 90.');
    return;
  }
  yield* override(ctx, `transparency to ${n}%`, { transparency: transparencyOf(n) });
}

/** Freeze, Thaw and Reset. */
async function* visibility(ctx: CommandContext, kind: 'freeze' | 'thaw' | 'reset'): Sub<void> {
  const layers = yield* layersAsked(ctx, `Enter layer name(s) to ${kind}`, kind !== 'thaw');
  if (layers.length === 0) return;
  const viewports = yield* viewportsAsked(ctx, kind === 'freeze');
  if (viewports.length === 0) return;
  const handles = layers.map((l) => l.handle);
  ctx.edit((b) =>
    kind === 'reset'
      ? resetInViewports(b, ctx.model, handles, viewports)
      : freezeInViewports(b, ctx.model, handles, viewports, kind === 'freeze'),
  );
}

/** Newfrz: new layers frozen in every viewport and by default in new ones. */
async function* newFrozen(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({
    message: 'Enter name(s) of new layers frozen in all viewports',
  });
  const making: string[] = [];
  for (const name of typed(a)
    .split(',')
    .map((n) => n.trim())) {
    if (name === '') continue;
    const key = name.toUpperCase();
    const taken =
      [...ctx.model.tables.layers.values()].some((l) => l.name.toUpperCase() === key) ||
      making.some((m) => m.toUpperCase() === key);
    if (taken) {
      ctx.message(`Layer ${quoted(name)} already exists.`);
      continue;
    }
    const problem = makeProblem(ctx, name);
    if (problem) ctx.message(problem);
    else making.push(name);
  }
  if (making.length === 0) return;
  const viewports = layoutViewports(ctx.model).map((v) => v.handle);
  ctx.edit((b) => {
    const made: Handle[] = [];
    for (const name of making) {
      const l = makeLayer(ctx, b, name);
      if (typeof l !== 'string') made.push(l.handle);
    }
    for (const h of made) b.updateTableRecord('layers', h, { flags: NEW_VP_FROZEN });
    freezeInViewports(b, ctx.model, made, viewports, true);
  });
}

/** Vpvisdflt: the layers' viewport visibility default. */
async function* visibilityDefault(ctx: CommandContext): Sub<void> {
  const layers = yield* layersAsked(
    ctx,
    'Enter layer name(s) to change viewport visibility default',
    false,
  );
  if (layers.length === 0) return;
  const a = yield ctx.prompt.keyword({
    message: 'Enter a viewport visibility option',
    options: ['Frozen', 'Thawed'],
    default: { kind: 'keyword', keyword: 'Thawed' },
  });
  const frozen = a.kind === 'keyword' && a.keyword === 'Frozen';
  ctx.edit((b) =>
    setNewViewportFrozen(
      b,
      ctx.model,
      layers.map((l) => l.handle),
      frozen,
    ),
  );
}

function option(ctx: CommandContext, keyword: string): Sub<void> {
  switch (keyword) {
    case '?':
      return list(ctx);
    case 'Color':
      return color(ctx);
    case 'Ltype':
      return ltype(ctx);
    case 'LWeight':
      return lweight(ctx);
    case 'TRansparency':
      return transparency(ctx);
    case 'Freeze':
      return visibility(ctx, 'freeze');
    case 'Thaw':
      return visibility(ctx, 'thaw');
    case 'Reset':
      return visibility(ctx, 'reset');
    case 'Newfrz':
      return newFrozen(ctx);
    default:
      return visibilityDefault(ctx);
  }
}

export function vplayerCommand(): CommandDef {
  return {
    name: 'VPLAYER',
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      for (;;) {
        const a = yield ctx.prompt.keyword({ message: 'Enter an option', options: OPTIONS });
        if (a.kind !== 'keyword') return;
        yield* option(ctx, a.keyword);
      }
    },
  };
}
