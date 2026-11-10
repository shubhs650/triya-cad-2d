// Test fonts built with opentype.js itself, so no third-party font file is committed.
// Glyph outlines are in font units, y up; unitsPerEm 1000.
import { opentype } from '../../src/ttf/lib';
import type { Font, Glyph } from 'opentype.js';

function glyph(
  name: string,
  unicode: number | undefined,
  advanceWidth: number,
  draw?: (p: InstanceType<typeof opentype.Path>) => void,
): Glyph {
  const path = new opentype.Path();
  draw?.(path);
  return new opentype.Glyph(
    unicode === undefined ? { name, advanceWidth, path } : { name, unicode, advanceWidth, path },
  );
}

export function testFont(
  options: {
    familyName?: string;
    styleName?: string;
    weightClass?: number;
    italicAngle?: number;
  } = {},
): Font {
  return new opentype.Font({
    familyName: options.familyName ?? 'Triya Test Sans',
    styleName: options.styleName ?? 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    weightClass: options.weightClass ?? 400,
    ...(options.italicAngle === undefined ? {} : { italicAngle: options.italicAngle }),
    glyphs: [
      glyph('.notdef', undefined, 520, (p) => {
        p.moveTo(50, 0);
        p.lineTo(50, 700);
        p.lineTo(470, 700);
        p.lineTo(470, 0);
        p.close();
      }),
      glyph('space', 32, 250),
      glyph('A', 65, 600, (p) => {
        p.moveTo(0, 0);
        p.lineTo(300, 700);
        p.lineTo(600, 0);
        p.close();
      }),
      glyph('B', 66, 640, (p) => {
        p.moveTo(80, 0);
        p.lineTo(80, 700);
        p.quadraticCurveTo(560, 700, 80, 350);
        p.close();
      }),
      glyph('H', 72, 700, (p) => {
        p.moveTo(80, 0);
        p.lineTo(80, 700);
        p.lineTo(620, 700);
        p.lineTo(620, 0);
        p.close();
      }),
      glyph('o', 111, 560, (p) => {
        p.moveTo(280, 0);
        p.curveTo(500, 0, 500, 500, 280, 500);
        p.curveTo(60, 500, 60, 0, 280, 0);
        p.close();
      }),
      glyph('Omega', 0x3a9, 760, (p) => {
        p.moveTo(60, 0);
        p.lineTo(700, 0);
        p.close();
      }),
    ],
  });
}

/** The font as a font file's bytes (opentype.js writes CFF-flavoured OpenType). */
export const fontBytes = (font: Font): Uint8Array => new Uint8Array(font.toArrayBuffer());
