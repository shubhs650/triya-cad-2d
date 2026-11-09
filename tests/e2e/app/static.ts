// A static server for the production build (M2-19): the service worker exists only in
// `apps/web/dist` (`pnpm build`), which the offline suite serves here, on a free port, as a
// static host would. A test can replace a file's body (a new `sw.js` stands for a new version)
// and stop the server to take the app offline.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

export const DIST = path.join(import.meta.dirname, '../../../apps/web/dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

export interface StaticApp {
  readonly url: string;
  /** Paths the server was asked for, in order. */
  readonly served: string[];
  /** Serves `body` for `pathname` instead of the built file. */
  override(pathname: string, body: string): void;
  close(): Promise<void>;
}

export async function serveBuild(): Promise<StaticApp> {
  if (!existsSync(path.join(DIST, 'sw.js')))
    throw new Error(`no production build in ${DIST}: run \`pnpm build\` first`);
  const overrides = new Map<string, string>();
  const served: string[] = [];
  const server: Server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    served.push(pathname);
    let file = path.join(DIST, pathname);
    if (!file.startsWith(DIST)) {
      res.writeHead(403).end();
      return;
    }
    // A path that is no file is the app (as a static host's SPA fallback).
    if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
    const body = overrides.get(pathname) ?? readFileSync(file);
    // As a host would: hashed assets forever, everything else revalidated.
    const cache = pathname.startsWith('/assets/') ? 'max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'content-type': type, 'cache-control': cache }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    served,
    override: (p, body) => overrides.set(p, body),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
