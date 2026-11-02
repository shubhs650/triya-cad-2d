// Fonts installed on this computer (M1-38 part 2), through the browser's Local Font Access API.
// The browser asks the user first: `queryLocalFonts()` runs from a click in Settings the first
// time, and on later visits only once the permission is already granted, so the app never
// prompts by itself. The list holds names only; a font's bytes are read when an open drawing
// names it, and nothing leaves the device (PRD §9). A denial, or a browser without the API,
// leaves the bundled stand-ins in place without an error.
//
// Order (ARCHITECTURE.md §8): the user's own font files, then these, then the bundled fonts.
// So a drawing's font is looked up here only when no user file serves it, and `TtfRegistry`
// does the looking: it checks each candidate parses and keeps a warning for one that does not.
import {
  TtfRegistry,
  parseMText,
  styleFont,
  type FontSource,
  type FontStyleRequest,
  type MTextFont,
} from '@triya/text';
import type { DocumentInit } from '@triya/engine';
import type { StoredFont } from './user-fonts';

/** The browser's `FontData`: one installed face, its names, and its file on demand. */
export interface LocalFontData {
  readonly family: string;
  readonly fullName: string;
  readonly postscriptName: string;
  /** The face within its family, as the font names it: "Regular", "Bold Italic". */
  readonly style: string;
  blob(): Promise<Blob>;
}

/** Whether the app may read installed fonts: as the browser reports it, never asked for. */
export type LocalFontsPermission = 'unsupported' | 'prompt' | 'granted' | 'denied';

export interface LocalFontAccess {
  permission(): Promise<LocalFontsPermission>;
  /** The installed fonts. The browser may ask the user; a refusal rejects. */
  query(): Promise<readonly LocalFontData[]>;
}

type FontScope = {
  queryLocalFonts?: () => Promise<readonly LocalFontData[]>;
  navigator?: { permissions?: { query(d: { name: string }): Promise<{ state: string }> } };
};

/** The Local Font Access API of this window, as far as the browser has it. */
export function browserFontAccess(scope: FontScope = globalThis as FontScope): LocalFontAccess {
  return {
    permission: async () => {
      if (typeof scope.queryLocalFonts !== 'function') return 'unsupported';
      try {
        const { state } = (await scope.navigator?.permissions?.query({ name: 'local-fonts' })) ?? {
          state: 'prompt',
        };
        return state === 'granted' || state === 'denied' ? state : 'prompt';
      } catch {
        // A browser that has the API but not the permission name: asking is the only way to know.
        return 'prompt';
      }
    },
    query: () => {
      if (typeof scope.queryLocalFonts !== 'function') {
        return Promise.reject(new Error('this browser cannot list installed fonts'));
      }
      return scope.queryLocalFonts();
    },
  };
}

/**
 * Windows font file names, as AutoCAD styles store them, and the face each one is. The API
 * gives family and face names, never file names. A file name not listed here is matched to a
 * face's PostScript or full name, then taken as a family name (`isocpeur.ttf` → ISOCPEUR).
 */
const WINDOWS_FILES: Readonly<Record<string, readonly [string, 'r' | 'b' | 'i' | 'bi']>> = {
  arial: ['Arial', 'r'],
  arialbd: ['Arial', 'b'],
  ariali: ['Arial', 'i'],
  arialbi: ['Arial', 'bi'],
  ariblk: ['Arial Black', 'r'],
  arialn: ['Arial Narrow', 'r'],
  arialnb: ['Arial Narrow', 'b'],
  arialni: ['Arial Narrow', 'i'],
  arialnbi: ['Arial Narrow', 'bi'],
  times: ['Times New Roman', 'r'],
  timesbd: ['Times New Roman', 'b'],
  timesi: ['Times New Roman', 'i'],
  timesbi: ['Times New Roman', 'bi'],
  cour: ['Courier New', 'r'],
  courbd: ['Courier New', 'b'],
  couri: ['Courier New', 'i'],
  courbi: ['Courier New', 'bi'],
  calibri: ['Calibri', 'r'],
  calibrib: ['Calibri', 'b'],
  calibrii: ['Calibri', 'i'],
  calibriz: ['Calibri', 'bi'],
  verdana: ['Verdana', 'r'],
  verdanab: ['Verdana', 'b'],
  verdanai: ['Verdana', 'i'],
  verdanaz: ['Verdana', 'bi'],
  tahoma: ['Tahoma', 'r'],
  tahomabd: ['Tahoma', 'b'],
  segoeui: ['Segoe UI', 'r'],
  segoeuib: ['Segoe UI', 'b'],
  segoeuii: ['Segoe UI', 'i'],
  segoeuiz: ['Segoe UI', 'bi'],
  consola: ['Consolas', 'r'],
  consolab: ['Consolas', 'b'],
  consolai: ['Consolas', 'i'],
  consolaz: ['Consolas', 'bi'],
  georgia: ['Georgia', 'r'],
  georgiab: ['Georgia', 'b'],
  georgiai: ['Georgia', 'i'],
  georgiaz: ['Georgia', 'bi'],
  trebuc: ['Trebuchet MS', 'r'],
  trebucbd: ['Trebuchet MS', 'b'],
  trebucit: ['Trebuchet MS', 'i'],
  trebucbi: ['Trebuchet MS', 'bi'],
  comic: ['Comic Sans MS', 'r'],
  comicbd: ['Comic Sans MS', 'b'],
  lucon: ['Lucida Console', 'r'],
  l_10646: ['Lucida Sans Unicode', 'r'],
  micross: ['Microsoft Sans Serif', 'r'],
  century: ['Century', 'r'],
  gothic: ['Century Gothic', 'r'],
};

