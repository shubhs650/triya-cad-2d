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
// Spline leaders (DXF 170 = 2) are fit-point splines through the vertices, which draw and bound
// once the kernel interpolates fit points the way AutoCAD does (M1-47); until then the
// MULTILEADER's bounds are unknown and the spline does not draw.
// Not yet (M1-52 part 2): block content and its attributes, per-line overrides (LEADER_LINE
// DXF 93), and the text underline and overline attachments (5, 6, 8 and 10).

import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type {
  Color,
  EntityGeometry,
  Entity,
  LinetypeRef,
  Lineweight,
  MTextGeometry,
  MultiLeaderGeometry,
} from '../model/types';

/** One thing an annotation draws, with the properties it draws in where they differ. */
export interface AnnotationPart {
  readonly geom: EntityGeometry;
  /** ByBlock (and absent) take the annotation's own property. */
  readonly color?: Color;
  readonly linetype?: LinetypeRef;
  readonly lineweight?: Lineweight;
}

/** What drawing an annotation's parts reads from the drawing. */
export type AnnotationTables = Pick<DocumentModel, 'tables' | 'blocks'>;

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
function linetypeRef(model: AnnotationTables, h: Handle | undefined): LinetypeRef | undefined {
  if (h === undefined) return undefined;
  const name = model.tables.linetypes.get(h)?.name.toLowerCase();
  if (name === 'byblock') return 'ByBlock';
  if (name === 'bylayer') return 'ByLayer';
  return h;
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
 * The parts a MULTILEADER draws, in drawing coordinates: for each branch its leader lines
 * (one LWPOLYLINE each, or a fit-point SPLINE) and their arrowheads, one landing, then the
 * content. Leader parts carry the leader line colour, linetype and lineweight.
 */
export function multiLeaderParts(
  g: MultiLeaderGeometry,
  model: AnnotationTables,
): AnnotationPart[] {
  const out: AnnotationPart[] = [];
  const line = {
    color: g.lineColor,
    lineweight: g.lineweight,
    ...(g.linetype === undefined ? {} : { linetype: linetypeRef(model, g.linetype)! }),
  };
  const arrowBlock =
    g.arrowhead ?? (g.style ? model.tables.mleaderStyles.get(g.style)?.arrowhead : undefined);
  const arrowDef = arrowBlock === undefined ? undefined : model.blocks.get(arrowBlock);
  const size = g.drawnArrowheadSize ?? g.arrowheadSize;
  const horizontal = g.textAttachmentDirection === 0;
  const spline = g.pathType === 2;

  if (g.pathType !== 0) {
    for (const branch of g.branches) {
      const dir = unit(branch.direction) ?? { x: 1, y: 0 };
      const landingEnd = add(branch.connection, dir, branch.doglegLength);
      // Splines have no dogleg (they end along the landing direction instead).
      const dogleg = horizontal && g.dogleg && !spline && branch.doglegLength !== 0;
      const end = horizontal && !dogleg && !spline ? landingEnd : branch.connection;
      for (const l of branch.lines) {
        const pts = [...l.vertices, end];
        if (pts.length < 2) continue;
        const tip = pts[0]!;
        const back = unit(sub(pts[1]!, tip));
        if (back && size > 0) {
          if (arrowBlock !== undefined && arrowDef) {
            out.push({
              ...line,
              geom: {
                kind: 'INSERT',
                block: arrowBlock,
                position: tip,
                scale: { x: size, y: size, z: size },
                rotation: Math.atan2(-back.y, -back.x),
                attributes: [],
              },
            });
            if (!DRAWN_AT_TIP.has(arrowDef.name.toLowerCase())) pts[0] = add(tip, back, size);
          } else {
            // Closed filled: base one size back, a sixth of the size either side.
            const base = add(tip, back, size);
            const n = { x: -back.y * (size / 6), y: back.x * (size / 6) };
            const left = add(base, n);
            const right = add(base, n, -1);
            out.push({ ...line, geom: { kind: 'SOLID', corners: [tip, left, right, right] } });
            pts[0] = base;
          }
        }
        if (spline) {
          out.push({
            ...line,
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
            ...line,
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
    }
  }
  const text = textPart(g);
  if (text) out.push(text);
  return out;
}

/** The parts of an annotation that draws through parts; undefined for every other entity. */
export function annotationParts(
  g: EntityGeometry,
  model: AnnotationTables,
): AnnotationPart[] | undefined {
  return g.kind === 'MULTILEADER' ? multiLeaderParts(g, model) : undefined;
}

/**
 * A part as an entity of its own, for the renderer's paint and block expansion: the owner's
 * handle, layer and properties, with the part's colour, linetype and lineweight where they
 * are not ByBlock.
 */
export function partEntity(owner: Entity, part: AnnotationPart): Entity {
  const { color, linetype, lineweight } = part;
  return {
    ...owner,
    geom: part.geom,
    type: part.geom.kind,
    ...(color && color.kind !== 'byBlock' ? { color } : {}),
    ...(linetype !== undefined && linetype !== 'ByBlock' ? { linetype } : {}),
    ...(lineweight !== undefined && lineweight !== 'ByBlock' ? { lineweight } : {}),
  };
}
