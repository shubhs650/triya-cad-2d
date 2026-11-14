// A pasted picture's PNG travels with the drawing (M2-72, DEC-056). PASTECLIP pastes another
// app's picture as an IMAGE whose IMAGEDEF names `pasted-<hash>.png` with no folder, and the app
// keeps that file on this device only (pasted-pictures.ts). A drawing sent to someone else would
// show the picture's frame and file name, so a save that names kept pictures offers to write
// them beside the DXF, where AutoCAD (and Triya, M1-21) looks for a file named without a folder:
// - With File System Access, the offer asks for the folder the DXF was saved in (the folder
//   picker opens there). The save picker's gesture is spent on the DXF and the picker gives no
//   folder of a file, hence a second click. The folder is asked once per drawing: later saves
//   to the same file, or into the same folder, write the pictures again without asking.
// - Without it (or when the save was a download), the offer downloads the pictures.
// An offer turned down is not made again for the same pictures of that drawing. The References
// palette saves one kept picture's file wherever the user picks (`saveOne`).
import type { ReferenceRow } from './xrefs';
import type { SaveHandle } from './save';
import { isPastedPictureName } from './pasted-pictures';
import { fileKey } from './underlay/pages';

type Permission = 'granted' | 'denied' | 'prompt';

/** The parts of a File System Access folder handle the pictures use. */
export interface FolderHandle {
  readonly kind: 'directory';
  readonly name: string;
  getFileHandle(name: string, o: { create: true }): Promise<SaveHandle>;
  /** The path from the folder to `h`, null when `h` is not inside it. */
  resolve?(h: SaveHandle): Promise<string[] | null>;
  queryPermission?(d: { mode: 'readwrite' }): Promise<Permission>;
}

/** What writing the pictures needs of the browser; the app's is `browserPictureFiles`. */
export interface PictureFilesEnv {
  /** The folder picker, opened at the saved drawing; undefined when cancelled. */
  pickFolder?(startIn: SaveHandle | undefined): Promise<FolderHandle | undefined>;
  /** The save picker for one PNG; undefined when cancelled. */
  pickFile?(name: string, startIn: SaveHandle | undefined): Promise<SaveHandle | undefined>;
  download(name: string, bytes: Uint8Array): void;
}

/** An offer to write the pictures a save named, waiting for the user. */
export interface PictureOffer {
  readonly doc: number;
  /** The drawing as saved: its file name. */
  readonly drawing: string;
  /** The pasted pictures' file names. */
  readonly pictures: readonly string[];
  /** `folder` asks for the drawing's folder; `download` downloads the pictures. */
  readonly way: 'folder' | 'download';
}

/** The pasted pictures among the drawing's own references (not its xrefs'), each once. */
export function pastedPicturesOf(rows: readonly ReferenceRow[]): string[] {
  const names = new Map<string, string>();
  for (const r of rows) {
    if (r.depth !== 0 || r.kind !== 'image' || !isPastedPictureName(r.path)) continue;
    const name = r.path.replace(/^.*[\\/]/, '');
    if (!names.has(fileKey(name))) names.set(fileKey(name), name);
  }
  return [...names.values()];
}

