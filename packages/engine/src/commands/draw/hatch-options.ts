// HATCH's settings and the -HATCH prompts that change them (M4-07), with AutoCAD 2024's prompts
// (AutoCAD 2024 Help, "-HATCH (Command)"):
//   Enter a pattern name or [?/Solid/User defined/Gradient] <TRIYA_LINES45>:        (Properties)
//     Pattern(s) to list <*>:                                                               (?)
//     Specify a scale for the pattern <1.0000>:  Specify an angle for the pattern <0>:
//     Specify angle for crosshatch lines <0>:  Specify spacing between the lines <1.0000>:
//     Double hatch area? [Yes/No] <N>:                                           (User defined)
//   Enter an option [Boundary set/Retain boundary/Island detection/Style/Associativity/
//     Gap tolerance/separate Hatches]:                                                (Advanced)
//   [Use current origin/Set new origin] <Use current origin>:  Specify origin point:
//     Store as default origin? [Yes/No] <N>:                                          (Origin)
//   Enter draw order [do Not assign/send to Back/bring to Front/send beHind boundary/
//     bring in front of bounDary] <send beHind boundary>:                          (DRaw order)
//   Enter new color for hatch or [. (use current)/Truecolor/COlorbook] <use current>:  (COlor)
//     Enter new background color or [. (none)/Truecolor/COlorbook] <none>:
//   Enter layer name for new hatch objects or [. (use current)] <use current>:          (LAyer)
//   Enter transparency value for new hatch objects or [ByLayer/ByBlock/. (use current)]
//     <use current>:                                                              (Transparency)
// The settings are AutoCAD's HP* variables. HPTRANSPARENCY is the one a drawing keeps (in its
// variable dictionary, as SETVAR sets it), so it is read from and written to the drawing; the
// others (HPNAME, HPDRAWORDER, HPCOLOR, HPLAYER, …) Triya keeps while the drawing is open, as
// MATCHPROP keeps its settings. Left out: ANnotative (DEC-013, DEC-058).
//
// Gradients (M4-07 part 3): AutoCAD's -HATCH Properties offers Gradient, and HPNAME takes the
// nine gradients by their GR_ names (GFNAME 1–9), so a GR_ name typed as the pattern is one too.
// Its help does not give the gradient prompts' wording, so these are ours, asking for what the
// Hatch and Gradient dialog's Gradient tab sets (GFANG, GFSHIFT, GFCLR1, GFCLR2, GFCLRSTATE,
// GFCLRLUM):
//   Enter a gradient name or [?] <GR_LINEAR>:  Specify an angle for the gradient <0>:
//     Centered gradient? [Yes/No] <Y>:                                              (Gradient)
//   Enter first gradient color or [Truecolor/COlorbook] <blue>:
//     Enter second gradient color or [One color/Truecolor/COlorbook] <yellow>:
//     Specify tint (0 dark to 1 light) <1.0000>:                         (COlor, a gradient)
// The first gradient is blue to yellow, as AutoCAD's are in the acadsharp sample drawings
// (ACI 5 and 2). A gradient and a background colour are true colours or ACIs: the file keeps
// them as colour values (DXF 421, the 1071 of HATCHBACKGROUNDCOLOR), so a colour book's name is
// not kept and ByLayer and ByBlock are refused.
import type { IslandStyle } from '../../edit/hatch-boundary';
import { validViewName } from '../../edit/named-view';
import type { Vec2 } from '../../geom/types';
import type { EntityId } from '../../model/entity-ids';
import type { Color, Entity, HatchGeometry, Transparency } from '../../model/types';
import { patternPlacement } from '../../properties/edit';
import type { BackgroundColor } from '../../edit/hatch-background';
import { parseColorValue, patternOrigin } from '../../properties/sheet';
import type { CommandContext } from '../command';
import { bookColor, colorFromText, colorText } from '../modify/chprop';
import { wcmatch } from '../modify/attributes';
import type { PatternPlacement, PlacedPattern } from '../view/host';
import type { Prompt, PromptAnswer } from '../prompt';

export type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** HPDRAWORDER 0–4: where a new hatch is drawn. */
export type HatchDrawOrder = 'none' | 'back' | 'front' | 'behind' | 'above';

