// The New and Modify Multileader Style dialog's fields (M4-04 part 2), tab by tab with AutoCAD
// 2024's groups and labels (AutoCAD Help, "Modify Multileader Style Dialog Box": the Leader
// Format, Leader Structure and Content tabs), and how they read and set an MLEADERSTYLE record
// (the DXF reference's MLEADERSTYLE object).
//
// What the dialog shows and the record has no field for, our reading (noted in the PR):
// - "Maximum leader points" unchecked is DXF 90 = 0, no limit (ObjectARX's
//   maxLeaderSegmentsPoints: 0 means none); checked, 2 or more.
// - "First segment angle" and "Second segment angle" unchecked are DXF 40/41 = 0, no constraint,
//   the angle kept in radians as MLEADER reads it (`constrainSegment`).
// - "Automatically include landing" sets both DXF 290 (landing) and 291 (dogleg), as MLEADER's
//   own Landing option does; "Set landing distance" is DXF 43, which every style states, so the
//   distance is always set (its check box is not offered).
// - "Scale multileaders to layout" is DXF 142 = 0, as DIMSCALE 0 scales a dimension to its
//   layout; MLEADER draws such a style at scale 1 (it has no viewport scale to take).
// - "Extend leader to text" has no field Triya maps, so it is not offered.
// - Annotative is shown and never set (DEC-013, DEC-058).
import type { Color, Lineweight, MLeaderStyleRecord } from '../model/types';
import type { Handle } from '../model/handle';
import { parseNumber } from '../commands/parse';
import { colorValue } from '../properties/color-books';
import {
  LINEWEIGHTS,
  colorLabel,
  lineweightLabel,
  lineweightValue,
  parseColorValue,
  parseLineweightValue,
} from '../properties/sheet';

export type MLeaderStyleTab = 'format' | 'structure' | 'content';

/** The dialog's tabs, in AutoCAD's order. */
export const MLEADERSTYLE_TABS: readonly {
  readonly id: MLeaderStyleTab;
  readonly label: string;
}[] = [
  { id: 'format', label: 'Leader Format' },
  { id: 'structure', label: 'Leader Structure' },
  { id: 'content', label: 'Content' },
];

/**
 * What the dialog shows of a style. Choices are strings (a colour as `colorValue` gives it, a
 * lineweight as `lineweightValue`, a record by handle, `''` for none); angles are degrees.
 */
export interface MLeaderStyleSettings {
  // Leader Format: General, Arrowhead, Leader break.
  /** DXF 173: '0' none, '1' straight, '2' spline. */
  readonly leaderType: string;
  readonly lineColor: string;
  /** A linetype's handle. */
  readonly linetype: string;
  readonly lineweight: string;
  /** '' closed filled, a block's handle, or the `_NAME` of an AutoCAD arrowhead to add. */
  readonly arrowhead: string;
  readonly arrowheadSize: number;
  readonly breakSize: number;
  // Leader Structure: Constraints, Landing settings, Scale.
  readonly maxPointsOn: boolean;
  readonly maxPoints: number;
  readonly firstAngleOn: boolean;
  readonly firstAngle: number;
  readonly secondAngleOn: boolean;
  readonly secondAngle: number;
  readonly landing: boolean;
  readonly landingDistance: number;
  readonly scaleToLayout: boolean;
  readonly scale: number;
  // Content: Multileader type, Text options, Leader connection, Block options.
  /** DXF 170: '2' Mtext, '1' Block, '0' None. */
  readonly contentType: string;
  readonly defaultText: string;
  /** A text style's handle. */
  readonly textStyle: string;
  /** DXF 175: '0' insert angle, '1' keep horizontal, '2' always right-reading. */
  readonly textAngle: string;
  readonly textColor: string;
  readonly textHeight: number;
  readonly alwaysLeft: boolean;
  readonly frame: boolean;
  /** DXF 271: '0' horizontal, '1' vertical attachment. */
  readonly attachment: string;
  /** DXF 174 / 178, '0'–'8'. */
  readonly leftAttachment: string;
  readonly rightAttachment: string;
  readonly landingGap: number;
  /** DXF 273 / 272: '9' center, '10' overline (underline) and center. */
  readonly topAttachment: string;
  readonly bottomAttachment: string;
  /** A block's handle, or a built-in block's `_Name` (added when the style is saved). */
  readonly block: string;
  /** DXF 177: '0' center extents, '1' insertion point. */
  readonly blockConnection: string;
  readonly blockColor: string;
  readonly blockScale: number;
}

