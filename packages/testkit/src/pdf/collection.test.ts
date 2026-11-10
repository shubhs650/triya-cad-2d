// M2-16 part 4: TrueType/OpenType collections (.ttc). Each face is read as a font of its own,
// a style naming the collection file draws with its first face (as AutoCAD does), the other
// faces answer to their families, and a plot embeds the face shown, not the collection.
import {
  CffFont,
  PdfDocument,
  TrueTypeFont,
  paperTransform,
  plotItems,
  readSfnt,
} from '@triya/pdf';
import { fontBookOf } from '@triya/render';
import { collectionFaces, parseTtf, parseTtfCollection } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { testCollection } from '../fonts/collection';
import { testTrueType } from '../fonts/truetype';

const pixel = testTrueType();
const sans = testTrueType({ family: 'Triya Pixel Sans', outlines: 'cff' });
const ttc = testCollection([pixel, sans]);

describe('TrueType collections (M2-16 part 4)', () => {
  it('copies each face out into a font file of its own', () => {
    // Most tables are shared, so the collection is smaller than its faces.
    expect(ttc.length).toBeLessThan(pixel.length + sans.length);
    const faces = collectionFaces(ttc)!;
    expect(faces).toHaveLength(2);
    faces.forEach((face, i) => {
      const own = readSfnt([pixel, sans][i]!)!;
      const copy = readSfnt(face)!;
      expect(copy.version).toBe(own.version);
      expect([...copy.tables.keys()]).toEqual([...own.tables.keys()]);
      for (const [t, data] of own.tables) expect([...copy.tables.get(t)!]).toEqual([...data]);
    });
    expect(TrueTypeFont.parse(faces[0]!)).toBeDefined();
    expect(CffFont.parse(faces[1]!)).toBeDefined();
    expect(collectionFaces(pixel)).toBeUndefined();
  });

  it('reads the first face, or the face a PostScript name asks for', () => {
    expect(parseTtf(ttc).family).toBe('Triya Pixel');
    expect(parseTtf(ttc, 'triyapixelsans').family).toBe('Triya Pixel Sans');
    expect(parseTtf(ttc, 'NoSuchFace').family).toBe('Triya Pixel');
    expect(parseTtfCollection(ttc).map((f) => f.family)).toEqual([
      'Triya Pixel',
      'Triya Pixel Sans',
    ]);
    expect(parseTtfCollection(pixel).map((f) => f.family)).toEqual(['Triya Pixel']);
    expect(() => parseTtf(ttc.slice(0, 40))).toThrow();
  });

  it('draws a style naming the collection with its first face, other faces by family', () => {
    const failed: string[] = [];
    const book = fontBookOf({ files: [{ name: 'pixels.ttc', bytes: ttc }] }, failed);
    expect(failed).toEqual([]);
    const file = book.resolve({ name: 'pixels.ttc', kind: 'ttf', bold: false, italic: false });
    expect(file.face?.kind === 'ttf' && file.face.font.family).toBe('Triya Pixel');
    const family = book.resolve({
      name: 'Triya Pixel Sans',
      kind: 'ttf',
      bold: false,
      italic: false,
    });
    expect(family.face?.kind === 'ttf' && family.face.font.family).toBe('Triya Pixel Sans');
  });

  it('embeds only the face shown in a plot', () => {
    const face = parseTtf(ttc, 'TriyaPixelSans');
    const g = face.glyph(0x48);
    const s = face.scaleFor(10);
    const doc = new PdfDocument({ compress: false });
    plotItems(
      doc.addPage(842, 595),
      [
        {
          kind: 'fill',
          path: [0, 20, 100, 1, 26, 100, 1, 26, 110, 4],
          paint: {
            color: [0, 0, 0],
            lineweight: 0.25,
            linetype: { kind: 'object' },
            endStyle: 'round',
            joinStyle: 'round',
          },
          glyphs: [
            {
              font: face,
              index: g.index,
              codePoint: 0x48,
              m: { a: s, b: 0, c: 0, d: s, e: 20, f: 100 },
            },
          ],
        },
      ],
      { toPaper: paperTransform(1, { x: 0, y: 0 }, { x: 0, y: 0 }) },
    );
    const latin = Buffer.from(doc.bytes()).toString('latin1');
    expect(latin).toMatch(/\/BaseFont \/[A-Z]{6}\+TriyaPixelSans /);
    expect(latin).toContain('/FontFile3');
    expect(latin).not.toContain('/FontFile2');
  });
});
