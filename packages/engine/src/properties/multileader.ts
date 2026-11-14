// A multileader's Text rows in the Properties palette (M2-35 part 11; AutoCAD 2024's "Properties
// Palette — Multileader": Contents with its `...` button, Text style, Justify, Text height).
//
// The text stays on its landing. AutoCAD's help does not say how a palette edit moves the text,
// and a drafter expects the text still to start a landing gap from the landing's end, so the
// side of the text's box that faces the landing is kept: its left edge for text right of the
// landing, its right edge for text left of it, its middle for text above or below the leader
// (vertical attachment) or between landings on both sides. A Justify, or a style or height that
// changes the box's width, therefore moves the insertion point by widths the canvas measures
// (`textWidths`, the widest line's advance; a defined width when the text wraps); and a height
// moves it up or down as the attachment level within the text moves (`attachmentRow`).
//
// Justify offers Left, Center and Right: the MTEXT editor of a multileader aligns its lines and
// the attachment (MLEADERSTYLE's Left/Right attachment, 173/95) sets the text's level, so the
// palette's choice is the column of the context data's attachment point (171) and the entity's
// text alignment (175). ActiveX's AcadMLeader.TextJustify is an AcAttachmentPoint, whose row
// a multileader's attachment overrides; the ambiguity is noted in the PR.
//
// M2-35 part 14 adds the rest of AutoCAD's MTEXT-like Text rows a multileader's text has (its
// help does not list them; they follow ActiveX AcadMLeader's TextRotation, TextLineSpacingFactor,
// TextLineSpacingDistance, TextLineSpacingStyle, TextBackgroundFill and TextFrameDisplay, and
// MTEXT's palette for the labels): Text rotation turns the text about its insertion point, as an
// MTEXT's Rotation row does; Line space distance is the factor times 5/3 of the text height
// (AutoCAD's single spacing), each multileader taking the factor its height gives; Background
// mask turned on uses the drawing window colour and a border of 1.5, the Background Mask
// dialog's defaults, and keeps a mask already on as it is. These are kept per annotation scale in
// the context data, so an annotative multileader refuses them; Text frame is the entity's (DXF
// 292) and flags ENABLE_FRAME_TEXT (bit 17). Direction (DXF 172) is not shown: the text layout
// does not draw a top-to-bottom flow yet.
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Entity, MTextGeometry, MultiLeaderGeometry, MultiLeaderText } from '../model/types';
import { MLEADER_MTEXT, attachmentRow, multiLeaderMText } from '../edit/mleader';
import { parseAngleValue, parseNumber } from '../commands/parse';
import type { PropertyOption, PropertyRow, PropertyValue } from './sheet';

/**
 * DXF 90 bits for the text's style, alignment and frame (ezdxf's `MLeader` override flags,
 * TEXT_STYLE_ID, TEXT_ALIGNMENT_TYPE and ENABLE_FRAME_TEXT).
 */
export const MLEADER_TEXT_OVERRIDES = {
  textStyle: 1 << 11,
  textAlignment: 1 << 14,
  textFrame: 1 << 17,
} as const;

const JUSTIFY = ['Left', 'Center', 'Right'] as const;

const JUSTIFY_OPTIONS: readonly PropertyOption[] = JUSTIFY.map((j) => ({ value: j, label: j }));

/** DXF 170 in the context data, as MTEXT's 73: 1 at least, 2 exactly. */
const LINE_SPACE_STYLE_OPTIONS: readonly PropertyOption[] = [
  { value: '1', label: 'At least' },
  { value: '2', label: 'Exactly' },
];