export type MLeaderStyleKey = keyof MLeaderStyleSettings;
export type MLeaderStyleValue = string | number | boolean;

export interface MLeaderStyleOption {
  readonly value: string;
  readonly label: string;
}

/** The drawing's records the fields name. */
export interface MLeaderStyleLists {
  readonly linetypes: readonly MLeaderStyleOption[];
  readonly textStyles: readonly MLeaderStyleOption[];
  /** Closed filled, AutoCAD's arrowheads (by handle where the drawing has one) and its own. */
  readonly arrowheads: readonly MLeaderStyleOption[];
  /** The drawing's blocks, then AutoCAD's built-in blocks it lacks. */
  readonly blocks: readonly MLeaderStyleOption[];
}

export interface MLeaderStyleField {
  readonly key: MLeaderStyleKey;
  readonly tab: MLeaderStyleTab;
  readonly group: string;
  readonly label: string;
  /** `choice` a list, `radio` buttons, `number` a typed number, `check`, `text` typed text. */
  readonly kind: 'choice' | 'radio' | 'number' | 'check' | 'text';
  /** A colour list, which the dialog ends with Select Color... */
  readonly color?: true;
  /** A list of numbers (the segment angles): the value is a number, its options strings. */
  readonly numeric?: true;
  /** The check box a number sits beside (Maximum leader points, Specify scale, …). */
  readonly checkedBy?: MLeaderStyleKey;
  readonly options?:
    | readonly MLeaderStyleOption[]
    | ((lists: MLeaderStyleLists, s: MLeaderStyleSettings) => readonly MLeaderStyleOption[]);
  /** Whether the field shows for `s` (the Content tab's groups follow the multileader type). */
  readonly shown?: (s: MLeaderStyleSettings) => boolean;
  /** Whether it can be changed now (AutoCAD greys it out otherwise). */
  readonly enabled?: (s: MLeaderStyleSettings) => boolean;
  /** Numbers it takes. */
  readonly takes?: (n: number) => boolean;
}

const opts = (pairs: readonly (readonly [string | number, string])[]): MLeaderStyleOption[] =>
  pairs.map(([value, label]) => ({ value: String(value), label }));

const STANDARD_COLORS: readonly Color[] = [
  { kind: 'byLayer' },
  { kind: 'byBlock' },
  ...[1, 2, 3, 4, 5, 6, 7].map((index): Color => ({ kind: 'aci', index })),
];

/** ByLayer, ByBlock, the seven named colours, and the style's own when it is another. */
function colorOptions(value: string): MLeaderStyleOption[] {
  const out = STANDARD_COLORS.map((c) => ({ value: colorValue(c), label: colorLabel(c) }));
  const own = parseColorValue(value);
  if (own && !out.some((o) => o.value === value)) out.push({ value, label: colorLabel(own) });
  return out;
}

const LINEWEIGHT_OPTIONS: readonly MLeaderStyleOption[] = [
  ...(['ByLayer', 'ByBlock', 'Default'] as const).map((w) => ({ value: w, label: w })),
  ...LINEWEIGHTS.map((w) => ({ value: String(w), label: lineweightLabel(w) })),
];

/** AutoCAD's segment angle list. */
const SEGMENT_ANGLES = opts([15, 30, 45, 60, 90].map((d) => [d, String(d)] as const));

