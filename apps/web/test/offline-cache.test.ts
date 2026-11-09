// M2-19 (PRD FR-F10, T1; ARCHITECTURE.md §14, DEC-052): the service worker's cache. The app
// shell and the core engine are cached when the worker installs, so the app starts with no
// connection; pdf.js is fetched the first time it is used, or by the warm-up after activation,
// and the app is "Ready offline" once every file of the build is in the cache.
import { describe, expect, it } from 'vitest';
import {
  CACHE_PREFIX,
  OfflineCache,
  offlineAssets,
  type CacheLike,
  type CacheStorageLike,
} from '../src/sw/offline-cache';

const ORIGIN = 'https://triya.test';

const BUILD = [
  'index.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'assets/index-D4K99R4V.js',
  'assets/index-D4K99R4V.js.map',
  'assets/index-C8kyRc_t.css',
  'assets/io.worker-CIaNE-lB.js',
  'assets/worker-BEzaeONQ.js',
  'assets/pdf-LpZwh9cT.js',
  'assets/pdf.worker.min-CeVT1XOq.js',
  'assets/pdf.worker.min-CjEcRF4W.mjs',
  'sw.js',
  'sw.js.map',
];

describe('offlineAssets', () => {
  it('caches the shell and engine first and pdf.js lazily, leaving out maps and the worker', () => {
    const a = offlineAssets(BUILD);
    expect(a.core).toEqual([
      '/',
      '/assets/index-C8kyRc_t.css',
      '/assets/index-D4K99R4V.js',
      '/assets/io.worker-CIaNE-lB.js',
      '/assets/worker-BEzaeONQ.js',
      '/icons/icon-192.png',
      '/icons/icon.svg',
      '/manifest.webmanifest',
    ]);
    expect(a.lazy).toEqual([
      '/assets/pdf-LpZwh9cT.js',
      '/assets/pdf.worker.min-CeVT1XOq.js',
      '/assets/pdf.worker.min-CjEcRF4W.mjs',
    ]);
  });

  it('names the cache after the build, so a new build gets a new cache', () => {
    const a = offlineAssets(BUILD);
    expect(a.version).toMatch(/^[0-9a-z]+$/);
    expect(offlineAssets([...BUILD]).version).toBe(a.version);
    const next = BUILD.map((f) => f.replace('D4K99R4V', 'Xx12Yy34'));
    expect(offlineAssets(next).version).not.toBe(a.version);
    // Windows paths from a directory listing read the same.
    expect(offlineAssets(BUILD.map((f) => f.replace('/', '\\'))).core).toEqual(a.core);
  });
});

/** Caches in memory, as the browser's CacheStorage keeps them, keyed by URL. */
function storage() {
  const all = new Map<string, Map<string, Response>>();
  const open = async (name: string): Promise<CacheLike> => {
    let c = all.get(name);
    if (!c) all.set(name, (c = new Map()));
    const cache = c;
    return {
      match: async (req) =>
        cache.get(new URL(typeof req === 'string' ? req : req.url, ORIGIN).href)?.clone(),
      put: async (req, res) => {
        cache.set(new URL(typeof req === 'string' ? req : req.url, ORIGIN).href, res);
      },
    };
  };
  const s: CacheStorageLike = {
    open,
    keys: async () => [...all.keys()],
    delete: async (name) => all.delete(name),
  };
  return { s, all };
}

/** A server answering every path of the build, counting what was asked of it. */
function server(o: { offline?: boolean; missing?: string[] } = {}) {
  const asked: string[] = [];
  const fetch = async (req: Request) => {
    const path = new URL(req.url).pathname;
    asked.push(path);
    if (o.offline) throw new TypeError('Failed to fetch');
    if (o.missing?.includes(path)) return new Response('not found', { status: 404 });
    return new Response(`body of ${path}`, { status: 200 });
  };
  return { fetch, asked };
}

const assets = offlineAssets(BUILD);
const at = (path: string, init?: RequestInit) => new Request(new URL(path, ORIGIN), init);
const nav = (path: string) => ({ request: at(path), navigate: true });
const get = (path: string) => ({ request: at(path), navigate: false });

