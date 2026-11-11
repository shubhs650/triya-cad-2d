// The app's Clipboard and the system clipboard (M2-32 part 5). AutoCAD's COPYCLIP puts the
// objects on the Windows clipboard in its own format, which another AutoCAD session pastes, and
// as a picture, which other apps paste. Triya does the same through the browser's async clipboard:
// the objects as `clipboardData` text under a web custom format (Chromium's "web " formats, which
// only a page that writes them reads) beside a PNG of them, and a paste reads the system
// clipboard first, so whatever was copied last is what pastes:
// - Triya's format from another window: those objects (another drawing's: PASTEORIG takes them);
//   from this window: its own Clipboard, which knows the drawing they came from;
// - text from another app: PASTECLIP pastes it as multiline text (AutoCAD 2024 Help,
//   "PASTECLIP");
// - a picture from another app: AutoCAD pastes it as an OLE object, which Triya has not (OLE is
//   outside the PRD), so it says so;
// - nothing it can read, or no permission to read: the window's own Clipboard, as before.
// Where the browser has no custom formats (Firefox, Safari) nothing is written, and the
// window's Clipboard is all there is: an object's picture alone on the system clipboard would be
// taken for another app's on the next paste.
//
// Reading the system clipboard asks the user's permission once (the browser's prompt), as any
// web app's paste of what another app copied does. Nothing here touches the network.
import {
  clipboardData,
  readClipboardData,
  type Clipboard,
  type Handle,
  type ViewReply,
} from '@triya/engine';
import { encodePng, plotSvg, type PlotItem } from '@triya/pdf';
import { rasterizeSvg, type PlotPart, type PlotRequest } from '@triya/render';

/** Triya's clipboard format: the objects as `clipboardData` text (a Chromium web custom format). */
export const CLIPBOARD_FORMAT = 'web application/x-triya-clipboard';

/** The picture's longer side, pixels, and the white margin around it. */
const PICTURE_SIZE = 1024;
const PICTURE_MARGIN = 8;
/** How long a picture may take before the objects are written without one. */
const PICTURE_TIMEOUT_MS = 5000;

const PICTURE = 'The Clipboard holds a picture, which Triya does not paste.';
const OTHER_VERSION =
  'The Clipboard holds objects from another version of Triya, which this one cannot paste.';

/** The system clipboard as the browser offers it: one item written, the first item read. */
export interface SystemClipboardEnv {
  write(item: Record<string, Blob>): Promise<void>;
  /** The first item: its types and their data; undefined when it holds none. */
  read(): Promise<
    { readonly types: readonly string[]; get(type: string): Promise<Blob> } | undefined
  >;
}

/** The browser's async clipboard, where it takes Triya's custom format; undefined elsewhere. */
export function browserClipboardEnv(): SystemClipboardEnv | undefined {
  const clipboard = globalThis.navigator?.clipboard;
  const Item = globalThis.ClipboardItem as
    (typeof ClipboardItem & { supports?: (type: string) => boolean }) | undefined;
  if (!clipboard?.write || !clipboard.read || !Item?.supports?.(CLIPBOARD_FORMAT)) return undefined;
  return {
    write: (item) => clipboard.write([new Item(item)]),
    async read() {
      const [first] = await clipboard.read();
      if (!first) return undefined;
      return { types: first.types, get: (type) => first.getType(type) };
    },
  };
}

interface Held {
  readonly doc: number;
  readonly content: Clipboard;
  /** What the system clipboard's copy names as its source. */
  readonly source: string;
  /** Whether the objects reached the system clipboard. */
  readonly written: Promise<boolean>;
}

/** Every drawing's Clipboard in one window: what COPYCLIP put there last, and the system's. */
export class AppClipboard {
  readonly #env: SystemClipboardEnv | undefined;
  readonly #window: string;
  #copies = 0;
  #held: Held | undefined;

  constructor(env: SystemClipboardEnv | undefined, window: string) {
    this.#env = env;
    this.#window = window;
  }

