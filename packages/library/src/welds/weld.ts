// Weld symbols (M8-02 part 2, DEC-092): the welding symbol of AWS A2.4 or ISO 2553 (system A)
// built from what the drafter states for each side of the joint, as a block.
//
// Placement: the base point is the arrow's tip, on the joint. The leader runs from it at the
// leader angle to the reference line, which runs away from the leader (right when the leader
// leans right or stands upright, left when it leans left) for its length; the tail, when the
// symbol has a reference, is at its far end. Texts read left to right whichever way the line
// runs.
//
// Sides: AWS A2.4 puts the arrow side's weld below the reference line and the other side's
// above. ISO 2553 system A puts the arrow side's weld on the continuous reference line (drawn
// above it here) and the other side's on the dashed identification line, drawn parallel below
// it; a symmetric weld (the same weld on both sides) has no identification line and sits across
// the continuous one.
//
// Each side's elements are where both standards place them: the weld's symbol at the line's
// middle, its size to the left, its length and pitch (AWS `2-6`, ISO `3×50 (100)`) to the right,
// a groove's root opening in the symbol's open end and its groove angle beyond it, and beyond
// those the contour symbol (flush, convex, concave) and the finish letter. AWS A2.4 draws the
// root opening inside a symbol drawn larger than its text; with the symbol as high as the text,
// it stands at the mouth instead, so no text crosses the symbol or another text. The weld-all-around circle and
// the field weld flag (pointing at the tail) are at the junction of the leader and the line.
//
// Sizes are of the text height h (the symbol is as high as the text): the arrowhead h long and
// h/3 wide, the fillet h × h with its upright leg on the left (AWS A2.4 §4.2.1), the V 90°
// included. A text is placed by its alignment point, so nothing depends on its width: the
// reference line's length is the drafter's (long enough for their texts) and the texts stay
// clear of the symbol whatever they say.
import type {
  ChangeSetBuilder,
  DocumentModel,
  EntityGeometry,
  Handle,
  TextGeometry,
  Vec2,
} from '@triya/engine';
import { addPartsBlock } from '../block';
import { circle, closed, corner, line, open, solid, type Corner, type LibraryPart } from '../parts';

export const WELD_TYPES = [
  'fillet',
  'square',
  'v',
  'bevel',
  'u',
  'j',
  'flare-v',
  'flare-bevel',
  'plug',
  'spot',
  'seam',
  'back',
  'surfacing',
] as const;

export type WeldType = (typeof WELD_TYPES)[number];

export const WELD_TYPE_NAMES: Readonly<Record<WeldType, string>> = {
  fillet: 'fillet',
  square: 'square groove',
  v: 'V-groove',
  bevel: 'bevel groove',
  u: 'U-groove',
  j: 'J-groove',
  'flare-v': 'flare-V groove',
  'flare-bevel': 'flare-bevel groove',
  plug: 'plug or slot',
  spot: 'spot',
  seam: 'seam',
  back: 'back or backing',
  surfacing: 'surfacing',
};

export const WELD_CONTOURS = ['flush', 'convex', 'concave'] as const;

export type WeldContour = (typeof WELD_CONTOURS)[number];

/** One side's weld and what is said about it; each text is drawn as written. */
export interface WeldSide {
  readonly type: WeldType;
  /** Left of the symbol: the leg or depth and effective throat (`1/4`, `(3/8)`, ISO `a5`). */
  readonly size?: string;
  /** Right of the symbol: the length, or length and pitch (`2-6`, ISO `3×50 (100)`). */
  readonly length?: string;
  /** A groove's included angle, beyond the symbol (`60%%d`). */
  readonly angle?: string;
  /** A groove's root opening, at the symbol's open end. */
  readonly rootOpening?: string;
  readonly contour?: WeldContour;
  /** The finishing method's letter, beyond the contour (AWS C, G, H, M, R, U). */
  readonly finish?: string;
}

