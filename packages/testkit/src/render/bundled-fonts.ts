// The bundled Hershey fonts (M1-09) as committed in assets/fonts, loaded the way the app
// will: one JSON file per font, each turned into an SHX font for FontBook.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FontBook, loadStrokeFont, type FontBookOptions, type TriyaStrokeFont } from '@triya/text';

export const fontsDir = fileURLToPath(new URL('../../../../assets/fonts/', import.meta.url));

/** The committed font files by font name. */
export function bundledFontFiles(): Map<string, string> {
  return new Map(
    readdirSync(fontsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => [f.slice(0, -5), readFileSync(`${fontsDir}${f}`, 'utf8')]),
  );
}

/** A FontBook holding every bundled font and nothing else. */
export function bundledFontBook(options: FontBookOptions = {}): FontBook {
  const book = new FontBook(options);
  for (const [name, text] of bundledFontFiles()) {
    book.addShx(name, loadStrokeFont(JSON.parse(text) as TriyaStrokeFont));
  }
  return book;
}
