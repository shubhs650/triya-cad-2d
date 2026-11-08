// MULTILEADER as the parts AutoCAD draws for it (M1-52, ARCHITECTURE.md §9 "Leaders"): leader lines
// with their landing, arrowheads, and the MTEXT content. The renderer draws each part as the
// entity it is (LWPOLYLINE, SOLID, INSERT, MTEXT, SPLINE) and the spatial index bounds the
// MULTILEADER by the union of the parts' bounds, so culling and picking match what is drawn.
//
// AutoCAD documents the MLEADER structure (DXF reference, MLEADER) but not how it draws it;
// these rules follow what AutoCAD and BricsCAD files show, as ezdxf reads them (MIT; its
// `render/mleader.py` notes the same findings):
// - The values stored on the entity are the ones drawn, whether or not DXF 90 flags them as
//   overriding the style; only a missing arrowhead falls back to the style's.
// - Each leader line runs from its arrowhead through its vertices to the branch's connection
//   point. With horizontal text attachment (DXF 271 = 0) and the dogleg on, a landing of the
//   branch's dogleg length runs on along the branch direction; with the dogleg off the lines
//   go straight to where the landing would end. Vertical attachment has no landing.
// - The arrowhead's tip is the line's first vertex; it points away from the second. The
//   closed filled arrow (no arrowhead block) is a triangle one arrowhead size long and a third
//   of it wide. A block arrowhead is that block inserted at the tip, scaled by the arrowhead
//   size, its +X axis pointing away from the line.
// - The line starts at the arrowhead's back, one size from the tip, except for the arrowheads
//   drawn about the tip (tick, oblique, small dots, integral, none), where it runs to the tip.
//   AutoCAD documents this for dimension lines only; leaders are drawn the same way.
// - The text frame (DXF 292) is a rectangle a landing gap outside the text. Where AutoCAD puts
//   it is undocumented; to be checked against reference plots (M1-24/M1-26).
// Spline leaders (DXF 170 = 2) are fit-point splines through the vertices, drawn and bounded
// as the kernel's interpolation of them (M1-47) with natural ends: AutoCAD stores no end
// tangents for a leader, and does not document how it shapes the ends.
// Block content (DXF 172 = 1) is an INSERT of its block (M1-52 part 2).
//
// M1-111, also as ezdxf's renderer draws them (its findings above):
// - Block content draws its attribute values from the MULTILEADER's own records (DXF 330/177/
//   44/302): each value as its ATTDEF in the block (style, height, justification, width factor,
//   layer, colour), placed by the content's location, scale and rotation, with the value as its
//   text. The width (44) is kept but not drawn: the DXF reference calls it "attribute width"
//   without saying what it scales, and ezdxf draws the ATTDEF's own width factor too.
// - A leader line draws in its own path type, colour, linetype, lineweight, arrowhead and
//   arrowhead size where its DXF 93 flags them (R2010+ LEADER_LINE), else in the MULTILEADER's.
//   Its arrowhead size (40) takes the overall scale the way the MULTILEADER's does (the ratio of
//   its drawn size, context 140, to DXF 42): AutoCAD does not say whether 40 is scaled.
// - Horizontal attachment 5, 6 and 8 (DXF 173 left, 95 right: bottom of the bottom or top line,
//   underlined) draw an underline from the landing's end, through the landing gap and across the
//   text's width (its widest line), on the side the leader comes from. Vertical attachment 10
//   (DXF 273 top "overline and center", 272 bottom "underline and center") draws a line the
//   text's width centred on the leader's end. Both need the text's width, so they draw only with
//   a `TextMeasure` that can measure it (as TOLERANCE frames); the text itself is unknown to the
//   spatial index until then anyway. AutoCAD documents neither; these follow ezdxf.

import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type {
  AttdefGeometry,
  Color,
  EntityGeometry,
  InsertAttribute,
  LinetypeRef,
  Lineweight,
  MTextGeometry,
  MultiLeaderBlock,
  MultiLeaderGeometry,
  MultiLeaderLine,
} from '../model/types';
import type { TextMeasure } from './tolerance';

/** One thing an annotation draws, with the properties it draws in where they differ. */
export interface AnnotationPart {
  readonly geom: EntityGeometry;
  /** ByBlock (and absent) take the annotation's own property. */
  readonly color?: Color;
  readonly linetype?: LinetypeRef;
  readonly lineweight?: Lineweight;
}