const YES_NO_OPTIONS: readonly PropertyOption[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

/** AutoCAD's single line spacing, as a multiple of the text height. */
const SINGLE_SPACING = 5 / 3;

/** MTEXT's line spacing factor range, 0.25 to 4.00. */
const MIN_SPACING = 0.25;
const MAX_SPACING = 4;

/** The Background Mask dialog's border offset factor, which turning the mask on uses. */
const MASK_SCALE = 1.5;

/** The multileader's text, when its content is text (MLEADER's "Mtext" content type). */
export function textOf(g: MultiLeaderGeometry): MultiLeaderText | undefined {
  return g.contentType === MLEADER_MTEXT ? g.text : undefined;
}

const columnOf = (attachment: number): number => (Math.max(1, attachment) - 1) % 3;

/** Every value the objects share, or `*VARIES*`. */
function sharedRow(
  values: readonly PropertyValue[],
  base: Omit<PropertyRow, 'value' | 'varies'>,
): PropertyRow {
  const first = values[0];
  const one = values.every((v) =>
    typeof v === 'number' && typeof first === 'number'
      ? Math.abs(v - first) <= 1e-9 * Math.max(1, Math.abs(v))
      : v === first,
  );
  return one && first !== undefined ? { ...base, value: first } : { ...base, varies: true };
}

/**
 * The Text rows of multileaders that all hold text (none when one holds a block or nothing):
 * Contents (read only; one multileader's has the `...` button), Text style, Justify, Text height.
 */
export function multiLeaderTextRows(
  es: readonly Entity[],
  textStyles: readonly PropertyOption[],
): PropertyRow[] {
  const texts = es.map((e) => textOf(e.geom as MultiLeaderGeometry));
  if (texts.length === 0 || texts.some((t) => t === undefined)) return [];
  const ts = texts as MultiLeaderText[];
  const contents = sharedRow(
    ts.map((t) => t.content),
    { key: 'contents', label: 'Contents', kind: 'text', readOnly: true },
  );
  return [
    es.length === 1 ? { ...contents, editor: true } : contents,
    sharedRow(
      ts.map((t) => t.style),
      { key: 'style', label: 'Text style', kind: 'choice', options: textStyles },
    ),
    sharedRow(
      ts.map((t) => JUSTIFY[columnOf(t.attachment)]!),
      { key: 'justify', label: 'Justify', kind: 'choice', options: JUSTIFY_OPTIONS },
    ),
    sharedRow(
      ts.map((t) => t.height),
      { key: 'height', label: 'Text height', kind: 'distance' },
    ),
    // M2-35 part 14.
    sharedRow(
      ts.map((t) => t.rotation),
      { key: 'textRotation', label: 'Text rotation', kind: 'angle' },
    ),
    sharedRow(
      ts.map((t) => t.lineSpacing),
      { key: 'lineSpacing', label: 'Line space factor', kind: 'number' },
    ),
    sharedRow(
      ts.map((t) => t.lineSpacing * SINGLE_SPACING * t.height),
      { key: 'lineSpaceDistance', label: 'Line space distance', kind: 'distance' },
    ),
    sharedRow(
      ts.map((t) => String(t.lineSpacingStyle === 2 ? 2 : 1)),
      {
        key: 'lineSpacingStyle',
        label: 'Line space style',
        kind: 'choice',
        options: LINE_SPACE_STYLE_OPTIONS,
      },
    ),
    sharedRow(
      ts.map((t) => (t.mask ? 'yes' : 'no')),
      { key: 'backgroundMask', label: 'Background mask', kind: 'choice', options: YES_NO_OPTIONS },
    ),
    sharedRow(
      es.map((e) => ((e.geom as MultiLeaderGeometry).textFrame ? 'yes' : 'no')),
      { key: 'textFrame', label: 'Text frame', kind: 'choice', options: YES_NO_OPTIONS },
    ),
  ];
}

/** The keys of the part 14 rows, which leave the text where it is. */
const TEXT_KEYS = new Set([
  'textRotation',
  'lineSpacing',
  'lineSpaceDistance',
  'lineSpacingStyle',
  'backgroundMask',
  'textFrame',
]);

/** A number typed or given; undefined where it does not read. */
function numberOf(v: PropertyValue, angle = false): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  return angle ? parseAngleValue(v) : parseNumber(v.trim());
}

/**
 * The multileader with part 14's row `key` set to `v` on its text (see the file comment);
 * undefined for another row or a multileader without text, `invalid` for a value the row cannot
 * take, a refusal for what an annotative multileader keeps per scale.
 */