const TRUETYPE_FILE = /\.(ttf|otf|ttc)$/i;
/** Names compared without case, spaces or punctuation: "Arial-BoldMT" ~ "arial boldmt". */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const stemOf = (name: string) =>
  (name.split(/[\\/]/).pop() ?? name).replace(TRUETYPE_FILE, '').toLowerCase();
const faceStyle = (f: LocalFontData): FontStyleRequest => ({
  bold: /bold|black|heavy/i.test(f.style),
  italic: /italic|oblique/i.test(f.style),
});

/** The family's face closest to a style: bold and italic matched, else the plainest. */
function pickFace(
  fonts: readonly LocalFontData[],
  family: string,
  style: FontStyleRequest,
): LocalFontData | undefined {
  const key = norm(family);
  let best: LocalFontData | undefined;
  let bestScore = -1;
  for (const f of fonts) {
    if (norm(f.family) !== key) continue;
    const s = faceStyle(f);
    // Bold and italic first; then a face named plainly ("Regular") over "Light" or "Narrow".
    const score =
      4 * Number(s.bold === style.bold) +
      4 * Number(s.italic === style.italic) +
      Number(/^(regular|normal|roman|book)$/i.test(f.style) || f.style === '');
    if (score > bestScore) [best, bestScore] = [f, score];
  }
  return best;
}

/** The installed face a style's font names: a file name (`arialbd.ttf`) or a family (`Arial`). */
export function matchLocalFont(
  fonts: readonly LocalFontData[],
  name: string,
  style: FontStyleRequest,
): LocalFontData | undefined {
  if (!TRUETYPE_FILE.test(name)) {
    return pickFace(fonts, name, style) ?? fonts.find((f) => norm(f.fullName) === norm(name));
  }
  const stem = stemOf(name);
  const known = Object.hasOwn(WINDOWS_FILES, stem) ? WINDOWS_FILES[stem] : undefined;
  if (known) {
    const [family, face] = known;
    return pickFace(fonts, family, { bold: face.includes('b'), italic: face.includes('i') });
  }
  const exact =
    fonts.find((f) => norm(f.postscriptName) === norm(stem)) ??
    fonts.find((f) => norm(f.fullName) === norm(stem));
  return exact ?? pickFace(fonts, stem, style);
}

/** The TrueType fonts a drawing's text asks for: its styles' fonts and MTEXT `\f` families. */
export function trueTypeFontsOf(init: Pick<DocumentInit, 'tables' | 'entities'>): MTextFont[] {
  const out = new Map<string, MTextFont>();
  const add = (f: MTextFont) => {
    if (f.kind === 'ttf' || TRUETYPE_FILE.test(f.name)) {
      out.set(`${f.name.toLowerCase()}|${Number(f.bold)}${Number(f.italic)}`, f);
    }
  };
  for (const s of init.tables?.textStyles ?? []) {
    if (!s.font) continue;
    add(styleFont(s));
  }
  const base = {
    font: styleFont({ font: '', trueTypeFlags: 0 }),
    height: 1,
    widthFactor: 1,
    oblique: 0,
  };
  for (const e of init.entities ?? []) {
    const g = e.geom;
    // Only `\f` (TrueType) codes name families; skip parsing MTEXT without one.
    if (g.kind !== 'MTEXT' || !/\\f/.test(g.contents)) continue;
    for (const p of parseMText(g.contents, base).paragraphs) {
      for (const item of p.items) if (item.style.font.name) add(item.style.font);
    }
  }
  return [...out.values()];
}

export interface DeviceFontsState {
  readonly permission: LocalFontsPermission;
  /** The installed faces drawn with, by the font name a drawing asked for. */
  readonly used: readonly { readonly requested: string; readonly face: string }[];
}

const requestKey = (f: MTextFont) => `${f.name.toLowerCase()}|${Number(f.bold)}${Number(f.italic)}`;

/**
 * Installed fonts for the fonts the open drawings name. `need` says which those are; once
 * the permission is granted, each is looked up once and read when found. `files` are the
 * faces to draw with, named so `fontBookOf` finds them (a file request by its file name, a
 * family request by the face's PostScript name with `.ttf`).
 */
