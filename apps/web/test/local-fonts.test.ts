// M1-38 part 2: fonts installed on this computer through the Local Font Access API. The app
// reads the permission without asking, lists the fonts only once it is granted (or from the
// Settings click that lets the browser ask), and reads a face's file only when an open drawing
// names it. A denial leaves the bundled stand-ins without an error.
import { describe, expect, it } from 'vitest';
import type { EntityInit, TextStyleRecord } from '@triya/engine';
import { fontBytes, testFont } from '../../../packages/text/test/ttf/fonts';
import {
  DeviceFonts,
  browserFontAccess,
  matchLocalFont,
  trueTypeFontsOf,
  type LocalFontAccess,
  type LocalFontData,
  type LocalFontsPermission,
} from '../src/local-fonts';
import { FontStore, type FontPersistence } from '../src/user-fonts';

const SANS = fontBytes(testFont());
const SANS_BOLD = fontBytes(testFont({ styleName: 'Bold', weightClass: 700 }));

function face(
  family: string,
  style: string,
  postscriptName: string,
  bytes: Uint8Array = SANS,
): LocalFontData & { reads: number } {
  const f = {
    family,
    style,
    postscriptName,
    fullName: style === 'Regular' ? family : `${family} ${style}`,
    reads: 0,
    blob: () => {
      f.reads++;
      return Promise.resolve(new Blob([bytes as Uint8Array<ArrayBuffer>]));
    },
  };
  return f;
}

const INSTALLED = [
  face('Arial', 'Regular', 'ArialMT'),
  face('Arial', 'Bold', 'Arial-BoldMT', SANS_BOLD),
  face('Arial', 'Italic', 'Arial-ItalicMT'),
  face('Arial Narrow', 'Regular', 'ArialNarrow'),
  face('DejaVu Sans', 'Bold', 'DejaVuSans-Bold'),
  face('ISOCPEUR', 'Regular', 'ISOCPEUR'),
  face('Broken', 'Regular', 'Broken', new Uint8Array([1, 2, 3])),
  // A face the browser lists but will not hand over (M1-38 part 3).
  {
    ...face('Locked', 'Regular', 'Locked'),
    blob: () => Promise.reject(new DOMException('The font is not available', 'NotFoundError')),
  },
];

const plain = { bold: false, italic: false };

/** The browser's API: a permission as it stands, and what asking gives. */
function access(
  permission: LocalFontsPermission,
  answer: 'allow' | 'deny' = 'allow',
): LocalFontAccess & { asked: number } {
  const a = {
    asked: 0,
    permission: () => Promise.resolve(permission),
    query: () => {
      a.asked++;
      return answer === 'allow'
        ? Promise.resolve(INSTALLED)
        : Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    },
  };
  return a;
}

describe('browserFontAccess', () => {
  it('reports a browser without the API as unsupported, and asking it rejects', async () => {
    const a = browserFontAccess({});
    expect(await a.permission()).toBe('unsupported');
    await expect(a.query()).rejects.toThrow();
  });

  it('reads the local-fonts permission without asking', async () => {
    const asked: string[] = [];
    const scope = (state: string) => ({
      queryLocalFonts: () => Promise.resolve([]),
      navigator: {
        permissions: {
          query: (d: { name: string }) => {
            asked.push(d.name);
            return Promise.resolve({ state });
          },
        },
      },
    });
    expect(await browserFontAccess(scope('granted')).permission()).toBe('granted');
    expect(await browserFontAccess(scope('denied')).permission()).toBe('denied');
    expect(await browserFontAccess(scope('prompt')).permission()).toBe('prompt');
    expect(asked).toEqual(['local-fonts', 'local-fonts', 'local-fonts']);
    const unknownName = {
      queryLocalFonts: () => Promise.resolve([]),
      navigator: { permissions: { query: () => Promise.reject(new TypeError('bad name')) } },
    };
    expect(await browserFontAccess(unknownName).permission()).toBe('prompt');
  });
});

describe('matchLocalFont', () => {
  const name = (n: string, style = plain) => matchLocalFont(INSTALLED, n, style)?.postscriptName;

  it('knows the Windows file names AutoCAD styles store', () => {
    expect(name('arial.ttf')).toBe('ArialMT');
    expect(name('ARIALBD.TTF')).toBe('Arial-BoldMT');
    expect(name('C:\\Windows\\Fonts\\ariali.ttf')).toBe('Arial-ItalicMT');
    expect(name('arialn.ttf')).toBe('ArialNarrow');
    expect(name('times.ttf')).toBeUndefined();
  });

  it('matches other file names to a PostScript name, else to a family', () => {
    expect(name('DejaVuSans-Bold.ttf')).toBe('DejaVuSans-Bold');
    expect(name('isocpeur.ttf')).toBe('ISOCPEUR');
  });

  it('finds a family by name with the closest bold and italic', () => {
    expect(name('Arial')).toBe('ArialMT');
    expect(name('arial', { bold: true, italic: false })).toBe('Arial-BoldMT');
    expect(name('Arial', { bold: false, italic: true })).toBe('Arial-ItalicMT');
    // Bold italic is not installed: one of the two matches, never Arial Narrow.
    expect(name('Arial', { bold: true, italic: true })).toMatch(/^Arial-/);
  });
});

