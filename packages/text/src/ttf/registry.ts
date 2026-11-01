// Which font file a TrueType text style gets (M1-10). Sources are injected (CLAUDE.md "no
// DOM in the engine"): the app adds the user font store and the browser's local fonts, tests
// use memory. A family not found anywhere falls back through a list, and the result says so,
// for the drawing health report.

import { parseTtf, type TtfFont } from './font';

export interface FontStyleRequest {
  readonly bold: boolean;
  readonly italic: boolean;
}

export interface FontSource {
  /** Shown in warnings and in the resolution result. */
  readonly name: string;
  /** The font file for a family (or file name) and style, or undefined if this source lacks it. */
  load(family: string, style: FontStyleRequest): Promise<Uint8Array | undefined>;
}

export interface ResolvedFont {
  readonly font: TtfFont;
  /** The family that was found: the requested one, or the fallback used. */
  readonly family: string;
  readonly requested: string;
  readonly source: string;
  readonly substituted: boolean;
}

export class TtfRegistry {
  readonly #sources: readonly FontSource[];
  readonly #fallbacks: readonly string[];
  readonly #cache = new Map<string, Promise<{ font: TtfFont; source: string } | undefined>>();
  /** Fonts a source offered that did not parse, so the health report can name them. */
  readonly warnings: string[] = [];

  constructor(sources: readonly FontSource[], fallbacks: readonly string[]) {
    this.#sources = sources;
    this.#fallbacks = fallbacks;
  }

  async resolve(family: string, style: FontStyleRequest): Promise<ResolvedFont | undefined> {
    for (const candidate of [family, ...this.#fallbacks]) {
      const found = await this.#find(candidate, style);
      if (found) {
        return {
          font: found.font,
          family: candidate,
          requested: family,
          source: found.source,
          substituted: candidate !== family,
        };
      }
    }
    return undefined;
  }

  #find(family: string, style: FontStyleRequest) {
    const key = `${family.toLowerCase()}|${style.bold ? 'b' : ''}${style.italic ? 'i' : ''}`;
    let hit = this.#cache.get(key);
    if (!hit) {
      hit = this.#load(family, style);
      this.#cache.set(key, hit);
    }
    return hit;
  }

  async #load(family: string, style: FontStyleRequest) {
    for (const source of this.#sources) {
      const bytes = await source.load(family, style);
      if (!bytes) continue;
      try {
        return { font: parseTtf(bytes), source: source.name };
      } catch (e) {
        this.warnings.push(
          `${source.name}: ${family} is not a usable font (${(e as Error).message})`,
        );
      }
    }
    return undefined;
  }
}
