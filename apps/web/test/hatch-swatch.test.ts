// M4-07 part 5: the hatch dialogs' swatches, drawn as SVG paths and CSS gradients.
import { describe, expect, it } from 'vitest';
import { MATERIAL_MOTIFS, bundledPatterns } from '@triya/hatch';
import { gradientSwatch, linesSwatch, patternSwatch, userSwatch } from '../src/hatch-swatch';

/** The segments of a path made of `Mx yLx y` pieces. */
const segments = (d: string) =>
  [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)].map((m) =>
    m.slice(1).map(Number),
  );

describe('hatch swatches', () => {
  it('draws a few repeats of a pattern clipped to the 0–100 square', () => {
    const p = bundledPatterns().get('TRIYA_LINES0')!;
    const s = segments(patternSwatch(p, 0));
    // Horizontal lines five spacings across the square, each from side to side.
    expect(s.length).toBe(5);
    for (const [x1, y1, x2, y2] of s) {
      expect([x1, x2]).toEqual([0, 100]);
      expect(y1).toBe(y2);
    }
    // Turned by the dialog's angle: vertical.
    for (const [x1, , x2] of segments(patternSwatch(p, Math.PI / 2))) expect(x1).toBe(x2);
  });

  it('draws every material pattern (M4-12), a few tiles of it', () => {
    // Their families have short spacings and long dash periods; sized by those, the swatch
    // spanned dozens of tiles, past the line limit, and showed nothing.
    const lib = bundledPatterns();
    for (const m of MATERIAL_MOTIFS) {
      const d = patternSwatch(lib.get(m.name)!, 0);
      expect(d, m.name).not.toBe('');
      expect(segments(d).length, m.name).toBeLessThan(600);
    }
  });

  it('draws dots as round-capped points and crosses doubled user lines', () => {
    const dots = patternSwatch(bundledPatterns().get('TRIYA_DOTS')!, 0);
    expect(dots).toMatch(/h0/);
    const single = segments(userSwatch(0, false));
    const double = segments(userSwatch(0, true));
    expect(single.every(([, y1, , y2]) => y1 === y2)).toBe(true);
    expect(double.filter(([x1, , x2]) => x1 === x2).length).toBeGreaterThanOrEqual(single.length);
    expect(linesSwatch([])).toBe('');
  });

  it('shows each gradient’s ramp shape, the INV ones with the colours swapped', () => {
    expect(gradientSwatch('GR_LINEAR', 'blue', 'yellow')).toBe(
      'linear-gradient(to right, blue, yellow)',
    );
    expect(gradientSwatch('GR_INVCYL', 'blue', 'yellow')).toBe(
      'linear-gradient(to right, yellow, blue, yellow)',
    );
    expect(gradientSwatch('GR_SPHER', 'blue', 'yellow')).toBe(
      'radial-gradient(circle, yellow, blue)',
    );
    expect(gradientSwatch('GR_INVHEM', 'blue', 'yellow')).toBe(
      'radial-gradient(circle at 50% 100%, blue, yellow)',
    );
    expect(gradientSwatch('GR_CURVED', 'blue', 'yellow')).toMatch(
      /^linear-gradient\(to top, yellow/,
    );
  });
});
