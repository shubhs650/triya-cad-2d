// Exact text bounds for the spatial index (M1-35, ARCHITECTURE.md §7.2): the box of what the
// renderer draws for a text, from the same layout and glyphs (`textPrimitives`), so culling
// and picking never miss a glyph and never keep a text whose drawing is elsewhere. Without
// the text's font loaded it draws nothing, and the bounds stay unknown (queries return it)
// until the fonts arrive and the index re-bounds it (`SpatialIndex.reboundAnnotations`).
//
// Covered: TEXT, MTEXT, ATTDEF (drawn as its tag, as AutoCAD shows a definition outside a
// block) and ATTRIB (its value, or its multiline MTEXT). TOLERANCE, LEADER and MULTILEADER
// are bounded by their parts (M1-52; TOLERANCE also takes `textMeasure` for its frame), and
// dimensions without a stored block stay unknown.

import type {
  AnnotationBounds,
  AnnotationGeometry,
  Box,
  MTextGeometry,
  TextGeometry,
  TextOutline,
} from '@triya/engine';
import { styleFont } from '@triya/text';
import { applyAffine } from './affine';
import { attributeText, placedText, STANDARD_FONT, textPrimitives, type TextContext } from './text';
import { PATH_A, PATH_C, PATH_E, PATH_L, PATH_M, PATH_Q, type RenderPrimitive } from './types';

/** Points a path never leaves: line ends, curve control points, arc and ellipse boxes. */
function grow(b: { minX: number; minY: number; maxX: number; maxY: number }, a: readonly number[]) {
  const add = (x: number, y: number) => {
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
  };
  for (let i = 0; i < a.length;) {
    switch (a[i]) {
      case PATH_M:
      case PATH_L:
        add(a[i + 1]!, a[i + 2]!);
        i += 3;
        break;
      case PATH_Q:
        add(a[i + 1]!, a[i + 2]!);
        add(a[i + 3]!, a[i + 4]!);
        i += 5;
        break;
      case PATH_C:
        add(a[i + 1]!, a[i + 2]!);
        add(a[i + 3]!, a[i + 4]!);
        add(a[i + 5]!, a[i + 6]!);
        i += 7;
        break;
      case PATH_A: {
        // The whole circle: looser than the arc, never tighter (glyph arcs are small).
        const [cx, cy, r] = [a[i + 1]!, a[i + 2]!, a[i + 3]!];
        add(cx - r, cy - r);
        add(cx + r, cy + r);
        i += 7;
        break;
      }
      case PATH_E: {
        const [cx, cy, rx, ry, rot] = [a[i + 1]!, a[i + 2]!, a[i + 3]!, a[i + 4]!, a[i + 5]!];
        const hx = Math.hypot(rx * Math.cos(rot), ry * Math.sin(rot));
        const hy = Math.hypot(rx * Math.sin(rot), ry * Math.cos(rot));
        add(cx - hx, cy - hy);
        add(cx + hx, cy + hy);
        i += 9;
        break;
      }
      default:
        i += 1;
    }
  }
}

/** The box around every path a set of primitives draws, its greeking included. */
export function primitivesBox(prims: readonly RenderPrimitive[]): Box | undefined {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of prims) {
    if (p.kind === 'point') {
      grow(b, [PATH_M, p.x, p.y]);
      continue;
    }
    if (p.kind === 'infinite') return undefined;
    grow(b, p.path);
    if (p.text) grow(b, p.text.greek);
  }
  return b.minX <= b.maxX && b.minY <= b.maxY ? b : undefined;
}

/** What an annotation draws as text, as TEXT or MTEXT geometry; undefined for the others. */
function asText(g: AnnotationGeometry): TextGeometry | MTextGeometry | undefined {
  // An ATTRIB (folded into its INSERT) has no kind of its own. Whether an invisible one shows
  // depends on ATTMODE, which the spatial index decides.
  if (!('kind' in g)) return attributeText(g);
  switch (g.kind) {
    case 'TEXT':
    case 'MTEXT':
      return g;
    case 'ATTDEF':
      return { ...g, kind: 'TEXT', value: g.tag };
    default:
      return undefined;
  }
}

/**
 * `annotationBounds` for the spatial index, from the loaded fonts and the text styles. A text
 * that draws nothing although its style's font is loaded (empty, only spaces, zero height) is
 * bounded by its insertion point, so it neither fills every query nor makes its block's
 * extents unknown.
 */
export function textBounds(ctx: TextContext): AnnotationBounds {
  return (g) => {
    const t = asText(g);
    if (!t) return undefined;
    const box = primitivesBox(textPrimitives(t, { color: 'foreground' }, ctx));
    if (box) return box;
    const style = ctx.style(t.style);
    const served = ctx.fonts.face(style ? styleFont(style) : STANDARD_FONT) !== undefined;
    const { x, y } = t.position;
    return served ? { minX: x, minY: y, maxX: x, maxY: y } : undefined;
  };
}

/**
 * Where a TEXT or MTEXT lies as drawn in the fonts loaded now (M2-27: an attribute picked, an
 * attribute's justification changed), or undefined while no loaded font draws it. A TEXT's box
 * runs along its baseline from its start to its advance and from its font's descender to its
 * height, turned and mirrored as drawn; a vertical TEXT's and an MTEXT's is the box of their
 * glyphs. `width` and `below` are a horizontal TEXT's advance and descent (0 otherwise).
 */
export function textOutline(
  ctx: TextContext,
): (g: TextGeometry | MTextGeometry) => TextOutline | undefined {
  const bounds = textBounds(ctx);
  return (g) => {
    const placed = g.kind === 'TEXT' ? placedText(g, ctx) : undefined;
    if (g.kind === 'TEXT' && placed && !placed.vertical) {
      const style = ctx.style(g.style);
      if (!ctx.fonts.face(style ? styleFont(style) : STANDARD_FONT)) return undefined;
      const { frame, width, below } = placed;
      const corners = [
        { x: 0, y: -below },
        { x: width, y: -below },
        { x: width, y: g.height },
        { x: 0, y: g.height },
      ].map((p) => applyAffine(frame, p));
      return { corners, width, below };
    }
    const style = ctx.style(g.style);
    if (!ctx.fonts.face(style ? styleFont(style) : STANDARD_FONT)) return undefined;
    const b = bounds(g);
    if (!b) return undefined;
    const corners = [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ];
    return { corners, width: 0, below: 0 };
  };
}
