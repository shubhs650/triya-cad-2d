// A multileader's Multileader style row in the Properties palette (M2-35 part 28; ActiveX
// AcadMLeader's StyleName, the Misc row part 25 showed read only).
//
// Choosing another style gives the multileader that style's values wherever it does not override
// them: a property flagged in DXF 90 (`MLEADER_OVERRIDES`, `MLEADER_TEXT_OVERRIDES`, the ODA
// specification's bits) keeps the multileader's own value and its flag, and every other one takes
// the new style's, as a style's overrides work for every AutoCAD object (its help gives no list
// for a multileader; this one follows the override bits, noted in the PR). The context
// data states sizes drawn, so the style's sizes are drawn at the multileader's overall scale (the
// style's own scale when that is not overridden, grown about the content's anchor as the Overall
// scale row does; an annotative style gives its scale to a plain multileader, as MLEADER does
// under DEC-058).
//
// The content stays where it is, as the other Text and Block rows keep it (AutoCAD's help does
// not say): the text's side facing the landing is kept (`placedText`, measured by the canvas
// where the text's width matters), the block's facing side or base point as its Attachment says
// (`keptOnLanding`, `reconnected`); each landing keeps its place against the content, so a new
// landing gap or landing distance moves where the leader lines meet it, as the Landing distance
// row does.
//
// What a re-applied value cannot change without re-laying out the content is kept and flagged as
// the multileader's own, as MLEADER flags a setting that differs from the style: its content type
// (text stays text), its text attachment direction (horizontal or vertical landings), a left or
// right attachment that anchors the text by another row of its lines (the text's height in lines
// is not known without the canvas), and a source block the drawing lacks or the style does not
// name. An annotative multileader keeps a placement per annotation scale (DEC-013, DEC-058), so it refuses.
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type {
  Entity,
  MLeaderStyleRecord,
  MTextGeometry,
  MultiLeaderBlock,
  MultiLeaderBranch,
  MultiLeaderGeometry,
  MultiLeaderText,
} from '../model/types';
import { MLEADER_OVERRIDES, attachmentRow } from '../edit/mleader';
import {
  MLEADER_TEXT_OVERRIDES,
  placedText,
  textOf,
  textsToMeasureFor,
  type MultiLeaderWidths,
} from './multileader';
import {
  attributeDefaults,
  blockConnectionOf,
  blockOf,
  isContentBlock,
  keptOnLanding,
  reconnected,
} from './multileader-block';
import { rescaled } from './multileader-misc';
import type { PropertyValue } from './sheet';

/** The Misc row's key. */
export const STYLE_KEY = 'mleaderStyle';

const ANNOTATIVE = 'annotative (each scale keeps its own placement)';
const UNMEASURED = 'its text cannot be measured';

/** What another style gives a multileader, before its text is placed. */
interface Restyled {
  /** The multileader with the style's values, its text where it was. */
  readonly geom: MultiLeaderGeometry;
  /** The multileader at the style's overall scale, before anything else changed. */
  readonly scaled: MultiLeaderGeometry;
  /** Its text then, and the text the style gives it, to place (`placedText`). */
  readonly text?: { readonly before: MultiLeaderText; readonly next: MultiLeaderText };
}

type Refusal = 'invalid' | { readonly refuse: string } | { readonly skip: true };

/** `o` without `key` where `value` is undefined, else with it. */
function withOptional<T extends object, K extends keyof T>(o: T, key: K, value: T[K]): T {
  if (value !== undefined) return { ...o, [key]: value };
  const { [key]: _old, ...rest } = o;
  return rest as T;
}

/** The unit vector along `d`, or undefined for none. */
function unit(d: Vec2): Vec2 | undefined {
  const len = Math.hypot(d.x, d.y);
  return len === 0 ? undefined : { x: d.x / len, y: d.y / len };
}

/**
 * Branch `b` with a landing `length` long that ends `by` further from the content along its
 * direction (which runs towards the content): where the leader lines meet it moves.
 */
function relanded(b: MultiLeaderBranch, length: number, by: number): MultiLeaderBranch {
  const d = unit(b.direction);
  if (!d) return { ...b, doglegLength: length };
  const k = b.doglegLength - length - by;
  return {
    ...b,
    doglegLength: length,
    connection: { x: b.connection.x + d.x * k, y: b.connection.y + d.y * k },
  };
}

