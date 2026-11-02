// The bundled Hershey fonts (M1-09, DEC-044) for every renderer the app makes (M1-72): the
// committed JSON files, built into the app so text draws offline and nothing is fetched. The
// render session (in its worker) loads them into a FontBook; a font the drawing names that is
// not here draws with its bundled equivalent, then the default one (FontBook.substitutions).
// The user's SHX and TrueType files (M1-37, M1-38) and installed faces join them in `FontStore`.
import { fontBookOf, type FontSources } from '@triya/render';
import type { FontError } from '@triya/io/health';
import type { FontBook } from '@triya/text';
import type { UnreadableFont } from './user-fonts';

const files = import.meta.glob<string>('../../../assets/fonts/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

export const BUNDLED_FONTS: FontSources = {
  shx: Object.entries(files).map(([path, source]) => ({
    name: path.slice(path.lastIndexOf('/') + 1, -'.json'.length),
    source,
  })),
};

export interface AppFonts {
  readonly book: FontBook;
  /** Files among the sources that did not parse, by name. */
  readonly failed: readonly string[];
}

const books = new WeakMap<FontSources, AppFonts>();

/**
 * The fonts the renderers are given, as a FontBook on the main thread, for the health report
 * (M1-70), which asks how each of a drawing's fonts draws, and the files among them that did
 * not parse (M1-38 part 3), as each render session finds them (`RenderSession.fontWarnings`).
 * Loaded when the Health palette first needs them, once per sources object (`FontStore`
 * keeps one until the fonts change).
 */
export function appFonts(sources: FontSources = BUNDLED_FONTS): AppFonts {
  let app = books.get(sources);
  if (!app) {
    const failed: string[] = [];
    app = { book: fontBookOf(sources, failed), failed };
    books.set(sources, app);
  }
  return app;
}

/**
 * Every font the app could not use, for the Health palette: files that did not parse (the
 * user's own, or installed faces handed on as files), kept files that could not be read back
 * (`FontStore`), and installed faces that could not be read or parsed (`DeviceFonts`).
 */
export function appFontErrors(o: {
  readonly failed: readonly string[];
  /** The user's file names; any other file came from this computer. */
  readonly own: readonly string[];
  readonly unreadable: readonly UnreadableFont[];
  readonly device: readonly FontError[];
}): FontError[] {
  const own = new Set(o.own.map((n) => n.toLowerCase()));
  return [
    ...o.failed.map((font) => ({
      source: own.has(font.toLowerCase()) ? YOUR_FONTS : 'This computer',
      font,
      problem: 'not a font Triya can read',
    })),
    ...o.unreadable.map((f) => ({ source: YOUR_FONTS, font: f.name, problem: f.problem })),
    ...o.device,
  ];
}

const YOUR_FONTS = 'Your fonts';