/** The HP* settings HATCH starts from. */
export interface HatchSettings {
  /** HPNAME: a pattern's name, SOLID, or _USER for user-defined lines. */
  pattern: string;
  /** From the user's own .pat files (DXF 76 = 2). */
  custom: boolean;
  /** HPSCALE. */
  scale: number;
  /** HPANG, radians. */
  angle: number;
  /** HPSPACE: user-defined lines' spacing. */
  spacing: number;
  /** HPDOUBLE. */
  double: boolean;
  /** HPISLANDDETECTION. */
  style: IslandStyle;
  /** HPISLANDDETECTIONMODE. */
  islands: boolean;
  /** HPGAPTOL. */
  gap: number;
  /** HPSEPARATE. */
  separate: boolean;
  /** HPORIGIN. */
  origin: Vec2;
  /**
   * HPORIGINMODE: 0 HPORIGIN; 1–5 the bottom left, bottom right, top right or top left corner,
   * or the centre, of the hatch's extents (the dialog's Default to boundary extents).
   */
  originMode: number;
  /** HPDRAWORDER: AutoCAD's initial 3, behind the boundary. */
  drawOrder: HatchDrawOrder;
  /** HPCOLOR: undefined for the current colour ("."). */
  color: Color | undefined;
  /** HPLAYER: a layer's name, undefined for the current layer ("."). */
  layer: string | undefined;
  /** HPBOUNDRETAIN. */
  retain: boolean;
  /** HPBACKGROUNDCOLOR: a pattern's background, undefined for none. */
  background: BackgroundColor | undefined;
  /** The gradient settings, kept while a pattern is used. */
  gradient: GradientSettings;
}

/** GFNAME, GFANG, GFSHIFT, GFCLR1, GFCLR2, GFCLRSTATE and GFCLRLUM. */
export interface GradientSettings {
  /** GFNAME as HPNAME spells it: GR_LINEAR, … */
  name: string;
  /** GFANG, radians. */
  angle: number;
  /** GFSHIFT 0. */
  centered: boolean;
  color1: BackgroundColor;
  color2: BackgroundColor;
  /** GFCLRSTATE: one colour, shading to the tint. */
  oneColor: boolean;
  /** GFCLRLUM: 0 dark (black) to 1 light (white). */
  tint: number;
}

/** The nine gradients: HPNAME's name, the file's (DXF 470), the description `?` lists. */
export const GRADIENTS: readonly (readonly [string, string, string])[] = [
  ['GR_LINEAR', 'LINEAR', 'Linear'],
  ['GR_CYLIN', 'CYLINDER', 'Cylindrical'],
  ['GR_INVCYL', 'INVCYLINDER', 'Inverted cylindrical'],
  ['GR_SPHER', 'SPHERICAL', 'Spherical'],
  ['GR_INVSPH', 'INVSPHERICAL', 'Inverted spherical'],
  ['GR_HEMISP', 'HEMISPHERICAL', 'Hemispherical'],
  ['GR_INVHEM', 'INVHEMISPHERICAL', 'Inverted hemispherical'],
  ['GR_CURVED', 'CURVED', 'Curved'],
  ['GR_INVCUR', 'INVCURVED', 'Inverted curved'],
];

/** The gradient HPNAME names, or undefined when `name` is none. */
export const gradientNamed = (name: string) =>
  GRADIENTS.find(([n]) => n === name.trim().toUpperCase());

/** Whether HPNAME is a gradient. */
export const isGradient = (pattern: string): boolean => gradientNamed(pattern) !== undefined;

/** The gradient settings HATCH starts from: Linear, centred, blue to yellow. */
export const initialGradient = (): GradientSettings => ({
  name: 'GR_LINEAR',
  angle: 0,
  centered: true,
  color1: { kind: 'aci', index: 5 },
  color2: { kind: 'aci', index: 2 },
  oneColor: false,
  tint: 1,
});

export const USER = '_USER';
export const SOLID = 'SOLID';
export const STYLES: readonly IslandStyle[] = ['normal', 'outer', 'ignore'];
/** HPTRANSPARENCY's name, and the value that means CETRANSPARENCY. */
export const HPTRANSPARENCY = 'HPTRANSPARENCY';
export const USE_CURRENT = 'use current';
const CURRENT_OPTION = '. (use current)';
const NONE_OPTION = '. (none)';

export const DRAW_ORDERS: readonly [HatchDrawOrder, string][] = [
  ['none', 'do Not assign'],
  ['back', 'send to Back'],
  ['front', 'bring to Front'],
  ['behind', 'send beHind boundary'],
  ['above', 'bring in front of bounDary'],
];

