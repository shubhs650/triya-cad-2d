// The user's font files (M1-38 TrueType/OpenType, M1-37 SHX): dropped on the window or picked
// in Settings. A text style naming one by file name draws with it instead of its bundled
// stand-in, in every open drawing (ARCHITECTURE.md §8: the user font store comes before the
// bundled Hershey fonts). They stay on this device (PRD §9): kept in the origin-private file
// system, never uploaded, and read back on the next visit.
import { fontBookOf, type FontSources } from '@triya/render';
import { BUNDLED_FONTS } from './fonts';

export const isFontFile = (name: string): boolean => /\.(shx|ttf|otf)$/i.test(name);

/** One kept file, by its name as dropped. */
export interface StoredFont {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Where the files are kept between visits. */
export interface FontPersistence {
  load(): Promise<readonly StoredFont[]>;
  put(font: StoredFont): Promise<void>;
  remove(name: string): Promise<void>;
}

export interface UserFont {
  readonly name: string;
  /** What kind of font it is, for the list: "TrueType font", "OpenType font", "SHX font". */
  readonly kind: string;
}

export interface FontState {
  readonly files: readonly UserFont[];
  readonly notice?: string;
  readonly error?: string;
}

const KEEP_FAILED = 'could not be kept on this device; it works until the page is closed';

function kindOf(name: string): string {
  if (/\.ttf$/i.test(name)) return 'TrueType font';
  if (/\.otf$/i.test(name)) return 'OpenType font';
  return 'SHX font';
}

/** AutoCAD file names ignore case, so a file replaces one whose name differs only in case. */
const keyOf = (name: string) => name.toLowerCase();

export class FontStore {
  readonly #persistence: FontPersistence;
  readonly #bundled: FontSources;
  #files: readonly StoredFont[] = [];
  #device: readonly StoredFont[] = [];
  #sources: FontSources;
  #state: FontState = { files: [] };
  #listeners = new Set<() => void>();

  constructor(persistence: FontPersistence, bundled: FontSources = BUNDLED_FONTS) {
    this.#persistence = persistence;
    this.#bundled = bundled;
    this.#sources = bundled;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): FontState => this.#state;

  /** The bundled fonts and the user's files, for `RendererHost`; the same object until they change. */
  sources(): FontSources {
    return this.#sources;
  }

  /** Reads the files kept by earlier visits. Files added meanwhile win over a kept namesake. */
  async load(): Promise<void> {
    let kept: readonly StoredFont[];
    try {
      kept = await this.#persistence.load();
    } catch {
      return;
    }
    const added = new Set(this.#files.map((f) => keyOf(f.name)));
    this.#set([...kept.filter((f) => !added.has(keyOf(f.name))), ...this.#files]);
  }

  async add(name: string, bytes: Uint8Array): Promise<void> {
    const failed: string[] = [];
    fontBookOf({ files: [{ name, bytes }] }, failed);
    if (failed.length > 0) {
      this.#update({ error: `${name} is not a font Triya can read.` });
      return;
    }
    const old = this.#files.find((f) => keyOf(f.name) === keyOf(name));
    const font: StoredFont = { name, bytes };
    this.#set([...this.#files.filter((f) => f !== old), font]);
    this.#update({ notice: `Added ${kindOf(name)} ${name}.` });
    try {
      if (old && old.name !== name) await this.#persistence.remove(old.name);
      await this.#persistence.put(font);
    } catch {
      this.#update({ error: `${name} ${KEEP_FAILED}.` });
    }
  }

  async remove(name: string): Promise<void> {
    const kept = this.#files.find((f) => keyOf(f.name) === keyOf(name));
    if (!kept) return;
    this.#set(this.#files.filter((f) => f !== kept));
    try {
      await this.#persistence.remove(kept.name);
    } catch {
      // Removed for this session; nothing else can be done about the device store.
    }
  }

  /**
   * Fonts installed on this computer (M1-38 part 2, `DeviceFonts`), handed on after the user's
   * files and never kept: they come from the device on each visit. One whose file name a user
   * file also has is left out, so the user's file wins.
   */
  setDeviceFonts(files: readonly StoredFont[]): void {
    if (files === this.#device) return;
    this.#device = files;
    this.#set(this.#files);
  }

  dismiss(): void {
    this.#state = { files: this.#state.files };
    this.#emit();
  }

  #set(files: readonly StoredFont[]): void {
    this.#files = [...files].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
    // FontBook looks files up without their extension, so arial.otf serves arial.ttf too.
    const stem = (name: string) => keyOf(name).replace(/\.(shx|ttf|otf)$/, '');
    const own = new Set(this.#files.map((f) => stem(f.name)));
    // User files first: FontBook keeps the first face added for a family and style.
    this.#sources = {
      ...this.#bundled,
      files: [...this.#files, ...this.#device.filter((f) => !own.has(stem(f.name)))],
    };
    this.#state = {
      ...this.#state,
      files: this.#files.map((f) => ({ name: f.name, kind: kindOf(f.name) })),
    };
    this.#emit();
  }

  #update(message: { notice?: string; error?: string }): void {
    this.#state = { files: this.#state.files, ...message };
    this.#emit();
  }

  #emit(): void {
    for (const l of this.#listeners) l();
  }
}

/** A directory handle's entries; the DOM typings here lack its async iterator. */
type Listable = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemFileHandle | FileSystemDirectoryHandle>;
};

/** The files in this origin's private file system, folder `fonts`, one file per font. */
export function opfsFonts(
  storage: StorageManager | undefined = globalThis.navigator?.storage,
): FontPersistence {
  const folder = async (): Promise<Listable> => {
    if (!storage?.getDirectory) throw new Error('the origin-private file system is unavailable');
    const root = await storage.getDirectory();
    return (await root.getDirectoryHandle('fonts', { create: true })) as Listable;
  };
  return {
    load: async () => {
      const out: StoredFont[] = [];
      for await (const handle of (await folder()).values()) {
        if (handle.kind !== 'file' || !isFontFile(handle.name)) continue;
        const file = await (handle as FileSystemFileHandle).getFile();
        out.push({ name: handle.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      }
      return out;
    },
    put: async (font) => {
      const handle = await (await folder()).getFileHandle(font.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(font.bytes as Uint8Array<ArrayBuffer>);
      await writable.close();
    },
    remove: async (name) => {
      await (await folder()).removeEntry(name);
    },
  };
}