export type WeldStandard = 'AWS' | 'ISO';

export const WELD_STANDARD_NAMES: Readonly<Record<WeldStandard, string>> = {
  AWS: 'AWS A2.4',
  ISO: 'ISO 2553',
};

export interface WeldSymbolSpec {
  readonly standard: WeldStandard;
  readonly arrowSide?: WeldSide;
  readonly otherSide?: WeldSide;
  readonly allAround?: boolean;
  readonly field?: boolean;
  /** The tail's reference (a process, a specification); no tail without one. */
  readonly tail?: string;
  /** Intermittent welds on both sides staggered: the other side's symbol shifted along. */
  readonly staggered?: boolean;
  /** The text height, which is the symbol's, in drawing units. */
  readonly height: number;
  readonly referenceLength: number;
  readonly leaderLength: number;
  /** Degrees, from the arrow's tip to the reference line. */
  readonly leaderAngle: number;
}

/** A ¼ in. arrow-side fillet, in inches (the library palette scales by `drawingScale`). */
export const WELD_SYMBOL_DEFAULTS: WeldSymbolSpec = {
  standard: 'AWS',
  arrowSide: { type: 'fillet', size: '1/4' },
  height: 0.125,
  referenceLength: 1,
  leaderLength: 0.375,
  leaderAngle: 45,
};

/** The defaults with each length multiplied by `scale` (25.4 for a drawing in millimetres). */
export function weldSymbolDefaults(scale = 1): WeldSymbolSpec {
  const d = WELD_SYMBOL_DEFAULTS;
  return {
    ...d,
    height: d.height * scale,
    referenceLength: d.referenceLength * scale,
    leaderLength: d.leaderLength * scale,
  };
}

/** The grooves AWS A2.4 and ISO 2553 give an included angle and a root opening. */
const ANGLED: ReadonlySet<WeldType> = new Set(['v', 'bevel', 'u', 'j']);
const OPENED: ReadonlySet<WeldType> = new Set(['square', 'v', 'bevel', 'u', 'j']);

const article = (type: WeldType) => (/^[aeiou]/i.test(WELD_TYPE_NAMES[type]) ? 'an' : 'a');

/** The symbol's half-width either side of its centre, its height (in h) and its pieces. */
interface Shape {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  /** For the side above the line, about (0, 0) on it, in h. */
  readonly pieces: readonly EntityGeometry[];
}

/** The bulge of an arc turning through `deg` degrees counter-clockwise. */
const bulge = (deg: number) => Math.tan((deg * Math.PI) / 720);

/** A flare's arc: a 30° arc of radius 2h, tangent to the upright where it meets the line. */
const FLARE = 2 - Math.sqrt(3);