/** The multileader `e` given style `v`, before its text is placed; undefined for another row. */
function restyle(
  model: DocumentModel,
  e: Entity,
  key: string,
  v: PropertyValue,
): Restyled | Refusal | undefined {
  if (key !== STYLE_KEY || e.geom.kind !== 'MULTILEADER') return undefined;
  const g = e.geom;
  const style = typeof v === 'string' ? model.tables.mleaderStyles.get(v) : undefined;
  if (!style) return 'invalid';
  if (style.handle === g.style) return { skip: true };
  if (e.annotative || g.annotative) return { refuse: ANNOTATIVE };
  const own = (bit: number) => (g.overrideFlags & bit) !== 0;
  const O = MLEADER_OVERRIDES;
  // Bits for values kept because they cannot be re-applied in place.
  let kept = 0;

  const scale = style.scale > 0 ? style.scale : 1;
  const scaled = !own(O.scale) && scale !== g.scale ? rescaled(g, scale) : g;
  const k = scaled.scale > 0 ? scaled.scale : 1;
  let n: MultiLeaderGeometry = { ...scaled, overrideFlags: g.overrideFlags };

  // The leaders.
  if (!own(O.pathType)) n = { ...n, pathType: style.pathType };
  if (!own(O.lineColor)) n = { ...n, lineColor: style.lineColor };
  if (!own(O.linetype)) n = withOptional(n, 'linetype', style.linetype);
  if (!own(O.lineweight)) n = { ...n, lineweight: style.lineweight };
  if (!own(O.landing)) n = { ...n, landing: style.landing };
  if (!own(O.dogleg)) n = { ...n, dogleg: style.dogleg };
  if (!own(O.arrowhead)) n = withOptional(n, 'arrowhead', style.arrowhead);
  if (!own(O.arrowheadSize)) {
    n = {
      ...n,
      arrowheadSize: style.arrowheadSize,
      drawnArrowheadSize: style.arrowheadSize * k,
    };
  }
  // The landing gap is the text's distance from the landing's end (none from a block).
  const t = textOf(n);
  const gap = own(O.landingGap) ? n.landingGap : style.landingGap * k;
  const moved = t ? gap - n.landingGap : 0;
  if (!own(O.doglegLength) || moved !== 0) {
    const length = (b: MultiLeaderBranch) =>
      own(O.doglegLength) ? b.doglegLength : style.doglegLength * k;
    n = {
      ...n,
      ...(!own(O.doglegLength) && { doglegLength: style.doglegLength }),
      branches: n.branches.map((b) => relanded(b, length(b), moved)),
    };
  }
  n = { ...n, landingGap: gap };

  if (style.contentType !== n.contentType && !own(O.contentType)) kept |= O.contentType;

  let text: Restyled['text'];
  if (t) {
    const restyled = retext(model, n, t, style, k);
    n = restyled.geom;
    kept |= restyled.kept;
    text = { before: t, next: restyled.text };
  }
  const b = blockOf(n);
  if (b) {
    const reblocked = reblock(model, n, b, style, k);
    n = reblocked.geom;
    kept |= reblocked.kept;
  }
  return {
    geom: { ...n, style: style.handle, overrideFlags: g.overrideFlags | kept },
    scaled,
    ...(text && { text }),
  };
}

/** The text's own values and the multileader's text settings as `style` gives them. */
function retext(
  model: DocumentModel,
  g: MultiLeaderGeometry,
  t: MultiLeaderText,
  style: MLeaderStyleRecord,
  k: number,
): { geom: MultiLeaderGeometry; text: MultiLeaderText; kept: number } {
  const T = MLEADER_TEXT_OVERRIDES;
  const own = (bit: number) => (g.overrideFlags & bit) !== 0;
  let kept = 0;
  let n = g;
  let next = t;
  if (!own(T.textStyle) && style.textStyle !== undefined) {
    if (model.tables.textStyles.has(style.textStyle)) next = { ...next, style: style.textStyle };
  }
  if (!own(T.textColor)) next = { ...next, color: style.textColor };
  if (!own(T.textHeight) && style.textHeight > 0) next = { ...next, height: style.textHeight * k };
  if (!own(T.textAlignment)) {
    const col = Math.min(2, Math.max(0, Math.round(style.textAlignment)));
    const row = Math.floor((Math.max(1, next.attachment) - 1) / 3);
    next = { ...next, attachment: row * 3 + col + 1 };
    n = { ...n, textAlignment: col };
  }
  if (!own(T.textFrame)) n = { ...n, textFrame: style.textFrame };
  if (!own(T.textAngle)) n = { ...n, textAngleType: style.textAngleType };
  if (!own(T.textTopAttachment)) n = { ...n, textTopAttachment: style.textTopAttachment };
  if (!own(T.textBottomAttachment)) {
    n = { ...n, textBottomAttachment: style.textBottomAttachment };
  }
  if (style.textAttachmentDirection !== g.textAttachmentDirection) {
    if (!own(T.textAttachmentDirection)) kept |= T.textAttachmentDirection;
  }
  // A side's attachment that anchors the text by the same row of its lines moves it up or down
  // (`placedText`); one by another row would need the text's height in lines.
  const side = (
    bit: number,
    was: number,
    now: number,
  ): { value: number; kept: number } | undefined => {
    if (own(bit) || was === now) return undefined;
    const same = attachmentRow(was, 1, 0).row === attachmentRow(now, 1, 0).row;
    return same ? { value: now, kept: 0 } : { value: was, kept: bit };
  };
  const left = side(T.textLeftAttachment, g.textLeftAttachment, style.textLeftAttachment);
  if (left) {
    n = { ...n, textLeftAttachment: left.value };
    kept |= left.kept;
  }
  const right = side(T.textRightAttachment, g.textRightAttachment, style.textRightAttachment);
  if (right) {
    n = { ...n, textRightAttachment: right.value };
    kept |= right.kept;
  }
  return { geom: n, text: next, kept };
}

