// Multileader geometry for MLEADER and MLEADEREDIT (M2-09): a new MULTILEADER as its current
// MLEADERSTYLE makes it, and leader lines added to it or removed from it.
//
// What AutoCAD stores for a multileader it draws (the DXF reference's MLEADER, and AutoCAD's own
// files: acadsharp's sample_AC1032 MLEADER): the leader line runs from the arrowhead to the
// "leader landing location" picked, which is the branch's connection point (LEADER{ 10); the
// landing runs on from there for the dogleg length (LEADER{ 40, scaled) in the branch's
// direction (LEADER{ 11, towards the content), and the content base point (context 10) is the
// landing's end. The text starts a landing gap (context 145) beyond it. Entity-level sizes
// (DXF 41, 42) are the style's; the context data's (140, 145, 41 text height, LEADER{ 40) are
// those times the overall scale (DXF 45), as AutoCAD writes them.
//
// Where AutoCAD does not document what it does, this takes the reading a drafter expects, noted
// in place:
// - The text is anchored by the MTEXT attachment point whose row matches the style's text
//   attachment: "top of top line" by its top, "middle of text" by its middle, "bottom of bottom
//   line" by its bottom, each offset by half a text height or a height where the attachment
//   names a line within the text (AutoCAD measures its font's lines; this uses the text height),
//   and lifted a landing gap where the attachment underlines. Text on the right of its landing
//   is aligned left, text on the left aligned right (AutoCAD's default, "always left justify"
//   off).
// - Block content attaches by the middle of its extents' side facing the landing (block
//   connection "extents") or by its insertion point ("base point"), without a landing gap: the
//   gap is the text's.
// - A leader added on the side of the content that already has a landing joins that landing;
//   one on the other side gets a landing of its own there (AutoCAD's MLEADEREDIT Add).
import { unionBox, type Box } from '../geom/bounds';
import { toleranceFromExtents } from '../geom/tolerance';
import { entityBounds, type BoundsContext } from '../spatial/entity-bounds';
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type {
  Color,
  MLeaderStyleRecord,
  MultiLeaderAttribute,
  MultiLeaderBlock,
  MultiLeaderBranch,
  MultiLeaderGeometry,
  MultiLeaderText,
} from '../model/types';

/** DXF 90 bits: the multileader properties that override its style (DXF reference, MLEADER). */
export const MLEADER_OVERRIDES = {
  pathType: 1 << 0,
  landing: 1 << 4,
  dogleg: 1 << 6,
  contentType: 1 << 10,
  blockContent: 1 << 17,
  scale: 1 << 22,
} as const;

/** DXF 170/172 content types. */
export const MLEADER_BLOCK = 1;
export const MLEADER_MTEXT = 2;

const BY_BLOCK: Color = { kind: 'byBlock' };

/**
 * The style new multileaders take: the one CMLEADERSTYLE names (a DICTIONARYVAR, carried under
 * its bare name), else Standard, else the first; undefined in a drawing with none.
 */
export function currentMLeaderStyle(model: DocumentModel): MLeaderStyleRecord | undefined {
  const name = model.header.get('CMLEADERSTYLE');
  const styles = [...model.tables.mleaderStyles.values()];
  const named = (n: string) => styles.find((s) => s.name.toUpperCase() === n.toUpperCase());
  return (typeof name === 'string' ? named(name) : undefined) ?? named('Standard') ?? styles[0];
}

/**
 * AutoCAD's Standard multileader style, for a drawing that has none (one read from R2004 or
 * older): the values of AutoCAD 2024's acad.dwt (imperial) and acadiso.dwt (metric) Standard
 * style, which acadsharp's sample drawing also holds (arrowhead 0.18, gap 0.09, landing 0.36).
 */