/** Left and Right attachment, in AutoCAD's list order (DXF 174/178 values). */
export const MLEADER_SIDE_ATTACHMENTS = opts([
  [0, 'Top of top line'],
  [1, 'Middle of top line'],
  [2, 'Middle of multi-line text'],
  [3, 'Middle of bottom line'],
  [4, 'Bottom of bottom line'],
  [7, 'Bottom of top line'],
  [5, 'Underline bottom line'],
  [6, 'Underline top line'],
  [8, 'Underline all text'],
]);

const mtext = (s: MLeaderStyleSettings) => s.contentType === '2';
const block = (s: MLeaderStyleSettings) => s.contentType === '1';
const horizontal = (s: MLeaderStyleSettings) => mtext(s) && s.attachment === '0';
const vertical = (s: MLeaderStyleSettings) => mtext(s) && s.attachment === '1';
const positive = (n: number) => n > 0;
const atLeast0 = (n: number) => n >= 0;

/** The dialog's fields, tab by tab, group by group, in AutoCAD's order. */
export const MLEADERSTYLE_FIELDS: readonly MLeaderStyleField[] = [
  // Leader Format.
  {
    key: 'leaderType',
    tab: 'format',
    group: 'General',
    label: 'Type',
    kind: 'choice',
    options: opts([
      [1, 'Straight'],
      [2, 'Spline'],
      [0, 'None'],
    ]),
  },
  {
    key: 'lineColor',
    tab: 'format',
    group: 'General',
    label: 'Color',
    kind: 'choice',
    color: true,
    options: (_l, s) => colorOptions(s.lineColor),
  },
  {
    key: 'linetype',
    tab: 'format',
    group: 'General',
    label: 'Linetype',
    kind: 'choice',
    options: (l) => l.linetypes,
  },
  {
    key: 'lineweight',
    tab: 'format',
    group: 'General',
    label: 'Lineweight',
    kind: 'choice',
    options: LINEWEIGHT_OPTIONS,
  },
  {
    key: 'arrowhead',
    tab: 'format',
    group: 'Arrowhead',
    label: 'Symbol',
    kind: 'choice',
    options: (l) => l.arrowheads,
  },
  {
    key: 'arrowheadSize',
    tab: 'format',
    group: 'Arrowhead',
    label: 'Size',
    kind: 'number',
    takes: atLeast0,
  },
  {
    key: 'breakSize',
    tab: 'format',
    group: 'Leader break',
    label: 'Break size',
    kind: 'number',
    takes: atLeast0,
  },
  // Leader Structure.
  {
    key: 'maxPointsOn',
    tab: 'structure',
    group: 'Constraints',
    label: 'Maximum leader points',
    kind: 'check',
  },
  {
    key: 'maxPoints',
    tab: 'structure',
    group: 'Constraints',
    label: 'Maximum leader points',
    kind: 'number',
    checkedBy: 'maxPointsOn',
    enabled: (s) => s.maxPointsOn,
    takes: (n) => Number.isInteger(n) && n >= 2,
  },
  {
    key: 'firstAngleOn',
    tab: 'structure',
    group: 'Constraints',
    label: 'First segment angle',
    kind: 'check',
  },
  {
    key: 'firstAngle',
    tab: 'structure',
    group: 'Constraints',
    label: 'First segment angle',
    kind: 'choice',
    checkedBy: 'firstAngleOn',
    numeric: true,
    enabled: (s) => s.firstAngleOn,
    options: SEGMENT_ANGLES,
  },
  {
    key: 'secondAngleOn',
    tab: 'structure',
    group: 'Constraints',
    label: 'Second segment angle',
    kind: 'check',
  },
  {
    key: 'secondAngle',
    tab: 'structure',
    group: 'Constraints',
    label: 'Second segment angle',
    kind: 'choice',
    checkedBy: 'secondAngleOn',
    numeric: true,
    enabled: (s) => s.secondAngleOn,
    options: SEGMENT_ANGLES,
  },
  {
    key: 'landing',
    tab: 'structure',
    group: 'Landing settings',
    label: 'Automatically include landing',
    kind: 'check',
  },
  {
    key: 'landingDistance',
    tab: 'structure',
    group: 'Landing settings',
    label: 'Set landing distance',
    kind: 'number',
    enabled: (s) => s.landing,
    takes: atLeast0,
  },
  {
    key: 'scaleToLayout',
    tab: 'structure',
    group: 'Scale',
    label: 'Scale',
    kind: 'radio',
    options: opts([
      ['true', 'Scale multileaders to layout'],
      ['false', 'Specify scale'],
    ]),
  },
  {
    key: 'scale',
    tab: 'structure',
    group: 'Scale',
    label: 'Specify scale',
    kind: 'number',
    enabled: (s) => !s.scaleToLayout,
    takes: positive,
  },
  // Content.
  {
    key: 'contentType',
    tab: 'content',
    group: 'Multileader type',
    label: 'Multileader type',
    kind: 'choice',
    options: opts([
      [2, 'Mtext'],
      [1, 'Block'],
      [0, 'None'],
    ]),
  },
  {
    key: 'defaultText',
    tab: 'content',
    group: 'Text options',
    label: 'Default text',
    kind: 'text',
    shown: mtext,
  },
  {
    key: 'textStyle',
    tab: 'content',
    group: 'Text options',
    label: 'Text style',
    kind: 'choice',
    shown: mtext,
    options: (l) => l.textStyles,
  },
  {
    key: 'textAngle',
    tab: 'content',
    group: 'Text options',
    label: 'Text angle',
    kind: 'choice',
    shown: mtext,
    options: opts([
      [1, 'Keep horizontal'],
      [0, 'Insert angle'],
      [2, 'Always right-reading'],
    ]),
  },
  {
    key: 'textColor',
    tab: 'content',
    group: 'Text options',
    label: 'Text color',
    kind: 'choice',
    color: true,
    shown: mtext,
    options: (_l, s) => colorOptions(s.textColor),
  },
  {
    key: 'textHeight',
    tab: 'content',
    group: 'Text options',
    label: 'Text height',
    kind: 'number',
    shown: mtext,
    takes: positive,
  },
  {
    key: 'alwaysLeft',
    tab: 'content',
    group: 'Text options',
    label: 'Always left justify',
    kind: 'check',
    shown: mtext,
  },
  {
    key: 'frame',
    tab: 'content',
    group: 'Text options',
    label: 'Frame text',
    kind: 'check',
    shown: mtext,
  },
  {
    key: 'attachment',
    tab: 'content',
    group: 'Leader connection',
    label: 'Attachment',
    kind: 'radio',
    shown: mtext,
    options: opts([
      [0, 'Horizontal attachment'],
      [1, 'Vertical attachment'],
    ]),
  },
  {
    key: 'leftAttachment',
    tab: 'content',
    group: 'Leader connection',
    label: 'Left attachment',
    kind: 'choice',
    shown: horizontal,
    options: MLEADER_SIDE_ATTACHMENTS,
  },
  {
    key: 'rightAttachment',
    tab: 'content',
    group: 'Leader connection',
    label: 'Right attachment',
    kind: 'choice',
    shown: horizontal,
    options: MLEADER_SIDE_ATTACHMENTS,
  },
  {
    key: 'topAttachment',
    tab: 'content',
    group: 'Leader connection',
    label: 'Top attachment',
    kind: 'choice',
    shown: vertical,
    options: opts([
      [9, 'Center'],
      [10, 'Overline and Center'],
    ]),
  },
  {
    key: 'bottomAttachment',
    tab: 'content',
    group: 'Leader connection',
    label: 'Bottom attachment',
    kind: 'choice',
    shown: vertical,
    options: opts([
      [9, 'Center'],
      [10, 'Underline and Center'],
    ]),
  },
  {
    key: 'landingGap',
    tab: 'content',
    group: 'Leader connection',
    label: 'Landing gap',
    kind: 'number',
    shown: mtext,
    takes: atLeast0,
  },
  {
    key: 'block',
    tab: 'content',
    group: 'Block options',
    label: 'Source block',
    kind: 'choice',
    shown: block,
    options: (l) => l.blocks,
  },
  {
    key: 'blockConnection',
    tab: 'content',
    group: 'Block options',
    label: 'Attachment',
    kind: 'choice',
    shown: block,
    options: opts([
      [0, 'Center extents'],
      [1, 'Insertion point'],
    ]),
  },
  {
    key: 'blockColor',
    tab: 'content',
    group: 'Block options',
    label: 'Color',
    kind: 'choice',
    color: true,
    shown: block,
    options: (_l, s) => colorOptions(s.blockColor),
  },
  {
    key: 'blockScale',
    tab: 'content',
    group: 'Block options',
    label: 'Scale',
    kind: 'number',
    shown: block,
    takes: (n) => n !== 0,
  },
];

