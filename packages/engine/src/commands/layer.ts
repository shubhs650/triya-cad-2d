// LAYER (LA), LAYERCLOSE and -LAYER (M5-18), with AutoCAD 2024's prompts (AutoCAD Help,
// "LAYER (Command)", "LAYERCLOSE (Command)", "-LAYER (Command)"):
//
//   - LAYER opens the Layer Properties Manager, which is the app's Layers palette; LAYERCLOSE
//     closes it. Neither deselects.
//   - -LAYER: "Current layer:" then "Enter an option [?/Make/Set/New/Rename/ON/OFF/Color/Ltype/
//     LWeight/TRansparency/Plot/PStyle/Freeze/Thaw/LOck/Unlock/stAte/Description/rEconcile/Xref]" again
//     after each option, until Enter; PStyle only in a drawing with named plot styles ($PSTYLEMODE 0),
//     as Help says it is not available with color-dependent plot styles. Name lists are names or wild-card patterns separated by commas (WCMATCH, case
//     ignored); an Enter at "or <select objects>" takes the layers of the objects selected, and
//     one at "<current>" the current layer.
//
// Help's rules: Make makes a layer (color 7, Continuous, Default lineweight: "New layers default
// to color 7, CONTINUOUS linetype, and DEFAULT lineweight") or takes one that exists, turning it
// on, and makes it current; Set makes an existing layer current; neither takes a frozen layer.
// Color turns the layers on unless the colour is typed negative, which turns them off (the
// classic `-1` of scripts); an LWeight between AutoCAD's lineweights takes the nearest. The
// current layer is never frozen and is turned off only after a Yes. The whole command is one
// LAYER undo step (the bus's record of the command), none when nothing changed.
//
// PStyle (M5-18 part 2) asks "Enter plot style or [?] <Normal>" (a name of the drawing's
// ACAD_PLOTSTYLENAME; ? lists them) and then Help's "Enter name list of layer(s) for plot style
// current <current>". stAte is in layer-state-dash.ts and Xref (resetting xref layer
// overrides, M5-18 part 3) in layer-xref-dash.ts. MATerial is not offered: Triya has no
// materials (#195).
//
// rEconcile (M5-19; Help: "Sets the unreconciled property of an unreconciled layer", ? "Lists
// all unreconciled layers") asks "Enter name list of layer(s) to reconcile or [?]"; the layers
// named that an xref load flagged as new (LAYEREVAL, model/xref.ts) are reconciled. Help gives
// no messages: ? lists the unreconciled layers' names one per line (or says there are none) and
// asks again; a list naming only reconciled layers says so.
//
// Ambiguities, settled for the common drafter expectation (Help gives no messages): a frozen
// layer at Make or Set says `Cannot make frozen layer "X" current.`; ? lists each layer's name,
// state (On or Off, then Frozen and Locked), colour, linetype, lineweight, transparency and plot
// setting, one per line, then the current layer; a name list matching nothing says "No matching
// layer names found." as -XREF's lists do. Typed names end at a space, as scripts expect (Space
// is Enter); Description's text keeps its spaces.
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { Handle } from '../model/handle';
import type { Color, LayerRecord, LinetypeRecord, Lineweight } from '../model/types';
import { ChangeSetBuilder } from '../model/builder';
import { isEmptyChangeSet } from '../model/changeset';
import { newLayer, setLayerProps, type LayerProps } from '../edit/layer-manager';
import { parseColorValue, transparencyOf, transparencyValue } from '../properties/sheet';
import { bookColor, colorFromText } from './modify/chprop';
import { wcmatch } from './modify/attributes';
import { lineweightTyped } from './lweight';
import { selectedLayers } from './nested-pick';
import { viewRequest } from './view/zoom';
import { layerStateOption } from './layer-state-dash';
import { layerXrefOption } from './layer-xref-dash';
import { namedPlotStyles } from '../properties/general';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const OPTIONS = [
  '?',
  'Make',
  'Set',
  'New',
  'Rename',
  'ON',
  'OFF',
  'Color',
  'Ltype',
  'LWeight',
  'TRansparency',
  'Plot',
  'PStyle',
  'Freeze',
  'Thaw',
  'LOck',
  'Unlock',
  'stAte',
  'Description',
  'rEconcile',
  'Xref',
];

