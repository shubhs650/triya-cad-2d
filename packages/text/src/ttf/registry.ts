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

/** A font a source offered but that cannot be used (M1-38): the health report lists these. */
export interface FontWarning {
  /** The source, as `FontSource.name` names it. */
  readonly source: string;
  /** The family or file name that was asked for. */
  readonly font: string;
  /** What went wrong: "could not be read (…)" or "not a usable font (…)". */
  readonly problem: string;
}

export class TtfRegistry {
  readonly #sources: readonly FontSource[];
  readonly #fallbacks: readonly string[];
  readonly #cache = new Map<string, Promise<{ font: TtfFont; source: string } | undefined>>();
  /** Fonts a source could not read or that did not parse, so the health report can name them. */
  readonly warnings: FontWarning[] = [];

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
    const warn = (source: FontSource, problem: string, e: unknown) =>
      this.warnings.push({
        source: source.name,
        font: family,
        problem: `${problem} (${e instanceof Error ? e.message : String(e)})`,
      });
    for (const source of this.#sources) {
      let bytes: Uint8Array | undefined;
      try {
        bytes = await source.load(family, style);
      } catch (e) {
        // A source that offers a file it then cannot read is skipped like one lacking it.
        warn(source, 'could not be read', e);
        continue;
      }
      if (!bytes) continue;
      try {
        return { font: parseTtf(bytes), source: source.name };
      } catch (e) {
        warn(source, 'not a usable font', e);
      }
    }
    return undefined;
  }
}