const SHAPES: Readonly<Record<WeldType, Shape>> = {
  fillet: {
    left: -0.5,
    right: 0.5,
    top: 1,
    pieces: [open([corner(-0.5, 0), corner(-0.5, 1), corner(0.5, 0)])],
  },
  square: {
    left: -0.2,
    right: 0.2,
    top: 1,
    pieces: [line({ x: -0.2, y: 0 }, { x: -0.2, y: 1 }), line({ x: 0.2, y: 0 }, { x: 0.2, y: 1 })],
  },
  v: {
    left: -1,
    right: 1,
    top: 1,
    pieces: [open([corner(-1, 1), corner(0, 0), corner(1, 1)])],
  },
  bevel: {
    left: -0.4,
    right: 0.4,
    top: 1,
    pieces: [open([corner(-0.4, 1), corner(-0.4, 0), corner(0.4, 1)])],
  },
  u: {
    left: -0.35,
    right: 0.35,
    top: 1,
    pieces: [
      line({ x: 0, y: 0 }, { x: 0, y: 0.3 }),
      open([corner(-0.35, 1), corner(-0.35, 0.65, 1), corner(0.35, 0.65), corner(0.35, 1)]),
    ],
  },
  j: {
    left: -0.2,
    right: 0.2,
    top: 1,
    pieces: [
      line({ x: -0.2, y: 0 }, { x: -0.2, y: 1 }),
      open([corner(-0.2, 0.25, bulge(90)), corner(0.2, 0.65), corner(0.2, 1)]),
    ],
  },
  'flare-v': {
    left: -0.05 - FLARE,
    right: 0.05 + FLARE,
    top: 1,
    pieces: [
      open([corner(-0.05, 0, bulge(30)), corner(-0.05 - FLARE, 1)]),
      open([corner(0.05, 0, -bulge(30)), corner(0.05 + FLARE, 1)]),
    ],
  },
  'flare-bevel': {
    left: -0.2,
    right: FLARE - 0.1,
    top: 1,
    pieces: [
      line({ x: -0.2, y: 0 }, { x: -0.2, y: 1 }),
      open([corner(-0.1, 0, -bulge(30)), corner(FLARE - 0.1, 1)]),
    ],
  },
  plug: {
    left: -0.5,
    right: 0.5,
    top: 0.5,
    pieces: [closed([corner(-0.5, 0), corner(0.5, 0), corner(0.5, 0.5), corner(-0.5, 0.5)])],
  },
  spot: { left: -0.5, right: 0.5, top: 1, pieces: [circle(0.5, { x: 0, y: 0.5 })] },
  seam: {
    left: -0.7,
    right: 0.7,
    top: 1,
    pieces: [
      circle(0.5, { x: 0, y: 0.5 }),
      line({ x: -0.7, y: 0.35 }, { x: 0.7, y: 0.35 }),
      line({ x: -0.7, y: 0.65 }, { x: 0.7, y: 0.65 }),
    ],
  },
  back: {
    left: -0.5,
    right: 0.5,
    top: 0.5,
    pieces: [open([corner(-0.5, 0, -1), corner(0.5, 0)])],
  },
  surfacing: {
    left: -1,
    right: 1,
    top: 0.5,
    pieces: [open([corner(-1, 0, -1), corner(0, 0, -1), corner(1, 0)])],
  },
};

/** `g` (drawn for the side above, in h) scaled by `h`, flipped below when `s` is -1, moved to `at`. */
function placed(g: EntityGeometry, h: number, s: 1 | -1, at: Vec2): EntityGeometry {
  const p = (v: Vec2): Vec2 => ({ x: at.x + v.x * h, y: at.y + s * v.y * h });
  switch (g.kind) {
    case 'LINE':
      return { ...g, start: p(g.start), end: p(g.end) };
    case 'CIRCLE':
      return { ...g, center: p(g.center), radius: g.radius * h };
    case 'LWPOLYLINE':
      // A mirror image turns each arc the other way.
      return { ...g, vertices: g.vertices.map((c) => ({ ...p(c), bulge: s * c.bulge })) };
    default:
      return g;
  }
}

/** DXF 72 and 73. */
const LEFT = 0;
const CENTRE = 1;
const RIGHT = 2;
const BOTTOM = 1;
const MIDDLE = 2;
const TOP = 3;

function text(
  value: string,
  at: Vec2,
  h: number,
  halign: number,
  valign: number,
  style: Handle,
): LibraryPart {
  const geom: TextGeometry = {
    kind: 'TEXT',
    value,
    style,
    position: at,
    alignmentPoint: at,
    height: h,
    rotation: 0,
    widthFactor: 1,
    oblique: 0,
    halign,
    valign,
    backward: false,
    upsideDown: false,
  };
  return { role: 'visible', geom };
}