export function standardMLeaderStyle(
  metric: boolean,
  textStyle: Handle | undefined,
  linetype?: Handle,
): Omit<MLeaderStyleRecord, 'handle'> {
  const k = metric ? 1 : 0.045;
  return {
    name: 'Standard',
    description: '',
    contentType: MLEADER_MTEXT,
    mleaderDrawOrder: 0,
    leaderDrawOrder: 0,
    maxLeaderPoints: 2,
    firstSegmentAngle: 0,
    secondSegmentAngle: 0,
    pathType: 1,
    lineColor: BY_BLOCK,
    ...(linetype !== undefined && { linetype }),
    lineweight: 'ByBlock',
    landing: true,
    landingGap: 2 * k,
    dogleg: true,
    doglegLength: 8 * k,
    arrowheadSize: 4 * k,
    defaultText: '',
    ...(textStyle !== undefined && { textStyle }),
    textLeftAttachment: 1,
    textRightAttachment: 1,
    textTopAttachment: 9,
    textBottomAttachment: 9,
    textAttachmentDirection: 0,
    textAngleType: 1,
    textAlignment: 0,
    textColor: BY_BLOCK,
    textHeight: 4 * k,
    textFrame: false,
    textAlignAlwaysLeft: false,
    alignSpace: 4 * k,
    blockColor: BY_BLOCK,
    blockScale: { x: 1, y: 1, z: 1 },
    blockScaleOn: true,
    blockRotation: 0,
    blockRotationOn: true,
    blockConnection: 0,
    scale: 1,
    overwriteProperties: false,
    annotative: false,
    breakGap: metric ? 3.75 : 0.125,
  };
}

/**
 * The linetype a new Standard style's leaders take: ByBlock, as AutoCAD's; a drawing from before
 * R13 has none, so ByLayer, Continuous or its first linetype stand in.
 */
export function standardLinetype(model: DocumentModel): Handle | undefined {
  const all = [...model.tables.linetypes.values()];
  const named = (n: string) => all.find((l) => l.name.toUpperCase() === n);
  return (named('BYBLOCK') ?? named('BYLAYER') ?? named('CONTINUOUS') ?? all[0])?.handle;
}

/** What MLEADER's Options change for the multileaders it makes; the style's until changed. */
export interface MLeaderSettings {
  /** 0 none, 1 straight, 2 spline. */
  readonly pathType: number;
  /** Leader landing (DXF 290 and 291 together). */
  readonly landing: boolean;
  /** 0 none, 1 block, 2 mtext. */
  readonly contentType: number;
  /** The block for block content. */
  readonly block?: Handle;
  /** The most points a leader line takes, the arrowhead and the landing location included. */
  readonly maxPoints: number;
  /** Radians; 0 leaves the segment free. */
  readonly firstAngle: number;
  readonly secondAngle: number;
}

export function settingsOf(style: MLeaderStyleRecord): MLeaderSettings {
  return {
    pathType: style.pathType,
    landing: style.dogleg,
    contentType:
      style.contentType === MLEADER_BLOCK
        ? MLEADER_BLOCK
        : style.contentType === MLEADER_MTEXT
          ? MLEADER_MTEXT
          : 0,
    ...(style.block !== undefined && { block: style.block }),
    maxPoints: Math.max(2, style.maxLeaderPoints || 2),
    firstAngle: style.firstSegmentAngle,
    secondAngle: style.secondSegmentAngle,
  };
}

/**
 * The point a constrained segment ends at: on the ray from `from` at the multiple of `step`
 * nearest the cursor's direction, as far along it as the cursor (AutoCAD's First angle and
 * Second angle constraints). A zero step leaves the point where it is.
 */
export function constrainSegment(from: Vec2, to: Vec2, step: number): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (!(step > 0) || len === 0) return to;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  const d = { x: Math.cos(a), y: Math.sin(a) };
  const along = dx * d.x + dy * d.y;
  return { x: from.x + d.x * along, y: from.y + d.y * along };
}

/** Where content meets a branch: the landing's end, and which way the content lies from it. */
export interface Landing {
  /** LEADER{ 10: where the leader lines end. */
  readonly connection: Vec2;
  /** LEADER{ 11: unit vector towards the content. */
  readonly direction: Vec2;
  /** The landing's end (context 10), where the content attaches. */
  readonly end: Vec2;
}

/** The style's sizes for a multileader of overall scale `scale`. */
function scaled(style: MLeaderStyleRecord, scale: number) {
  return {
    dogleg: style.doglegLength * scale,
    gap: style.landingGap * scale,
    arrow: style.arrowheadSize * scale,
    text: style.textHeight * scale,
  };
}

/**
 * The landing of a leader whose line comes from `from` and ends at the landing location `at`.
 * Horizontal attachment: the content lies on the side away from `from` (to the right when
 * level), the landing running on for the dogleg length; with the landing off the line ends where
 * the landing would have, at `at`, and the branch keeps its dogleg length. Vertical attachment:
 * the content lies above or below, with no landing.
 */