/** What drawing an annotation's parts reads from the drawing. */
export type AnnotationTables = Pick<DocumentModel, 'tables' | 'blocks' | 'entityByHandle'>;

/** Arrowhead blocks AutoCAD draws about the tip, so the line runs all the way to it. */
const DRAWN_AT_TIP = new Set([
  '_archtick',
  '_oblique',
  '_dotsmall',
  '_small',
  '_integral',
  '_none',
]);

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2, k = 1): Vec2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });
function unit(v: Vec2): Vec2 | undefined {
  const len = Math.hypot(v.x, v.y);
  return len > 0 ? { x: v.x / len, y: v.y / len } : undefined;
}

/** A linetype handle as an entity reference: the ByBlock and ByLayer records by their name. */
export function linetypeRef(
  model: AnnotationTables,
  h: Handle | undefined,
): LinetypeRef | undefined {
  if (h === undefined) return undefined;
  const name = model.tables.linetypes.get(h)?.name.toLowerCase();
  if (name === 'byblock') return 'ByBlock';
  if (name === 'bylayer') return 'ByLayer';
  return h;
}

/** Properties a leader's parts draw in. */
type LineProps = Pick<AnnotationPart, 'color' | 'linetype' | 'lineweight'>;

/**
 * The arrowhead at `tip` of a line whose next point is `next`: closed filled when `block` names
 * no block of the drawing, else that block. `start` is where the line then begins: one size
 * back for a closed filled arrow and for block arrowheads not drawn about the tip (`trim`).
 */
export function arrowheadParts(
  tip: Vec2,
  next: Vec2,
  size: number,
  block: Handle | undefined,
  model: AnnotationTables,
  props: LineProps,
  trim = true,
): { readonly parts: AnnotationPart[]; readonly start: Vec2 } {
  const back = unit(sub(next, tip));
  if (!back || !(size > 0)) return { parts: [], start: tip };
  const def = block === undefined ? undefined : model.blocks.get(block);
  if (block !== undefined && def) {
    const geom: EntityGeometry = {
      kind: 'INSERT',
      block,
      position: tip,
      scale: { x: size, y: size, z: size },
      rotation: Math.atan2(-back.y, -back.x),
      attributes: [],
    };
    const atTip = !trim || DRAWN_AT_TIP.has(def.name.toLowerCase());
    return { parts: [{ ...props, geom }], start: atTip ? tip : add(tip, back, size) };
  }
  // Closed filled: base one size back, a sixth of the size either side.
  const base = add(tip, back, size);
  const n = { x: -back.y * (size / 6), y: back.x * (size / 6) };
  const left = add(base, n);
  const right = add(base, n, -1);
  return {
    parts: [{ ...props, geom: { kind: 'SOLID', corners: [tip, left, right, right] } }],
    start: trim ? base : tip,
  };
}

/** The MULTILEADER's MTEXT content as an MTEXT, its frame as the MTEXT's background frame. */
function textPart(g: MultiLeaderGeometry): AnnotationPart | undefined {
  const t = g.text;
  if (!t || g.contentType !== 2) return undefined;
  const geom: MTextGeometry = {
    kind: 'MTEXT',
    contents: t.content,
    style: t.style,
    position: t.position,
    height: t.height,
    width: t.width,
    rotation: t.rotation,
    ...(t.upsideDown ? { upsideDown: true } : {}),
    attachment: t.attachment,
    direction: t.flow,
    lineSpacingStyle: t.lineSpacingStyle,
    lineSpacing: t.lineSpacing,
    // The frame sits a landing gap outside the text: MTEXT's frame is (scale − 1) × height out.
    ...(g.textFrame && t.height > 0
      ? { background: { flags: 16, scale: 1 + Math.max(0, g.landingGap) / t.height } }
      : {}),
  };
  return { geom, color: t.color };
}

/**
 * The MULTILEADER's block content as an INSERT of that block at its location, scale and
 * rotation (context data 15, 16, 46) in the content colour (93), with its attribute values.
 */
function blockPart(g: MultiLeaderGeometry, model: AnnotationTables): AnnotationPart | undefined {
  const b = g.block;
  if (!b || g.contentType !== 1 || b.block === undefined) return undefined;
  const def = model.blocks.get(b.block);
  if (!def) return undefined;
  return {
    geom: {
      kind: 'INSERT',
      block: b.block,
      position: b.position,
      scale: b.scale,
      rotation: b.rotation,
      attributes: blockAttributes(b, def.basePoint, model),
    },
    color: b.color,
  };
}

