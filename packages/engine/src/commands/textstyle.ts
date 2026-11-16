// STYLE (ST, DDSTYLE; M4-04): the Text Style dialog (AutoCAD 2024 Help, "STYLE (Command)",
// "Text Style Dialog Box", "New Text Style Dialog Box") and -STYLE ("-STYLE (Command)").
//
// The dialog lists the drawing's named styles (all, or those in use) with the current one
// (TEXTSTYLE); Set Current, New..., Apply, Delete and the list's shortcut menu (Set current,
// Rename, Delete) act on the style selected. Each action is made at once and the dialog opens
// again on the style it left selected; Close ends the command, everything it did one undo step.
// Text drawn in a style takes its new font, effects and width at once (the renderer reads the
// style), as AutoCAD regenerates it; a TEXT keeps the height, width and oblique angle it holds.
//
// A shape file's nameless style (DXF 70 bit 1, what LTYPE shapes load) is not listed, as
// AutoCAD lists none; an xref's style is, read only. Annotative is shown and never set: Triya
// makes no annotative objects (DEC-013, DEC-058).
//
// -STYLE asks the name (a new one makes a style, an existing one changes it), the font file
// (`romans.shx,bigfont.shx` names a big font too), the height, width factor, obliquing angle,
// backwards and upside-down, and for an SHX font vertical, then makes the style current.
// AutoCAD asks "Vertical?" only of a font with vertical glyphs; the engine has no fonts, so it
// asks of every SHX font, and the renderer draws one without them horizontally (M1-110).
import type { CommandContext, CommandDef } from './command';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { TextStyleRecord } from '../model/types';
import type { Prompt, PromptAnswer } from './prompt';
import { currentTextStyle, textSize } from './draw/text';
import { validViewName } from '../edit/named-view';
import { wcmatch } from './modify/attributes';
import { drawingUnits, formatAngle, formatDistance } from './units';

/** What the dialog shows of a style: its Font, Size and Effects groups. */
export interface TextStyleSettings {
  /** Font Name: the font file (DXF 3). */
  readonly font: string;
  /** Use Big Font's file (DXF 4); empty for none. An SHX font's only. */
  readonly bigFont: string;
  /** Font Style: a TrueType font's only. */
  readonly bold: boolean;
  readonly italic: boolean;
  /** 0: asked for when text is placed. */
  readonly height: number;
  readonly widthFactor: number;
  /** Degrees, −85 to 85. */
  readonly obliqueAngle: number;
  readonly backwards: boolean;
  readonly upsideDown: boolean;
  /** An SHX font's only (DXF 70 bit 4). */
  readonly vertical: boolean;
}

/** One style in the dialog's list. */
export interface TextStyleRow {
  readonly name: string;
  readonly settings: TextStyleSettings;
  /** Text, a dimension style, a multileader or table style, … uses it ("Styles in use"). */
  readonly used: boolean;
  /** An xref's (DXF 70 bit 16): listed, not changed. */
  readonly xref: boolean;
  /** The style is annotative (`AcadAnnotative` xdata), which the dialog shows only. */
  readonly annotative: boolean;
}

/** The Text Style dialog as STYLE opens it. */
export interface TextStyleRequest {
  readonly type: 'textstyle';
  readonly styles: readonly TextStyleRow[];
  /** TEXTSTYLE's style. */
  readonly current: string;
  readonly selected: string;
  /** The font files the drawing's styles name, for the Font Name list. */
  readonly fonts: readonly string[];
  /** The big font files they name, for the Big Font list. */
  readonly bigFonts: readonly string[];
  /** Why the last action did nothing ("Style in use, can't be deleted."). */
  readonly note?: string;
}

/** What a Text Style dialog button or shortcut menu choice asks of STYLE. */
export type TextStyleAction =
  | { readonly op: 'current'; readonly name: string }
  /** New...'s name, with the settings the dialog shows. */
  | { readonly op: 'new'; readonly name: string; readonly settings: TextStyleSettings }
  | { readonly op: 'apply'; readonly name: string; readonly settings: TextStyleSettings }
  | { readonly op: 'rename'; readonly name: string; readonly to: string }
  | { readonly op: 'delete'; readonly name: string };