/** The options a field offers for `s`. */
export function mleaderStyleFieldOptions(
  f: MLeaderStyleField,
  lists: MLeaderStyleLists,
  s: MLeaderStyleSettings,
): readonly MLeaderStyleOption[] {
  if (!f.options) return [];
  return typeof f.options === 'function' ? f.options(lists, s) : f.options;
}

/** A typed number, as the command line parses one. */
function typed(v: MLeaderStyleValue): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  return parseNumber(v.trim());
}

/** `s` with field `key` set to `value`; `s` itself when the field cannot take it. */
export function setMLeaderStyleField(
  s: MLeaderStyleSettings,
  key: MLeaderStyleKey,
  value: MLeaderStyleValue,
): MLeaderStyleSettings {
  const f = MLEADERSTYLE_FIELDS.find((x) => x.key === key);
  if (!f) return s;
  const was = s[key];
  if (typeof was === 'boolean') {
    const on = typeof value === 'boolean' ? value : value === 'true';
    return { ...s, [key]: on };
  }
  if (typeof was === 'number') {
    const n = typed(value);
    if (n === undefined || (f.takes && !f.takes(n))) return s;
    return { ...s, [key]: n };
  }
  if (typeof value !== 'string') return s;
  return { ...s, [key]: value };
}

const DEG = Math.PI / 180;
const deg = (r: number) => Number((r / DEG).toPrecision(12));
const vec = (n: number) => ({ x: n, y: n, z: n });

