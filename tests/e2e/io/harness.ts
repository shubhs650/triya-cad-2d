// Shared Vite dev server for the io specs: serves tests/e2e/io/harness, whose page loads
// drawings through @triya/io's readInWorker.
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';

export async function startHarness(): Promise<{ url: string; close(): Promise<void> }> {
  const server: ViteDevServer = await createServer({
    root: path.join(import.meta.dirname, 'harness'),
    configFile: false,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('vite did not bind a port');
  return { url: `http://127.0.0.1:${address.port}/`, close: () => server.close() };
}
