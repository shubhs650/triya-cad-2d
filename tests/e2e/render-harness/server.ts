// Vite dev server for the renderer specs (fidelity pixel test, perf budgets): serves page/,
// which draws drawings through RendererHost in both modes.
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';

export async function startRenderHarness(): Promise<{ url: string; close(): Promise<void> }> {
  const server: ViteDevServer = await createServer({
    root: path.join(import.meta.dirname, 'page'),
    configFile: false,
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
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('vite did not bind a port');
  return { url: `http://127.0.0.1:${address.port}/`, close: () => server.close() };
}