/** DXF 70: a shape file's style; xref-dependent; vertical text. */
const SHAPE_FILE = 1;
const VERTICAL = 4;
const XREF_DEPENDENT = 16;
/** DXF 71. */
const BACKWARD = 2;
const UPSIDE_DOWN = 4;
/** `trueTypeFlags`. */
const ITALIC = 1;
const BOLD = 2;
/** AutoCAD's ranges for the Text Style dialog's Width Factor and Oblique Angle. */
const MIN_WIDTH = 0.01;
const MAX_WIDTH = 100;
const MAX_OBLIQUE = 85;

const DEG = Math.PI / 180;
const upper = (s: string) => s.toUpperCase();
const isShapeFile = (s: TextStyleRecord) => ((s.flags ?? 0) & SHAPE_FILE) !== 0;
const isXref = (s: TextStyleRecord) => ((s.flags ?? 0) & XREF_DEPENDENT) !== 0;

/** Whether a font file is TrueType or OpenType (bold and italic) rather than SHX. */
export function isTrueTypeFont(font: string): boolean {
  return /\.(ttf|ttc|otf)$/i.test(font.trim());
}

/** A style as the dialog shows it. */
export function textStyleSettings(s: TextStyleRecord): TextStyleSettings {
  return {
    font: s.font,
    bigFont: s.bigFont ?? '',
    bold: (s.trueTypeFlags & BOLD) !== 0,
    italic: (s.trueTypeFlags & ITALIC) !== 0,
    height: s.height,
    widthFactor: s.widthFactor,
    obliqueAngle: Number((s.obliqueAngle / DEG).toPrecision(12)),
    backwards: (s.generation & BACKWARD) !== 0,
    upsideDown: (s.generation & UPSIDE_DOWN) !== 0,
    vertical: ((s.flags ?? 0) & VERTICAL) !== 0,
  };
}

/** Why settings cannot be a style's (AutoCAD's own messages, where it has them). */
export function textStyleProblem(s: TextStyleSettings): string | undefined {
  if (typeof s.font !== 'string' || s.font.trim() === '') return 'Choose a font.';
  if (!(Number.isFinite(s.height) && s.height >= 0)) return 'Height must be 0 or more.';
  if (!(Number.isFinite(s.widthFactor) && s.widthFactor >= MIN_WIDTH && s.widthFactor <= MAX_WIDTH))
    return 'Width factor must be between 0.01 and 100.';
  if (!(Number.isFinite(s.obliqueAngle) && Math.abs(s.obliqueAngle) <= MAX_OBLIQUE))
    return 'Oblique angle must be between -85 and 85.';
  return undefined;
}

/** Whether the bus brought settings the dialog can give (it takes any object). */
function wellFormed(s: unknown): s is TextStyleSettings {
  if (typeof s !== 'object' || s === null) return false;
  const v = s as Record<string, unknown>;
  return (
    typeof v.font === 'string' &&
    typeof v.bigFont === 'string' &&
    ['bold', 'italic', 'backwards', 'upsideDown', 'vertical'].every(
      (k) => typeof v[k] === 'boolean',
    ) &&
    ['height', 'widthFactor', 'obliqueAngle'].every((k) => typeof v[k] === 'number')
  );
}

/**
 * The record fields `s` sets, given the record's own (`was`): what the font cannot have is
 * dropped (bold and italic need TrueType; a big font and vertical text need SHX), and an oblique
 * angle the dialog showed unchanged keeps the record's radians.
 */
export function recordFields(
  s: TextStyleSettings,
  was: TextStyleRecord | undefined,
): Pick<
  TextStyleRecord,
  'font' | 'height' | 'widthFactor' | 'obliqueAngle' | 'generation' | 'trueTypeFlags'
> & { bigFont: string | undefined; flags: number } {
  const font = s.font.trim();
  const ttf = isTrueTypeFont(font);
  const bigFont = s.bigFont.trim();
  const shown = was ? textStyleSettings(was).obliqueAngle : undefined;
  const flags = ((was?.flags ?? 0) & ~VERTICAL) | (!ttf && s.vertical ? VERTICAL : 0);
  return {
    font,
    bigFont: !ttf && bigFont !== '' ? bigFont : undefined,
    height: s.height,
    widthFactor: s.widthFactor,
    obliqueAngle: was && shown === s.obliqueAngle ? was.obliqueAngle : s.obliqueAngle * DEG,
    generation:
      ((was?.generation ?? 0) & ~(BACKWARD | UPSIDE_DOWN)) |
      (s.backwards ? BACKWARD : 0) |
      (s.upsideDown ? UPSIDE_DOWN : 0),
    trueTypeFlags:
      ((was?.trueTypeFlags ?? 0) & ~(BOLD | ITALIC)) |
      (ttf && s.bold ? BOLD : 0) |
      (ttf && s.italic ? ITALIC : 0),
    flags,
  };
}

