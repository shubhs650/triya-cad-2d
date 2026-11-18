// ATTDEF (alias ATT), -ATTDEF and ATTDISP (M5-03 part 1; COMMANDS.md "Blocks and references"),
// as AutoCAD 2024's (AutoCAD Help, "ATTDEF (Command)", "Attribute Definition Dialog Box",
// "-ATTDEF (Command)", "ATTDISP (Command)", "ATTMODE (System Variable)").
//
// -ATTDEF:
//   Current attribute modes: Invisible=N Constant=N Verify=N Preset=N Lock position=Y
//     Annotative=N Multiple lines=N
//   Enter an option to change [Invisible/Constant/Verify/Preset/Lock position/Multiple lines]
//     <done>:                                   each option toggles its mode and shows them again
//   Enter attribute tag name:
//   Enter attribute prompt:                     not for a constant attribute
//   Enter default attribute value:              "Enter attribute value:" for a constant one
//   then TEXT's placement: start point or [Justify/Style] (Enter: below the last definition),
//   "Specify text height", "Specify rotation angle of text".
// ATTDEF's dialog: Mode, Attribute (Tag, Prompt, Default with `...` for a multiline value),
// Insertion Point (Specify on-screen, X, Y), Text Settings (Justification, Text style, Text
// height, Rotation, Boundary width, each with its pick button), Align below previous attribute
// definition; OK asks "Specify start point:" when the point is on screen.
// ATTDISP: "Enter attribute visibility setting [Normal/ON/OFF] <current>:", ATTMODE 1, 2 or 0.
//
// Settled for the common drafter expectation, where Help is silent (noted in the PR):
// - Annotative is shown "N" and not offered: Triya makes no annotative objects (DEC-058);
// - the modes are kept per drawing for the session (AutoCAD's AFLAGS, not saved), Lock position
//   on at first as AutoCAD's initial AFLAGS 16; a constant attribute drops Verify and Preset,
//   which AutoCAD's dialog greys for it;
// - a tag is stored in capitals and may hold no spaces (AutoCAD's dialog refuses them);
// - -ATTDEF's multiline value is typed with MTEXT's codes (`\P` a new line) and its boundary
//   width asked after the rotation ("Specify boundary width <0.0000>:", 0 no wrapping); Align
//   and Fit, which have no MTEXT attachment, are not offered for one;
// - Align below previous attribute definition (and Enter at -ATTDEF's start point) puts the
//   definition 5/3 of the last one's height below it, as TEXT's next line, in its style,
//   justification, height and rotation;
// - Align and Fit ask both baseline points on screen once OK closes the dialog (the dialog's
//   insertion point has one point); Align takes TEXTSIZE as its nominal height, as TEXT does.
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { AttdefGeometry, MTextGeometry, TextStyleRecord } from '../model/types';
import { currentProps } from '../properties/current';
import { toUcs, toWorld } from '../input/ucs';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import { currentUcs } from './ucs';
import { drawingUnits, formatDistance } from './units';
import {
  JUSTIFY,
  JUSTIFY_NAMES,
  LINE_PITCH,
  askStyle,
  attachmentOf,
  currentTextStyle,
  mtextEditorRequest,
  textSize,
} from './draw/text';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** DXF 70 attribute flags. */
const INVISIBLE = 1;
const CONSTANT = 2;
const VERIFY = 4;
const PRESET = 8;

/** An attribute definition's modes (AutoCAD's AFLAGS, and DXF 70 / 280 / 71). */
export interface AttdefModes {
  readonly invisible: boolean;
  readonly constant: boolean;
  readonly verify: boolean;
  readonly preset: boolean;
  readonly lockPosition: boolean;
  readonly multiline: boolean;
}

/** The Attribute Definition dialog's fields. */
export interface AttdefSettings extends AttdefModes {
  readonly tag: string;
  readonly prompt: string;
  readonly value: string;
  /** Insertion Point "Specify on-screen": asked once OK closes the dialog. */
  readonly pointOnScreen: boolean;
  /** The insertion point, in the current UCS. */
  readonly point: Vec2;
  /** A TEXT justification as TEXT's Justify option names it (`Left`, `MC`, …). */
  readonly justify: string;
  /** The text style's name. */
  readonly style: string;
  readonly height: number;
  /** Radians, from the current UCS's X axis. */
  readonly rotation: number;
  /** A multiline attribute's boundary width (0: no wrapping). */
  readonly width: number;
  /** Align below previous attribute definition. */
  readonly alignBelow: boolean;
}

