// Vite dev server for the renderer specs (fidelity pixel test, perf budgets): serves page/,
// which draws drawings through RendererHost in both modes.
import path from 'node:path';
import { createServer, type InlineConfig, type ViteDevServer } from 'vite';

/** The config every render harness server uses; the global setup pre-bundles its dependencies. */
export function renderHarnessConfig(): InlineConfig {
  return {
    root: path.join(import.meta.dirname, 'page'),
    configFile: false,
    // Its own dependency cache (M2-67): the default, the repository's node_modules/.vite, is
    // shared with the io harness, whose different config would re-optimise it.
    cacheDir: path.join(import.meta.dirname, '../../../node_modules/.vite-e2e-render'),
    logLevel: 'error',
    // Same mapping as tsconfig.base.json `paths` and vitest.config.ts: packages from source.
    resolve: {
      alias: [
        {
          find: /^@triya\/([a-z-]+)$/,
          replacement: path.join(import.meta.dirname, '../../../packages/$1/src/index.ts'),
        },
      ],
    },
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  };
}

export async function startRenderHarness(): Promise<{ url: string; close(): Promise<void> }> {
  const server: ViteDevServer = await createServer(renderHarnessConfig());
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('vite did not bind a port');
  return { url: `http://127.0.0.1:${address.port}/`, close: () => server.close() };
}