export const keyword = (a: PromptAnswer): string | undefined =>
  a.kind === 'keyword' ? a.keyword : undefined;

/** An angle, or a number, prompt with a default always answers its kind. */
const valueOf = (a: PromptAnswer): number => (a as { value: number }).value;

async function* angle(ctx: CommandContext, message: string, current: number): Sub<number> {
  return valueOf(yield ctx.prompt.angle({ message, default: { kind: 'angle', value: current } }));
}

async function* positive(ctx: CommandContext, message: string, current: number): Sub<number> {
  for (;;) {
    const v = valueOf(
      yield ctx.prompt.real({ message, default: { kind: 'number', value: current } }),
    );
    if (v > 0) return v;
    ctx.message('Value must be positive and nonzero.');
  }
}

export async function* yesNo(ctx: CommandContext, message: string, current: boolean): Sub<boolean> {
  const a = yield ctx.prompt.keyword({
    message,
    options: ['Yes', 'No'],
    defaultLabel: current ? 'Y' : 'N',
  });
  const k = keyword(a);
  return k === undefined ? current : k === 'Yes';
}

/** -HATCH Properties: the pattern and its scale and angle, or user-defined lines. */
export async function* properties(ctx: CommandContext, s: HatchSettings): Sub<void> {
  for (;;) {
    const current = s.pattern === USER ? 'U' : s.pattern;
    const a = yield ctx.prompt.string({
      message: 'Enter a pattern name or',
      options: ['?', 'Solid', 'User defined', 'Gradient'],
      defaultLabel: current,
    });
    const k = keyword(a);
    if (k === '?') {
      yield* listPatterns(ctx);
      continue;
    }
    if (k === 'Solid') {
      s.pattern = SOLID;
      s.custom = false;
      return;
    }
    if (k === 'User defined') {
      s.angle = yield* angle(ctx, 'Specify angle for crosshatch lines', s.angle);
      s.spacing = yield* positive(ctx, 'Specify spacing between the lines', s.spacing);
      s.double = yield* yesNo(ctx, 'Double hatch area?', s.double);
      s.pattern = USER;
      s.custom = false;
      return;
    }
    if (k === 'Gradient') {
      if (yield* gradient(ctx, s)) return;
      continue;
    }
    if (a.kind !== 'string') return; // Enter: the pattern kept
    if (isGradient(a.value)) {
      s.gradient.name = gradientNamed(a.value)![0];
      yield* gradientShape(ctx, s);
      return;
    }
    // The library says whether it knows the name, and how its file spells it.
    const p = await placed(ctx, a.value.trim(), { angle: 0, scale: 1, origin: { x: 0, y: 0 } });
    if (!p) continue;
    s.pattern = p.name;
    s.custom = p.custom;
    s.scale = yield* positive(ctx, 'Specify a scale for the pattern', s.scale);
    s.angle = yield* angle(ctx, 'Specify an angle for the pattern', s.angle);
    return;
  }
}

/**
 * Properties Gradient: a gradient by name (`?` lists them), then its angle and centring; false
 * when Enter keeps the gradient there is and none was chosen before.
 */
async function* gradient(ctx: CommandContext, s: HatchSettings): Sub<boolean> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter a gradient name or',
      options: ['?'],
      defaultLabel: s.gradient.name,
    });
    if (keyword(a) === '?') {
      for (const [name, , description] of GRADIENTS) ctx.message(`${name} - ${description}`);
      continue;
    }
    if (a.kind === 'string' && a.value.trim() !== '') {
      const g = gradientNamed(a.value);
      if (!g) {
        ctx.message(`Gradient "${a.value.trim().toUpperCase()}" is not defined.`);
        continue;
      }
      s.gradient.name = g[0];
    }
    yield* gradientShape(ctx, s);
    return true;
  }
}

/** The gradient's angle and centring, the gradient then being the fill. */
async function* gradientShape(ctx: CommandContext, s: HatchSettings): Sub<void> {
  s.pattern = s.gradient.name;
  s.custom = false;
  s.gradient.angle = yield* angle(ctx, 'Specify an angle for the gradient', s.gradient.angle);
  s.gradient.centered = yield* yesNo(ctx, 'Centered gradient?', s.gradient.centered);
}

