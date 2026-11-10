// M2-20 part 2: the user's plot style tables (.ctb/.stb) and linetype files (.lin), as
// AutoCAD's OPTIONS > Files lists its Plot Style Table Search Path and support files. Adding
// one checks it can be read (parsePlotStyleTable, parseLin), keeps it on the device and lists
// what it holds; a file of the same name in another case replaces it; a file that cannot be
// used is refused with the reason; a reload reads the kept files back.
import { describe, expect, it } from 'vitest';
import { BUNDLED_PLOT_STYLE_TABLES, writePlotStyleTable } from '@triya/render';
import {
  LINETYPE_FILES,
  PLOT_STYLE_FILES,
  SupportFileStore,
  opfsSupportFiles,
  plotStyleTablesIn,
  type StoredSupportFile,
  type SupportPersistence,
} from '../src/support-files';

const CTB = writePlotStyleTable(BUNDLED_PLOT_STYLE_TABLES['triya-monochrome.ctb']!);
const STB = writePlotStyleTable(BUNDLED_PLOT_STYLE_TABLES['triya-default.stb']!);
const LIN = new TextEncoder().encode(
  [
    ';; two linetypes',
    '*BORDER2,Border (.5x) __ __ . __ __ . __',
    'A,.25,-.125,.25,-.125,0,-.125',
    '*FENCE,Fence ----0----0----',
    'A,.25,-.1,["O",STANDARD,S=.1,R=0,X=-.03,Y=-.05],-.1',
    '*BROKEN',
    'A,1,-',
    '',
  ].join('\r\n'),
);
const enc = (s: string) => new TextEncoder().encode(s);