export function multiLeaderTextRowChange(
  e: Entity,
  key: string,
  v: PropertyValue,
): MultiLeaderGeometry | 'invalid' | { readonly refuse: string } | undefined {
  const g = e.geom as MultiLeaderGeometry;
  const t = textOf(g);
  if (!t || !TEXT_KEYS.has(key)) return undefined;
  if (key === 'textFrame') {
    if (v !== 'yes' && v !== 'no') return 'invalid';
    return {
      ...g,
      textFrame: v === 'yes',
      overrideFlags: g.overrideFlags | MLEADER_TEXT_OVERRIDES.textFrame,
    };
  }
  let next: MultiLeaderText;
  if (key === 'backgroundMask') {
    if (v !== 'yes' && v !== 'no') return 'invalid';
    const { mask, ...rest } = t;
    next = v === 'no' ? rest : { ...rest, mask: mask ?? { scale: MASK_SCALE } };
  } else if (key === 'lineSpacingStyle') {
    if (v !== '1' && v !== '2' && v !== 1 && v !== 2) return 'invalid';
    next = { ...t, lineSpacingStyle: Number(v) };
  } else if (key === 'textRotation') {
    const n = numberOf(v, true);
    if (n === undefined) return 'invalid';
    next = { ...t, rotation: n };
  } else {
    const n = numberOf(v);
    if (n === undefined) return 'invalid';
    const factor = key === 'lineSpacing' ? n : n / (SINGLE_SPACING * t.height);
    // A rounding error at the range's ends is the drafter's typed end, not out of it.
    const eps = 1e-9;
    if (!(factor >= MIN_SPACING - eps && factor <= MAX_SPACING + eps)) return 'invalid';
    next = { ...t, lineSpacing: Math.min(MAX_SPACING, Math.max(MIN_SPACING, factor)) };
  }
  if (e.annotative || g.annotative) return { refuse: ANNOTATIVE };
  return { ...g, text: next };
}

/** The widths of a multileader's text before and after an edit (undefined: not measured). */
export type MultiLeaderWidths = ReadonlyMap<
  EntityId,
  { readonly before?: number; readonly after?: number }
>;

/** Why an edit is refused, or the text it gives (undefined: not one of these rows). */
type Retexted = MultiLeaderText | 'invalid' | { readonly refuse: string } | undefined;

/** The text as `key` set to `v` gives it, before it is placed again. */
function retexted(model: DocumentModel, e: Entity, key: string, v: PropertyValue): Retexted {
  const g = e.geom as MultiLeaderGeometry;
  const t = textOf(g);
  if (!t || (key !== 'style' && key !== 'justify' && key !== 'height')) return undefined;
  let next: MultiLeaderText;
  if (key === 'style') {
    const style = typeof v === 'string' ? model.tables.textStyles.get(v) : undefined;
    if (!style) return 'invalid';
    // A fixed-height text style does not change the height: a multileader's text is its
    // MLEADERSTYLE's height times its overall scale, which the context data states.
    next = { ...t, style: style.handle };
  } else if (key === 'justify') {
    const col = JUSTIFY.indexOf(v as (typeof JUSTIFY)[number]);
    if (col < 0) return 'invalid';
    const row = Math.floor((Math.max(1, t.attachment) - 1) / 3);
    next = { ...t, attachment: row * 3 + col + 1 };
  } else {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n <= 0) return 'invalid';
    next = { ...t, height: n };
  }
  // An annotative multileader keeps a placement per annotation scale (M2-43); Triya edits one.
  if (e.annotative || g.annotative) return { refuse: ANNOTATIVE };
  return next;
}

const ANNOTATIVE = 'annotative (each scale keeps its own placement)';
const UNMEASURED = 'its text cannot be measured';

/**
 * The column of the text's box that faces its landing (0 left edge, 1 middle, 2 right edge),
 * which the edit keeps in place.
 */
function facingColumn(g: MultiLeaderGeometry): number {
  if (g.textAttachmentDirection === 1) return 1;
  const level = g.branches.filter((b) => b.direction.x !== 0);
  if (level.length === 0) return 1;
  if (level.every((b) => b.direction.x > 0)) return 0;
  if (level.every((b) => b.direction.x < 0)) return 2;
  return 1;
}

/** How far `t`'s attachment point lies from the facing side of its box, in box widths. */
const offsetOf = (t: MultiLeaderText, facing: number): number =>
  (facing - columnOf(t.attachment)) / 2;