/** -LAYER's options in the drawing: PStyle only with named plot styles. */
const optionsOf = (ctx: CommandContext) =>
  namedPlotStyles(ctx.model) ? OPTIONS : OPTIONS.filter((o) => o !== 'PStyle');

const COLOR_NAMES = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'white'];
const quoted = (s: string) => `"${s}"`;
const upper = (s: string) => s.toUpperCase();
export const NO_MATCH = 'No matching layer names found.';

const layersOf = (ctx: CommandContext) => [...ctx.model.tables.layers.values()];

function named(ctx: CommandContext, name: string): LayerRecord | undefined {
  const key = upper(name.trim());
  return layersOf(ctx).find((l) => upper(l.name) === key);
}

export function current(ctx: CommandContext): LayerRecord | undefined {
  const c = ctx.model.header.get('$CLAYER');
  return typeof c === 'string' ? named(ctx, c) : undefined;
}

/** A colour as -LAYER names it: "1 (red)", "30", "10,20,30" or "BOOK$COLOR". */
export function colorLabel(c: Color): string {
  if (c.kind === 'aci') {
    const name = COLOR_NAMES[c.index - 1];
    return name ? `${c.index} (${name})` : String(c.index);
  }
  if (c.kind === 'rgb')
    return c.bookName ? `${c.bookName}$${c.colorName ?? ''}` : `${c.r},${c.g},${c.b}`;
  return c.kind === 'byLayer' ? 'BYLAYER' : 'BYBLOCK';
}

export const lineweightLabel = (w: Lineweight) =>
  typeof w === 'number' ? `${(w / 100).toFixed(2)}mm` : String(w);

/** `props` set on `layers` in one edit, or why not (said); nothing built when nothing changes. */
function apply(ctx: CommandContext, layers: readonly LayerRecord[], props: LayerProps): void {
  if (layers.length === 0) return;
  const handles = layers.map((l) => l.handle);
  const probe = new ChangeSetBuilder(ctx.model);
  const problem = setLayerProps(probe, ctx.model, handles, props);
  if (problem) {
    ctx.message(problem);
    return;
  }
  if (isEmptyChangeSet(probe.build())) return;
  ctx.edit((b) => void setLayerProps(b, ctx.model, handles, props));
}

/** What was typed, trimmed; '' for Enter (Esc never reaches a command: the bus ends it). */
export const typed = (a: PromptAnswer): string => (a.kind === 'string' ? a.value.trim() : '');

/** The layers a name list (names or patterns, comma separated) matches; said when none. */
export function matching(ctx: CommandContext, list: string): LayerRecord[] {
  const found = layersOf(ctx).filter((l) => wcmatch(l.name, list));
  if (found.length === 0) ctx.message(NO_MATCH);
  return found;
}

/**
 * "Enter name list of layer(s) …": the layers named; at Enter, those of the objects selected
 * (`select`), the current layer (`current`) or none.
 */
async function* nameList(
  ctx: CommandContext,
  message: string,
  enter: 'select' | 'current' | 'none',
): Sub<LayerRecord[]> {
  const cur = current(ctx);
  const a = yield ctx.prompt.string({
    message: enter === 'select' ? `${message} or <select objects>` : message,
    ...(enter === 'current' && cur && { defaultLabel: cur.name }),
  });
  const list = typed(a);
  if (list !== '') return matching(ctx, list);
  if (enter === 'current') return cur ? [cur] : [];
  if (enter === 'none') return [];
  const s = yield ctx.prompt.selection({ message: 'Select objects' });
  return s.kind === 'selection' ? selectedLayers(ctx, s, 'None') : [];
}