function styleNamed(model: DocumentModel, name: string): TextStyleRecord | undefined {
  if (typeof name !== 'string') return undefined;
  for (const s of model.tables.textStyles.values())
    if (!isShapeFile(s) && upper(s.name) === upper(name)) return s;
  return undefined;
}

/** Keys under which the model names a text style by handle. */
const STYLE_KEYS = new Set(['style', 'textStyle', 'DIMTXSTY']);

/** Adds to `out` the text styles of `handles` that `v` names under a style key, at any depth. */
function collect(v: unknown, handles: ReadonlySet<string>, out: Set<Handle>): void {
  if (Array.isArray(v)) {
    // Coordinate lists (vertices, knots) hold no styles.
    const first: unknown = v[0];
    if (typeof first === 'number' || (typeof first === 'object' && first !== null && 'x' in first))
      return;
    for (const x of v) collect(x, handles, out);
    return;
  }
  if (typeof v !== 'object' || v === null) return;
  for (const [k, x] of Object.entries(v)) {
    if (STYLE_KEYS.has(k) && typeof x === 'string') {
      if (handles.has(x)) out.add(x as Handle);
    } else if (typeof x === 'object') collect(x, handles, out);
  }
}

/**
 * The text styles in use: named by text, attributes, multileaders, tables and the like (in any
 * block), by a dimension, multileader or table style, or by the header's DIMTXSTY. A handle names
 * one record only, so a `style` key naming a dimension style never matches a text style.
 */
export function usedTextStyles(model: DocumentModel): Set<Handle> {
  const handles = new Set<string>(model.tables.textStyles.keys());
  const out = new Set<Handle>();
  for (const e of model.entities()) collect(e.geom, handles, out);
  for (const table of ['dimStyles', 'mleaderStyles', 'tableStyles'] as const)
    for (const r of model.tables[table].values()) collect(r, handles, out);
  const dimtxsty = model.header.get('$DIMTXSTY');
  const named = typeof dimtxsty === 'string' ? styleNamed(model, dimtxsty) : undefined;
  if (named) out.add(named.handle);
  return out;
}