/** A text style the dialog's Text style list offers; a fixed height greys Text height. */
export interface AttdefStyleEntry {
  readonly name: string;
  readonly height: number;
}

/** ATTDEF's Attribute Definition dialog. */
export interface AttdefDefineRequest {
  readonly type: 'attdefine';
  readonly settings: AttdefSettings;
  /** The drawing's text styles, by name. */
  readonly styles: readonly AttdefStyleEntry[];
  /** Whether a definition was made before, which Align below previous takes. */
  readonly canAlignBelow: boolean;
  /** Why the last OK made nothing. */
  readonly note?: string;
}

/**
 * The Attribute Definition dialog's answer: its fields, and the pick button that closed it
 * (`value` is the Default's `...`, the MTEXT editor on a multiline value), if one did.
 */
export interface AttdefDefineAnswer {
  readonly settings: AttdefSettings;
  readonly pick?: 'height' | 'rotation' | 'width' | 'value';
}

/** Where the last definition went, for the next one below it. */
interface LastAttdef {
  readonly style: string;
  readonly justify: string;
  readonly at: Vec2;
  readonly second?: Vec2;
  readonly height: number;
  readonly rotation: number;
}

const DEFAULT_MODES: AttdefModes = {
  invisible: false,
  constant: false,
  verify: false,
  preset: false,
  lockPosition: true,
  multiline: false,
};

/** Per drawing: the modes, the dialog's last settings and the last definition made. */
const lastModes = new WeakMap<object, AttdefModes>();
const lastSettings = new WeakMap<object, AttdefSettings>();
const lastAttdef = new WeakMap<object, LastAttdef>();

/** Justifications a multiline attribute takes: Align and Fit have no MTEXT attachment. */
const MULTILINE_JUSTIFY = JUSTIFY_NAMES.filter((n) => n !== 'Align' && n !== 'Fit');

const yn = (v: boolean) => (v ? 'Y' : 'N');

function modesLine(m: AttdefModes): string {
  return (
    `Current attribute modes: Invisible=${yn(m.invisible)} Constant=${yn(m.constant)} ` +
    `Verify=${yn(m.verify)} Preset=${yn(m.preset)} Lock position=${yn(m.lockPosition)} ` +
    `Annotative=N Multiple lines=${yn(m.multiline)}`
  );
}

/** Why `tag` cannot be an attribute's tag, or undefined. */
function tagProblem(tag: string): string | undefined {
  if (tag.trim() === '') return 'a tag must hold at least one character.';
  if (/\s/.test(tag.trim())) return 'a tag cannot contain spaces.';
  return undefined;
}

function styleNamed(model: DocumentModel, name: string): TextStyleRecord | undefined {
  return [...model.tables.textStyles.values()].find(
    (s) => s.name.toUpperCase() === name.toUpperCase(),
  );
}

/** What a new definition is: its modes, attribute, style and placement (world). */
interface NewAttdef {
  readonly modes: AttdefModes;
  readonly tag: string;
  readonly prompt: string;
  readonly value: string;
  readonly style: TextStyleRecord;
  readonly justify: string;
  readonly at: Vec2;
  readonly second?: Vec2;
  readonly height: number;
  /** World radians. */
  readonly rotation: number;
  readonly width: number;
}

/** The ATTDEF geometry of `d`, with a multiline one's embedded MTEXT. */
export function attdefGeometry(d: NewAttdef): AttdefGeometry {
  const j = JUSTIFY[d.justify] ?? JUSTIFY.Left!;
  const m = d.modes;
  const flags =
    (m.invisible ? INVISIBLE : 0) |
    (m.constant ? CONSTANT : 0) |
    (m.verify && !m.constant ? VERIFY : 0) |
    (m.preset && !m.constant ? PRESET : 0);
  const s = d.style;
  const mtext: MTextGeometry | undefined = m.multiline
    ? {
        kind: 'MTEXT',
        contents: d.value,
        style: s.handle,
        position: d.at,
        height: d.height,
        width: d.width,
        rotation: d.rotation,
        attachment: attachmentOf(j.h, j.v),
        direction: 1,
        lineSpacingStyle: 1,
        lineSpacing: 1,
      }
    : undefined;
  return {
    kind: 'ATTDEF',
    tag: d.tag.trim().toUpperCase(),
    prompt: m.constant ? '' : d.prompt,
    value: d.value,
    flags,
    ...(m.lockPosition && { lockPosition: true }),
    ...(mtext && { mtext }),
    style: s.handle,
    position: d.at,
    ...((j.h !== 0 || j.v !== 0) && { alignmentPoint: d.second ?? d.at }),
    height: d.height,
    rotation: d.rotation,
    widthFactor: s.widthFactor,
    oblique: s.obliqueAngle,
    halign: j.h,
    valign: j.v,
    backward: (s.generation & 2) !== 0,
    upsideDown: (s.generation & 4) !== 0,
  };
}