/** A style as the dialog shows it. */
export function mleaderStyleSettings(s: MLeaderStyleRecord): MLeaderStyleSettings {
  const choice = (n: number) => String(Math.round(n));
  return {
    leaderType: choice(s.pathType),
    lineColor: colorValue(s.lineColor),
    linetype: s.linetype ?? '',
    lineweight: lineweightValue(s.lineweight),
    arrowhead: s.arrowhead ?? '',
    arrowheadSize: s.arrowheadSize,
    breakSize: s.breakGap,
    maxPointsOn: s.maxLeaderPoints > 0,
    maxPoints: s.maxLeaderPoints >= 2 ? s.maxLeaderPoints : 2,
    firstAngleOn: s.firstSegmentAngle !== 0,
    firstAngle: s.firstSegmentAngle !== 0 ? deg(s.firstSegmentAngle) : 15,
    secondAngleOn: s.secondSegmentAngle !== 0,
    secondAngle: s.secondSegmentAngle !== 0 ? deg(s.secondSegmentAngle) : 15,
    landing: s.dogleg,
    landingDistance: s.doglegLength,
    scaleToLayout: s.scale === 0,
    scale: s.scale > 0 ? s.scale : 1,
    contentType: choice(s.contentType === 3 ? 0 : s.contentType),
    defaultText: s.defaultText,
    textStyle: s.textStyle ?? '',
    textAngle: choice(s.textAngleType),
    textColor: colorValue(s.textColor),
    textHeight: s.textHeight,
    alwaysLeft: s.textAlignAlwaysLeft,
    frame: s.textFrame,
    attachment: choice(s.textAttachmentDirection === 1 ? 1 : 0),
    leftAttachment: choice(s.textLeftAttachment),
    rightAttachment: choice(s.textRightAttachment),
    landingGap: s.landingGap,
    topAttachment: choice(s.textTopAttachment === 10 ? 10 : 9),
    bottomAttachment: choice(s.textBottomAttachment === 10 ? 10 : 9),
    block: s.block ?? '',
    blockConnection: choice(s.blockConnection === 1 ? 1 : 0),
    blockColor: colorValue(s.blockColor),
    blockScale: s.blockScaleOn ? s.blockScale.x : 1,
  };
}