/** A side's symbol and texts, centred at `cx` on the line at `y`, on the side `s`. */
function sideParts(
  side: WeldSide,
  cx: number,
  y: number,
  s: 1 | -1,
  h: number,
  style: Handle,
): LibraryPart[] {
  const shape = SHAPES[side.type];
  const at = { x: cx, y };
  const parts: LibraryPart[] = shape.pieces.map((g) => ({
    role: 'visible',
    geom: placed(g, h, s, at),
  }));
  // The size and length are as high as the symbol's tallest, standing on the line.
  const mid = y + (s * h) / 2;
  const beyond = s > 0 ? BOTTOM : TOP;
  if (side.size)
    parts.push(
      text(side.size, { x: cx + (shape.left - 0.25) * h, y: mid }, h, RIGHT, MIDDLE, style),
    );
  if (side.length)
    parts.push(
      text(side.length, { x: cx + (shape.right + 0.25) * h, y: mid }, h, LEFT, MIDDLE, style),
    );
  // Outward from the line: the root opening, the groove angle, the contour, then the finish.
  let reach = (shape.top + 0.25) * h;
  if (side.rootOpening) {
    parts.push(text(side.rootOpening, { x: cx, y: y + s * reach }, h, CENTRE, beyond, style));
    reach += 1.25 * h;
  }
  if (side.angle) {
    parts.push(text(side.angle, { x: cx, y: y + s * reach }, h, CENTRE, beyond, style));
    reach += 1.25 * h;
  }
  if (side.contour) {
    const x0 = cx + (shape.left - 0.1) * h;
    const x1 = cx + (shape.right + 0.1) * h;
    const sag = 0.2 * h;
    const k = sag / ((x1 - x0) / 2);
    const y0 = y + s * reach;
    if (side.contour === 'flush') {
      parts.push({ role: 'visible', geom: line({ x: x0, y: y0 }, { x: x1, y: y0 }) });
    } else {
      // Convex bows away from the line, concave towards it, within the same band.
      const convex = side.contour === 'convex';
      const yc = convex ? y0 : y0 + s * sag;
      parts.push({
        role: 'visible',
        geom: open([corner(x0, yc, convex ? -s * k : s * k), corner(x1, yc)]),
      });
      reach += 0.2 * h;
    }
    reach += 0.2 * h;
    if (side.finish)
      parts.push(text(side.finish, { x: cx, y: y + s * reach }, h, CENTRE, beyond, style));
  }
  return parts;
}