/** Adds `d` to the current space, one undo step, and keeps it as the last definition. */
function addAttdef(ctx: CommandContext, d: NewAttdef): void {
  const geom = attdefGeometry(d);
  const props = currentProps(ctx.model);
  ctx.edit((b) => b.addEntity({ owner: ctx.space, ...props, geom }));
  lastAttdef.set(ctx.model, {
    style: d.style.handle,
    justify: d.justify,
    at: d.at,
    ...(d.second && { second: d.second }),
    height: d.height,
    rotation: d.rotation,
  });
}

/** The placement below the last definition (5/3 of its height, as TEXT's next line). */
function belowLast(
  ctx: CommandContext,
  last: LastAttdef,
): Pick<NewAttdef, 'style' | 'justify' | 'at' | 'second' | 'height' | 'rotation'> | undefined {
  const style = ctx.model.tables.textStyles.get(last.style) ?? currentTextStyle(ctx.model);
  if (!style) return undefined;
  const down = { x: Math.sin(last.rotation), y: -Math.cos(last.rotation) };
  const step = last.height * LINE_PITCH;
  const move = (p: Vec2) => ({ x: p.x + down.x * step, y: p.y + down.y * step });
  return {
    style,
    justify: last.justify,
    at: move(last.at),
    ...(last.second && { second: move(last.second) }),
    height: last.height,
    rotation: last.rotation,
  };
}

/** The two baseline points of Align and Fit; undefined when the command was ended. */
async function* baseline(ctx: CommandContext, first?: Vec2): Sub<[Vec2, Vec2] | undefined> {
  let at = first;
  if (!at) {
    const a = yield ctx.prompt.point({ message: 'Specify first endpoint of text baseline' });
    if (a.kind !== 'point') return undefined;
    at = a.point;
  }
  const b = yield ctx.prompt.point({
    message: 'Specify second endpoint of text baseline',
    rubberBand: { from: at },
  });
  if (b.kind !== 'point') return undefined;
  return [at, b.point];
}

// ── -ATTDEF ──────────────────────────────────────────────────────────────────────────────────

const MODE_OPTIONS: readonly [string, keyof AttdefModes][] = [
  ['Invisible', 'invisible'],
  ['Constant', 'constant'],
  ['Verify', 'verify'],
  ['Preset', 'preset'],
  ['Lock position', 'lockPosition'],
  ['Multiple lines', 'multiline'],
];

/** "Enter attribute tag name:" until a valid tag; undefined when the command was ended. */
async function* tagName(ctx: CommandContext): Sub<string | undefined> {
  for (;;) {
    const a = yield ctx.prompt.string({ message: 'Enter attribute tag name', spaces: true });
    if (a.kind !== 'string' && a.kind !== 'enter') return undefined;
    const problem = tagProblem(a.kind === 'string' ? a.value : '');
    if (!problem) return (a as { readonly value: string }).value;
    ctx.message(`Invalid attribute tag name: ${problem.replace(/^a tag /, 'it ')}`);
  }
}

