// Vite dev server for the app specs (ui, offline): serves apps/web with its own config, the
// way `pnpm dev` does, on a free port and without HMR (no websocket, so the offline spec sees
// only the requests the app itself makes).
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';

export const APP_ROOT = path.join(import.meta.dirname, '../../../apps/web');
export const CORPUS = path.join(import.meta.dirname, '../../../corpus/public/third-party');

export async function startApp(): Promise<{ url: string; close(): Promise<void> }> {
  const server: ViteDevServer = await createServer({
    configFile: path.join(APP_ROOT, 'vite.config.ts'),
    root: APP_ROOT,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('vite did not bind a port');
  return { url: `http://127.0.0.1:${address.port}/`, close: () => server.close() };
}