/** Whether a style carries the annotative property (`AcadAnnotative` xdata, its flag 1). */
function isAnnotative(model: DocumentModel, s: TextStyleRecord): boolean {
  return (s.xdata ?? []).some((x) => {
    if (upper(model.tables.appIds.get(x.appId)?.name ?? '') !== 'ACADANNOTATIVE') return false;
    const ints = x.values.filter((v) => v.code === 1070).map((v) => v.value);
    return ints[1] === 1;
  });
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/** The dialog as it opens on `selected`. */
export function textStyleRequest(
  model: DocumentModel,
  selected?: string,
  note?: string,
): TextStyleRequest {
  const listed = [...model.tables.textStyles.values()]
    .filter((s) => !isShapeFile(s))
    .sort((a, b) => byName(a.name, b.name));
  const used = usedTextStyles(model);
  const current = currentTextStyle(model);
  const shown = selected === undefined ? undefined : styleNamed(model, selected);
  const unique = (names: string[]) =>
    [...new Map(names.filter((n) => n !== '').map((n) => [upper(n), n])).values()].sort(byName);
  return {
    type: 'textstyle',
    styles: listed.map((s) => ({
      name: s.name,
      settings: textStyleSettings(s),
      used: used.has(s.handle),
      xref: isXref(s),
      annotative: isAnnotative(model, s),
    })),
    current: current?.name ?? '',
    selected: shown?.name ?? current?.name ?? listed[0]?.name ?? '',
    fonts: unique(listed.map((s) => s.font.trim())),
    bigFonts: unique(listed.map((s) => (s.bigFont ?? '').trim())),
    ...(note !== undefined && { note }),
  };
}

const NAME_IN_USE = 'A text style with this name already exists.';
const NAME_INVALID = 'Invalid text style name.';

/** Why `name` cannot name a new or renamed style (`except`: the style being renamed). */
function nameProblem(model: DocumentModel, name: string, except?: Handle): string | undefined {
  // `|` names an xref's styles.
  if (!validViewName(name) || name.includes('|')) return NAME_INVALID;
  const other = styleNamed(model, name);
  return other && other.handle !== except ? NAME_IN_USE : undefined;
}

/** Adds a style named `name` with `s`, as AutoCAD's STYLE makes one. */
function addStyle(b: ChangeSetBuilder, model: DocumentModel, name: string, s: TextStyleSettings) {
  const { bigFont, ...fields } = recordFields(s, undefined);
  return b.addTableRecord('textStyles', {
    name,
    ...fields,
    ...(bigFont !== undefined && { bigFont }),
    // DXF 42, the height last used: the style's own, else TEXTSIZE.
    lastHeight: s.height > 0 ? s.height : textSize(model),
  });
}

/** The record patch that sets `s` on `style`; undefined when it changes nothing. */
function changedFields(style: TextStyleRecord, s: TextStyleSettings) {
  const { flags, ...f } = recordFields(s, style);
  const same =
    f.font === style.font &&
    f.bigFont === style.bigFont &&
    f.height === style.height &&
    f.widthFactor === style.widthFactor &&
    f.obliqueAngle === style.obliqueAngle &&
    f.generation === style.generation &&
    f.trueTypeFlags === style.trueTypeFlags &&
    flags === (style.flags ?? 0);
  if (same) return undefined;
  return flags === (style.flags ?? 0) ? f : { ...f, flags };
}

/** Sets `s` on the style, if it says anything new. */
function updateStyle(b: ChangeSetBuilder, style: TextStyleRecord, s: TextStyleSettings): void {
  const patch = changedFields(style, s);
  if (patch) b.updateTableRecord('textStyles', style.handle, patch);
}

/** Makes `a`; what to show next (the style left selected, a refusal). */
function act(ctx: CommandContext, a: TextStyleAction): { selected?: string; note?: string } {
  const model = ctx.model;
  const current = currentTextStyle(model);
  switch (a.op) {
    case 'current': {
      const s = styleNamed(model, a.name);
      if (!s) return {};
      if (isXref(s))
        return { selected: s.name, note: 'An xref-dependent text style cannot be made current.' };
      if (s.name !== model.header.get('$TEXTSTYLE'))
        ctx.edit((b) => b.setHeader('$TEXTSTYLE', s.name));
      return { selected: s.name };
    }
    case 'new': {
      const name = typeof a.name === 'string' ? a.name.trim() : '';
      if (!wellFormed(a.settings)) return {};
      const problem = nameProblem(model, name) ?? textStyleProblem(a.settings);
      if (problem) return { note: problem };
      ctx.edit((b) => addStyle(b, model, name, a.settings));
      return { selected: name };
    }
    case 'apply': {
      const s = styleNamed(model, a.name);
      if (!s || !wellFormed(a.settings)) return {};
      if (isXref(s))
        return { selected: s.name, note: 'An xref-dependent text style cannot be modified.' };
      const problem = textStyleProblem(a.settings);
      if (problem) return { selected: s.name, note: problem };
      if (changedFields(s, a.settings)) ctx.edit((b) => updateStyle(b, s, a.settings));
      return { selected: s.name };
    }
    case 'rename': {
      const s = styleNamed(model, a.name);
      const to = typeof a.to === 'string' ? a.to.trim() : '';
      if (!s) return {};
      if (upper(s.name) === 'STANDARD')
        return { selected: s.name, note: 'Standard cannot be renamed.' };
      if (isXref(s))
        return { selected: s.name, note: 'An xref-dependent text style cannot be renamed.' };
      if (to === s.name) return { selected: s.name };
      const problem = nameProblem(model, to, s.handle);
      if (problem) return { selected: s.name, note: problem };
      ctx.edit((b) => {
        b.updateTableRecord('textStyles', s.handle, { name: to });
        if (s.handle === current?.handle) b.setHeader('$TEXTSTYLE', to);
        const dimtxsty = model.header.get('$DIMTXSTY');
        if (typeof dimtxsty === 'string' && upper(dimtxsty) === upper(s.name))
          b.setHeader('$DIMTXSTY', to);
      });
      return { selected: to };
    }
    case 'delete': {
      const s = styleNamed(model, a.name);
      if (!s) return {};
      if (upper(s.name) === 'STANDARD')
        return { selected: s.name, note: 'Standard cannot be deleted.' };
      if (isXref(s))
        return { selected: s.name, note: 'An xref-dependent text style cannot be deleted.' };
      if (s.handle === current?.handle)
        return { selected: s.name, note: 'The current text style cannot be deleted.' };
      if (usedTextStyles(model).has(s.handle))
        return { selected: s.name, note: 'Style in use, can’t be deleted.' };
      ctx.edit((b) => b.removeTableRecord('textStyles', s.handle));
      return { selected: current?.name ?? '' };
    }
  }
  return {};
}

/** STYLE (ST, DDSTYLE): the Text Style dialog. */
export function styleCommand(): CommandDef {
  return {
    name: 'STYLE',
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      let selected: string | undefined;
      let note: string | undefined;
      for (;;) {
        const a: PromptAnswer = yield ctx.prompt.dialog({
          message: 'Text Style',
          dialog: textStyleRequest(ctx.model, selected, note),
        });
        if (a.kind !== 'dialog' || a.action !== 'apply' || !a.textstyle) return;
        const shown = act(ctx, a.textstyle);
        selected = shown.selected ?? selected;
        note = shown.note;
      }
    },
  };
}

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** A style's -STYLE listing, as AutoCAD's `?` prints it. */
function listStyle(ctx: CommandContext, s: TextStyleRecord): void {
  const u = drawingUnits(ctx.model.header);
  const files = [s.font, s.bigFont].filter((f) => f !== undefined && f !== '').join(', ');
  const gen = [
    s.generation & BACKWARD ? 'Backwards' : '',
    s.generation & UPSIDE_DOWN ? 'Upside-down' : '',
    (s.flags ?? 0) & VERTICAL ? 'Vertical' : '',
  ].filter(Boolean);
  ctx.message(`Style name: "${s.name}"  Font files: ${files}`);
  ctx.message(
    `   Height: ${formatDistance(s.height, u)}  Width factor: ${s.widthFactor.toFixed(4)}  ` +
      `Obliquing angle: ${formatAngle(s.obliqueAngle, u)}`,
  );
  ctx.message(`   Generation: ${gen.length > 0 ? gen.join(', ') : 'Normal'}`);
}