export function landingAt(
  from: Vec2,
  at: Vec2,
  style: MLeaderStyleRecord,
  landing: boolean,
  scale: number,
): Landing {
  const len = scaled(style, scale).dogleg;
  if (style.textAttachmentDirection === 1) {
    return { connection: at, direction: { x: 0, y: from.y > at.y ? -1 : 1 }, end: at };
  }
  const direction = { x: from.x > at.x ? -1 : 1, y: 0 };
  if (landing) return { connection: at, direction, end: { x: at.x + direction.x * len, y: at.y } };
  return { connection: { x: at.x - direction.x * len, y: at.y }, direction, end: at };
}

/** The landing that reaches content at `end` from the side `direction` points away from. */
export function landingTo(
  end: Vec2,
  direction: Vec2,
  style: MLeaderStyleRecord,
  scale: number,
): Landing {
  if (direction.x === 0) return { connection: end, direction, end };
  const len = scaled(style, scale).dogleg;
  return { connection: { x: end.x - direction.x * len, y: end.y }, direction, end };
}

/**
 * A horizontal text attachment (DXF 173/95, the MLEADERSTYLE dialog's order: top of top line,
 * middle of top line, middle of text, middle of bottom line, bottom of bottom line, underline
 * bottom line, underline top line, bottom of top line, underline all text) as the MTEXT row that
 * anchors the text (0 top, 1 middle, 2 bottom) and the anchor's height above the landing.
 */
export function attachmentRow(
  kind: number,
  height: number,
  gap: number,
): { readonly row: number; readonly dy: number } {
  switch (kind) {
    case 0:
      return { row: 0, dy: 0 };
    case 1:
      return { row: 0, dy: height / 2 };
    case 2:
      return { row: 1, dy: 0 };
    case 3:
      return { row: 2, dy: -height / 2 };
    case 5:
    case 8:
      return { row: 2, dy: gap };
    case 6:
      return { row: 0, dy: height + gap };
    case 7:
      return { row: 0, dy: height };
    default:
      return { row: 2, dy: 0 };
  }
}

/** Where the text goes for a landing: its MTEXT insertion point and attachment (1–9). */
export function textAnchor(
  style: MLeaderStyleRecord,
  landing: Landing,
  scale: number,
): { readonly position: Vec2; readonly attachment: number } {
  const s = scaled(style, scale);
  const e = landing.end;
  if (style.textAttachmentDirection === 1) {
    // Content above the leader's end: the text's bottom centre a gap above it, and below, its
    // top centre a gap below.
    const above = landing.direction.y > 0;
    return above
      ? { position: { x: e.x, y: e.y + s.gap }, attachment: 8 }
      : { position: { x: e.x, y: e.y - s.gap }, attachment: 2 };
  }
  const right = landing.direction.x > 0;
  const kind = right ? style.textLeftAttachment : style.textRightAttachment;
  const { row, dy } = attachmentRow(kind, s.text, s.gap);
  const col = right ? 0 : 2;
  return {
    position: { x: e.x + landing.direction.x * s.gap, y: e.y + dy },
    attachment: row * 3 + col + 1,
  };
}

