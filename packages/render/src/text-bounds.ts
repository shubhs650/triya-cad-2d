// Exact text bounds for the spatial index (M1-35, ARCHITECTURE.md §7.2): the box of what the
// renderer draws for a text, from the same layout and glyphs (`textPrimitives`), so culling
// and picking never miss a glyph and never keep a text whose drawing is elsewhere. Without
// the text's font loaded it draws nothing, and the bounds stay unknown (queries return it)
// until the fonts arrive and the index re-bounds it (`SpatialIndex.reboundAnnotations`).
//
// Covered: TEXT, MTEXT, ATTDEF (drawn as its tag, as AutoCAD shows a definition outside a
// block) and ATTRIB (its value, or its multiline MTEXT). TOLERANCE, LEADER, MULTILEADER and
// dimensions without a stored block need their own geometry and stay unknown.

import type {
  AnnotationBounds,
  AnnotationGeometry,
  Box,
  MTextGeometry,
  TextGeometry,
} from '@triya/engine';
import { styleFont } from '@triya/text';
import { STANDARD_FONT, textPrimitives, type TextContext } from './text';
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
  // An ATTRIB (folded into its INSERT) has no kind of its own.
  if (!('kind' in g)) {
    if (g.flags & 1) return undefined; // invisible: draws nothing
    return g.mtext ?? { ...g, kind: 'TEXT' };
  }
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
