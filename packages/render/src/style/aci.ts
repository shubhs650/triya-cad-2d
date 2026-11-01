// The AutoCAD Color Index palette, computed rather than copied from any Autodesk file.
//
// 1–9 are named colours. 10–249 are 24 hues 15° apart; each hue has five values
// (V = 1, 0.65, 0.5, 0.3, 0.15 of 255), and each value is shown at full (even index) and half
// (odd index) saturation. 250–255 are greys. Channels are floored, so they match the palette
// AutoCAD shows in its Select Color dialog (checked against acad-ts in the testkit oracle test).

export type Rgb = readonly [r: number, g: number, b: number];

const NAMED: readonly Rgb[] = [
  [0, 0, 0], // 0 is ByBlock; it has no colour of its own.
  [255, 0, 0],
  [255, 255, 0],
  [0, 255, 0],
  [0, 255, 255],
  [0, 0, 255],
  [255, 0, 255],
  [255, 255, 255],
  [128, 128, 128],
  [192, 192, 192],
];

const VALUES = [1, 0.65, 0.5, 0.3, 0.15];
// AutoCAD reports 253 as 173,173,173 (AC-CI-2-RGB, AUGI forum); the greys are 51 + 40.8·k, floored.
const GREYS = [51, 91, 132, 173, 214, 255];

/** RGB of ACI `index` (1–255). Index 7 is listed as white; `resolveColor` applies the background rule. */
export function aciRgb(index: number): Rgb {
  if (!Number.isInteger(index) || index < 0 || index > 255) {
    throw new RangeError(`ACI index ${index} is outside 0–255`);
  }
  if (index < 10) return NAMED[index]!;
  if (index >= 250) {
    const g = GREYS[index - 250]!;
    return [g, g, g];
  }
  const hue = (Math.floor(index / 10) - 1) * 15;
  const v = 255 * VALUES[Math.floor((index % 10) / 2)]!;
  const min = index % 2 ? v / 2 : 0;
  return hsv(hue, v, min);
}

/** RGB of a hue (degrees) whose brightest channel is `v` and dimmest is `min`. */
function hsv(hue: number, v: number, min: number): Rgb {
  const sector = Math.floor(hue / 60);
  const f = (hue % 60) / 60;
  const up = min + (v - min) * f;
  const down = v - (v - min) * f;
  const rgb: [number, number, number][] = [
    [v, up, min],
    [down, v, min],
    [min, v, up],
    [min, down, v],
    [up, min, v],
    [v, min, down],
  ];
  const [r, g, b] = rgb[sector]!;
  return [Math.floor(r), Math.floor(g), Math.floor(b)];
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

export function rgbHex([r, g, b]: Rgb): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}