/** "Enter name of text style or [?]": a name (trimmed), `?` lists; undefined when ended. */
async function* askName(ctx: CommandContext): Sub<string | undefined> {
  const current = currentTextStyle(ctx.model);
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter name of text style or',
      options: ['?'],
      default: { kind: 'string', value: current?.name ?? 'Standard' },
    });
    if (a.kind === 'keyword') {
      const p = yield ctx.prompt.string({
        message: 'Enter text style(s) to list',
        default: { kind: 'string', value: '*' },
      });
      if (p.kind !== 'string') return undefined;
      const patterns = p.value.trim() === '' ? '*' : p.value.trim();
      const styles = [...ctx.model.tables.textStyles.values()]
        .filter((s) => !isShapeFile(s) && wcmatch(s.name, patterns))
        .sort((x, y) => byName(x.name, y.name));
      for (const s of styles) listStyle(ctx, s);
      continue;
    }
    if (a.kind !== 'string') return undefined;
    const name = a.value.trim();
    const existing = styleNamed(ctx.model, name);
    if (existing && isXref(existing)) {
      ctx.message('An xref-dependent text style cannot be modified.');
      continue;
    }
    if (!existing && nameProblem(ctx.model, name)) {
      ctx.message(NAME_INVALID);
      continue;
    }
    return existing?.name ?? name;
  }
}

/** A number `ok` takes, asked again (saying why) until one is given; undefined when ended. */
async function* numberIn(
  ctx: CommandContext,
  ask: () => Prompt,
  value: (a: PromptAnswer) => number | 'again' | undefined,
  problem: (n: number) => string | undefined,
): Sub<number | undefined> {
  for (;;) {
    const v = value(yield ask());
    if (v === 'again') continue;
    if (v === undefined) return undefined;
    const why = problem(v);
    if (!why) return v;
    ctx.message(why);
  }
}

