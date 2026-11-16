// The hatch dialogs' swatches (M4-07 part 5): a pattern drawn as SVG path data in a square, and
// a gradient as a CSS background, so the dialog never draws with Canvas 2D (rule: render).
//
// A pattern's swatch shows a few repeats of it at scale 1, turned by the dialog's angle, in a
// square sized from the pattern's own spacing and dash period (AutoCAD's swatch ignores the
// scale too). A gradient's follows the ramp shapes `@triya/hatch`'s `gradientRamp` draws:
// LINEAR colour 1 to colour 2 left to right, CYLINDER colour 2 along the middle, SPHERICAL
// colour 2 at the centre, HEMISPHERICAL about the middle of the bottom edge, CURVED colour 2
// along the bottom; the INV versions swap the colours.
import type { HatchPatternLine } from '@triya/engine';
import { hatchPattern, type PatPattern, patternLines, userDefinedLines } from '@triya/hatch';

/**
 * The swatch square's side in drawing units for `lines`, a few repeats of the pattern: five
 * spacings of a continuous family; two dash periods of a dashed one, but no more than three
 * sides of the cell it repeats in (spacing × period). A motif pattern (M4-12: a stroke per
 * family, each repeating once per tile) has short spacings and long periods whose cells are
 * all its tile, so it shows about three tiles.
 */
function swatchSize(lines: readonly HatchPatternLine[]): number {
  let size = 0;
  for (const l of lines) {
    const spacing = Math.abs(-Math.sin(l.angle) * l.offset.x + Math.cos(l.angle) * l.offset.y);
    const period = l.dashes.reduce((s, d) => s + Math.abs(d), 0);
    const repeat =
      period > 0
        ? Math.min(Math.max(5 * spacing, 2 * period), 3 * Math.sqrt(spacing * period))
        : 5 * spacing;
    size = Math.max(size, repeat);
  }
  return size > 0 ? size : 1;
}

/** SVG path data of `lines` clipped to a square, in a 0–100 view box (y down). */
export function linesSwatch(lines: readonly HatchPatternLine[]): string {
  const size = swatchSize(lines);
  const k = 100 / size;
  const corners = [
    [0, 0],
    [size, 0],
    [size, size],
    [0, size],
  ] as const;
  const out = hatchPattern(
    {
      loops: [
        {
          flags: 3,
          polyline: { closed: true, vertices: corners.map(([x, y]) => ({ x, y, bulge: 0 })) },
        },
      ],
      patternLines: lines,
      style: 0,
    },
    { maxLines: 2000 },
  );
  if (out.kind !== 'lines') return '';
  const n = (v: number) => Math.round(v * k * 10) / 10;
  const parts: string[] = [];
  for (const f of out.families) {
    const s = f.segments;
    for (let i = 0; i < s.length; i += 4) {
      parts.push(`M${n(s[i]!)} ${n(size - s[i + 1]!)}L${n(s[i + 2]!)} ${n(size - s[i + 3]!)}`);
    }
    // A dot: a line of no length, drawn with round caps.
    for (let i = 0; i < f.dots.length; i += 2) {
      parts.push(`M${n(f.dots[i]!)} ${n(size - f.dots[i + 1]!)}h0`);
    }
  }
  return parts.join('');
}

/** A library pattern's swatch at `angle` (radians). */
export const patternSwatch = (p: PatPattern, angle: number): string =>
  linesSwatch(patternLines(p, { angle, scale: 1 }));

/** User-defined lines' swatch: a few lines at the angle, crossed when double. */
export const userSwatch = (angle: number, double: boolean): string =>
  linesSwatch(userDefinedLines(angle, 1, double));

/** A gradient's swatch as a CSS background, from its colours. */
export function gradientSwatch(name: string, c1: string, c2: string): string {
  const inverse = name.startsWith('GR_INV');
  const [a, b] = inverse ? [c2, c1] : [c1, c2];
  switch (name.replace('GR_INV', 'GR_')) {
    case 'GR_CYL':
    case 'GR_CYLIN':
      return `linear-gradient(to right, ${a}, ${b}, ${a})`;
    case 'GR_SPH':
    case 'GR_SPHER':
      return `radial-gradient(circle, ${b}, ${a})`;
    case 'GR_HEM':
    case 'GR_HEMISP':
      return `radial-gradient(circle at 50% 100%, ${b}, ${a})`;
    case 'GR_CUR':
    case 'GR_CURVED':
      return `linear-gradient(to top, ${b}, ${b} 10%, ${a})`;
    default:
      return `linear-gradient(to right, ${a}, ${b})`;
  }
}
