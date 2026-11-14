// Vite dev server for the app specs (ui, offline): serves apps/web with its own config, the
// way `pnpm dev` does, on a free port and without HMR (no websocket, so the offline spec sees
// only the requests the app itself makes).
import path from 'node:path';
import { createLogger, createServer, type InlineConfig, type ViteDevServer } from 'vite';

export const APP_ROOT = path.join(import.meta.dirname, '../../../apps/web');
export const CORPUS = path.join(import.meta.dirname, '../../../corpus/public/third-party');
/**
 * The test servers' own dependency cache (M2-67), kept apart from `pnpm dev`'s
 * `node_modules/.vite` so pre-bundling it for a run never pulls the cache from under a dev
 * server the developer has open.
 */
export const APP_DEPS = path.join(APP_ROOT, 'node_modules/.vite-e2e');

/** The config every app test server uses; the global setup pre-bundles its dependencies. */
export function appServerConfig(): InlineConfig {
  return {
    configFile: path.join(APP_ROOT, 'vite.config.ts'),
    root: APP_ROOT,
    cacheDir: APP_DEPS,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  };
}

/**
 * Starts the app on a free port. `log`, when given, receives every message the server logs at
 * any level (errors are still printed), so a spec can check what the server did.
 */
export async function startApp(
  options: { log?: (message: string) => void } = {},
): Promise<{ url: string; close(): Promise<void> }> {
  const { log } = options;
  const config = appServerConfig();
  if (log) {
    const printed = createLogger('error');
    config.customLogger = {
      ...printed,
      info: (message) => log(message),
      warn: (message) => log(message),
      warnOnce: (message) => log(message),
      error: (message, o) => {
        log(message);
        printed.error(message, o);
      },
    };
    config.logLevel = 'info';
  }
  const server: ViteDevServer = await createServer(config);
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('vite did not bind a port');
  return { url: `http://127.0.0.1:${address.port}/`, close: () => server.close() };
}
