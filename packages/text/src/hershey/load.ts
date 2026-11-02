// A bundled stroke font (assets/fonts/*.json) as an `ShxFont` (M1-09), so FontBook, the
// measure and the renderer treat it exactly like a user's SHX font: each glyph becomes a
// Unicode shape of pen-up/pen-down moves (code 8 displacements), ending at its advance.

import { ShxFont } from '../shx/font';
import type { TriyaStrokeFont } from './convert';

/** Code 8 takes signed-byte displacements; longer moves go in steps. */
function moveBy(out: number[], dx: number, dy: number): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 127));
  let doneX = 0;
  let doneY = 0;
  for (let k = 1; k <= steps; k++) {
    const x = Math.round((dx * k) / steps);
    const y = Math.round((dy * k) / steps);
    out.push(8, (x - doneX) & 0xff, (y - doneY) & 0xff);
    doneX = x;
    doneY = y;
  }
}

/** The shape specification bytes for one glyph. */
export function strokeShape(advance: number, strokes: readonly (readonly number[])[]): Uint8Array {
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (const s of strokes) {
    if (s.length < 4) continue; // a single point draws nothing
    out.push(2);
    moveBy(out, s[0]! - x, s[1]! - y);
    out.push(1);
    for (let i = 2; i < s.length; i += 2) moveBy(out, s[i]! - s[i - 2]!, s[i + 1]! - s[i - 1]!);
    x = s[s.length - 2]!;
    y = s[s.length - 1]!;
  }
  out.push(2);
  moveBy(out, advance - x, -y);
  out.push(0);
  return Uint8Array.from(out);
}

export function loadStrokeFont(font: TriyaStrokeFont): ShxFont {
  if (font.format !== 'triya-stroke-font' || font.version !== 1) {
    throw new Error(`not a Triya stroke font (format ${font.format}, version ${font.version})`);
  }
  if (font.above < 1 || font.above > 255 || font.below < 0 || font.below > 255) {
    throw new Error(`${font.name}: above and below must fit the SHX font info bytes`);
  }
  const shapes = new Map<number, { name: string; spec: Uint8Array }>();
  shapes.set(0, { name: font.name, spec: new Uint8Array(0) });
  for (const [code, [advance, strokes]] of Object.entries(font.glyphs)) {
    shapes.set(Number(code), { name: '', spec: strokeShape(advance, strokes) });
  }
  // Font info: above, below, modes 0 (horizontal), encoding 0 (Unicode), type 0.
  return new ShxFont('unifont', shapes, [font.above, font.below, 0, 0, 0]);
}