describe('OfflineCache', () => {
  it('installs the core files into the build’s cache, the unhashed ones read past the HTTP cache', async () => {
    const { s, all } = storage();
    const net = server();
    const modes = new Map<string, string>();
    const cache = new OfflineCache(
      assets,
      s,
      async (req) => {
        modes.set(new URL(req.url).pathname, req.cache);
        return net.fetch(req);
      },
      ORIGIN,
    );
    await cache.install();
    expect([...all.keys()]).toEqual([`${CACHE_PREFIX}${assets.version}`]);
    expect(net.asked.sort()).toEqual([...assets.core].sort());
    // Hashed files may come from the HTTP cache (the page just loaded them); the rest may not.
    expect(modes.get('/assets/io.worker-CIaNE-lB.js')).toBe('default');
    expect(modes.get('/')).toBe('reload');
    expect(modes.get('/manifest.webmanifest')).toBe('reload');
    expect(await cache.status()).toEqual({ cached: assets.core.length, total: 11 });
  });

  it('never makes its cache again once "Clear all local data" deleted it (M2-20)', async () => {
    const { s, all } = storage();
    const net = server();
    const cache = new OfflineCache(assets, s, net.fetch, ORIGIN);
    await cache.install();
    await s.delete(`${CACHE_PREFIX}${assets.version}`);
    // The worker still answers the page until it goes, from the network.
    const shell = await cache.respond(nav('/'));
    expect(await shell?.text()).toBe('body of /');
    const lazy = assets.lazy[0]!;
    await cache.respond(get(lazy));
    expect(await cache.warm(() => {})).toEqual({ cached: 0, total: 11 });
    expect(await cache.status()).toEqual({ cached: 0, total: 11 });
    expect(all.size).toBe(0);
  });

  it('fails the install when a core file cannot be fetched, so the old version stays', async () => {
    const { s } = storage();
    const net = server({ missing: ['/assets/io.worker-CIaNE-lB.js'] });
    const cache = new OfflineCache(assets, s, net.fetch, ORIGIN);
    await expect(cache.install()).rejects.toThrow(/io\.worker-CIaNE-lB\.js: 404/);
  });

  it('activating removes the caches of earlier builds and nothing else', async () => {
    const { s, all } = storage();
    await s.open(`${CACHE_PREFIX}old`);
    await s.open('someone-else');
    const cache = new OfflineCache(assets, s, server().fetch, ORIGIN);
    await cache.install();
    await cache.activate();
    expect([...all.keys()].sort()).toEqual(['someone-else', `${CACHE_PREFIX}${assets.version}`]);
  });

  it('serves the app with no connection: navigations get the shell, files come from the cache', async () => {
    const { s } = storage();
    const online = server();
    const cache = new OfflineCache(assets, s, online.fetch, ORIGIN);
    await cache.install();
    const offline = server({ offline: true });
    const off = new OfflineCache(assets, s, offline.fetch, ORIGIN);
    const shell = await off.respond(nav('/'));
    expect(await shell!.text()).toBe('body of /');
    // Any page in the app's scope is the app, as the manifest's start_url is.
    expect(await (await off.respond(nav('/?file=a.dxf')))!.text()).toBe('body of /');
    expect(await (await off.respond(get('/assets/io.worker-CIaNE-lB.js')))!.text()).toBe(
      'body of /assets/io.worker-CIaNE-lB.js',
    );
    expect(offline.asked).toEqual([]);
  });

  it('leaves alone what is not the app’s: other origins, other methods, unknown paths', async () => {
    const { s } = storage();
    const cache = new OfflineCache(assets, s, server().fetch, ORIGIN);
    await cache.install();
    expect(
      cache.respond({ request: new Request('https://example.com/x.js'), navigate: false }),
    ).toBeUndefined();
    expect(
      cache.respond({
        request: at('/assets/index-D4K99R4V.js', { method: 'POST' }),
        navigate: false,
      }),
    ).toBeUndefined();
    expect(cache.respond(get('/fixtures/drawing.dxf'))).toBeUndefined();
    expect(cache.respond(get('/assets/index-D4K99R4V.js.map'))).toBeUndefined();
  });

  it('fetches pdf.js the first time it is asked for and keeps it', async () => {
    const { s } = storage();
    const net = server();
    const cache = new OfflineCache(assets, s, net.fetch, ORIGIN);
    await cache.install();
    net.asked.length = 0;
    const res = await cache.respond(get('/assets/pdf-LpZwh9cT.js'));
    expect(await res!.text()).toBe('body of /assets/pdf-LpZwh9cT.js');
    expect(net.asked).toEqual(['/assets/pdf-LpZwh9cT.js']);
    await cache.respond(get('/assets/pdf-LpZwh9cT.js'));
    expect(net.asked).toEqual(['/assets/pdf-LpZwh9cT.js']);
    expect(await cache.status()).toEqual({ cached: assets.core.length + 1, total: 11 });
  });

  it('does not keep a failed answer for a lazy file', async () => {
    const { s } = storage();
    const net = server({ missing: ['/assets/pdf-LpZwh9cT.js'] });
    const cache = new OfflineCache(assets, s, net.fetch, ORIGIN);
    await cache.install();
    expect((await cache.respond(get('/assets/pdf-LpZwh9cT.js')))!.status).toBe(404);
    expect(await cache.status()).toEqual({ cached: assets.core.length, total: 11 });
  });

  it('warms the lazy files, reporting progress, until the app is ready offline', async () => {
    const { s } = storage();
    const net = server();
    const cache = new OfflineCache(assets, s, net.fetch, ORIGIN);
    await cache.install();
    await cache.respond(get('/assets/pdf-LpZwh9cT.js'));
    net.asked.length = 0;
    const seen: string[] = [];
    const done = await cache.warm((p) => seen.push(`${p.cached}/${p.total}`));
    expect(done).toEqual({ cached: 11, total: 11 });
    // The file already kept is not fetched again.
    expect(net.asked).toEqual([
      '/assets/pdf.worker.min-CeVT1XOq.js',
      '/assets/pdf.worker.min-CjEcRF4W.mjs',
    ]);
    expect(seen).toEqual(['10/11', '11/11']);
    // A second warm-up has nothing to do.
    net.asked.length = 0;
    expect(await cache.warm(() => undefined)).toEqual({ cached: 11, total: 11 });
    expect(net.asked).toEqual([]);
  });

  it('a warm-up with no connection stops short and says how far it got', async () => {
    const { s } = storage();
    const cache = new OfflineCache(assets, s, server().fetch, ORIGIN);
    await cache.install();
    const off = new OfflineCache(assets, s, server({ offline: true }).fetch, ORIGIN);
    expect(await off.warm(() => undefined)).toEqual({ cached: 8, total: 11 });
  });
});
