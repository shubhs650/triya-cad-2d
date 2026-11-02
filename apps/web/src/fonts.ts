// The bundled Hershey fonts (M1-09, DEC-044) for every renderer the app makes (M1-72): the
// committed JSON files, built into the app so text draws offline and nothing is fetched. The
// render session (in its worker) loads them into a FontBook; a font the drawing names that is
// not here draws with its bundled equivalent, then the default one (FontBook.substitutions).
// User SHX and TrueType fonts join them in M1-37 and M1-38.
import type { FontSources } from '@triya/render';

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