/** Why settings cannot be a style's; undefined when they can. */
export function mleaderStyleProblem(s: MLeaderStyleSettings): string | undefined {
  for (const f of MLEADERSTYLE_FIELDS) {
    const v: unknown = s[f.key];
    if (f.kind === 'check' || f.key === 'scaleToLayout') {
      if (typeof v !== 'boolean') return `${f.label}: invalid value.`;
    } else if (f.kind === 'number' || f.numeric) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return `${f.label}: invalid value.`;
    } else if (typeof v !== 'string') return `${f.label}: invalid value.`;
  }
  if (!['0', '1', '2'].includes(s.leaderType)) return 'Type: invalid value.';
  if (!parseColorValue(s.lineColor)) return 'Color: invalid value.';
  if (!parseColorValue(s.textColor)) return 'Text color: invalid value.';
  if (!parseColorValue(s.blockColor)) return 'Color: invalid value.';
  if (!parseLineweightValue(s.lineweight)) return 'Lineweight: invalid value.';
  if (s.arrowheadSize < 0) return 'Arrowhead size must be 0 or more.';
  if (s.breakSize < 0) return 'Break size must be 0 or more.';
  if (s.maxPointsOn && !(Number.isInteger(s.maxPoints) && s.maxPoints >= 2))
    return 'Maximum leader points must be a whole number, 2 or more.';
  for (const a of [s.firstAngle, s.secondAngle])
    if (!(a > 0 && a <= 90)) return 'A segment angle must be between 0 and 90.';
  if (s.landingDistance < 0) return 'Landing distance must be 0 or more.';
  if (!s.scaleToLayout && !(s.scale > 0)) return 'Scale must be greater than 0.';
  if (!['0', '1', '2'].includes(s.contentType)) return 'Multileader type: invalid value.';
  if (!['0', '1', '2'].includes(s.textAngle)) return 'Text angle: invalid value.';
  if (!(s.textHeight > 0)) return 'Text height must be greater than 0.';
  if (!['0', '1'].includes(s.attachment)) return 'Attachment: invalid value.';
  const side = MLEADER_SIDE_ATTACHMENTS.map((o) => o.value);
  if (!side.includes(s.leftAttachment) || !side.includes(s.rightAttachment))
    return 'Attachment: invalid value.';
  if (!['9', '10'].includes(s.topAttachment) || !['9', '10'].includes(s.bottomAttachment))
    return 'Attachment: invalid value.';
  if (s.landingGap < 0) return 'Landing gap must be 0 or more.';
  if (!['0', '1'].includes(s.blockConnection)) return 'Attachment: invalid value.';
  if (s.blockScale === 0) return 'Block scale cannot be 0.';
  if (s.contentType === '1' && s.block === '') return 'Choose a source block.';
  return undefined;
}

/**
 * The dialog settings each record field is made from: a field whose settings the dialog left as
 * they were keeps the record's own value (a non-uniform block scale, an angle's radians).
 */