async function* yesNo(
  ctx: CommandContext,
  message: string,
  was: boolean,
): Sub<boolean | undefined> {
  const a = yield ctx.prompt.keyword({
    message,
    options: ['Yes', 'No'],
    default: { kind: 'keyword', keyword: was ? 'Yes' : 'No' },
  });
  return a.kind === 'keyword' ? a.keyword === 'Yes' : undefined;
}

/** -STYLE: a text style made or changed at the command line, and made current. */
export function dashStyleCommand(): CommandDef {
  return {
    name: '-STYLE',
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      const name = yield* askName(ctx);
      if (name === undefined) return;
      const existing = styleNamed(ctx.model, name);
      ctx.message(existing ? 'Existing style.' : 'New style.');
      const base = existing ?? currentTextStyle(ctx.model);
      const was: TextStyleSettings = base
        ? textStyleSettings(base)
        : {
            font: 'txt',
            bigFont: '',
            bold: false,
            italic: false,
            height: 0,
            widthFactor: 1,
            obliqueAngle: 0,
            backwards: false,
            upsideDown: false,
            vertical: false,
          };
      const files = [was.font, was.bigFont].filter((f) => f !== '').join(',');
      const fa = yield ctx.prompt.string({
        message: 'Specify full font name or font filename (TTF or SHX)',
        default: { kind: 'string', value: files },
      });
      if (fa.kind !== 'string') return;
      const typed = fa.value.trim() === '' ? files : fa.value.trim();
      const [font = '', bigFont = ''] = typed.split(',').map((f) => f.trim());
      if (font === '') return;
      const ttf = isTrueTypeFont(font);
      const height = yield* numberIn(
        ctx,
        () =>
          ctx.prompt.distance({
            message: 'Specify height of text or',
            options: ['Annotative'],
            default: { kind: 'distance', value: was.height },
          }),
        (a) => {
          if (a.kind === 'keyword') {
            ctx.message('Triya does not make annotative text styles.');
            return 'again';
          }
          return a.kind === 'distance' ? a.value : undefined;
        },
        (n) => textStyleProblem({ ...was, height: n }),
      );
      if (height === undefined) return;
      const widthFactor = yield* numberIn(
        ctx,
        () =>
          ctx.prompt.real({
            message: 'Specify width factor',
            default: { kind: 'number', value: was.widthFactor },
          }),
        (a) => (a.kind === 'number' ? a.value : undefined),
        (n) => textStyleProblem({ ...was, widthFactor: n }),
      );
      if (widthFactor === undefined) return;
      const oblique = yield* numberIn(
        ctx,
        () =>
          ctx.prompt.angle({
            message: 'Specify obliquing angle',
            zero: 0,
            counterClockwise: true,
            turn: true,
            default: { kind: 'angle', value: was.obliqueAngle * DEG },
          }),
        (a) => {
          if (a.kind !== 'angle') return undefined;
          // An angle comes back as a direction, 0 to 360: a negative slant is one past 180.
          const r = a.value > Math.PI ? a.value - 2 * Math.PI : a.value;
          return Number((r / DEG).toPrecision(12));
        },
        (n) => textStyleProblem({ ...was, obliqueAngle: n }),
      );
      if (oblique === undefined) return;
      const backwards = yield* yesNo(ctx, 'Display text backwards?', was.backwards);
      if (backwards === undefined) return;
      const upsideDown = yield* yesNo(ctx, 'Display text upside-down?', was.upsideDown);
      if (upsideDown === undefined) return;
      let vertical = false;
      if (!ttf) {
        const v = yield* yesNo(ctx, 'Vertical?', was.vertical);
        if (v === undefined) return;
        vertical = v;
      }
      const settings: TextStyleSettings = {
        ...was,
        font,
        bigFont,
        height,
        widthFactor,
        obliqueAngle: oblique,
        backwards,
        upsideDown,
        vertical,
      };
      let made = name;
      ctx.edit((b) => {
        if (existing) updateStyle(b, existing, settings);
        else made = addStyle(b, ctx.model, name, settings).name;
        if (ctx.model.header.get('$TEXTSTYLE') !== made) b.setHeader('$TEXTSTYLE', made);
      });
      ctx.message(`"${made}" is now the current text style.`);
    },
  };
}

export const STYLE_COMMANDS: readonly (() => CommandDef)[] = [styleCommand, dashStyleCommand];