async function* dashAttdef(ctx: CommandContext): Sub<void> {
  let modes = lastModes.get(ctx.model) ?? DEFAULT_MODES;
  ctx.message(modesLine(modes));
  for (;;) {
    const a = yield ctx.prompt.keyword({
      message: 'Enter an option to change',
      options: MODE_OPTIONS.map(([o]) => o),
      defaultLabel: 'done',
    });
    if (a.kind === 'keyword') {
      const key = MODE_OPTIONS.find(([o]) => o === a.keyword)![1];
      modes = { ...modes, [key]: !modes[key] };
      lastModes.set(ctx.model, modes);
      ctx.message(modesLine(modes));
      continue;
    }
    if (a.kind !== 'enter') return;
    break;
  }
  const tag = yield* tagName(ctx);
  if (tag === undefined) return;
  let prompt = '';
  if (!modes.constant) {
    const p = yield ctx.prompt.string({ message: 'Enter attribute prompt', spaces: true });
    // Enter answers an empty prompt, as AutoCAD takes it.
    if (p.kind !== 'string' && p.kind !== 'enter') return;
    prompt = p.kind === 'string' ? p.value : '';
  }
  const v = yield ctx.prompt.string({
    message: modes.constant ? 'Enter attribute value' : 'Enter default attribute value',
    spaces: true,
  });
  if (v.kind !== 'string' && v.kind !== 'enter') return;
  const value = v.kind === 'string' ? v.value : '';

  const initial = currentTextStyle(ctx.model);
  if (!initial) {
    ctx.message('The drawing has no text style.');
    return;
  }
  let style: TextStyleRecord = initial;
  ctx.message(
    `Current text style:  "${style.name}"  Text height:  ${formatDistance(
      style.height > 0 ? style.height : textSize(ctx.model),
      drawingUnits(ctx.model.header),
    )}  Annotative:  No`,
  );

  const names = modes.multiline ? MULTILINE_JUSTIFY : JUSTIFY_NAMES;
  let justify = 'Left';
  let chosen = false;
  let at: Vec2 | undefined;
  let below: ReturnType<typeof belowLast>;
  while (!at) {
    const j = JUSTIFY[justify]!;
    const a = yield ctx.prompt.point(
      chosen ? { message: j.ask } : { message: `${j.ask} or`, options: ['Justify', 'Style'] },
    );
    if (a.kind === 'point') at = a.point;
    else if (a.kind === 'enter') {
      const last = lastAttdef.get(ctx.model);
      below = last && belowLast(ctx, last);
      if (below) {
        if (modes.multiline && !MULTILINE_JUSTIFY.includes(below.justify)) {
          below = { ...below, justify: 'Left' };
        }
        at = below.at;
      } else ctx.message('No attribute definition to align below.');
    } else if (a.kind === 'keyword' && a.keyword === 'Style') {
      const s: TextStyleRecord | undefined = yield* askStyle(ctx, style);
      if (!s) return;
      style = s;
    } else if (a.kind === 'keyword' && a.keyword === 'Justify') {
      const k = yield ctx.prompt.keyword({ message: 'Enter an option', options: names });
      if (k.kind !== 'keyword') return;
      justify = k.keyword;
      chosen = true;
    } else return;
  }

  let second: Vec2 | undefined;
  let height: number;
  let rotation: number;
  if (below) {
    ({ style, justify, second, height, rotation } = below);
  } else {
    const j = JUSTIFY[justify]!;
    const twoPoints = j.h === 3 || j.h === 5;
    if (twoPoints) {
      const pts = yield* baseline(ctx, at);
      if (!pts) return;
      second = pts[1];
    }
    if (style.height > 0) height = style.height;
    else if (j.h === 3) height = textSize(ctx.model);
    else {
      const h = yield ctx.prompt.distance({
        message: 'Specify text height',
        base: at,
        default: { kind: 'distance', value: textSize(ctx.model) },
      });
      if (h.kind !== 'distance' || h.value <= 0) return;
      height = h.value;
    }
    if (twoPoints) rotation = Math.atan2(second!.y - at.y, second!.x - at.x);
    else {
      const r = yield ctx.prompt.angle({
        message: 'Specify rotation angle of text',
        base: at,
        default: { kind: 'angle', value: currentUcs(ctx).angle },
      });
      if (r.kind !== 'angle') return;
      rotation = r.value;
    }
  }
  let width = 0;
  if (modes.multiline) {
    const w = yield ctx.prompt.distance({
      message: 'Specify boundary width',
      base: at,
      default: { kind: 'distance', value: 0 },
    });
    if (w.kind !== 'distance' || w.value < 0) return;
    width = w.value;
  }
  addAttdef(ctx, {
    modes,
    tag,
    prompt,
    value,
    style,
    justify,
    at,
    ...(second && { second }),
    height,
    rotation,
    width,
  });
}