/** A box's corners turned by `angle` and scaled, about the origin. */
function placedBox(b: Box, scale: Vec2, angle: number): Box {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const pts = [
    [b.minX, b.minY],
    [b.maxX, b.minY],
    [b.minX, b.maxY],
    [b.maxX, b.maxY],
  ].map(([x, y]) => {
    const px = x! * scale.x;
    const py = y! * scale.y;
    return { x: px * c - py * s, y: px * s + py * c };
  });
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

/**
 * Where block content goes for a landing: its insertion point. `extents` is the block's extents
 * relative to its base point, unscaled; without them (or with the base point connection) the
 * insertion point is the landing's end.
 */
export function blockAnchor(
  style: MLeaderStyleRecord,
  landing: Landing,
  extents: Box | undefined,
  scale: Vec2,
  rotation: number,
): Vec2 {
  const e = landing.end;
  if (style.blockConnection === 1 || !extents) return e;
  const b = placedBox(extents, scale, rotation);
  const d = landing.direction;
  if (d.x !== 0) {
    const x = d.x > 0 ? e.x - b.minX : e.x - b.maxX;
    return { x, y: e.y - (b.minY + b.maxY) / 2 };
  }
  const y = d.y > 0 ? e.y - b.minY : e.y - b.maxY;
  return { x: e.x - (b.minX + b.maxX) / 2, y };
}

/** What a new multileader holds besides its style's values. */
export interface NewMultiLeader {
  readonly style: MLeaderStyleRecord;
  readonly settings: MLeaderSettings;
  /** Leader line vertices from the arrowhead, the connection point not repeated. */
  readonly vertices: readonly Vec2[];
  readonly landing: Landing;
  /** The overall scale (DXF 45). */
  readonly scale: number;
  readonly text?: {
    readonly content: string;
    readonly style: Handle;
    readonly position: Vec2;
    readonly attachment: number;
    readonly width: number;
  };
  readonly block?: {
    readonly block: Handle;
    readonly position: Vec2;
    readonly attributes: readonly MultiLeaderAttribute[];
  };
}

/** The block content's scale and rotation as the style gives them, times the overall scale. */
export function blockScaleOf(
  style: MLeaderStyleRecord,
  scale: number,
): { scale: Vec2; rotation: number } {
  const s = style.blockScaleOn ? style.blockScale : { x: 1, y: 1 };
  return {
    scale: { x: s.x * scale, y: s.y * scale },
    rotation: style.blockRotationOn ? style.blockRotation : 0,
  };
}

/** A new MULTILEADER: the style's values, the settings MLEADER's Options changed flagged. */
export function newMultiLeader(n: NewMultiLeader): MultiLeaderGeometry {
  const { style, settings: o, scale } = n;
  const s = scaled(style, scale);
  let flags = 0;
  if (o.pathType !== style.pathType) flags |= MLEADER_OVERRIDES.pathType;
  if (o.landing !== style.landing) flags |= MLEADER_OVERRIDES.landing;
  if (o.landing !== style.dogleg) flags |= MLEADER_OVERRIDES.dogleg;
  if (o.contentType !== style.contentType) flags |= MLEADER_OVERRIDES.contentType;
  if (n.block && n.block.block !== style.block) flags |= MLEADER_OVERRIDES.blockContent;
  if (scale !== style.scale) flags |= MLEADER_OVERRIDES.scale;
  const branch: MultiLeaderBranch = {
    index: 0,
    connection: n.landing.connection,
    direction: n.landing.direction,
    doglegLength: s.dogleg,
    lines: [{ index: 0, vertices: n.vertices }],
  };
  let text: MultiLeaderText | undefined;
  if (n.text) {
    text = {
      content: n.text.content,
      style: n.text.style,
      position: n.text.position,
      rotation: 0,
      height: s.text,
      width: n.text.width,
      boundaryHeight: 0,
      lineSpacing: 1,
      lineSpacingStyle: 1,
      attachment: n.text.attachment,
      flow: 1,
      color: style.textColor,
    };
  }
  let block: MultiLeaderBlock | undefined;
  if (n.block) {
    const placed = blockScaleOf(style, scale);
    block = {
      block: n.block.block,
      position: n.block.position,
      scale: {
        x: placed.scale.x,
        y: placed.scale.y,
        z: (style.blockScaleOn ? style.blockScale.z : 1) * scale,
      },
      rotation: placed.rotation,
      color: style.blockColor,
      ...(n.block.attributes.length > 0 && { attributes: n.block.attributes }),
    };
  }
  return {
    kind: 'MULTILEADER',
    style: style.handle,
    overrideFlags: flags,
    pathType: o.pathType,
    lineColor: style.lineColor,
    ...(style.linetype !== undefined && { linetype: style.linetype }),
    lineweight: style.lineweight,
    landing: o.landing,
    dogleg: o.landing,
    doglegLength: style.doglegLength,
    ...(style.arrowhead !== undefined && { arrowhead: style.arrowhead }),
    arrowheadSize: style.arrowheadSize,
    drawnArrowheadSize: s.arrow,
    contentType: o.contentType,
    scale,
    annotative: false,
    textLeftAttachment: style.textLeftAttachment,
    textRightAttachment: style.textRightAttachment,
    textTopAttachment: style.textTopAttachment,
    textBottomAttachment: style.textBottomAttachment,
    textAttachmentDirection: style.textAttachmentDirection,
    textAngleType: style.textAngleType,
    textAlignment: style.textAlignment,
    textFrame: style.textFrame,
    contentBase: n.landing.end,
    landingGap: s.gap,
    ...(text && { text }),
    ...(block && { block }),
    branches: [branch],
  };
}

/** The content's box in drawing coordinates, where it is known. */
export type ContentBox = Box | undefined;

/**
 * The side of the content a new arrowhead at `arrow` is on, as the direction of a landing there
 * towards the content: left or right of the content's middle, or above or below it with
 * vertical attachment.
 */
function sideOf(g: MultiLeaderGeometry, arrow: Vec2, box: ContentBox): Vec2 {
  const mid = box ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : g.contentBase;
  if (g.textAttachmentDirection === 1) return { x: 0, y: arrow.y < mid.y ? 1 : -1 };
  return { x: arrow.x < mid.x ? 1 : -1, y: 0 };
}

const sameSide = (a: Vec2, b: Vec2): boolean =>
  Math.sign(a.x) === Math.sign(b.x) && Math.sign(a.y) === Math.sign(b.y);

/**
 * The landing end for a branch on the side `d` of content in `box`: a horizontal attachment
 * level of the text (by the style's attachment for that side) or the block's middle, a landing
 * gap out from the text (none from a block).
 */
function landingEndOn(g: MultiLeaderGeometry, d: Vec2, box: Box): Vec2 {
  const t = g.contentType === MLEADER_MTEXT ? g.text : undefined;
  const gap = t ? g.landingGap : 0;
  if (d.y !== 0) {
    const x = (box.minX + box.maxX) / 2;
    return { x, y: d.y > 0 ? box.minY - gap : box.maxY + gap };
  }
  const x = d.x > 0 ? box.minX - gap : box.maxX + gap;
  if (!t) return { x, y: (box.minY + box.maxY) / 2 };
  const kind = d.x > 0 ? g.textLeftAttachment : g.textRightAttachment;
  const h = t.height;
  // The level within the text the attachment names, from its top or bottom (as attachmentRow).
  const y = ((): number => {
    switch (kind) {
      case 0:
        return box.maxY;
      case 1:
        return box.maxY - h / 2;
      case 2:
        return (box.minY + box.maxY) / 2;
      case 3:
        return box.minY + h / 2;
      case 5:
      case 8:
        return box.minY - gap;
      case 6:
        return box.maxY - h - gap;
      case 7:
        return box.maxY - h;
      default:
        return box.minY;
    }
  })();
  return { x, y };
}

/** Why a leader cannot be added, or the multileader with it. */
export type AddLeaderResult =
  | { readonly ok: true; readonly geom: MultiLeaderGeometry }
  | { readonly ok: false; readonly message: string };

/**
 * The multileader with a leader line from `arrow` added: to the branch on that side of the
 * content, or, on a side without one, to a new branch whose landing reaches the content there
 * (which needs the content's box). Content-less multileaders add to the nearest branch.
 */
export function addLeaderLine(
  g: MultiLeaderGeometry,
  arrow: Vec2,
  box: ContentBox,
): AddLeaderResult {
  const nextIndex = (xs: readonly { index: number }[]) =>
    xs.reduce((m, x) => Math.max(m, x.index), -1) + 1;
  const join = (b: MultiLeaderBranch): MultiLeaderGeometry => ({
    ...g,
    branches: g.branches.map((x) =>
      x === b ? { ...b, lines: [...b.lines, { index: nextIndex(b.lines), vertices: [arrow] }] } : x,
    ),
  });
  const hasContent = g.contentType === MLEADER_MTEXT || g.contentType === MLEADER_BLOCK;
  if (!hasContent || g.branches.length === 0) {
    const nearest = [...g.branches].sort(
      (a, b) =>
        Math.hypot(a.connection.x - arrow.x, a.connection.y - arrow.y) -
        Math.hypot(b.connection.x - arrow.x, b.connection.y - arrow.y),
    )[0];
    if (!nearest) return { ok: false, message: 'The multileader has no leader to add to.' };
    return { ok: true, geom: join(nearest) };
  }
  const d = sideOf(g, arrow, box);
  const own = g.branches.find((b) => sameSide(b.direction, d));
  if (own) return { ok: true, geom: join(own) };
  if (!box) {
    return {
      ok: false,
      message:
        'The size of the content is not known here, so a leader on its other side cannot be placed.',
    };
  }
  const end = landingEndOn(g, d, box);
  const len = g.branches[0]!.doglegLength;
  const connection = d.x === 0 ? end : { x: end.x - d.x * len, y: end.y };
  const branch: MultiLeaderBranch = {
    index: nextIndex(g.branches),
    connection,
    direction: d,
    doglegLength: len,
    lines: [{ index: 0, vertices: [arrow] }],
  };
  return { ok: true, geom: { ...g, branches: [...g.branches, branch] } };
}

/** Distance from `p` to the segment a–b. */
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}