/** The block content as `style` gives it, kept on its landing. */
function reblock(
  model: DocumentModel,
  g: MultiLeaderGeometry,
  b: MultiLeaderBlock,
  style: MLeaderStyleRecord,
  k: number,
): { geom: MultiLeaderGeometry; kept: number } {
  const O = MLEADER_OVERRIDES;
  const own = (bit: number) => (g.overrideFlags & bit) !== 0;
  let kept = 0;
  let next = b;
  if (!own(O.blockContent) && style.block !== b.block) {
    const def = style.block === undefined ? undefined : model.blocks.get(style.block);
    if (def && isContentBlock(def)) {
      const { attributes: _old, ...rest } = next;
      const attributes = attributeDefaults(model, def.handle);
      next = { ...rest, block: def.handle, ...(attributes.length > 0 && { attributes }) };
    } else {
      kept |= O.blockContent;
    }
  }
  if (!own(O.blockColor)) next = { ...next, color: style.blockColor };
  if (!own(O.blockScale)) {
    const s = style.blockScaleOn ? style.blockScale : { x: 1, y: 1, z: 1 };
    // A mirrored block stays mirrored.
    const signed = (was: number, to: number) => (was < 0 ? -1 : 1) * Math.abs(to) * k;
    next = {
      ...next,
      scale: {
        x: signed(b.scale.x, s.x),
        y: signed(b.scale.y, s.y),
        z: signed(b.scale.z, s.z),
      },
    };
  }
  if (!own(O.blockRotation)) {
    next = { ...next, rotation: style.blockRotationOn ? style.blockRotation : 0 };
  }
  next = { ...next, position: keptOnLanding(model, g, b, next) };
  let n: MultiLeaderGeometry = { ...g, block: next };
  if (!own(O.blockConnection)) {
    const was = blockConnectionOf(model, g);
    const now = style.blockConnection === 1 ? 1 : 0;
    const position = was === now ? next.position : reconnected(model, n, next, now === 1);
    n = { ...n, blockConnection: now, block: { ...next, position } };
  }
  return { geom: n, kept };
}

/**
 * The multileader with another Multileader style (see the file comment); undefined for another
 * row, `invalid` for a style the drawing lacks, a refusal for an annotative multileader or a
 * text the canvas could not measure, `skip` for the style it has.
 */
export function multiLeaderStyleChange(
  model: DocumentModel,
  e: Entity,
  key: string,
  v: PropertyValue,
  widths: MultiLeaderWidths | undefined,
): MultiLeaderGeometry | Refusal | undefined {
  const r = restyle(model, e, key, v);
  if (r === undefined || r === 'invalid' || 'refuse' in r || 'skip' in r) return r;
  if (!r.text) return r.geom;
  const position = placedText(r.scaled, r.geom, r.text.before, r.text.next, widths?.get(e.id));
  if (!position) return { refuse: UNMEASURED };
  return { ...r.geom, text: { ...r.text.next, position } };
}

/** The multileader texts the canvas must measure before style `v` places them again. */
export function multiLeaderStylesToMeasure(
  model: DocumentModel,
  entities: readonly Entity[],
  v: PropertyValue,
): { readonly id: EntityId; readonly before?: MTextGeometry; readonly after?: MTextGeometry }[] {
  const out: { id: EntityId; before?: MTextGeometry; after?: MTextGeometry }[] = [];
  for (const e of entities) {
    const r = restyle(model, e, STYLE_KEY, v);
    if (r === undefined || r === 'invalid' || 'refuse' in r || 'skip' in r || !r.text) continue;
    const texts = textsToMeasureFor(r.scaled, r.text.before, r.text.next);
    if (texts) out.push({ id: e.id, ...texts });
  }
  return out;
}