/** The pieces of the symbol `spec` (in drawing units) about the arrow's tip, its texts in `style`. */
export function weldSymbolParts(spec: WeldSymbolSpec, style: Handle): LibraryPart[] {
  const h = spec.height;
  const a = (spec.leaderAngle * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const j = { x: spec.leaderLength * u.x, y: spec.leaderLength * u.y };
  const dir = u.x < -1e-9 ? -1 : 1;
  const e = { x: j.x + dir * spec.referenceLength, y: j.y };
  const parts: LibraryPart[] = [];
  const add = (geom: EntityGeometry, role: LibraryPart['role'] = 'visible') =>
    parts.push({ role, geom });

  // The leader and its arrowhead, filled.
  add(line({ x: 0, y: 0 }, j));
  const n = { x: -u.y, y: u.x };
  const w = h / 6;
  const head: Corner[] = [
    corner(0, 0),
    corner(u.x * h + n.x * w, u.y * h + n.y * w),
    corner(u.x * h - n.x * w, u.y * h - n.y * w),
  ];
  add(closed(head));
  add(solid([head]), 'hatch');
  add(line(j, e));

  const { arrowSide, otherSide } = spec;
  const symmetric = arrowSide !== undefined && arrowSide.type === otherSide?.type;
  const xm = (j.x + e.x) / 2;
  const stagger =
    spec.staggered && arrowSide && otherSide
      ? Math.max(SHAPES[arrowSide.type].right, SHAPES[otherSide.type].right) * h + 0.25 * h
      : 0;
  if (spec.standard === 'ISO') {
    const idY = j.y - 0.4 * h;
    if (!symmetric) {
      const [x0, x1] = dir > 0 ? [j.x, e.x] : [e.x, j.x];
      add(line({ x: x0, y: idY }, { x: x1, y: idY }), 'hidden');
    }
    if (arrowSide) parts.push(...sideParts(arrowSide, xm - stagger, j.y, 1, h, style));
    if (otherSide)
      parts.push(...sideParts(otherSide, xm + stagger, symmetric ? j.y : idY, -1, h, style));
  } else {
    if (arrowSide) parts.push(...sideParts(arrowSide, xm - stagger, j.y, -1, h, style));
    if (otherSide) parts.push(...sideParts(otherSide, xm + stagger, j.y, 1, h, style));
  }

  if (spec.allAround) add(circle(0.4 * h, j));
  if (spec.field) {
    const top = { x: j.x, y: j.y + 1.6 * h };
    add(line(j, top));
    const flag = [
      corner(top.x, top.y),
      corner(top.x + dir * 0.9 * h, top.y - 0.25 * h),
      corner(top.x, top.y - 0.5 * h),
    ];
    add(closed(flag));
    add(solid([flag]), 'hatch');
  }
  if (spec.tail) {
    const t = 0.6 * h;
    add(line(e, { x: e.x + dir * t, y: e.y + t }));
    add(line(e, { x: e.x + dir * t, y: e.y - t }));
    parts.push(
      text(
        spec.tail,
        { x: e.x + dir * (t + 0.25 * h), y: e.y },
        h,
        dir > 0 ? LEFT : RIGHT,
        MIDDLE,
        style,
      ),
    );
  }
  return parts;
}

const oneLine = (v: string | undefined) => v === undefined || !/[\r\n]/.test(v);

function checkSide(side: WeldSide): string | undefined {
  if (!WELD_TYPES.includes(side.type)) return `${side.type} is not a weld type`;
  for (const [key, label] of [
    ['size', 'size'],
    ['length', 'length'],
    ['angle', 'groove angle'],
    ['rootOpening', 'root opening'],
    ['finish', 'finish'],
  ] as const) {
    if (!oneLine(side[key])) return `${label} must be one line`;
  }
  const name = WELD_TYPE_NAMES[side.type];
  if (side.angle && !ANGLED.has(side.type))
    return `${article(side.type)} ${name} weld has no groove angle`;
  if (side.rootOpening && !OPENED.has(side.type))
    return `${article(side.type)} ${name} weld has no root opening`;
  if (side.contour !== undefined && !WELD_CONTOURS.includes(side.contour))
    return `${side.contour} is not a contour`;
  if (side.finish && !side.contour) return 'a finish needs a contour';
  return undefined;
}

/** Why `spec` is not a weld symbol AWS A2.4 or ISO 2553 draws, or undefined when it is. */
export function checkWeldSymbol(spec: WeldSymbolSpec): string | undefined {
  if (spec.standard !== 'AWS' && spec.standard !== 'ISO')
    return `${String(spec.standard)} is not a standard`;
  for (const [key, label, positive] of [
    ['height', 'height', true],
    ['referenceLength', 'reference line length', true],
    ['leaderLength', 'leader length', true],
    ['leaderAngle', 'leader angle', false],
  ] as const) {
    const v = spec[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${label} must be a number`;
    if (positive && v <= 0) return `${label} must be more than 0`;
  }
  const sides = [spec.arrowSide, spec.otherSide].filter((s): s is WeldSide => s !== undefined);
  if (sides.length === 0) return 'a weld symbol needs a weld on the arrow side or the other side';
  for (const side of sides) {
    const why = checkSide(side);
    if (why) return why;
  }
  if (spec.staggered && !(spec.arrowSide?.length && spec.otherSide?.length))
    return 'staggered welds need a length and pitch on both sides';
  const shapes = sides.map((s) => SHAPES[s.type]);
  const stagger = spec.staggered ? 2 * Math.max(...shapes.map((s) => s.right)) + 0.5 : 0;
  if (spec.referenceLength < (4 + stagger) * spec.height)
    return 'reference line length must be at least 4 times the height (and the staggered offset)';
  if (!oneLine(spec.tail)) return 'tail must be one line';
  return undefined;
}

/** A dimension in a description: at most four decimals, without trailing zeros. */
function figure(v: number): string {
  const s = v.toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

function sideDescription(label: string, side: WeldSide): string {
  const said = [
    side.size && `size ${side.size}`,
    side.length && `length ${side.length}`,
    side.angle && `groove angle ${side.angle}`,
    side.rootOpening && `root opening ${side.rootOpening}`,
    side.contour && `${side.contour} contour`,
    side.finish && `finish ${side.finish}`,
  ].filter(Boolean);
  return [`${label} ${WELD_TYPE_NAMES[side.type]}`, ...said].join(', ');
}

/**
 * "Weld symbol, AWS A2.4: arrow side fillet, size 1/4; all around; …; height 0.125, reference
 * line 1, leader 0.375 at 45°": everything the symbol is drawn from.
 */
export function weldSymbolDescription(spec: WeldSymbolSpec): string {
  const said = [
    spec.arrowSide && sideDescription('arrow side', spec.arrowSide),
    spec.otherSide && sideDescription('other side', spec.otherSide),
    spec.staggered && 'staggered',
    spec.allAround && 'all around',
    spec.field && 'field weld',
    spec.tail && `tail ${spec.tail}`,
    `height ${figure(spec.height)}, reference line ${figure(spec.referenceLength)}, leader ${figure(spec.leaderLength)} at ${figure(spec.leaderAngle)}°`,
  ].filter(Boolean);
  return `Weld symbol, ${WELD_STANDARD_NAMES[spec.standard]}: ${said.join('; ')}`;
}

/** FNV-1a, 32 bits, of the string's UTF-16 code units, as eight hex digits. */
function digest(s: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).toUpperCase().padStart(8, '0');
}

/**
 * The block's name: `TRIYA_WELD_<standard>_<arrow side>_<other side>_<digest>`, a side's weld
 * type or 0 without one, and a digest of the description (the texts a drafter writes may hold
 * characters a block name cannot, and any change to what is drawn is another block).
 */
export function weldSymbolName(spec: WeldSymbolSpec): string {
  const type = (s: WeldSide | undefined) => (s ? s.type.toUpperCase() : '0');
  return [
    'TRIYA_WELD',
    spec.standard,
    type(spec.arrowSide),
    type(spec.otherSide),
    digest(weldSymbolDescription(spec)),
  ].join('_');
}

/** The style TEXTSTYLE names, else Standard, else the first (as TEXT and MTEXT start with). */
function currentTextStyle(model: DocumentModel): Handle | undefined {
  const name = model.header.get('$TEXTSTYLE');
  const styles = [...model.tables.textStyles.values()];
  const named = (n: string) => styles.find((s) => s.name.toUpperCase() === n.toUpperCase());
  return ((typeof name === 'string' ? named(name) : undefined) ?? named('Standard') ?? styles[0])
    ?.handle;
}

/**
 * The handle of the drawing's block for the symbol `spec` (in the drawing's units), adding it,
 * its texts in the current text style, when the drawing lacks it. Undefined, with nothing
 * added, when `spec` is no weld symbol or the drawing has no text style.
 */
export function addWeldSymbolBlock(
  b: ChangeSetBuilder,
  model: DocumentModel,
  spec: WeldSymbolSpec,
): Handle | undefined {
  if (checkWeldSymbol(spec) !== undefined) return undefined;
  const style = currentTextStyle(model);
  if (style === undefined) return undefined;
  return addPartsBlock(b, model, weldSymbolName(spec), weldSymbolDescription(spec), () =>
    weldSymbolParts(spec, style),
  );
}