/** `?`: the library's patterns whose names match, each with its description. */
async function* listPatterns(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({ message: 'Pattern(s) to list', defaultLabel: '*' });
  const wanted = a.kind === 'string' && a.value.trim() !== '' ? a.value.trim() : '*';
  const r = await ctx.view.request({ op: 'hatchPatternList' });
  if (!r.ok) {
    ctx.message(r.message);
    return;
  }
  for (const p of r.patterns!) {
    if (!wcmatch(p.name, wanted)) continue;
    ctx.message(p.description ? `${p.name} - ${p.description}` : p.name);
  }
}

/** The pattern `name` placed by the app's library, or undefined (said) when it has none. */
export async function placed(
  ctx: CommandContext,
  name: string,
  at: PatternPlacement,
): Promise<PlacedPattern | undefined> {
  const r = await ctx.view.request({ op: 'hatchPattern', name, placements: [at] });
  if (r.ok && r.pattern) return r.pattern;
  ctx.message(r.ok ? `Pattern "${name}" is not in the pattern library.` : r.message);
  return undefined;
}

/** What -HATCH Advanced's Boundary set changes: the run's candidate set. */
export interface BoundarySetHolder {
  boundarySet: readonly EntityId[] | undefined;
}

/**
 * -HATCH Advanced: the boundary set, retaining boundaries, island detection and style,
 * associativity, gap tolerance, separate hatches.
 */
export async function* advanced(
  ctx: CommandContext,
  s: HatchSettings,
  run: BoundarySetHolder,
): Sub<void> {
  for (;;) {
    const a = yield ctx.prompt.keyword({
      message: 'Enter an option',
      options: [
        'Boundary set',
        'Retain boundary',
        'Island detection',
        'Style',
        'Associativity',
        'Gap tolerance',
        'separate Hatches',
      ],
    });
    switch (keyword(a)) {
      case 'Boundary set':
        yield* boundarySet(ctx, run);
        break;
      case 'Retain boundary':
        s.retain = yield* yesNo(ctx, 'Retain derived boundaries?', s.retain);
        break;
      case 'Island detection':
        s.islands = yield* yesNo(ctx, 'Do you want island detection?', s.islands);
        break;
      case 'Style': {
        const names = ['Ignore', 'Outer', 'Normal'];
        const b = yield ctx.prompt.keyword({
          message: 'Enter island detection style',
          options: names,
          default: { kind: 'keyword', keyword: names[2 - STYLES.indexOf(s.style)]! },
        });
        s.style = STYLES[2 - names.indexOf(keyword(b)!)]!;
        break;
      }
      case 'Associativity':
        if (yield* yesNo(ctx, 'Do you want associativity?', false)) {
          ctx.message('Triya makes non-associative hatches.');
        }
        break;
      case 'Gap tolerance': {
        const gap = valueOf(
          yield ctx.prompt.real({
            message: 'Specify a boundary gap tolerance value',
            default: { kind: 'number', value: s.gap },
          }),
        );
        // HPGAPTOL: "Valid values are from 0 to 5000".
        if (gap < 0 || gap > 5000) ctx.message('Value must be between 0 and 5000.');
        else s.gap = gap;
        break;
      }
      case 'separate Hatches':
        s.separate = yield* yesNo(ctx, 'Create separate hatches?', s.separate);
        break;
      default:
        return;
    }
  }
}

/**
 * Boundary set: "New" makes the objects selected the only ones boundaries are found among;
 * "Everything" goes back to what the view shows. Enter keeps the set there is.
 */
async function* boundarySet(ctx: CommandContext, run: BoundarySetHolder): Sub<void> {
  const a = yield ctx.prompt.keyword({
    message: 'Specify candidate set for boundary',
    options: ['New', 'Everything'],
    ...(run.boundarySet
      ? { defaultLabel: 'current' }
      : { default: { kind: 'keyword', keyword: 'Everything' } }),
  });
  const k = keyword(a);
  if (k === 'Everything') run.boundarySet = undefined;
  if (k !== 'New') return;
  const b = yield ctx.prompt.selection({ message: 'Select objects' });
  if (b.kind === 'selection' && b.ids.length > 0) run.boundarySet = b.ids;
}

