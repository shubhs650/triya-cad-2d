// Fonts for the text rendering tests (M1-41), built in memory so no font file is committed.
import { FontBook, parseShx, parseTtf } from '@triya/text';
import { buildBigfont, buildShapes, s8 } from '../../text/test/shx/builder';
import { fontBytes, testFont } from '../../text/test/ttf/fonts';

/** A 1×1 square from the pen, then pen up 2 units east: advance 2 font units. */
const cell = [0x14, 0x10, 0x1c, 0x18, 2, 0x20, 0];

/**
 * `romans`: above 10, below 4. A is the square, B a semicircle (bulge arc) 2 wide, space
 * advances 1, `?` is the square.
 */
export const romans = () =>
  parseShx(
    buildShapes(
      [
        { code: 32, name: 'space', bytes: [2, 0x10, 0] },
        { code: 63, name: 'question', bytes: cell },
        { code: 65, name: 'UCA', bytes: cell },
        { code: 66, name: 'UCB', bytes: [12, 2, 0, 127, 0] },
      ],
      { name: 'Test roman', above: 10, below: 4 },
    ),
  );

/** A big font with one double-byte character, 0x8140: the square, above 8. */
export const bigfont = () =>
  parseShx(
    buildBigfont([{ code: 0x8140, name: '', bytes: cell }], { name: 'Big', above: 8, below: 0 }, [
      [0x81, 0x9f],
    ]),
  );

export const sans = () => parseTtf(fontBytes(testFont()));

/** romans.shx, the big font big.shx, and the test TrueType font as testsans.ttf. */
export function fontBook(): FontBook {
  const book = new FontBook();
  book.addShx('romans.shx', romans());
  book.addShx('big.shx', bigfont());
  book.addTtf(sans(), 'testsans.ttf');
  return book;
}

export { s8 };
