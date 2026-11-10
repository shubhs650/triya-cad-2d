// M1-38 / M1-37: the user's font files. Adding one keeps it on the device and hands its bytes
// to the renderers beside the bundled fonts; a file of the same name in another case replaces
// it; a file that is not a font is refused; a reload reads the kept files back.
import { describe, expect, it } from 'vitest';
import { buildShapes } from '../../../packages/text/test/shx/builder';
import { fontBytes, testFont } from '../../../packages/text/test/ttf/fonts';
import {
  FontStore,
  isFontFile,
  opfsFonts,
  type FontPersistence,
  type StoredFont,
} from '../src/user-fonts';

const SANS = fontBytes(testFont());
const SHX = buildShapes([{ code: 65, name: 'UCA', bytes: [0x14, 0x10, 0x1c, 0x18, 0] }], {
  name: 'Mine',
  above: 1,
  below: 0,
});
const BUNDLED = { shx: [{ name: 'oet-simplex', source: '{}' }] };

/** The device store's stand-in: what a reload would read back. */
function memory(
  initial: StoredFont[] = [],
  unreadable: { name: string; problem: string }[] = [],
): FontPersistence & { rows: StoredFont[] } {
  const p = {
    rows: [...initial],
    load: () => Promise.resolve({ fonts: [...p.rows], unreadable }),
    put: (f: StoredFont) => {
      p.rows = [...p.rows.filter((r) => r.name !== f.name), f];
      return Promise.resolve();
    },
    remove: (name: string) => {
      p.rows = p.rows.filter((r) => r.name !== name);
      return Promise.resolve();
    },
  };
  return p;
}

const names = (s: FontStore) => s.getSnapshot().files.map((f) => [f.name, f.kind]);

describe('FontStore', () => {
  it('adds TrueType and SHX files, keeps them and hands them over beside the bundled fonts', async () => {
    const db = memory();
    const s = new FontStore(db, BUNDLED);
    await s.add('TestSans.ttf', SANS);
    await s.add('mine.shx', SHX);
    expect(names(s)).toEqual([
      ['mine.shx', 'SHX font'],
      ['TestSans.ttf', 'TrueType font'],
    ]);
    expect(s.getSnapshot().notice).toBe('Added SHX font mine.shx.');
    expect(s.sources().shx).toBe(BUNDLED.shx);
    expect(s.sources().files?.map((f) => f.name)).toEqual(['mine.shx', 'TestSans.ttf']);
    expect(db.rows.map((r) => r.name).sort()).toEqual(['TestSans.ttf', 'mine.shx']);
  });

  it('reads back what an earlier visit kept', async () => {
    const db = memory([{ name: 'TestSans.ttf', bytes: SANS }]);
    const s = new FontStore(db, BUNDLED);
    await s.load();
    expect(names(s)).toEqual([['TestSans.ttf', 'TrueType font']]);
    expect(s.sources().files?.[0]?.bytes).toEqual(SANS);
  });

  // M1-38 part 3: the Health palette lists kept files that could not be read back.
  it('keeps the names of kept files it could not read back, for the health report', async () => {
    const db = memory(
      [{ name: 'TestSans.ttf', bytes: SANS }],
      [{ name: 'gone.shx', problem: 'could not be read (NotReadableError)' }],
    );
    const s = new FontStore(db, BUNDLED);
    expect(s.getSnapshot().unreadable).toEqual([]);
    await s.load();
    expect(names(s)).toEqual([['TestSans.ttf', 'TrueType font']]);
    expect(s.getSnapshot().unreadable).toEqual([
      { name: 'gone.shx', problem: 'could not be read (NotReadableError)' },
    ]);
    // A file added under that name replaces the one that could not be read.
    await s.add('Gone.SHX', SHX);
    expect(s.getSnapshot().unreadable).toEqual([]);
  });

  it('replaces a file whose name differs only in case', async () => {
    const db = memory();
    const s = new FontStore(db, BUNDLED);
    await s.add('testsans.ttf', SANS);
    await s.add('TESTSANS.TTF', SANS);
    expect(names(s)).toEqual([['TESTSANS.TTF', 'TrueType font']]);
    expect(db.rows.map((r) => r.name)).toEqual(['TESTSANS.TTF']);
  });

  it('refuses a file that is not a font and says so', async () => {
    const db = memory();
    const s = new FontStore(db, BUNDLED);
    await s.add('notes.ttf', new Uint8Array([1, 2, 3]));
    expect(names(s)).toEqual([]);
    expect(db.rows).toEqual([]);
    expect(s.getSnapshot().error).toBe('notes.ttf is not a font Triya can read.');
  });

  it('removes a file, and keeps the same sources object until the files change', async () => {
    const db = memory();
    const s = new FontStore(db, BUNDLED);
    await s.add('TestSans.ttf', SANS);
    const before = s.sources();
    s.dismiss();
    expect(s.sources()).toBe(before);
    await s.remove('testsans.TTF');
    expect(names(s)).toEqual([]);
    expect(db.rows).toEqual([]);
    expect(s.sources().files).toEqual([]);
  });

  it('works for the session when the device store is unavailable', async () => {
    const broken: FontPersistence = {
      load: () => Promise.reject(new Error('no OPFS')),
      put: () => Promise.reject(new Error('no OPFS')),
      remove: () => Promise.reject(new Error('no OPFS')),
    };
    const s = new FontStore(broken, BUNDLED);
    await s.load();
    await s.add('TestSans.ttf', SANS);
    expect(s.sources().files).toHaveLength(1);
    expect(s.getSnapshot().error).toMatch(/could not be kept on this device/);
  });

  it('reads every kept file it can and names the ones it cannot', async () => {
    const file = (name: string, bytes: Uint8Array | Error) => ({
      kind: 'file' as const,
      name,
      getFile: () =>
        bytes instanceof Error
          ? Promise.reject(bytes)
          : Promise.resolve(new Blob([bytes as Uint8Array<ArrayBuffer>])),
    });
    const entries = [
      file('TestSans.ttf', SANS),
      file('gone.shx', new DOMException('The file changed', 'NotReadableError')),
      file('notes.txt', SANS),
    ];
    const folder = {
      async *values() {
        yield* entries;
      },
    };
    const storage = {
      getDirectory: () => Promise.resolve({ getDirectoryHandle: () => Promise.resolve(folder) }),
    } as unknown as StorageManager;
    const { fonts, unreadable } = await opfsFonts(storage).load();
    expect(fonts.map((f) => f.name)).toEqual(['TestSans.ttf']);
    expect(unreadable).toEqual([
      { name: 'gone.shx', problem: 'could not be read (The file changed)' },
    ]);
  });

  it('recognises font files by extension', () => {
    // TrueType collections too, since M2-16 part 4 reads their faces.
    expect(['a.SHX', 'b.ttf', 'c.OTF', 'msgothic.ttc'].every(isFontFile)).toBe(true);
    expect(isFontFile('drawing.dxf')).toBe(false);
    expect(isFontFile('fonts.ttf.zip')).toBe(false);
  });
});