/** -HATCH Origin: this hatch's pattern origin, stored as HPORIGIN when asked. */
export async function* origin(ctx: CommandContext, s: HatchSettings): Sub<Vec2 | undefined> {
  const a = yield ctx.prompt.keyword({
    message: '',
    options: ['Use current origin', 'Set new origin'],
    default: { kind: 'keyword', keyword: 'Use current origin' },
  });
  if (keyword(a) !== 'Set new origin') return undefined;
  // A point prompt without options or default answers a point.
  const p = ((yield ctx.prompt.point({ message: 'Specify origin point' })) as { point: Vec2 })
    .point;
  if (yield* yesNo(ctx, 'Store as default origin?', false)) s.origin = p;
  return p;
}

/** -HATCH DRaw order (HPDRAWORDER). */
export async function* drawOrder(ctx: CommandContext, s: HatchSettings): Sub<void> {
  const a = yield ctx.prompt.keyword({
    message: 'Enter draw order',
    options: DRAW_ORDERS.map(([, name]) => name),
    default: { kind: 'keyword', keyword: DRAW_ORDERS.find(([o]) => o === s.drawOrder)![1] },
  });
  const k = keyword(a);
  // A default: Enter answers the order there is, so the answer is one of them.
  s.drawOrder = DRAW_ORDERS.find(([, name]) => name === k)![0];
}

/**
 * A colour typed at `message`: a number, a name, Truecolor or COlorbook; `current` for the
 * option answered `.`, `one` for One color, `keep` for Enter, `refused` for a colour it cannot
 * take (said). `plain` takes only an ACI or a true colour (a colour book's without its name).
 */
async function* askColor(
  ctx: CommandContext,
  message: string,
  options: readonly string[],
  defaultLabel: string,
  plain: boolean,
): Sub<Color | 'current' | 'one' | 'keep' | 'refused'> {
  const a = yield ctx.prompt.string({ message, options: [...options], defaultLabel });
  const k = keyword(a);
  let value: string | undefined;
  if (k === CURRENT_OPTION || k === NONE_OPTION) return 'current';
  if (k === 'One color') return 'one';
  if (k === 'COlorbook') {
    value = yield* bookColor(ctx);
    if (!value) return 'refused';
  } else if (k === 'Truecolor') {
    const rgb = yield ctx.prompt.string({ message: 'Red, Green, Blue' });
    const m = rgb.kind === 'string' && /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/.exec(rgb.value);
    value = m ? `rgb:${m[1]},${m[2]},${m[3]}` : '';
  } else if (a.kind === 'string') {
    value = colorFromText(a.value) ?? '';
  } else return 'keep';
  const color = parseColorValue(value);
  if (color && (!plain || color.kind === 'aci' || color.kind === 'rgb')) {
    return plain && color.kind === 'rgb'
      ? { kind: 'rgb', r: color.r, g: color.g, b: color.b }
      : color;
  }
  ctx.message('Invalid color.');
  return 'refused';
}

/**
 * -HATCH hatch COlor: for a pattern the hatch's colour (HPCOLOR) and its background
 * (HPBACKGROUNDCOLOR); for a gradient its two colours, or one shading to a tint.
 */
export async function* hatchColor(ctx: CommandContext, s: HatchSettings): Sub<void> {
  if (isGradient(s.pattern)) {
    yield* gradientColors(ctx, s);
    return;
  }
  const c = yield* askColor(
    ctx,
    'Enter new color for hatch or',
    [CURRENT_OPTION, 'Truecolor', 'COlorbook'],
    s.color ? colorText(s.color) : USE_CURRENT,
    false,
  );
  if (c === 'refused') return;
  if (c === 'current') s.color = undefined;
  else if (typeof c === 'object') s.color = c;
  const b = yield* askColor(
    ctx,
    'Enter new background color or',
    [NONE_OPTION, 'Truecolor', 'COlorbook'],
    s.background ? colorText(s.background) : 'none',
    true,
  );
  if (b === 'current') s.background = undefined;
  else if (typeof b === 'object') s.background = b as BackgroundColor;
}

