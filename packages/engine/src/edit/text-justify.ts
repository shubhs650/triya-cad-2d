// Where a text's justification points lie as it is drawn (M4-09): what JUSTIFYTEXT gives a text
// another justification by without moving it, and what SCALETEXT scales a text about.
//
// A single-line text is placed as the renderer places it (render/src/text.ts, placedText): its
// box runs along its baseline from its start for its advance, and from its font's descent below
// the baseline to its height above it. Bottom is the descent line, Middle (DXF 72 = 4) halfway
// up that box, Middle center (DXF 73 = 2) half the height above the baseline. Every point is
// read off the box the canvas measured (`TextOutline`), so the drawn text never moves.
//
// An MTEXT's attachment places its frame (the layout's width and height, @triya/text
// layoutMText): left, centre or right of its width, top, middle or bottom of its height. Its
// justification keywords name the frame's top row for the baseline ones (Left, Align and Fit
// are Top left, Center Top center, Right Top right) and its centre for Middle: AutoCAD's help
// does not say, and MTEXT has no baseline, so this reads them as the MTEXT editor's own
// Justification menu does.
import type { Vec2 } from '../geom/types';
import type { MTextGeometry, TextFields } from '../model/types';
import type { TextOutline } from '../commands/view/host';

/** DXF 72 and 73 of a single-line text. */
export interface Justification {
  readonly halign: number;
  readonly valign: number;
}

/** The justification keywords of TEXT's Justify option, JUSTIFYTEXT and SCALETEXT. */
export const TEXT_JUSTIFICATIONS: Readonly<Record<string, Justification>> = {
  Left: { halign: 0, valign: 0 },
  Align: { halign: 3, valign: 0 },
  Fit: { halign: 5, valign: 0 },
  Center: { halign: 1, valign: 0 },
  Middle: { halign: 4, valign: 0 },
  Right: { halign: 2, valign: 0 },
  TL: { halign: 0, valign: 3 },
  TC: { halign: 1, valign: 3 },
  TR: { halign: 2, valign: 3 },
  ML: { halign: 0, valign: 2 },
  MC: { halign: 1, valign: 2 },
  MR: { halign: 2, valign: 2 },
  BL: { halign: 0, valign: 1 },
  BC: { halign: 1, valign: 1 },
  BR: { halign: 2, valign: 1 },
};

/** Aligned (3) and Fit (5) run between DXF 10 and DXF 11. */
const twoPoint = (halign: number) => halign === 3 || halign === 5;

/** The MTEXT attachment (1–9, top-left to bottom-right) a justification keyword names. */
export function attachmentFor(j: Justification): number {
  const col = j.halign === 1 || j.halign === 4 ? 1 : j.halign === 2 ? 2 : 0;
  const row = j.valign === 2 || j.halign === 4 ? 1 : j.valign === 1 ? 2 : 0;
  return row * 3 + col + 1;
}

/**
 * The point of a drawn single-line text `x` of the way along its advance and `y` above its
 * baseline, in the text's own units (before an Aligned or Fit text's stretch).
 */
function outlinePoint(o: TextOutline, height: number, x: number, y: number): Vec2 {
  const [c0, c1, , c3] = o.corners as [Vec2, Vec2, Vec2, Vec2];
  const v = (y + o.below) / (height + o.below);
  return {
    x: c0.x + (c1.x - c0.x) * x + (c3.x - c0.x) * v,
    y: c0.y + (c1.y - c0.y) * x + (c3.y - c0.y) * v,
  };
}

/** Where justification `j` lies on the single-line text `t` drawn as `o`. */
export function textJustificationPoint(t: TextFields, o: TextOutline, j: Justification): Vec2 {
  const h = t.height;
  const x = j.halign === 1 || j.halign === 4 ? 0.5 : j.halign === 2 ? 1 : 0;
  const y =
    j.halign === 4
      ? (h - o.below) / 2
      : j.valign === 1
        ? -o.below
        : j.valign === 2
          ? h / 2
          : j.valign === 3
            ? h
            : 0;
  return outlinePoint(o, h, x, y);
}

/** What JUSTIFYTEXT changes on a single-line text. */
export type Rejustified = Pick<
  TextFields,
  'position' | 'alignmentPoint' | 'halign' | 'valign' | 'height' | 'widthFactor'
>;

/**
 * The single-line text `t`, drawn as `o`, given justification `j` where it lies (JUSTIFYTEXT).
 * DXF 10 becomes the baseline start as drawn and DXF 11 the new justification point. An
 * Aligned or Fit text is drawn stretched between its points: leaving them, it keeps its size by
 * taking the stretch into its height (Aligned) or its width factor (Fit), so it is drawn the
 * same whatever it becomes; Aligned and Fit run from its baseline start to its end.
 */
export function justifiedInPlace(t: TextFields, j: Justification, o: TextOutline): Rejustified {
  const [c0, c1] = o.corners as [Vec2, Vec2];
  let height = t.height;
  let widthFactor = t.widthFactor;
  if (twoPoint(t.halign) && o.width > 0) {
    const k = Math.hypot(c1.x - c0.x, c1.y - c0.y) / o.width;
    if (t.halign === 3) height = t.height * k;
    else widthFactor = (t.widthFactor || 1) * k;
  }
  const start = outlinePoint(o, t.height, 0, 0);
  const base = { height, widthFactor, halign: j.halign };
  if (twoPoint(j.halign)) {
    return { ...base, valign: 0, position: start, alignmentPoint: outlinePoint(o, t.height, 1, 0) };
  }
  if (j.halign === 0 && j.valign === 0) {
    return {
      ...base,
      valign: 0,
      position: start,
      ...(t.alignmentPoint && { alignmentPoint: start }),
    };
  }
  return {
    ...base,
    valign: j.valign,
    position: start,
    alignmentPoint: textJustificationPoint(t, o, j),
  };
}

/** An MTEXT's frame as laid out: its width (all its columns) and height. */
export interface TextFrame {
  readonly width: number;
  readonly height: number;
}

/** Where attachment `a` (1–9) lies on the MTEXT `g` whose frame is `f`. */
export function mtextAttachmentPoint(g: MTextGeometry, f: TextFrame, a: number): Vec2 {
  const col = (k: number) => (k - 1) % 3;
  const row = (k: number) => Math.floor((k - 1) / 3);
  const x = ((col(a) - col(g.attachment)) * f.width) / 2;
  // Under a −Z extrusion the text's own Y axis points the other way.
  const y = ((row(g.attachment) - row(a)) * f.height * (g.upsideDown ? -1 : 1)) / 2;
  const cos = Math.cos(g.rotation);
  const sin = Math.sin(g.rotation);
  return { x: g.position.x + x * cos - y * sin, y: g.position.y + x * sin + y * cos };
}

/** The MTEXT `g`, laid out in frame `f`, given attachment `a` where it lies (JUSTIFYTEXT). */
export function mtextJustifiedInPlace(g: MTextGeometry, a: number, f: TextFrame): MTextGeometry {
  if (a === g.attachment) return g;
  return { ...g, attachment: a, position: mtextAttachmentPoint(g, f, a) };
}
