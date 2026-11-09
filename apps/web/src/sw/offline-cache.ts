// The service worker's cache (M2-19, PRD FR-F10 and T1, ARCHITECTURE.md §14, DEC-052). The
// files of one build are known when it is built (`pwa-plugin.ts` writes their list into
// `sw.js`): the app shell and the core engine are cached when the worker installs, so the app
// starts with no connection, and pdf.js (only needed for PDF underlays) is fetched the first
// time it is used or by the warm-up that runs once the worker is active. When every file is in
// the cache the app shows "Ready offline".
//
// The browser objects are reached through the small interfaces below, so this file has no
// imports and Vitest drives it with in-memory caches and a fake server.

export const CACHE_PREFIX = 'triya-offline-';

export interface OfflineAssets {
  /** Names the cache; a new build has a new one, and activating it removes the old. */
  readonly version: string;
  /** Cached on install: the install fails, keeping the previous version, if one is missing. */
  readonly core: readonly string[];
  /** Cached on first use, or by the warm-up. */
  readonly lazy: readonly string[];
}

/** pdf.js and its worker, loaded only when a PDF underlay is drawn (M1-20). */
const LAZY = /^assets\/pdf[.-]/;
const LEFT_OUT = /(\.map|^sw\.js)$/;

/** The offline files of a build, from the paths of its output folder. */
export function offlineAssets(files: readonly string[]): OfflineAssets {
  const paths = files
    .map((f) => f.replaceAll('\\', '/').replace(/^\/+/, ''))
    .filter((f) => !LEFT_OUT.test(f))
    .sort();
  // The shell is cached as the app's start URL, which every navigation is served.
  const url = (f: string) => (f === 'index.html' ? '/' : `/${f}`);
  const core = paths.filter((f) => !LAZY.test(f)).map(url);
  const lazy = paths.filter((f) => LAZY.test(f)).map(url);
  // The paths carry Vite's content hashes, so they name the build; index.html's own content is
  // covered by the hashed files it loads.
  return { version: hash(paths.join('\n')), core: core.sort(), lazy };
}

/** FNV-1a, 32 bits, in base 36: a short stable name, not a security measure. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export interface CacheLike {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

export interface OfflineProgress {
  readonly cached: number;
  readonly total: number;
}

/** A request the worker was asked to answer; `navigate` for a page load. */
export interface Fetched {
  readonly request: Request;
  readonly navigate: boolean;
}

export class OfflineCache {
  readonly #name: string;
  readonly #known: ReadonlySet<string>;
  readonly #lazy: ReadonlySet<string>;

  constructor(
    readonly assets: OfflineAssets,
    private readonly caches: CacheStorageLike,
    private readonly fetch: (request: Request) => Promise<Response>,
    private readonly origin: string,
  ) {
    this.#name = `${CACHE_PREFIX}${assets.version}`;
    this.#known = new Set(assets.core);
    this.#lazy = new Set(assets.lazy);
  }

  /**
   * Caches every core file. Vite's `assets/` files carry their content hash in their names, so
   * the copies the page just loaded are taken from the HTTP cache; the shell, the manifest and
   * the icons keep their names between versions and are read past it, so the cached shell
   * always matches the scripts it loads.
   */
  async install(): Promise<void> {
    const cache = await this.caches.open(this.#name);
    await Promise.all(
      this.assets.core.map(async (path) => {
        // (Typed loosely: this file is also compiled for Node by the build plugin.)
        const init = { cache: path.startsWith('/assets/') ? 'default' : 'reload' } as RequestInit;
        const res = await this.fetch(new Request(new URL(path, this.origin), init));
        if (!res.ok) throw new Error(`${path}: ${res.status}`);
        await cache.put(path, res);
      }),
    );
  }

  /** Removes the caches of earlier builds. */
  async activate(): Promise<void> {
    const names = await this.caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith(CACHE_PREFIX) && n !== this.#name)
        .map((n) => this.caches.delete(n)),
    );
  }

  /**
   * The answer to a request, or undefined to leave it to the network: the worker answers only
   * GETs of this build's files and page loads in its scope.
   */
  respond({ request, navigate }: Fetched): Promise<Response> | undefined {
    if (request.method !== 'GET') return undefined;
    const url = new URL(request.url);
    if (url.origin !== this.origin) return undefined;
    if (navigate) return this.#cached('/', request);
    if (this.#known.has(url.pathname)) return this.#cached(url.pathname, request);
    if (this.#lazy.has(url.pathname)) return this.#lazily(url.pathname, request);
    return undefined;
  }

  /** How many of the build's files are cached. */
  async status(): Promise<OfflineProgress> {
    const cache = await this.#existing();
    const all = [...this.assets.core, ...this.assets.lazy];
    if (!cache) return { cached: 0, total: all.length };
    const hits = await Promise.all(all.map((p) => cache.match(p)));
    return { cached: hits.filter(Boolean).length, total: all.length };
  }

  /**
   * Caches the lazy files not yet cached, one at a time so the app's own loading comes first,
   * reporting after each; stops at the first that cannot be fetched (no connection).
   */
  async warm(progress: (p: OfflineProgress) => void): Promise<OfflineProgress> {
    const cache = await this.#existing();
    if (!cache) return this.status();
    for (const path of this.assets.lazy) {
      if (await cache.match(path)) continue;
      try {
        const res = await this.fetch(new Request(new URL(path, this.origin)));
        if (!res.ok) break;
        await cache.put(path, res);
      } catch {
        break;
      }
      progress(await this.status());
    }
    return this.status();
  }

  /**
   * This version's cache, unless it is gone: "Clear all local data" (M2-20) deletes it and
   * unregisters the worker, which still answers its page until the page goes; opening the
   * cache then would make it again.
   */
  async #existing(): Promise<CacheLike | undefined> {
    if (!(await this.caches.keys()).includes(this.#name)) return undefined;
    return this.caches.open(this.#name);
  }

  async #cached(path: string, request: Request): Promise<Response> {
    const cache = await this.#existing();
    return (await cache?.match(path)) ?? this.fetch(request);
  }

  async #lazily(path: string, request: Request): Promise<Response> {
    const cache = await this.#existing();
    const hit = await cache?.match(path);
    if (hit) return hit;
    const res = await this.fetch(request);
    if (res.ok) await cache?.put(path, res.clone());
    return res;
  }
}
