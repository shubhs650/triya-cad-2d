// M1-72: the app bundles every committed Hershey font (M1-09) and hands them to its renderers,
// so a font a drawing names but the device lacks draws with its bundled equivalent.
import { fontBookOf } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { fontBytes, testFont } from '../../../packages/text/test/ttf/fonts';
import { BUNDLED_FONTS, appFontErrors, appFonts } from '../src/fonts';

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

// M1-38 part 3: the Health palette asks a main-thread book of the same fonts the renderers get
// (bundled, the user's files, installed faces) and lists the ones that could not be used.
describe('the fonts the Health palette asks', () => {
  const sources = {
    ...BUNDLED_FONTS,
    files: [
      { name: 'TestSans.ttf', bytes: fontBytes(testFont()) },
      { name: 'arial.ttf', bytes: new Uint8Array([1, 2, 3]) },
      { name: 'ArialMT.ttf', bytes: new Uint8Array([4, 5]) },
    ],
  };

  it('loads the sources the renderers get, once per sources object, naming files that fail', () => {
    const app = appFonts(sources);
    expect(app.failed).toEqual(['arial.ttf', 'ArialMT.ttf']);
    expect(
      app.book.face({ name: 'TestSans.ttf', kind: 'ttf', bold: false, italic: false })?.kind,
    ).toBe('ttf');
    expect(appFonts(sources)).toBe(app);
    expect(appFonts().failed).toEqual([]);
    expect(appFonts()).toBe(appFonts(BUNDLED_FONTS));
  });

  it("names each error's source: the user's files, kept or not, and this computer", () => {
    expect(
      appFontErrors({
        failed: appFonts(sources).failed,
        own: ['arial.ttf', 'TestSans.ttf'],
        unreadable: [{ name: 'gone.shx', problem: 'could not be read (NotReadableError)' }],
        device: [{ source: 'This computer', font: 'Locked', problem: 'could not be read (x)' }],
      }),
    ).toEqual([
      { source: 'Your fonts', font: 'arial.ttf', problem: 'not a font Triya can read' },
      // A file that is not the user's came from this computer.
      { source: 'This computer', font: 'ArialMT.ttf', problem: 'not a font Triya can read' },
      { source: 'Your fonts', font: 'gone.shx', problem: 'could not be read (NotReadableError)' },
      { source: 'This computer', font: 'Locked', problem: 'could not be read (x)' },
    ]);
  });
});