// ── ATTDEF: the Attribute Definition dialog ──────────────────────────────────────────────────

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Whether `s` is settings the dialog can give (the bus hands the command any object). */
function validSettings(s: unknown): s is AttdefSettings {
  const v = s as AttdefSettings | undefined;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.tag === 'string' &&
    typeof v.prompt === 'string' &&
    typeof v.value === 'string' &&
    typeof v.style === 'string' &&
    typeof v.justify === 'string' &&
    JUSTIFY[v.justify] !== undefined &&
    finite(v.point?.x) &&
    finite(v.point?.y) &&
    finite(v.height) &&
    finite(v.rotation) &&
    finite(v.width)
  );
}

function initialSettings(ctx: CommandContext): AttdefSettings {
  const last = lastSettings.get(ctx.model);
  if (last) return { ...last, tag: '', prompt: '', value: '', alignBelow: false };
  const style = currentTextStyle(ctx.model);
  return {
    ...(lastModes.get(ctx.model) ?? DEFAULT_MODES),
    tag: '',
    prompt: '',
    value: '',
    pointOnScreen: true,
    point: { x: 0, y: 0 },
    justify: 'Left',
    style: style?.name ?? '',
    height: style && style.height > 0 ? style.height : textSize(ctx.model),
    rotation: 0,
    width: 0,
    alignBelow: false,
  };
}

const modesOf = (s: AttdefSettings): AttdefModes => ({
  invisible: Boolean(s.invisible),
  constant: Boolean(s.constant),
  verify: Boolean(s.verify),
  preset: Boolean(s.preset),
  lockPosition: Boolean(s.lockPosition),
  multiline: Boolean(s.multiline),
});

/** Why OK makes nothing with `s`, or undefined. */
function settingsProblem(ctx: CommandContext, s: AttdefSettings): string | undefined {
  const tag = tagProblem(s.tag);
  if (tag) return `Invalid tag: ${tag}`;
  if (s.alignBelow) return undefined;
  if (!styleNamed(ctx.model, s.style)) return `Cannot find text style "${s.style}".`;
  if (s.multiline && !MULTILINE_JUSTIFY.includes(s.justify)) {
    return `A multiline attribute cannot be justified ${s.justify}.`;
  }
  if (!(s.height > 0)) return 'Text height must be greater than 0.';
  if (s.width < 0) return 'Boundary width cannot be negative.';
  return undefined;
}

/** A pick button: the field asked on screen; the settings unchanged at Esc. */
async function* pickField(
  ctx: CommandContext,
  s: AttdefSettings,
  pick: NonNullable<AttdefDefineAnswer['pick']>,
): Sub<AttdefSettings> {
  const ucs = currentUcs(ctx);
  const base = toWorld(ucs, s.point);
  if (pick === 'value') {
    const style = styleNamed(ctx.model, s.style) ?? currentTextStyle(ctx.model);
    if (!style) return s;
    const j = JUSTIFY[s.justify]!;
    const g: MTextGeometry = {
      kind: 'MTEXT',
      contents: s.value,
      style: style.handle,
      position: base,
      height: style.height > 0 ? style.height : s.height,
      width: s.width,
      rotation: s.rotation + ucs.angle,
      attachment: attachmentOf(j.h, j.v),
      direction: 1,
      lineSpacingStyle: 1,
      lineSpacing: 1,
    };
    const a = yield ctx.prompt.string({
      message: 'Enter default value',
      spaces: true,
      escape: true,
      editor: mtextEditorRequest(ctx.model, g),
    });
    return a.kind === 'string' ? { ...s, value: a.value } : s;
  }
  if (pick === 'rotation') {
    const a = yield ctx.prompt.angle({
      message: 'Specify rotation angle',
      escape: true,
      ...(!s.pointOnScreen && { base }),
      default: { kind: 'angle', value: s.rotation + ucs.angle },
    });
    return a.kind === 'angle' ? { ...s, rotation: a.value - ucs.angle } : s;
  }
  const a = yield ctx.prompt.distance({
    message: pick === 'height' ? 'Specify text height' : 'Specify boundary width',
    escape: true,
    ...(!s.pointOnScreen && { base }),
    default: { kind: 'distance', value: pick === 'height' ? s.height : s.width },
  });
  if (a.kind !== 'distance') return s;
  if (pick === 'height') return a.value > 0 ? { ...s, height: a.value } : s;
  return a.value >= 0 ? { ...s, width: a.value } : s;
}