/** The device store's stand-in: what a reload would read back. */
function memory(
  initial: StoredSupportFile[] = [],
  unreadable: { name: string; problem: string }[] = [],
): SupportPersistence & { rows: StoredSupportFile[] } {
  const p = {
    rows: [...initial],
    load: () => Promise.resolve({ files: [...p.rows], unreadable }),
    put: (f: StoredSupportFile) => {
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

const listed = (s: SupportFileStore) => s.getSnapshot().files.map((f) => [f.name, f.summary]);

describe('plot style table store', () => {
  it('adds a colour-dependent and a named table, keeps them and lists what they are', async () => {
    const db = memory();
    const s = new SupportFileStore(PLOT_STYLE_FILES, db);
    await s.add('Office.ctb', CTB);
    expect(s.getSnapshot().notice).toBe('Added color-dependent plot style table Office.ctb.');
    await s.add('named.STB', STB);
    expect(s.getSnapshot().notice).toBe('Added named plot style table named.STB.');
    expect(listed(s)).toEqual([
      ['named.STB', 'Named, 2 styles (Normal, Style 1): Triya: plot every object as it is'],
      ['Office.ctb', 'Color-dependent, 255 styles: Triya: plot every object black'],
    ]);
    expect(db.rows.map((r) => r.name).sort()).toEqual(['Office.ctb', 'named.STB']);
    // M2-17 part 3's Plot dialog finds a table by its file name, ignoring case.
    expect(s.file('office.CTB')).toEqual(CTB);
    expect(s.file('missing.ctb')).toBeUndefined();
  });

  it('refuses a file that is not a plot style table, or one whose extension says the other kind', async () => {
    const db = memory();
    const s = new SupportFileStore(PLOT_STYLE_FILES, db);
    await s.add('notes.ctb', enc('hello'));
    expect(s.getSnapshot().error).toBe(
      'notes.ctb is not a plot style table Triya can read (not a plot style table (no PIAFILEVERSION marker)).',
    );
    // AutoCAD tells the two kinds apart by extension: a named table saved as .ctb is unusable.
    await s.add('wrong.ctb', STB);
    expect(s.getSnapshot().error).toBe(
      'wrong.ctb holds a named plot style table, so its name must end in .stb.',
    );
    await s.add('wrong.stb', CTB);
    expect(s.getSnapshot().error).toBe(
      'wrong.stb holds a color-dependent plot style table, so its name must end in .ctb.',
    );
    expect(listed(s)).toEqual([]);
    expect(db.rows).toEqual([]);
  });

  it('replaces a file whose name differs only in case, and removes one', async () => {
    const db = memory();
    const s = new SupportFileStore(PLOT_STYLE_FILES, db);
    await s.add('office.ctb', CTB);
    await s.add('OFFICE.CTB', CTB);
    expect(listed(s).map(([n]) => n)).toEqual(['OFFICE.CTB']);
    expect(db.rows.map((r) => r.name)).toEqual(['OFFICE.CTB']);
    await s.remove('Office.ctb');
    expect(listed(s)).toEqual([]);
    expect(db.rows).toEqual([]);
  });

  it('reads back what an earlier visit kept, and names kept files it cannot use', async () => {
    const db = memory(
      [
        { name: 'Office.ctb', bytes: CTB },
        { name: 'broken.ctb', bytes: enc('PIAFILEVERSION_2.0,CTBVER1,compress\r\npmzlibcodec') },
      ],
      [{ name: 'gone.stb', problem: 'could not be read (The file changed)' }],
    );
    const s = new SupportFileStore(PLOT_STYLE_FILES, db);
    await s.load();
    expect(listed(s)).toEqual([
      ['Office.ctb', 'Color-dependent, 255 styles: Triya: plot every object black'],
    ]);
    expect(s.getSnapshot().unreadable.map((u) => u.name)).toEqual(['broken.ctb', 'gone.stb']);
    expect(s.getSnapshot().unreadable[1]!.problem).toBe('could not be read (The file changed)');
    // A file added under that name replaces the one that could not be used.
    await s.add('Broken.ctb', CTB);
    expect(s.getSnapshot().unreadable.map((u) => u.name)).toEqual(['gone.stb']);
  });

  it('works for the session when the device store is unavailable', async () => {
    const broken: SupportPersistence = {
      load: () => Promise.reject(new Error('no OPFS')),
      put: () => Promise.reject(new Error('no OPFS')),
      remove: () => Promise.reject(new Error('no OPFS')),
    };
    const s = new SupportFileStore(PLOT_STYLE_FILES, broken);
    await s.load();
    await s.add('Office.ctb', CTB);
    expect(s.file('Office.ctb')).toEqual(CTB);
    expect(s.getSnapshot().error).toMatch(/could not be kept on this device/);
  });

  it('gives the Plot dialog the tables it keeps, read once per change (M2-17 part 3)', async () => {
    const s = new SupportFileStore(PLOT_STYLE_FILES, memory());
    await s.add('Office.ctb', CTB);
    await s.add('named.STB', STB);
    const tables = plotStyleTablesIn(s);
    expect([...tables.keys()].sort()).toEqual(['Office.ctb', 'named.STB']);
    expect(tables.get('Office.ctb')!.description).toBe('Triya: plot every object black');
    expect(tables.get('named.STB')!.kind).toBe('stb');
    expect(plotStyleTablesIn(s)).toBe(tables);
    await s.remove('Office.ctb');
    expect([...plotStyleTablesIn(s).keys()]).toEqual(['named.STB']);
  });

  it('recognises plot style tables by extension', () => {
    expect(['a.ctb', 'B.STB', 'monochrome.Ctb'].every(PLOT_STYLE_FILES.accepts)).toBe(true);
    expect(PLOT_STYLE_FILES.accepts('a.lin')).toBe(false);
    expect(PLOT_STYLE_FILES.accepts('a.ctb.zip')).toBe(false);
  });
});

describe('linetype file store', () => {
  it('adds a .lin file and lists its linetypes, skipping a definition with errors', async () => {
    const db = memory();
    const s = new SupportFileStore(LINETYPE_FILES, db);
    await s.add('mine.lin', LIN);
    expect(s.getSnapshot().notice).toBe(
      'Added 2 linetypes from mine.lin: BORDER2, FENCE. Skipped 1 with errors.',
    );
    expect(listed(s)).toEqual([['mine.lin', 'BORDER2, FENCE']]);
    expect(db.rows.map((r) => r.name)).toEqual(['mine.lin']);
  });

  it('reads the file as AutoCAD writes it, in its ANSI code page', async () => {
    const s = new SupportFileStore(LINETYPE_FILES, memory());
    // "*MAUER,Mauer ‒ ..." with a Latin-1 "ü" in the name.
    const latin1 = new Uint8Array([...enc('*M'), 0xdc, ...enc('LL,x\nA,.5,-.25\n')]);
    await s.add('de.lin', latin1);
    expect(listed(s)).toEqual([['de.lin', 'MÜLL']]);
  });

  it('refuses a file with no linetype and says why', async () => {
    const s = new SupportFileStore(LINETYPE_FILES, memory());
    await s.add('empty.lin', enc(';; nothing here\n'));
    expect(s.getSnapshot().error).toBe('empty.lin holds no linetype.');
    await s.add('bad.lin', enc('*ONLY\n'));
    expect(s.getSnapshot().error).toBe(
      'bad.lin holds no linetype (line 1: *ONLY has no pattern line).',
    );
    expect(listed(s)).toEqual([]);
  });

  it('shortens a long list of linetypes', async () => {
    const many = Array.from({ length: 12 }, (_, i) => `*T${i + 1}\nA,.5,-.25`).join('\n');
    const s = new SupportFileStore(LINETYPE_FILES, memory());
    await s.add('many.lin', enc(many));
    expect(listed(s)).toEqual([['many.lin', 'T1, T2, T3, T4, T5, T6, T7, T8 and 4 more']]);
  });
});

describe('opfsSupportFiles', () => {
  it("keeps each kind in its own folder and reads every kept file it can, naming the ones it can't", async () => {
    const asked: string[] = [];
    const file = (name: string, bytes: Uint8Array | Error) => ({
      kind: 'file' as const,
      name,
      getFile: () =>
        bytes instanceof Error
          ? Promise.reject(bytes)
          : Promise.resolve(new Blob([bytes as Uint8Array<ArrayBuffer>])),
    });
    const entries = [
      file('Office.ctb', CTB),
      file('gone.stb', new DOMException('The file changed', 'NotReadableError')),
      file('notes.txt', CTB),
    ];
    const folder = {
      async *values() {
        yield* entries;
      },
    };
    const storage = {
      getDirectory: () =>
        Promise.resolve({
          getDirectoryHandle: (name: string) => {
            asked.push(name);
            return Promise.resolve(folder);
          },
        }),
    } as unknown as StorageManager;
    const { files, unreadable } = await opfsSupportFiles(PLOT_STYLE_FILES, storage).load();
    expect(asked).toEqual(['plotstyles']);
    expect(files.map((f) => f.name)).toEqual(['Office.ctb']);
    expect(unreadable).toEqual([
      { name: 'gone.stb', problem: 'could not be read (The file changed)' },
    ]);
    await opfsSupportFiles(LINETYPE_FILES, storage).load();
    expect(asked).toEqual(['plotstyles', 'linetypes']);
  });
});
