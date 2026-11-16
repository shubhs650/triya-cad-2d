// HATCH's settings and the -HATCH prompts that change them (M4-07), with AutoCAD 2024's prompts
// (AutoCAD 2024 Help, "-HATCH (Command)"):
//   Enter a pattern name or [?/Solid/User defined] <TRIYA_LINES45>:                 (Properties)
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
//   Enter layer name for new hatch objects or [. (use current)] <use current>:          (LAyer)
//   Enter transparency value for new hatch objects or [ByLayer/ByBlock/. (use current)]
//     <use current>:                                                              (Transparency)
// The settings are AutoCAD's HP* variables. HPTRANSPARENCY is the one a drawing keeps (in its
// variable dictionary, as SETVAR sets it), so it is read from and written to the drawing; the
// others (HPNAME, HPDRAWORDER, HPCOLOR, HPLAYER, …) Triya keeps while the drawing is open, as
// MATCHPROP keeps its settings. Left out: the background colour COlor asks next (Triya does
// not keep a hatch's background colour yet) and ANnotative (DEC-013, DEC-058).
import type { IslandStyle } from '../../edit/hatch-boundary';
import { validViewName } from '../../edit/named-view';
import type { Vec2 } from '../../geom/types';
import type { EntityId } from '../../model/entity-ids';
import type { Color } from '../../model/types';
import { parseColorValue } from '../../properties/sheet';
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
  /** HPDRAWORDER: AutoCAD's initial 3, behind the boundary. */
  drawOrder: HatchDrawOrder;
  /** HPCOLOR: undefined for the current colour ("."). */
  color: Color | undefined;
  /** HPLAYER: a layer's name, undefined for the current layer ("."). */
  layer: string | undefined;
  /** HPBOUNDRETAIN. */
  retain: boolean;
}

export const USER = '_USER';
export const SOLID = 'SOLID';
export const STYLES: readonly IslandStyle[] = ['normal', 'outer', 'ignore'];
/** HPTRANSPARENCY's name, and the value that means CETRANSPARENCY. */
export const HPTRANSPARENCY = 'HPTRANSPARENCY';
export const USE_CURRENT = 'use current';
const CURRENT_OPTION = '. (use current)';

const DRAW_ORDERS: readonly [HatchDrawOrder, string][] = [
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
      options: ['?', 'Solid', 'User defined'],
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
    if (a.kind !== 'string') return; // Enter: the pattern kept
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

/** -HATCH hatch COlor (HPCOLOR): a number, a name, ByLayer or ByBlock, true colour, a book's. */
export async function* hatchColor(ctx: CommandContext, s: HatchSettings): Sub<void> {
  const a = yield ctx.prompt.string({
    message: 'Enter new color for hatch or',
    options: [CURRENT_OPTION, 'Truecolor', 'COlorbook'],
    defaultLabel: s.color ? colorText(s.color) : USE_CURRENT,
  });
  const k = keyword(a);
  let value: string | undefined;
  if (k === CURRENT_OPTION) {
    s.color = undefined;
    return;
  } else if (k === 'COlorbook') {
    value = yield* bookColor(ctx);
    if (!value) return;
  } else if (k === 'Truecolor') {
    const rgb = yield ctx.prompt.string({ message: 'Red, Green, Blue' });
    const m = rgb.kind === 'string' && /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/.exec(rgb.value);
    value = m ? `rgb:${m[1]},${m[2]},${m[3]}` : '';
  } else if (a.kind === 'string') {
    value = colorFromText(a.value) ?? '';
  } else return; // Enter: the colour kept
  const color = parseColorValue(value);
  if (color) s.color = color;
  else ctx.message('Invalid color.');
}

/** -HATCH LAyer (HPLAYER): a layer the drawing has, or one the hatch will make. */
export async function* hatchLayer(ctx: CommandContext, s: HatchSettings): Sub<void> {
  const a = yield ctx.prompt.string({
    message: 'Enter layer name for new hatch objects or',
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
): Sub<string | undefined> {
  const a = yield ctx.prompt.string({
    message: 'Enter transparency value for new hatch objects or',
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