async function* attdefDialog(ctx: CommandContext): Sub<void> {
  let settings = initialSettings(ctx);
  let note: string | undefined;
  for (;;) {
    const styles = [...ctx.model.tables.textStyles.values()]
      .map((s) => ({ name: s.name, height: s.height }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const a = yield ctx.prompt.dialog({
      message: 'Attribute Definition',
      dialog: {
        type: 'attdefine',
        settings,
        styles,
        canAlignBelow: lastAttdef.has(ctx.model),
        ...(note !== undefined && { note }),
      },
    });
    note = undefined;
    if (a.kind !== 'dialog' || !a.attdefine || !validSettings(a.attdefine.settings)) return;
    settings = a.attdefine.settings;
    if (a.attdefine.pick) {
      settings = yield* pickField(ctx, settings, a.attdefine.pick);
      continue;
    }
    if (a.action !== 'ok') return;
    note = settingsProblem(ctx, settings);
    if (note) continue;
    break;
  }
  const modes = modesOf(settings);
  lastModes.set(ctx.model, modes);
  lastSettings.set(ctx.model, settings);

  const attribute = { modes, tag: settings.tag, prompt: settings.prompt, value: settings.value };
  const last = settings.alignBelow ? lastAttdef.get(ctx.model) : undefined;
  const below = last && belowLast(ctx, last);
  if (below) {
    addAttdef(ctx, {
      ...attribute,
      ...below,
      justify:
        modes.multiline && !MULTILINE_JUSTIFY.includes(below.justify) ? 'Left' : below.justify,
      width: settings.width,
    });
    return;
  }

  const style = styleNamed(ctx.model, settings.style)!;
  const ucs = currentUcs(ctx);
  const j = JUSTIFY[settings.justify]!;
  const twoPoints = j.h === 3 || j.h === 5;
  let at = toWorld(ucs, settings.point);
  let second: Vec2 | undefined;
  let rotation = settings.rotation + ucs.angle;
  if (twoPoints) {
    const pts = yield* baseline(ctx);
    if (!pts) return;
    [at, second] = pts;
    rotation = Math.atan2(second.y - at.y, second.x - at.x);
  } else if (settings.pointOnScreen) {
    const p = yield ctx.prompt.point({ message: 'Specify start point' });
    if (p.kind !== 'point') return;
    at = p.point;
    // The dialog shows the point picked next time, in the UCS.
    lastSettings.set(ctx.model, { ...settings, point: toUcs(ucs, at) });
  }
  const height =
    style.height > 0 ? style.height : j.h === 3 ? textSize(ctx.model) : settings.height;
  addAttdef(ctx, {
    ...attribute,
    style,
    justify: settings.justify,
    at,
    ...(second && { second }),
    height,
    rotation,
    width: settings.width,
  });
}

export function attdefCommand(): CommandDef {
  return {
    name: 'ATTDEF',
    dashVariant: true,
    async *run(ctx) {
      if (ctx.dash) yield* dashAttdef(ctx);
      else yield* attdefDialog(ctx);
    },
  };
}

// ── ATTDISP ──────────────────────────────────────────────────────────────────────────────────

const ATTDISP_OPTIONS = ['Normal', 'ON', 'OFF'] as const;
/** ATTMODE for each ATTDISP option. */
const ATTMODE_OF: Readonly<Record<string, number>> = { Normal: 1, ON: 2, OFF: 0 };

export function attdispCommand(): CommandDef {
  return {
    name: 'ATTDISP',
    usesSelection: 'none',
    async *run(ctx) {
      const v = ctx.model.header.get('$ATTMODE');
      // A missing ATTMODE is AutoCAD's initial 1, Normal.
      const now = typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : 1;
      const current = now === 0 ? 'OFF' : now === 2 ? 'ON' : 'Normal';
      const a = yield ctx.prompt.keyword({
        message: 'Enter attribute visibility setting',
        options: [...ATTDISP_OPTIONS],
        default: { kind: 'keyword', keyword: current },
      });
      if (a.kind !== 'keyword') return;
      const mode = ATTMODE_OF[a.keyword]!;
      if (mode === now) return;
      ctx.edit((b) => b.setHeader('$ATTMODE', mode));
    },
  };
}