const plural = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`);

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function writeFile(h: SaveHandle, bytes: Uint8Array): Promise<void> {
  if (!h.createWritable) throw new Error(`${h.name} cannot be written`);
  const w = await h.createWritable();
  await w.write(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
  await w.close();
}

/** An offer with the DXF its save wrote, where the folder picker opens. */
type HeldOffer = PictureOffer & { readonly file: SaveHandle | undefined };

interface DocPictures {
  /** The folder picked for the drawing, and the DXF it was picked for. */
  folder?: { readonly handle: FolderHandle; readonly file: SaveHandle };
  /** Pictures whose offer was turned down. */
  readonly declined: Set<string>;
  /** Pictures downloaded already (saves that download). */
  readonly downloaded: Set<string>;
}

export class PictureFiles {
  readonly #bytes: (name: string) => Promise<Uint8Array | undefined>;
  readonly #env: () => PictureFilesEnv;
  readonly #docs = new Map<number, DocPictures>();
  readonly #listeners = new Set<() => void>();
  #offer: HeldOffer | undefined;

  /**
   * `bytes` gives a kept picture's file (undefined when this device holds none of that name);
   * `env` the browser's pickers and downloads, asked for when first needed.
   */
  constructor(
    bytes: (name: string) => Promise<Uint8Array | undefined>,
    env: () => PictureFilesEnv,
  ) {
    this.#bytes = bytes;
    this.#env = env;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** The offer waiting for the user, if any. */
  readonly get = (): PictureOffer | undefined => this.#offer;

  #set(offer: HeldOffer | undefined): void {
    this.#offer = offer;
    for (const l of this.#listeners) l();
  }

  #doc(doc: number): DocPictures {
    let d = this.#docs.get(doc);
    if (!d) this.#docs.set(doc, (d = { declined: new Set(), downloaded: new Set() }));
    return d;
  }

  /** The pictures of `names` this device keeps, with their bytes. */
  async #kept(names: readonly string[]): Promise<[string, Uint8Array][]> {
    const out: [string, Uint8Array][] = [];
    for (const name of names) {
      const bytes = await this.#bytes(name).catch(() => undefined);
      if (bytes) out.push([name, bytes]);
    }
    return out;
  }

  /**
   * A save of `doc` wrote `drawing`, to `file` (undefined: downloaded), naming the pasted
   * pictures `pictures`. Writes them beside it when the drawing's folder was picked already,
   * else offers to. What to tell the user when the pictures were written; undefined otherwise.
   */
  async saved(
    doc: number,
    drawing: string,
    file: SaveHandle | undefined,
    pictures: readonly string[],
  ): Promise<string | undefined> {
    if (this.#offer?.doc === doc) this.#set(undefined);
    const kept = await this.#kept(pictures);
    if (kept.length === 0) return undefined;
    const d = this.#doc(doc);
    if (file && d.folder && (await this.#beside(d.folder, file))) {
      try {
        for (const [name, bytes] of kept)
          await writeFile(await d.folder.handle.getFileHandle(name, { create: true }), bytes);
        d.folder = { handle: d.folder.handle, file };
        return `Saved ${drawing} and ${plural(kept.length, 'pasted picture')} beside it.`;
      } catch {
        // The folder went away or its permission did: ask for it again.
        delete d.folder;
      }
    }
    const way = file && this.#env().pickFolder ? 'folder' : 'download';
    const open = kept
      .map(([name]) => name)
      .filter(
        (n) => !d.declined.has(fileKey(n)) && (way === 'folder' || !d.downloaded.has(fileKey(n))),
      );
    if (open.length === 0) return undefined;
    this.#set({ doc, drawing, pictures: open, way, file });
    return undefined;
  }

  /** The drawing's folder still holds `file` (the one saved), and may be written unasked. */
  async #beside(folder: NonNullable<DocPictures['folder']>, file: SaveHandle): Promise<boolean> {
    const permission = await folder.handle
      .queryPermission?.({ mode: 'readwrite' })
      .catch(() => 'denied');
    if (permission !== undefined && permission !== 'granted') return false;
    if (folder.file === file) return true;
    const path = await folder.handle.resolve?.(file).catch(() => null);
    return path?.length === 1;
  }

  /**
   * The offer's button, on the user's click: picks the drawing's folder and writes the pictures
   * there, or downloads them. What to tell the user; undefined when the picker was cancelled
   * (the offer stays).
   */
  async accept(): Promise<string | undefined> {
    const offer = this.#offer;
    if (!offer) return undefined;
    const d = this.#doc(offer.doc);
    const kept = await this.#kept(offer.pictures);
    const env = this.#env();
    if (offer.way === 'download' || !env.pickFolder) {
      for (const [name, bytes] of kept) {
        env.download(name, bytes);
        d.downloaded.add(fileKey(name));
      }
      this.#set(undefined);
      return `Downloaded ${plural(kept.length, 'pasted picture')}: keep ${kept.length === 1 ? 'it' : 'them'} in the folder of ${offer.drawing}.`;
    }
    let folder: FolderHandle | undefined;
    try {
      folder = await env.pickFolder(offer.file);
    } catch (e) {
      if (isAbort(e)) return undefined;
      this.#set(undefined);
      return `The pasted pictures were not saved: ${reason(e)}`;
    }
    if (!folder) return undefined;
    this.#set(undefined);
    try {
      for (const [name, bytes] of kept)
        await writeFile(await folder.getFileHandle(name, { create: true }), bytes);
    } catch (e) {
      return `The pasted pictures were not saved: ${reason(e)}`;
    }
    const pictures = plural(kept.length, 'pasted picture');
    const path = offer.file && (await folder.resolve?.(offer.file).catch(() => null));
    if (offer.file && path !== undefined && path?.length !== 1) {
      // Written where the user said, but the drawing will not find them there.
      return `Saved ${pictures} in ${folder.name}, which does not hold ${offer.drawing}: the drawing finds them only beside it.`;
    }
    if (offer.file) d.folder = { handle: folder, file: offer.file };
    return `Saved ${pictures} beside ${offer.drawing}.`;
  }

  /** The offer was turned down: it is not made again for these pictures of the drawing. */
  decline(): void {
    const offer = this.#offer;
    if (!offer) return;
    const d = this.#doc(offer.doc);
    for (const name of offer.pictures) d.declined.add(fileKey(name));
    this.#set(undefined);
  }

  /**
   * The References palette's Save file: one kept picture, to a file the user picks (the save
   * picker, opened beside `startIn`), or downloaded. What to tell the user; undefined when
   * cancelled.
   */
  async saveOne(name: string, startIn: SaveHandle | undefined): Promise<string | undefined> {
    const [kept] = await this.#kept([name]);
    if (!kept) return `${name} is not kept on this device.`;
    const env = this.#env();
    if (!env.pickFile) {
      env.download(name, kept[1]);
      return `Downloaded ${name}.`;
    }
    let target: SaveHandle | undefined;
    try {
      target = await env.pickFile(name, startIn);
    } catch (e) {
      if (isAbort(e)) return undefined;
      return `${name} was not saved: ${reason(e)}`;
    }
    if (!target) return undefined;
    try {
      await writeFile(target, kept[1]);
    } catch (e) {
      return `${target.name} was not saved: ${reason(e)}`;
    }
    return `Saved ${target.name}.`;
  }

  /** The drawing closed. */
  forget(doc: number): void {
    this.#docs.delete(doc);
    if (this.#offer?.doc === doc) this.#set(undefined);
  }
}