/**
 * Each attribute value as an ATTRIB would have it: its ATTDEF's text placed where the content
 * puts the block, the value as its text. Values whose ATTDEF is gone draw nothing.
 */
function blockAttributes(
  b: MultiLeaderBlock,
  base: Vec2,
  model: AnnotationTables,
): InsertAttribute[] {
  const out: InsertAttribute[] = [];
  const cos = Math.cos(b.rotation);
  const sin = Math.sin(b.rotation);
  const place = (p: Vec2): Vec2 => {
    const x = (p.x - base.x) * b.scale.x;
    const y = (p.y - base.y) * b.scale.y;
    return { x: b.position.x + x * cos - y * sin, y: b.position.y + x * sin + y * cos };
  };
  // Content blocks are scaled uniformly; the text takes the Y scale and keeps its proportions.
  const sx = Math.abs(b.scale.x);
  const sy = Math.abs(b.scale.y);
  for (const a of b.attributes ?? []) {
    const e = a.definition === undefined ? undefined : model.entityByHandle(a.definition);
    if (e?.geom.kind !== 'ATTDEF') continue;
    const { kind: _kind, prompt: _prompt, mtext, ...fields } = e.geom as AttdefGeometry;
    out.push({
      handle: e.handle,
      layer: e.layer,
      color: e.color,
      linetype: e.linetype,
      lineweight: e.lineweight,
      transparency: e.transparency,
      ltScale: e.ltScale,
      visible: e.visible,
      ...fields,
      value: a.value,
      position: place(fields.position),
      ...(fields.alignmentPoint ? { alignmentPoint: place(fields.alignmentPoint) } : {}),
      height: fields.height * sy,
      rotation: fields.rotation + b.rotation,
      widthFactor: sy > 0 ? (fields.widthFactor * sx) / sy : fields.widthFactor,
      ...(mtext
        ? {
            mtext: {
              ...mtext,
              contents: a.value,
              position: place(mtext.position),
              height: mtext.height * sy,
              width: mtext.width * sx,
              rotation: mtext.rotation + b.rotation,
            },
          }
        : {}),
    });
  }
  return out;
}

/** The properties and arrowhead a leader line draws in: its own where DXF 93 flags them. */
function lineStyle(
  l: MultiLeaderLine,
  line: LineProps,
  arrow: Handle | undefined,
  size: number,
  g: MultiLeaderGeometry,
  model: AnnotationTables,
): { props: LineProps; arrow: Handle | undefined; size: number; pathType: number } {
  const o = l.overrides;
  if (!o || o.flags === 0) return { props: line, arrow, size, pathType: g.pathType };
  const has = (bit: number): boolean => (o.flags & bit) !== 0;
  const props: { -readonly [K in keyof LineProps]: LineProps[K] } = { ...line };
  if (has(2) && o.color) props.color = o.color;
  if (has(4)) {
    if (o.linetype === undefined) delete props.linetype;
    else props.linetype = linetypeRef(model, o.linetype)!;
  }
  if (has(8) && o.lineweight !== undefined) props.lineweight = o.lineweight;
  // The line's size is before the overall scale, as DXF 42 is; 140 is 42 drawn.
  const ratio =
    g.drawnArrowheadSize !== undefined && g.arrowheadSize > 0
      ? g.drawnArrowheadSize / g.arrowheadSize
      : 1;
  return {
    props,
    arrow: has(32) ? o.arrowhead : arrow,
    size: has(16) && o.arrowheadSize !== undefined ? o.arrowheadSize * ratio : size,
    pathType: has(1) && o.pathType !== undefined ? o.pathType : g.pathType,
  };
}

