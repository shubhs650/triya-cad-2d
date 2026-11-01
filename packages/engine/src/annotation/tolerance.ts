// TOLERANCE (feature control frame) as the parts AutoCAD draws for it (M1-52 part 4,
// ARCHITECTURE.md §9 "Leaders"): one rectangle per compartment and the compartment's text as
// an MTEXT. The engine has no fonts, so the compartment widths come from an injected
// `TextMeasure` (the renderer's text layout); without it, or while a font is not loaded, a
// TOLERANCE has no parts and its bounds stay unknown.
//
// What the DXF reference gives: DXF 1 holds the frame as text, rows split by `^J` (read as a
// newline since acad-ts patch 0039) and compartments by `%%v`, GD&T symbols as `{\Fgdt;x}`
// font switches. The style comes from the DIMSTYLE (DXF 3) with the entity's `DSTYLE` xdata
// overrides: DIMTXT × DIMSCALE text in DIMTXSTY coloured DIMCLRT, DIMGAP × DIMSCALE between
// text and frame, the frame in DIMCLRD and DIMLWD (as for dimension lines).
// AutoCAD does not document the frame's geometry. These rules are the common drafter
// expectation, to be checked against reference plots (M1-24/M1-26):
// - Each row is the text height plus a gap above and below; rows stack downwards.
// - The insertion point (DXF 10) is the left edge of the first row, half way up it, where
//   the TOLERANCE command and leaders attach.
// - Each compartment is its text's width plus a gap either side; compartments run on from
//   the left edge. An empty compartment (`%%v%%v`, or only font switches) draws nothing and
//   takes no room; an empty row draws nothing but keeps its place.

import type { Vec2 } from '../geom/types';
import type { Entity, MTextGeometry, ToleranceGeometry } from '../model/types';
import { dimColor, dimLineweight, dimNum, dimTrueColors, dimVars } from './leader';
import type { AnnotationPart, AnnotationTables } from './multileader';

/**
 * The width a text engine lays an MTEXT out at (its widest line's advance), or undefined
 * while its font is not loaded.
 */
export type TextMeasure = (text: MTextGeometry) => number | undefined;

/** Whether a compartment holds anything but font switches and braces. */
function isEmpty(contents: string): boolean {
  return contents.replace(/\\[Ff][^;]*;|[{}]/g, '').trim() === '';
}

/**
 * The parts a TOLERANCE draws, in drawing coordinates: per compartment a closed LWPOLYLINE in
 * the frame colour and its text as an MTEXT. Undefined when `measure` cannot measure a
 * compartment's text.
 */
export function toleranceParts(
  g: ToleranceGeometry,
  xdata: Entity['xdata'],
  model: AnnotationTables,
  measure: TextMeasure,
): AnnotationPart[] | undefined {
  const vars = dimVars(g.style, xdata, model);
  const scale = dimNum(vars.DIMSCALE, 1) || 1;
  const h = dimNum(vars.DIMTXT, 0.18) * scale;
  if (!(h > 0)) return [];
  // A negative DIMGAP boxes dimension text; the frame always takes its size.
  const gap = Math.abs(dimNum(vars.DIMGAP, 0.09)) * scale;
  const rowHeight = h + 2 * gap;
  const style = typeof vars.DIMTXSTY === 'string' ? vars.DIMTXSTY : '';
  const trueColors = dimTrueColors(g.style, xdata, model);
  const frameColor = trueColors.DIMCLRD ?? dimColor(vars.DIMCLRD);
  const textColor = trueColors.DIMCLRT ?? dimColor(vars.DIMCLRT);
  const lineweight = dimLineweight(vars.DIMLWD);
  const frameProps = {
    ...(frameColor ? { color: frameColor } : {}),
    ...(lineweight !== undefined ? { lineweight } : {}),
  };

  const cos = Math.cos(g.rotation);
  const sin = Math.sin(g.rotation);
  // The frame's Y axis is normal × X; under a −Z extrusion it is reversed (`upsideDown`).
  const ySign = g.upsideDown ? -1 : 1;
  const at = (x: number, y: number): Vec2 => ({
    x: g.position.x + x * cos - y * sin * ySign,
    y: g.position.y + x * sin + y * cos * ySign,
  });

  const out: AnnotationPart[] = [];
  const rows = g.text.split(/\r?\n|\^J/);
  for (const [r, row] of rows.entries()) {
    const top = rowHeight / 2 - r * rowHeight;
    const bottom = top - rowHeight;
    let x = 0;
    for (const contents of row.split(/%%v/i)) {
      if (isEmpty(contents)) continue;
      const text: MTextGeometry = {
        kind: 'MTEXT',
        contents,
        style,
        position: at(x + gap, (top + bottom) / 2),
        height: h,
        width: 0,
        rotation: g.rotation,
        ...(g.upsideDown ? { upsideDown: true } : {}),
        attachment: 4, // middle left
        direction: 1,
        lineSpacingStyle: 1,
        lineSpacing: 1,
      };
      const w = measure(text);
      if (w === undefined) return undefined;
      const right = x + w + 2 * gap;
      out.push({
        ...frameProps,
        geom: {
          kind: 'LWPOLYLINE',
          vertices: [at(x, top), at(right, top), at(right, bottom), at(x, bottom)].map((p) => ({
            ...p,
            bulge: 0,
          })),
          closed: true,
        },
      });
      out.push({ geom: text, ...(textColor ? { color: textColor } : {}) });
      x = right;
    }
  }
  return out;
}