/** COlor for a gradient: GFCLR1, then GFCLR2 or one colour with its tint (GFCLRLUM). */
async function* gradientColors(ctx: CommandContext, s: HatchSettings): Sub<void> {
  const g = s.gradient;
  const first = yield* askColor(
    ctx,
    'Enter first gradient color or',
    ['Truecolor', 'COlorbook'],
    colorText(g.color1),
    true,
  );
  if (first === 'refused') return;
  if (typeof first === 'object') g.color1 = first as BackgroundColor;
  const second = yield* askColor(
    ctx,
    'Enter second gradient color or',
    ['One color', 'Truecolor', 'COlorbook'],
    g.oneColor ? 'one color' : colorText(g.color2),
    true,
  );
  if (second === 'one') {
    for (;;) {
      const t = valueOf(
        yield ctx.prompt.real({
          message: 'Specify tint (0 dark to 1 light)',
          default: { kind: 'number', value: g.tint },
        }),
      );
      if (t >= 0 && t <= 1) {
        g.tint = t;
        g.oneColor = true;
        return;
      }
      ctx.message('Value must be between 0 and 1.');
    }
  }
  if (typeof second === 'object') {
    g.color2 = second as BackgroundColor;
    g.oneColor = false;
  }
}

/** -HATCH LAyer (HPLAYER): a layer the drawing has, or one the hatch will make. */
export async function* hatchLayer(
  ctx: CommandContext,
  s: HatchSettings,
  message = 'Enter layer name for new hatch objects or',
): Sub<void> {
  const a = yield ctx.prompt.string({
    message,
    options: [CURRENT_OPTION],
    defaultLabel: s.layer ?? USE_CURRENT,
    spaces: true,
  });
  if (keyword(a) === CURRENT_OPTION) s.layer = undefined;
  if (a.kind !== 'string') return;
  const name = a.value.trim();
  if (validViewName(name)) s.layer = name;
  else ctx.message('Invalid layer name.');
}

/**
 * -HATCH Transparency (HPTRANSPARENCY): ByLayer, ByBlock, 0–90 percent, or the current one;
 * the value it answers is what the drawing will keep, undefined for Enter.
 */
export async function* hatchTransparency(
  ctx: CommandContext,
  current: string,
  message = 'Enter transparency value for new hatch objects or',
): Sub<string | undefined> {
  const a = yield ctx.prompt.string({
    message,
    options: ['ByLayer', 'ByBlock', CURRENT_OPTION],
    defaultLabel: current,
  });
  const k = keyword(a);
  if (k === CURRENT_OPTION) return USE_CURRENT;
  if (k !== undefined) return k;
  if (a.kind !== 'string') return undefined;
  const t = a.value.trim();
  const n = Number(t);
  if (/^\d+$/.test(t) && n <= 90) return String(n);
  ctx.message('Value must be ByLayer, ByBlock or between 0 and 90.');
  return undefined;
}

/** The settings a hatch was made with, as -HATCH would ask for them. */
export function settingsOf(
  ctx: CommandContext,
  e: Entity & { readonly geom: HatchGeometry },
  base: HatchSettings,
): HatchSettings {
  const g = e.geom;
  const gradient = g.gradient && GRADIENTS.find(([, file]) => file === g.gradient!.name);
  const user = !g.solid && g.patternType === 0;
  const colors = g.gradient?.colors ?? [];
  const plain = (i: number, fallback: BackgroundColor): BackgroundColor => {
    const c = colors[i]?.color;
    return c && (c.kind === 'aci' || c.kind === 'rgb') ? (c as BackgroundColor) : fallback;
  };
  return {
    ...base,
    pattern: g.gradient
      ? (gradient?.[0] ?? 'GR_LINEAR')
      : g.solid
        ? SOLID
        : user
          ? USER
          : g.pattern,
    custom: g.patternType === 2,
    scale: patternPlacement(g).scale,
    angle: g.solid ? base.angle : g.patternAngle,
    spacing: user && g.patternScale > 0 ? g.patternScale : base.spacing,
    double: g.double,
    style: STYLES[g.style] ?? 'normal',
    islands: true,
    origin: patternOrigin(g),
    color: e.color,
    layer: ctx.model.tables.layers.get(e.layer)?.name,
    background: g.background as BackgroundColor | undefined,
    gradient: g.gradient
      ? {
          name: gradient?.[0] ?? 'GR_LINEAR',
          angle: g.gradient.angle,
          centered: g.gradient.shift === 0,
          color1: plain(0, base.gradient.color1),
          color2: plain(1, base.gradient.color2),
          oneColor: g.gradient.singleColor,
          tint: g.gradient.tint,
        }
      : { ...base.gradient },
  };
}

/** A transparency as -HATCH's prompt shows it: ByLayer, ByBlock or a percentage. */
export function transparencyText(t: Transparency): string {
  return typeof t === 'string' ? t : String(Math.round((1 - t.alpha / 255) * 100));
}