/** `?`: the layers named, one per line, then the current layer. */
async function* list(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({
    message: 'Enter layer name(s) to list',
    default: { kind: 'string', value: '*' },
  });
  const layers = matching(ctx, typed(a) || '*');
  if (layers.length === 0) return;
  const linetype = (h: Handle) => ctx.model.tables.linetypes.get(h)?.name ?? '';
  const state = (l: LayerRecord) =>
    [l.on ? 'On' : 'Off', ...(l.frozen ? ['Frozen'] : []), ...(l.locked ? ['Locked'] : [])].join(
      ' ',
    );
  const rows = [
    ['Layer name', 'State', 'Color', 'Linetype', 'Lineweight', 'Transparency', 'Plot'],
    ...layers.map((l) => [
      quoted(l.name),
      state(l),
      colorLabel(l.color),
      quoted(linetype(l.linetype)),
      lineweightLabel(l.lineweight),
      String(transparencyValue(l.transparency)),
      l.plot ? 'Plot' : 'No plot',
    ]),
  ];
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)) + 2);
  for (const r of rows)
    ctx.message(
      r
        .map((c, i) => c.padEnd(widths[i]!))
        .join('')
        .trimEnd(),
    );
  const cur = current(ctx);
  if (cur) ctx.message(`Current layer:  ${quoted(cur.name)}`);
}

/** `layer` made current, unless frozen (said); a layer that is off is turned on. */
function makeCurrent(ctx: CommandContext, layer: LayerRecord): void {
  if (layer.frozen) {
    ctx.message(`Cannot make frozen layer ${quoted(layer.name)} current.`);
    return;
  }
  if (layer.on && current(ctx)?.handle === layer.handle) return;
  ctx.edit((b) => {
    if (!layer.on) b.updateTableRecord('layers', layer.handle, { on: true });
    b.setHeader('$CLAYER', layer.name);
  });
}

/**
 * A new layer as -LAYER makes it, into `b`: color 7, Continuous, Default lineweight, opaque,
 * otherwise as layer 0 (on, thawed, unlocked, plotted unless layer 0 is not); why not, else.
 */
export function makeLayer(
  ctx: CommandContext,
  b: ChangeSetBuilder,
  name: string,
): LayerRecord | string {
  const continuous = [...ctx.model.tables.linetypes.values()].find(
    (t) => upper(t.name) === 'CONTINUOUS',
  );
  const zero = named(ctx, '0') ?? layersOf(ctx)[0]!;
  const made = newLayer(b, ctx.model, zero.handle, name, {
    color: { kind: 'aci', index: 7 },
    linetype: continuous?.handle ?? zero.linetype,
    lineweight: 'Default',
    transparency: { alpha: 255 },
  });
  return made;
}

/** Why -LAYER cannot make a layer named `name`, or undefined. */
export function makeProblem(ctx: CommandContext, name: string): string | undefined {
  const made = makeLayer(ctx, new ChangeSetBuilder(ctx.model), name);
  return typeof made === 'string' ? made : undefined;
}

async function* make(ctx: CommandContext): Sub<void> {
  const cur = current(ctx);
  const a = yield ctx.prompt.string({
    message: 'Enter name for new layer (becomes the current layer)',
    ...(cur && { defaultLabel: cur.name }),
  });
  const name = typed(a);
  if (name === '') return;
  const existing = named(ctx, name);
  if (existing) {
    makeCurrent(ctx, existing);
    return;
  }
  const problem = makeProblem(ctx, name);
  if (problem) {
    ctx.message(problem);
    return;
  }
  ctx.edit((b) => {
    makeLayer(ctx, b, name);
    b.setHeader('$CLAYER', name);
  });
}

async function* set(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({
    message: 'Enter layer name to make current or <select object>',
  });
  const name = typed(a);
  if (name !== '') {
    const layer = named(ctx, name);
    if (layer) makeCurrent(ctx, layer);
    else ctx.message(`Cannot find layer ${quoted(name)}.`);
    return;
  }
  const s = yield ctx.prompt.selection({ message: 'Select object', single: true });
  const [layer] = s.kind === 'selection' ? await selectedLayers(ctx, s, 'None') : [];
  if (layer) makeCurrent(ctx, layer);
}