export const MLEADERSTYLE_RECORD_KEYS: Readonly<Record<string, readonly MLeaderStyleKey[]>> = {
  pathType: ['leaderType'],
  lineColor: ['lineColor'],
  linetype: ['linetype'],
  lineweight: ['lineweight'],
  arrowhead: ['arrowhead'],
  arrowheadSize: ['arrowheadSize'],
  breakGap: ['breakSize'],
  maxLeaderPoints: ['maxPointsOn', 'maxPoints'],
  firstSegmentAngle: ['firstAngleOn', 'firstAngle'],
  secondSegmentAngle: ['secondAngleOn', 'secondAngle'],
  landing: ['landing'],
  dogleg: ['landing'],
  doglegLength: ['landingDistance'],
  scale: ['scaleToLayout', 'scale'],
  contentType: ['contentType'],
  defaultText: ['defaultText'],
  textStyle: ['textStyle'],
  textAngleType: ['textAngle'],
  textColor: ['textColor'],
  textHeight: ['textHeight'],
  textAlignAlwaysLeft: ['alwaysLeft'],
  textFrame: ['frame'],
  textAttachmentDirection: ['attachment'],
  textLeftAttachment: ['leftAttachment'],
  textRightAttachment: ['rightAttachment'],
  landingGap: ['landingGap'],
  textTopAttachment: ['topAttachment'],
  textBottomAttachment: ['bottomAttachment'],
  block: ['block'],
  blockConnection: ['blockConnection'],
  blockColor: ['blockColor'],
  blockScale: ['blockScale'],
  blockScaleOn: ['blockScale'],
};

/**
 * The record fields `s` sets, given the handles its names resolve to (`refs`: the linetype,
 * arrowhead, text style and block, each undefined for none).
 */
export function mleaderStyleFields(
  s: MLeaderStyleSettings,
  refs: {
    readonly linetype: Handle | undefined;
    readonly arrowhead: Handle | undefined;
    readonly textStyle: Handle | undefined;
    readonly block: Handle | undefined;
  },
): Omit<
  MLeaderStyleRecord,
  | 'handle'
  | 'name'
  | 'description'
  | 'mleaderDrawOrder'
  | 'leaderDrawOrder'
  | 'textAlignment'
  | 'alignSpace'
  | 'blockRotation'
  | 'blockRotationOn'
  | 'overwriteProperties'
  | 'annotative'
  | 'flags'
  | 'xdata'
  | 'linetype'
  | 'arrowhead'
  | 'textStyle'
  | 'block'
> & {
  readonly linetype: Handle | undefined;
  readonly arrowhead: Handle | undefined;
  readonly textStyle: Handle | undefined;
  readonly block: Handle | undefined;
} {
  const n = (v: string) => Number(v);
  return {
    pathType: n(s.leaderType),
    lineColor: parseColorValue(s.lineColor)!,
    linetype: refs.linetype,
    lineweight: parseLineweightValue(s.lineweight) as Lineweight,
    arrowhead: refs.arrowhead,
    arrowheadSize: s.arrowheadSize,
    breakGap: s.breakSize,
    maxLeaderPoints: s.maxPointsOn ? s.maxPoints : 0,
    firstSegmentAngle: s.firstAngleOn ? s.firstAngle * DEG : 0,
    secondSegmentAngle: s.secondAngleOn ? s.secondAngle * DEG : 0,
    landing: s.landing,
    dogleg: s.landing,
    doglegLength: s.landingDistance,
    scale: s.scaleToLayout ? 0 : s.scale,
    contentType: n(s.contentType),
    defaultText: s.defaultText,
    textStyle: refs.textStyle,
    textAngleType: n(s.textAngle),
    textColor: parseColorValue(s.textColor)!,
    textHeight: s.textHeight,
    textAlignAlwaysLeft: s.alwaysLeft,
    textFrame: s.frame,
    textAttachmentDirection: n(s.attachment),
    textLeftAttachment: n(s.leftAttachment),
    textRightAttachment: n(s.rightAttachment),
    landingGap: s.landingGap,
    textTopAttachment: n(s.topAttachment),
    textBottomAttachment: n(s.bottomAttachment),
    block: refs.block,
    blockConnection: n(s.blockConnection),
    blockColor: parseColorValue(s.blockColor)!,
    blockScale: vec(s.blockScale),
    blockScaleOn: true,
  };
}