/** Which leader line (branch and line positions) passes nearest `p`; undefined with none. */
export function nearestLeaderLine(
  g: MultiLeaderGeometry,
  p: Vec2,
): { readonly branch: number; readonly line: number } | undefined {
  let best: { branch: number; line: number; d: number } | undefined;
  g.branches.forEach((b, i) =>
    b.lines.forEach((l, j) => {
      const pts = [...l.vertices, b.connection];
      let d = Math.hypot(pts[0]!.x - p.x, pts[0]!.y - p.y);
      for (let k = 1; k < pts.length; k++)
        d = Math.min(d, segmentDistance(p, pts[k - 1]!, pts[k]!));
      if (!best || d < best.d) best = { branch: i, line: j, d };
    }),
  );
  return best && { branch: best.branch, line: best.line };
}

/** How many leader lines a multileader has. */
export const leaderLineCount = (g: MultiLeaderGeometry): number =>
  g.branches.reduce((n, b) => n + b.lines.length, 0);

/**
 * The multileader without the leader line nearest `p`; a branch left without lines goes too.
 * Undefined when that would leave it with none.
 */
export function removeLeaderLine(g: MultiLeaderGeometry, p: Vec2): MultiLeaderGeometry | undefined {
  const at = nearestLeaderLine(g, p);
  if (!at || leaderLineCount(g) <= 1) return undefined;
  const branches = g.branches
    .map((b, i) => (i === at.branch ? { ...b, lines: b.lines.filter((_, j) => j !== at.line) } : b))
    .filter((b) => b.lines.length > 0);
  return { ...g, branches };
}

