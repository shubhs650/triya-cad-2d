// M1-70: the app bundles every committed Hershey font (M1-09) and hands them to its renderers,
// so a font a drawing names but the device lacks draws with its bundled equivalent.
import { fontBookOf } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { BUNDLED_FONTS } from '../src/fonts';

/** What `pnpm fonts:build` commits (M1-09); bundled-fonts.test.ts keeps the files in step. */
const committed = [
  'oet-complex',
  'oet-duplex',
  'oet-gothice',
  'oet-gothicg',
  'oet-gothici',
  'oet-italic',
  'oet-script',
  'oet-scriptc',
  'oet-simplex',
  'oet-triplex',
];

describe('bundled fonts in the app', () => {
  it('holds every committed font by name', () => {
    expect(BUNDLED_FONTS.shx?.map((f) => f.name).sort()).toEqual(committed);
  });

  it('loads into a font book that serves the SHX names drawings use', () => {
    const book = fontBookOf(BUNDLED_FONTS);
    for (const name of ['romans.shx', 'txt', 'complex.shx', 'gothice.shx']) {
      expect(book.face({ name, kind: 'shx', bold: false, italic: false })?.kind, name).toBe('shx');
    }
    expect(book.substitutions.get('romans.shx')).toBe('oet-simplex');
  });
});
