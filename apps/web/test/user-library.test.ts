// M8-03 part 2: the user's library folders, kept on the device in the origin-private file system
// (folder `library`, one folder of drawing files per library folder). Drawing files dropped on
// the Library palette join a folder (made when there is none); a file of a name the folder has,
// in any case, replaces it; other files are refused; folders are made, named as files are, and
// removed; a reload reads them all back.
import { describe, expect, it } from 'vitest';
import {
  LIBRARY_FOLDER,
  UserLibraryStore,
  folderNameProblem,
  isLibraryDrawing,
  opfsLibrary,
  userBlockMatches,
} from '../src/user-library';

/** An origin-private file system's stand-in: directories of files, as the browser's API has them. */
class FakeDirectory {
  readonly kind = 'directory';
  readonly dirs = new Map<string, FakeDirectory>();
  readonly files = new Map<string, Uint8Array>();
  /** Names whose getFile() fails, as a file another tab is writing does. */
  readonly broken = new Set<string>();
  constructor(readonly name: string) {}

  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectory> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!options?.create) return Promise.reject(new DOMException(name, 'NotFoundError'));
      this.dirs.set(name, (d = new FakeDirectory(name)));
    }
    return Promise.resolve(d);
  }

  getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) return Promise.reject(new DOMException(name, 'NotFoundError'));
      this.files.set(name, new Uint8Array());
    }
    return Promise.resolve(this.#file(name));
  }

  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    if (this.dirs.has(name)) {
      if (!options?.recursive && this.dirs.get(name)!.files.size > 0)
        return Promise.reject(new DOMException(name, 'InvalidModificationError'));
      this.dirs.delete(name);
    } else if (!this.files.delete(name)) {
      return Promise.reject(new DOMException(name, 'NotFoundError'));
    }
    return Promise.resolve();
  }

  async *values() {
    yield* this.dirs.values();
    for (const name of this.files.keys()) yield this.#file(name);
  }

  #file(name: string) {
    return {
      kind: 'file' as const,
      name,
      getFile: () =>
        this.broken.has(name)
          ? Promise.reject(new DOMException('The file changed', 'NotReadableError'))
          : Promise.resolve(new Blob([this.files.get(name)! as Uint8Array<ArrayBuffer>])),
      createWritable: () => {
        let bytes: Uint8Array = new Uint8Array();
        return Promise.resolve({
          write: (b: Uint8Array) => {
            bytes = b;
            return Promise.resolve();
          },
          close: () => {
            this.files.set(name, bytes);
            return Promise.resolve();
          },
        });
      },
    };
  }
}

function device() {
  const root = new FakeDirectory('');
  const storage = { getDirectory: () => Promise.resolve(root) } as unknown as StorageManager;
  return { root, persistence: opfsLibrary(storage) };
}

const DXF = (text: string) => new TextEncoder().encode(text);
const listing = (s: UserLibraryStore) =>
  s.getSnapshot().folders.map((f) => [f.name, f.files.map((x) => x.name)]);
const kept = (root: FakeDirectory) =>
  [...(root.dirs.get('library')?.dirs.values() ?? [])].map((d) => [d.name, [...d.files.keys()]]);