  /**
   * Holds `content`, copied in drawing `doc`, and writes it with its `picture` to the system
   * clipboard; resolves once written (or not), which no command waits for.
   */
  copy(doc: number, content: Clipboard, picture: () => Promise<Blob | undefined>): Promise<void> {
    const source = `${this.#window}#${++this.#copies}`;
    const written = this.#env
      ? this.#write(this.#env, content, source, picture)
      : Promise.resolve(false);
    this.#held = { doc, content, source, written };
    return written.then(() => undefined);
  }

  async #write(
    env: SystemClipboardEnv,
    content: Clipboard,
    source: string,
    picture: () => Promise<Blob | undefined>,
  ): Promise<boolean> {
    const item: Record<string, Blob> = {
      // The browser takes a blob only under its own type.
      [CLIPBOARD_FORMAT]: new Blob([clipboardData(content, source)], { type: CLIPBOARD_FORMAT }),
    };
    const png = await withTimeout(
      picture().catch(() => undefined),
      PICTURE_TIMEOUT_MS,
    );
    if (png) item['image/png'] = png;
    try {
      await env.write(item);
      return true;
    } catch {
      return false;
    }
  }

  /** What a paste in drawing `doc` pastes: the reply to the engine's `clipboard` read. */
  async paste(doc: number): Promise<ViewReply> {
    const held = this.#held;
    const own = (): ViewReply =>
      held ? { ok: true, clipboard: held.content, sameDrawing: held.doc === doc } : { ok: true };
    // A copy that did not reach the system clipboard is newer than what is there.
    if (!this.#env || (held && !(await held.written))) return own();
    let item: Awaited<ReturnType<SystemClipboardEnv['read']>>;
    try {
      item = await this.#env.read();
    } catch {
      return own();
    }
    if (!item) return own();
    try {
      if (item.types.includes(CLIPBOARD_FORMAT)) {
        const found = readClipboardData(await (await item.get(CLIPBOARD_FORMAT)).text());
        if (!found) return { ok: false, message: OTHER_VERSION };
        if (held && found.source === held.source) return own();
        return { ok: true, clipboard: found.clipboard, sameDrawing: false };
      }
      if (item.types.includes('text/plain')) {
        return { ok: true, text: await (await item.get('text/plain')).text() };
      }
      if (item.types.some((t) => t.startsWith('image/'))) return { ok: false, message: PICTURE };
    } catch {
      return own();
    }
    return own();
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    void p.then((v) => {
      clearTimeout(timer);
      resolve(v);
    });
  });
}

/**
 * A PNG of the copied objects, as other apps paste it: their plot (objects' own colours, black
 * for the foreground, their lineweights) fitted to their extents, the longer side 1024 pixels, on
 * white with a small margin. Undefined when their extents are not known.
 */
export async function clipboardPicture(
  content: Clipboard,
  plot: (request: PlotRequest) => Promise<PlotPart[]>,
  rasterize: typeof rasterizeSvg = rasterizeSvg,
): Promise<Blob | undefined> {
  const box = content.extents;
  const first = content.entities[0];
  if (!box || !first) return undefined;
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const long = Math.max(w, h);
  const s = long > 0 ? PICTURE_SIZE / long : 1;
  const width = Math.max(1, Math.round(w * s)) + 2 * PICTURE_MARGIN;
  const height = Math.max(1, Math.round(h * s)) + 2 * PICTURE_MARGIN;
  const handles: Handle[] = content.entities.map((e) => e.handle);
  const parts = await plot({ block: first.owner, handles });
  const svg = plotSvg(parts as readonly PlotItem[], {
    toPaper: {
      a: s,
      b: 0,
      c: 0,
      d: s,
      e: PICTURE_MARGIN - box.minX * s,
      f: PICTURE_MARGIN - box.minY * s,
    },
    width,
    height,
    title: 'Triya objects',
  });
  const pixels = await rasterize(svg, { width, height, background: '#ffffff' });
  return new Blob([encodePng(pixels) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
}