/**
 * A block's extents relative to its base point, from what it draws that has known bounds (text
 * has none in the engine, which has no fonts): undefined when nothing has.
 */
export function blockExtentsOf(model: DocumentModel, block: Handle): Box | undefined {
  const min = model.header.get('$EXTMIN');
  const max = model.header.get('$EXTMAX');
  const v2 = (v: unknown): Vec2 | undefined =>
    typeof v === 'object' && v !== null && 'x' in v && 'y' in v ? (v as Vec2) : undefined;
  const lo = v2(min);
  const hi = v2(max);
  const tol = toleranceFromExtents(lo ?? { x: 0, y: 0 }, hi ?? { x: 0, y: 0 });
  const seen = new Set<Handle>();
  const extents = (h: Handle): Box | 'unknown' | undefined => {
    if (seen.has(h) || !model.hasBlock(h)) return undefined;
    seen.add(h);
    let out: Box | undefined;
    for (const id of model.blockEntities(h)) {
      const e = model.entity(id)!;
      const b = entityBounds(e.geom, ctx, e.xdata);
      if (b.kind === 'box') out = out ? unionBox(out, b.box) : b.box;
    }
    seen.delete(h);
    return out;
  };
  const ctx: BoundsContext = {
    tol,
    blockExtents: extents,
    basePoint: (h) => model.blocks.get(h)?.basePoint,
    tables: model,
  };
  const box = extents(block);
  if (!box || box === 'unknown') return undefined;
  const base = model.blocks.get(block)?.basePoint ?? { x: 0, y: 0 };
  return {
    minX: box.minX - base.x,
    minY: box.minY - base.y,
    maxX: box.maxX - base.x,
    maxY: box.maxY - base.y,
  };
}

/** Block content's box in drawing coordinates, from its block's extents. */
export function blockContentBox(model: DocumentModel, b: MultiLeaderBlock): Box | undefined {
  if (b.block === undefined) return undefined;
  const ext = blockExtentsOf(model, b.block);
  if (!ext) return undefined;
  const p = placedBox(ext, b.scale, b.rotation);
  return {
    minX: p.minX + b.position.x,
    minY: p.minY + b.position.y,
    maxX: p.maxX + b.position.x,
    maxY: p.maxY + b.position.y,
  };
}