describe('the user library folders (M8-03 part 2)', () => {
  it('keeps drawing files dropped with no folder in My Library, on the device', async () => {
    const { root, persistence } = device();
    const s = new UserLibraryStore(persistence);
    await s.load();
    await s.add(undefined, [
      { name: 'valves.dxf', bytes: DXF('valves') },
      { name: 'Pumps.DWG', bytes: DXF('pumps') },
    ]);
    expect(listing(s)).toEqual([[LIBRARY_FOLDER, ['Pumps.DWG', 'valves.dxf']]]);
    expect(s.getSnapshot().notice).toBe('Added 2 drawings to My Library.');
    expect(kept(root)).toEqual([[LIBRARY_FOLDER, ['valves.dxf', 'Pumps.DWG']]]);
    expect(new TextDecoder().decode(s.bytes(LIBRARY_FOLDER, 'VALVES.DXF'))).toBe('valves');
  });

  it('refuses files that are not drawings, and says which', async () => {
    const s = new UserLibraryStore(device().persistence);
    await s.add(undefined, [
      { name: 'notes.txt', bytes: DXF('x') },
      { name: 'flange.dxf', bytes: DXF('y') },
    ]);
    expect(listing(s)).toEqual([[LIBRARY_FOLDER, ['flange.dxf']]]);
    expect(s.getSnapshot().error).toBe('notes.txt is not a drawing file (DXF or DWG).');
  });

  it('replaces a file of the same name in another case, and gives it a new key', async () => {
    const { root, persistence } = device();
    const s = new UserLibraryStore(persistence);
    await s.add(undefined, [{ name: 'valves.dxf', bytes: DXF('one') }]);
    const before = s.getSnapshot().folders[0]!.files[0]!.key;
    await s.add(LIBRARY_FOLDER, [{ name: 'VALVES.dxf', bytes: DXF('two') }]);
    expect(listing(s)).toEqual([[LIBRARY_FOLDER, ['VALVES.dxf']]]);
    expect(s.getSnapshot().folders[0]!.files[0]!.key).not.toBe(before);
    expect(kept(root)).toEqual([[LIBRARY_FOLDER, ['VALVES.dxf']]]);
    expect(new TextDecoder().decode(s.bytes(LIBRARY_FOLDER, 'valves.dxf'))).toBe('two');
  });

  it('makes folders, sorted, files dropped on one joining it, and removes them', async () => {
    const { root, persistence } = device();
    const s = new UserLibraryStore(persistence);
    expect(await s.addFolder('Piping')).toBe(true);
    expect(await s.addFolder('Electrical')).toBe(true);
    await s.add('Piping', [{ name: 'valves.dxf', bytes: DXF('v') }]);
    expect(listing(s)).toEqual([
      ['Electrical', []],
      ['Piping', ['valves.dxf']],
    ]);
    await s.remove('Piping', 'valves.dxf');
    await s.removeFolder('Electrical');
    expect(listing(s)).toEqual([['Piping', []]]);
    expect(kept(root)).toEqual([['Piping', []]]);
  });

  it('refuses a folder name a file could not have, or one taken in any case', async () => {
    const s = new UserLibraryStore(device().persistence);
    await s.addFolder('Piping');
    expect(await s.addFolder('piping')).toBe(false);
    expect(s.getSnapshot().error).toBe('A folder named piping already exists.');
    expect(folderNameProblem('', [])).toBe('Type a name for the folder.');
    expect(folderNameProblem('  ', [])).toBe('Type a name for the folder.');
    expect(folderNameProblem('a/b', [])).toBe('A folder name cannot contain \\ / : * ? " < > |.');
    expect(folderNameProblem('..', [])).toBe('A folder name cannot be . or ..');
    expect(folderNameProblem('x'.repeat(256), [])).toBe(
      'A folder name has at most 255 characters.',
    );
    expect(folderNameProblem('Valves 2', ['Piping'])).toBeUndefined();
  });

  it('reads the folders back on the next visit, naming a file it cannot read', async () => {
    const { root, persistence } = device();
    const first = new UserLibraryStore(persistence);
    await first.addFolder('Electrical');
    await first.add('Piping', [
      { name: 'valves.dxf', bytes: DXF('v') },
      { name: 'pumps.dxf', bytes: DXF('p') },
    ]);
    root.dirs.get('library')!.dirs.get('Piping')!.broken.add('pumps.dxf');
    const next = new UserLibraryStore(persistence);
    await next.load();
    expect(listing(next)).toEqual([
      ['Electrical', []],
      ['Piping', ['valves.dxf']],
    ]);
    expect(next.getSnapshot().error).toBe('Piping/pumps.dxf could not be read (The file changed).');
    expect(new TextDecoder().decode(next.bytes('Piping', 'valves.dxf'))).toBe('v');
  });

  it('works for the session where the device keeps nothing, and says so', async () => {
    const s = new UserLibraryStore(opfsLibrary(undefined));
    await s.load();
    await s.add(undefined, [{ name: 'valves.dxf', bytes: DXF('v') }]);
    expect(listing(s)).toEqual([[LIBRARY_FOLDER, ['valves.dxf']]]);
    expect(s.getSnapshot().error).toBe(
      'valves.dxf could not be kept on this device; it works until the page is closed.',
    );
  });

  it('recognises drawing files by extension', () => {
    expect(['a.dxf', 'B.DWG'].every(isLibraryDrawing)).toBe(true);
    expect(isLibraryDrawing('a.dxf.zip')).toBe(false);
  });

  it('finds a block by every word of the search, in its name, file or folder', () => {
    const at = { folder: 'Piping', file: 'valves.dxf', block: 'GATE-VALVE' };
    expect(userBlockMatches('', at)).toBe(true);
    expect(userBlockMatches('gate', at)).toBe(true);
    expect(userBlockMatches('VALVES piping', at)).toBe(true);
    expect(userBlockMatches('gate pump', at)).toBe(false);
  });
});