export class DeviceFonts {
  readonly #access: LocalFontAccess;
  #state: DeviceFontsState = { permission: 'unsupported', used: [] };
  #installed: readonly LocalFontData[] | undefined;
  readonly #needed = new Map<string, MTextFont>();
  readonly #tried = new Set<string>();
  /** The faces read, by the name each is handed on under, and which face that is. */
  readonly #read = new Map<string, { readonly font: StoredFont; readonly face: string }>();
  #files: readonly StoredFont[] = [];
  /** What the registry's source read for each request, so the bytes are read once. */
  readonly #picked = new Map<
    string,
    { readonly face: LocalFontData; readonly bytes: Uint8Array }
  >();
  readonly #registry: TtfRegistry;
  readonly #listeners = new Set<() => void>();
  #pending: Promise<void> = Promise.resolve();

  constructor(access: LocalFontAccess) {
    this.#access = access;
    const source: FontSource = {
      name: 'This computer',
      load: async (name, style) => {
        const face = this.#installed && matchLocalFont(this.#installed, name, style);
        if (!face) return undefined;
        const bytes = new Uint8Array(await (await face.blob()).arrayBuffer());
        this.#picked.set(`${name.toLowerCase()}|${Number(style.bold)}${Number(style.italic)}`, {
          face,
          bytes,
        });
        return bytes;
      },
    };
    // No fallbacks: a font not installed draws with its bundled stand-in (FontBook).
    this.#registry = new TtfRegistry([source], []);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): DeviceFontsState => this.#state;

  /** Installed faces that were offered but did not parse (`TtfRegistry.warnings`). */
  get warnings(): readonly string[] {
    return this.#registry.warnings;
  }

  /** The faces read so far; the same array until one is added. */
  files(): readonly StoredFont[] {
    return this.#files;
  }

  /** Reads the permission; if already granted, lists the fonts without asking. */
  async init(): Promise<void> {
    const permission = await this.#access.permission();
    this.#set({ permission });
    if (permission === 'granted') await this.#list();
  }

  /** From a click: lets the browser ask the user, then uses what they allow. */
  allow(): Promise<void> {
    return this.#list();
  }

  /** The fonts the open drawings name; ones not looked up yet are, once fonts are allowed. */
  need(fonts: Iterable<MTextFont>): Promise<void> {
    for (const f of fonts) this.#needed.set(requestKey(f), f);
    return this.#resolve();
  }

  /** Settles once the lookups asked for so far are done. */
  settled(): Promise<void> {
    return this.#pending;
  }

  async #list(): Promise<void> {
    try {
      this.#installed = await this.#access.query();
    } catch {
      // Refused, or no gesture: the bundled stand-ins keep drawing; Settings says so.
      this.#set({ permission: 'denied' });
      return;
    }
    this.#set({ permission: 'granted' });
    await this.#resolve();
  }

  #resolve(): Promise<void> {
    this.#pending = this.#pending.then(async () => {
      if (!this.#installed) return;
      let changed = false;
      for (const [key, font] of this.#needed) {
        if (this.#tried.has(key)) continue;
        this.#tried.add(key);
        const style = { bold: font.bold, italic: font.italic };
        const found = await this.#registry.resolve(font.name, style).catch(() => undefined);
        const picked = this.#picked.get(key);
        if (!found || !picked) continue;
        this.#used(font.name, picked.face);
        if (this.#add(font.name, picked.face, picked.bytes)) changed = true;
      }
      if (changed) {
        this.#files = [...this.#read.values()].map((r) => r.font);
        this.#emit();
      }
    });
    return this.#pending;
  }

  /**
   * Keeps a face under the name a request finds it by: a file request by its file name; a
   * family request by the face's PostScript name, unless the face is kept already (FontBook
   * registers every face's family, whatever its file name). A file request for a face kept
   * for a family takes that entry over, so each face is read and sent once.
   */
  #add(requested: string, face: LocalFontData, bytes: Uint8Array): boolean {
    const isFile = TRUETYPE_FILE.test(requested);
    const name = isFile
      ? (requested.split(/[\\/]/).pop() ?? requested)
      : `${face.postscriptName}.ttf`;
    if (this.#read.has(name.toLowerCase())) return false;
    const kept = [...this.#read].find(([, r]) => r.face === face.postscriptName);
    if (kept && !isFile) return false;
    if (kept && kept[0] === `${face.postscriptName}.ttf`.toLowerCase()) this.#read.delete(kept[0]);
    this.#read.set(name.toLowerCase(), { font: { name, bytes }, face: face.postscriptName });
    return true;
  }

  #used(requested: string, face: LocalFontData): void {
    if (this.#state.used.some((u) => u.requested.toLowerCase() === requested.toLowerCase())) return;
    const used = [...this.#state.used, { requested, face: face.fullName }].sort((a, b) =>
      a.requested.localeCompare(b.requested, undefined, { sensitivity: 'base' }),
    );
    this.#state = { ...this.#state, used };
    this.#emit();
  }

  #set(s: Partial<DeviceFontsState>): void {
    this.#state = { ...this.#state, ...s };
    this.#emit();
  }

  #emit(): void {
    for (const l of this.#listeners) l();
  }
}