describe('trueTypeFontsOf', () => {
  const style = (handle: string, font: string, trueTypeFlags = 0): TextStyleRecord => ({
    handle,
    name: font,
    font,
    height: 0,
    widthFactor: 1,
    obliqueAngle: 0,
    lastHeight: 2.5,
    generation: 0,
    trueTypeFlags,
  });
  const mtext = (contents: string) =>
    ({ geom: { kind: 'MTEXT', contents } }) as unknown as EntityInit;

  it("lists the styles' TrueType fonts and the MTEXT \\f families, once each", () => {
    const fonts = trueTypeFontsOf({
      tables: {
        textStyles: [style('1', 'romans.shx'), style('2', 'arial.ttf'), style('3', 'Arial.TTF', 2)],
      },
      entities: [
        mtext('{\\fTimes New Roman|b1|i0|c0|p18;Title}\\PBody'),
        mtext('{\\Fromand.shx;not TrueType}'),
        mtext('{\\fTimes New Roman|b1|i0;again}'),
      ],
    });
    expect(fonts.map((f) => [f.name, f.bold, f.italic])).toEqual([
      ['arial.ttf', false, false],
      ['Arial.TTF', true, false],
      ['Times New Roman', true, false],
    ]);
  });
});

describe('DeviceFonts', () => {
  it('lists nothing and asks nothing until fonts are allowed, then reads what drawings name', async () => {
    const a = access('prompt');
    const d = new DeviceFonts(a);
    await d.init();
    await d.need([{ name: 'arial.ttf', kind: 'ttf', bold: false, italic: false }]);
    expect(a.asked).toBe(0);
    expect(d.getSnapshot().permission).toBe('prompt');
    expect(d.files()).toEqual([]);

    await d.allow();
    expect(a.asked).toBe(1);
    expect(d.getSnapshot()).toEqual({
      permission: 'granted',
      used: [{ requested: 'arial.ttf', face: 'Arial' }],
      warnings: [],
    });
    expect(d.files().map((f) => f.name)).toEqual(['arial.ttf']);
    expect(d.files()[0]!.bytes).toEqual(SANS);
    // Only the face asked for was read.
    expect(INSTALLED.filter((f) => f.reads > 0).map((f) => f.postscriptName)).toEqual(['ArialMT']);
  });

  it('lists the fonts on a later visit without asking when already granted', async () => {
    const a = access('granted');
    const d = new DeviceFonts(a);
    await d.need([{ name: 'Arial', kind: 'ttf', bold: true, italic: false }]);
    await d.init();
    expect(a.asked).toBe(1);
    // A family request is handed on under the face's PostScript name.
    expect(d.files().map((f) => f.name)).toEqual(['Arial-BoldMT.ttf']);
  });

  it('falls back without an error when the user denies access', async () => {
    const d = new DeviceFonts(access('prompt', 'deny'));
    await d.init();
    await d.need([{ name: 'arial.ttf', kind: 'ttf', bold: false, italic: false }]);
    await expect(d.allow()).resolves.toBeUndefined();
    expect(d.getSnapshot()).toEqual({ permission: 'denied', used: [], warnings: [] });
    expect(d.files()).toEqual([]);
  });

  it('skips a face that does not parse and keeps a warning for the health report', async () => {
    const d = new DeviceFonts(access('granted'));
    await d.init();
    await d.need([{ name: 'Broken', kind: 'ttf', bold: false, italic: false }]);
    expect(d.files()).toEqual([]);
    const [warning, ...rest] = d.getSnapshot().warnings;
    expect(rest).toEqual([]);
    expect(warning).toMatchObject({ source: 'This computer', font: 'Broken' });
    expect(warning?.problem).toMatch(/^not a usable font/);
  });

  // M1-38 part 3: the health report lists it, so the snapshot changes when one is added.
  it('keeps a warning for a face it cannot read, and tells its listeners', async () => {
    const d = new DeviceFonts(access('granted'));
    await d.init();
    let told = 0;
    d.subscribe(() => told++);
    await d.need([{ name: 'Locked', kind: 'ttf', bold: false, italic: false }]);
    expect(d.files()).toEqual([]);
    expect(d.getSnapshot().warnings).toEqual([
      {
        source: 'This computer',
        font: 'Locked',
        problem: 'could not be read (The font is not available)',
      },
    ]);
    expect(told).toBeGreaterThan(0);
  });

  it('hands a face on once, by the file name a style asks for', async () => {
    const d = new DeviceFonts(access('granted'));
    await d.init();
    await d.need([{ name: 'Arial', kind: 'ttf', bold: false, italic: false }]);
    expect(d.files().map((f) => f.name)).toEqual(['ArialMT.ttf']);
    await d.need([{ name: 'arial.ttf', kind: 'ttf', bold: false, italic: false }]);
    expect(d.files().map((f) => f.name)).toEqual(['arial.ttf']);
    await d.need([{ name: 'Arial', kind: 'ttf', bold: false, italic: true }]);
    expect(d.files().map((f) => f.name)).toEqual(['arial.ttf', 'Arial-ItalicMT.ttf']);
    expect(d.getSnapshot().used.map((u) => u.requested)).toEqual(['Arial', 'arial.ttf']);
  });
});

describe('FontStore with installed fonts', () => {
  const none: FontPersistence = {
    load: () => Promise.resolve({ fonts: [], unreadable: [] }),
    put: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  };

  it("hands them on after the user's files, and a user file of the same name wins", async () => {
    const s = new FontStore(none, { shx: [] });
    s.setDeviceFonts([
      { name: 'arial.ttf', bytes: SANS },
      { name: 'ArialMT.ttf', bytes: SANS },
    ]);
    expect(s.sources().files?.map((f) => f.name)).toEqual(['arial.ttf', 'ArialMT.ttf']);
    await s.add('Arial.otf', SANS_BOLD);
    expect(s.sources().files?.map((f) => f.name)).toEqual(['Arial.otf', 'ArialMT.ttf']);
    // Installed fonts are not the user's files: Settings does not list them as such.
    expect(s.getSnapshot().files.map((f) => f.name)).toEqual(['Arial.otf']);
  });
});