/** The attachment line (M1-111) of a branch whose leader ends at `end`, if its attachment has one. */
function attachmentLine(
  g: MultiLeaderGeometry,
  end: Vec2,
  measure: TextMeasure | undefined,
  text: AnnotationPart | undefined,
  line: LineProps,
): AnnotationPart | undefined {
  const t = g.text;
  if (!t || !text || !measure) return undefined;
  const dir = { x: Math.cos(t.rotation), y: Math.sin(t.rotation) };
  const along = (a: Vec2, b: Vec2): number => (b.x - a.x) * dir.x + (b.y - a.y) * dir.y;
  const across = (a: Vec2, b: Vec2): number => (b.y - a.y) * dir.x - (b.x - a.x) * dir.y;
  let from: Vec2;
  let to: Vec2;
  if (g.textAttachmentDirection === 0) {
    // The leader is on the text's left when its end is before the text's insertion point.
    const left = along(t.position, end) < 0;
    const kind = left ? g.textLeftAttachment : g.textRightAttachment;
    if (kind !== 5 && kind !== 6 && kind !== 8) return undefined;
    const width = measure(text.geom as MTextGeometry);
    if (width === undefined) return undefined;
    from = end;
    to = add(end, dir, (left ? 1 : -1) * (width + Math.max(0, g.landingGap)));
  } else {
    // The leader is at the text's bottom when the text's insertion point is above its end.
    const bottom = across(end, t.position) > 0;
    if ((bottom ? g.textBottomAttachment : g.textTopAttachment) !== 10) return undefined;
    const width = measure(text.geom as MTextGeometry);
    if (width === undefined) return undefined;
    from = add(end, dir, -width / 2);
    to = add(end, dir, width / 2);
  }
  return {
    ...line,
    geom: {
      kind: 'LWPOLYLINE',
      vertices: [
        { ...from, bulge: 0 },
        { ...to, bulge: 0 },
      ],
      closed: false,
    },
  };
}

/**
 * The parts a MULTILEADER draws, in drawing coordinates: for each branch its leader lines
 * (one LWPOLYLINE each, or a fit-point SPLINE) and their arrowheads, one landing and the text's
 * underline or overline, then the content. Leader parts carry the leader line colour, linetype
 * and lineweight, or a line's own where it overrides them. The underline and overline need
 * `measure` (M1-111).
 */
export function multiLeaderParts(
  g: MultiLeaderGeometry,
  model: AnnotationTables,
  measure?: TextMeasure,
): AnnotationPart[] {
  const out: AnnotationPart[] = [];
  const line: LineProps = {
    color: g.lineColor,
    lineweight: g.lineweight,
    ...(g.linetype === undefined ? {} : { linetype: linetypeRef(model, g.linetype)! }),
  };
  const arrowBlock =
    g.arrowhead ?? (g.style ? model.tables.mleaderStyles.get(g.style)?.arrowhead : undefined);
  const arrowSize = g.drawnArrowheadSize ?? g.arrowheadSize;
  const horizontal = g.textAttachmentDirection === 0;
  const text = textPart(g);

  if (g.pathType !== 0) {
    for (const branch of g.branches) {
      const dir = unit(branch.direction) ?? { x: 1, y: 0 };
      const landingEnd = add(branch.connection, dir, branch.doglegLength);
      // Splines have no dogleg (they end along the landing direction instead).
      const dogleg = horizontal && g.dogleg && g.pathType !== 2 && branch.doglegLength !== 0;
      for (const l of branch.lines) {
        const own = lineStyle(l, line, arrowBlock, arrowSize, g, model);
        if (own.pathType === 0) continue;
        const spline = own.pathType === 2;
        const end = horizontal && !dogleg && !spline ? landingEnd : branch.connection;
        const pts = [...l.vertices, end];
        if (pts.length < 2) continue;
        const tip = pts[0]!;
        const back = unit(sub(pts[1]!, tip));
        const arrow = arrowheadParts(tip, pts[1]!, own.size, own.arrow, model, own.props);
        out.push(...arrow.parts);
        pts[0] = arrow.start;
        if (spline) {
          out.push({
            ...own.props,
            geom: {
              kind: 'SPLINE',
              degree: 3,
              knots: [],
              controlPoints: [],
              fitPoints: pts,
              ...(back ? { startTangent: { x: -back.x, y: -back.y } } : {}),
              ...(horizontal ? { endTangent: dir } : {}),
              closed: false,
              periodic: false,
            },
          });
        } else {
          out.push({
            ...own.props,
            geom: {
              kind: 'LWPOLYLINE',
              vertices: pts.map((p) => ({ x: p.x, y: p.y, bulge: 0 })),
              closed: false,
            },
          });
        }
      }
      if (dogleg && branch.lines.length > 0) {
        out.push({
          ...line,
          geom: {
            kind: 'LWPOLYLINE',
            vertices: [
              { ...branch.connection, bulge: 0 },
              { ...landingEnd, bulge: 0 },
            ],
            closed: false,
          },
        });
      }
      if (branch.lines.length > 0) {
        const under = attachmentLine(
          g,
          horizontal ? landingEnd : branch.connection,
          measure,
          text,
          line,
        );
        if (under) out.push(under);
      }
    }
  }
  if (text) out.push(text);
  const block = blockPart(g, model);
  if (block) out.push(block);
  return out;
}