async function* create(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({ message: 'Enter name list for new layer(s)' });
  const making: string[] = [];
  for (const name of typed(a)
    .split(',')
    .map((n) => n.trim())) {
    if (name === '') continue;
    if (named(ctx, name) || making.some((m) => upper(m) === upper(name))) {
      ctx.message(`Layer ${quoted(name)} already exists.`);
      continue;
    }
    const problem = makeProblem(ctx, name);
    if (problem) ctx.message(problem);
    else making.push(name);
  }
  if (making.length === 0) return;
  ctx.edit((b) => {
    for (const name of making) makeLayer(ctx, b, name);
  });
}

async function* rename(ctx: CommandContext): Sub<void> {
  const old = typed(yield ctx.prompt.string({ message: 'Enter old layer name' }));
  if (old === '') return;
  const layer = named(ctx, old);
  if (!layer) {
    ctx.message(`Cannot find layer ${quoted(old)}.`);
    return;
  }
  const name = typed(yield ctx.prompt.string({ message: 'Enter new layer name' }));
  if (name !== '') apply(ctx, [layer], { name });
}

/** A Yes to "<question> <N>", Enter taking No. */
async function* yes(ctx: CommandContext, message: string): Sub<boolean> {
  const y = yield ctx.prompt.keyword({ message, hiddenOptions: ['Yes', 'No'], defaultLabel: 'N' });
  return y.kind === 'keyword' && y.keyword === 'Yes';
}

async function* turnOff(ctx: CommandContext): Sub<void> {
  const layers = yield* nameList(ctx, 'Enter name list of layer(s) to turn off', 'select');
  const cur = current(ctx);
  let off = layers.filter((l) => l.on);
  if (cur && off.some((l) => l.handle === cur.handle)) {
    const really = yield* yes(
      ctx,
      `Really want layer ${quoted(cur.name)} (the CURRENT layer) off?`,
    );
    if (!really) off = off.filter((l) => l.handle !== cur.handle);
  }
  apply(ctx, off, { on: false });
}

async function* freeze(ctx: CommandContext): Sub<void> {
  const layers = yield* nameList(ctx, 'Enter name list of layer(s) to freeze', 'select');
  const cur = current(ctx);
  const freezing = layers.filter((l) => {
    if (l.handle !== cur?.handle) return true;
    ctx.message(`Cannot freeze layer ${quoted(l.name)}.  It is the CURRENT layer.`);
    return false;
  });
  apply(ctx, freezing, { frozen: true });
}

/** "New color [Truecolor/COlorbook]": the colour's choice value, and whether typed negative. */
export async function* colorAsked(
  ctx: CommandContext,
  message = 'New color',
): Sub<{ value?: string; off: boolean }> {
  const a = yield ctx.prompt.string({ message, options: ['Truecolor', 'COlorbook'] });
  if (a.kind === 'keyword' && a.keyword === 'COlorbook') {
    const value = yield* bookColor(ctx);
    return { ...(value !== undefined && { value }), off: false };
  }
  if (a.kind === 'keyword') {
    const rgb = typed(yield ctx.prompt.string({ message: 'Red, Green, Blue' }));
    const m = /^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/.exec(rgb);
    return { ...(m && { value: `rgb:${m[1]},${m[2]},${m[3]}` }), off: false };
  }
  const t = typed(a);
  const off = t.startsWith('-');
  const value = colorFromText(off ? t.slice(1) : t);
  return { ...(value !== undefined && { value }), off };
}

async function* color(ctx: CommandContext): Sub<void> {
  const { value, off } = yield* colorAsked(ctx);
  const c = value === undefined ? undefined : parseColorValue(value);
  if (!c || (c.kind !== 'aci' && c.kind !== 'rgb')) {
    ctx.message('Invalid color.');
    return;
  }
  const label = colorLabel(c);
  const layers = yield* nameList(ctx, `Enter name list of layer(s) for color ${label}`, 'current');
  apply(ctx, layers, { color: c, on: !off });
}