/** Whether placing `next` needs the width of its text or of `before`'s (no defined width). */
function needsWidths(g: MultiLeaderGeometry, before: MultiLeaderText, next: MultiLeaderText) {
  const facing = facingColumn(g);
  return {
    before: before.width <= 0 && offsetOf(before, facing) !== 0,
    after: next.width <= 0 && offsetOf(next, facing) !== 0,
  };
}

/** The level of the text's attachment above the landing, for a text height (`attachmentRow`). */
function levelOf(g: MultiLeaderGeometry, t: MultiLeaderText): number {
  if (g.textAttachmentDirection === 1) return 0;
  const kind = facingColumn(g) === 2 ? g.textRightAttachment : g.textLeftAttachment;
  return attachmentRow(kind, t.height, g.landingGap).dy;
}

/**
 * The texts the canvas must measure before `edit` (a Justify, Text style or Text height row) can
 * place the multileaders' text again: each multileader's text before and after, where its
 * insertion point is not on the side of its box facing the landing and it has no defined width.
 */
export function multiLeadersToMeasure(
  model: DocumentModel,
  entities: readonly Entity[],
  key: string,
  v: PropertyValue,
): { readonly id: EntityId; readonly before?: MTextGeometry; readonly after?: MTextGeometry }[] {
  const out: { id: EntityId; before?: MTextGeometry; after?: MTextGeometry }[] = [];
  for (const e of entities) {
    if (e.geom.kind !== 'MULTILEADER') continue;
    const next = retexted(model, e, key, v);
    const t = textOf(e.geom);
    if (!t || next === undefined || next === 'invalid' || 'refuse' in next) continue;
    const need = needsWidths(e.geom, t, next);
    if (!need.before && !need.after) continue;
    // Measured unturned, so the width is along the text's own direction.
    const flat = (x: MultiLeaderText) => ({ ...multiLeaderMText(x), rotation: 0 });
    out.push({
      id: e.id,
      ...(need.before && { before: flat(t) }),
      ...(need.after && { after: flat(next) }),
    });
  }
  return out;
}

/**
 * The multileader with `key` set to `v` on its text, placed again so the text stays on its
 * landing (see the file comment); undefined for another row, `invalid` for a value that does
 * not read, a refusal for an annotative multileader or a width the canvas could not measure.
 */
export function multiLeaderTextChange(
  model: DocumentModel,
  e: Entity,
  key: string,
  v: PropertyValue,
  widths: MultiLeaderWidths | undefined,
): MultiLeaderGeometry | 'invalid' | { readonly refuse: string } | undefined {
  const g = e.geom as MultiLeaderGeometry;
  const next = retexted(model, e, key, v);
  if (next === undefined || next === 'invalid' || 'refuse' in next) return next;
  // `retexted` gives a text only to a multileader that has one.
  const t = textOf(g)!;
  const facing = facingColumn(g);
  const measured = widths?.get(e.id);
  // A text's width matters only where its insertion point is off the side facing the landing.
  const widthOf = (x: MultiLeaderText, w: number | undefined) =>
    offsetOf(x, facing) === 0 ? 0 : x.width > 0 ? x.width : w;
  const before = widthOf(t, measured?.before);
  const after = widthOf(next, measured?.after);
  if (before === undefined || after === undefined) return { refuse: UNMEASURED };
  const along = offsetOf(t, facing) * before - offsetOf(next, facing) * after;
  const up = levelOf(g, next) - levelOf(g, t);
  const dir: Vec2 = { x: Math.cos(t.rotation), y: Math.sin(t.rotation) };
  // Upside-down text (normal −Z) has its Y axis reversed.
  const flip = t.upsideDown ? -1 : 1;
  const normal: Vec2 = { x: -dir.y * flip, y: dir.x * flip };
  const position = {
    x: t.position.x + dir.x * along + normal.x * up,
    y: t.position.y + dir.y * along + normal.y * up,
  };
  let flags = g.overrideFlags;
  if (key === 'style') flags |= MLEADER_TEXT_OVERRIDES.textStyle;
  if (key === 'justify') flags |= MLEADER_TEXT_OVERRIDES.textAlignment;
  return {
    ...g,
    overrideFlags: flags,
    ...(key === 'justify' && { textAlignment: columnOf(next.attachment) }),
    text: { ...next, position },
  };
}