/** "Enter a loaded linetype name or [?] <Continuous>": the linetype, or undefined (said). */
export async function* linetypeAsked(
  ctx: CommandContext,
  message = 'Enter a loaded linetype name or',
): Sub<LinetypeRecord | undefined> {
  const linetypes = [...ctx.model.tables.linetypes.values()];
  let a: PromptAnswer;
  for (;;) {
    a = yield ctx.prompt.string({
      message,
      options: ['?'],
      defaultLabel: 'Continuous',
    });
    if (a.kind !== 'keyword') break;
    const width = Math.max(...linetypes.map((t) => t.name.length)) + 2;
    for (const t of linetypes) ctx.message(`${t.name.padEnd(width)}${t.description}`.trimEnd());
  }
  const name = typed(a) || 'Continuous';
  const t = linetypes.find((x) => upper(x.name) === upper(name));
  if (!t) {
    ctx.message(`Linetype ${quoted(name)} is not loaded.  Use the LINETYPE command to load it.`);
    return undefined;
  }
  return t;
}

async function* ltype(ctx: CommandContext): Sub<void> {
  const t = yield* linetypeAsked(ctx);
  if (!t) return;
  const message = `Enter name list of layer(s) for linetype ${quoted(t.name)}`;
  apply(ctx, yield* nameList(ctx, message, 'current'), { linetype: t.handle });
}

async function* lweight(ctx: CommandContext): Sub<void> {
  const text = typed(yield ctx.prompt.string({ message: 'Enter lineweight (0.0mm - 2.11mm)' }));
  if (text === '') return;
  const w = lineweightTyped(text);
  if (w === undefined || w === 'ByLayer' || w === 'ByBlock') {
    ctx.message('Invalid lineweight.');
    return;
  }
  // AutoCAD's own prompt says "layers(s)".
  const message = `Enter name list of layers(s) for lineweight ${lineweightLabel(w)}`;
  apply(ctx, yield* nameList(ctx, message, 'current'), { lineweight: w });
}

async function* transparency(ctx: CommandContext): Sub<void> {
  const text = typed(yield ctx.prompt.string({ message: 'Enter transparency value (0-90)' }));
  if (text === '') return;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0 || n > 90) {
    ctx.message('Value must be between 0 and 90.');
    return;
  }
  const message = `Enter name list of layer(s) for transparency ${n}%`;
  apply(ctx, yield* nameList(ctx, message, 'current'), { transparency: transparencyOf(n) });
}

async function* plot(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.keyword({
    message: 'Enter a plotting preference',
    options: ['Plot', 'No plot'],
    default: { kind: 'keyword', keyword: 'Plot' },
  });
  const plots = !(a.kind === 'keyword' && a.keyword === 'No plot');
  const layers = yield* nameList(ctx, 'Enter layer name(s) for this plot preference', 'current');
  apply(ctx, layers, { plot: plots });
}

/** "Enter plot style or [?] <Normal>": a named plot style of the drawing, ? listing them. */
async function* plotStyle(ctx: CommandContext): Sub<void> {
  const styles = [...ctx.model.tables.plotStyles.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  let a: PromptAnswer;
  for (;;) {
    a = yield ctx.prompt.string({
      message: 'Enter plot style or',
      options: ['?'],
      defaultLabel: 'Normal',
    });
    if (a.kind !== 'keyword') break;
    const pattern =
      typed(
        yield ctx.prompt.string({
          message: 'Enter plot style(s) to list',
          default: { kind: 'string', value: '*' },
        }),
      ) || '*';
    for (const s of styles) if (wcmatch(s.name, pattern)) ctx.message(s.name);
  }
  const name = typed(a) || 'Normal';
  const style = styles.find((s) => upper(s.name) === upper(name));
  if (!style) {
    ctx.message(`Cannot find plot style ${quoted(name)}.`);
    return;
  }
  // Help's own prompt, "current" and all.
  const message = 'Enter name list of layer(s) for plot style current';
  apply(ctx, yield* nameList(ctx, message, 'current'), { plotStyle: style.handle });
}

async function* describe(ctx: CommandContext): Sub<void> {
  const text = typed(yield ctx.prompt.string({ message: 'Enter layer description', spaces: true }));
  const message = 'Enter name list of layer(s) to apply description';
  const layers = yield* nameList(ctx, message, 'select');
  const replacing = layers.some((l) => l.description && l.description !== text);
  const override =
    replacing &&
    (yield* yes(ctx, 'Layer description already exists. Override existing description?'));
  apply(ctx, override ? layers : layers.filter((l) => !l.description), { description: text });
}

/** rEconcile: the unreconciled layers named are reconciled; ? lists them. */
async function* reconcile(ctx: CommandContext): Sub<void> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter name list of layer(s) to reconcile or',
      options: ['?'],
    });
    if (a.kind === 'keyword') {
      const names = layersOf(ctx)
        .filter((l) => l.unreconciled)
        .map((l) => l.name)
        .sort((x, y) => x.localeCompare(y));
      if (names.length === 0) ctx.message('No unreconciled layers found.');
      for (const n of names) ctx.message(n);
      continue;
    }
    const text = typed(a);
    if (text === '') return;
    const found = matching(ctx, text);
    const layers = found.filter((l) => l.unreconciled);
    if (found.length > 0 && layers.length === 0) ctx.message('No unreconciled layers matched.');
    apply(ctx, layers, { reconcile: true });
    return;
  }
}

/** "Enter name list of layer(s) to <verb>" setting `props` on the layers named. */
async function* flags(
  ctx: CommandContext,
  verb: string,
  enter: 'select' | 'none',
  props: LayerProps,
): Sub<void> {
  apply(ctx, yield* nameList(ctx, `Enter name list of layer(s) to ${verb}`, enter), props);
}

/** One option of -LAYER. */
function option(ctx: CommandContext, keyword: string): Sub<void> {
  switch (keyword) {
    case '?':
      return list(ctx);
    case 'Make':
      return make(ctx);
    case 'Set':
      return set(ctx);
    case 'New':
      return create(ctx);
    case 'Rename':
      return rename(ctx);
    case 'ON':
      return flags(ctx, 'turn On', 'none', { on: true });
    case 'OFF':
      return turnOff(ctx);
    case 'Color':
      return color(ctx);
    case 'Ltype':
      return ltype(ctx);
    case 'LWeight':
      return lweight(ctx);
    case 'TRansparency':
      return transparency(ctx);
    case 'Plot':
      return plot(ctx);
    case 'PStyle':
      return plotStyle(ctx);
    case 'stAte':
      return layerStateOption(ctx);
    case 'rEconcile':
      return reconcile(ctx);
    case 'Xref':
      return layerXrefOption(ctx);
    case 'Freeze':
      return freeze(ctx);
    case 'Thaw':
      return flags(ctx, 'thaw', 'none', { frozen: false });
    case 'LOck':
      return flags(ctx, 'lock', 'select', { locked: true });
    case 'Unlock':
      return flags(ctx, 'unlock', 'select', { locked: false });
    default:
      return describe(ctx);
  }
}

export function layerCommand(): CommandDef {
  return {
    name: 'LAYER',
    dashVariant: true,
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      if (!ctx.dash) {
        await viewRequest(ctx, { op: 'palette', palette: 'layers', open: true });
        return;
      }
      const cur = current(ctx);
      if (cur) ctx.message(`Current layer:  ${quoted(cur.name)}`);
      for (;;) {
        const a = yield ctx.prompt.keyword({ message: 'Enter an option', options: optionsOf(ctx) });
        if (a.kind !== 'keyword') return;
        yield* option(ctx, a.keyword);
      }
    },
  };
}

export function layerCloseCommand(): CommandDef {
  return {
    name: 'LAYERCLOSE',
    usesSelection: 'none',
    keepsSelection: true,
    // eslint-disable-next-line require-yield -- the host closes the palette
    async *run(ctx) {
      await viewRequest(ctx, { op: 'palette', palette: 'layers', open: false });
    },
  };
}
