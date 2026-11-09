// Vite config for the app (M1-22). Packages are consumed from source, as everywhere else in
// the repo; the workers (`?worker` imports of @triya/io and @triya/render) build as ES modules.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { pwa } from './pwa-plugin';

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

export default defineConfig({
  plugins: [react(), pwa()],
  resolve: {
    alias: [
      {
        // Same mapping as tsconfig.base.json `paths`: packages import each other by name without
        // listing each other as dependencies. Subpaths (`@triya/io/client`, `@triya/render/worker`)
        // resolve through the package exports.
        find: /^@triya\/([a-z-]+)$/,
        replacement: fileURLToPath(new URL('../../packages/$1/src/index.ts', import.meta.url)),
      },
    ],
  },
  define: { __APP_VERSION__: JSON.stringify(version) },
  // acad-ts finds its DXF property maps by class name (`DxfMap.create(type.name)`), so the
  // production build keeps class and function names through minification; without them the
  // minified I/O worker read no PDFDEFINITION file name, among others (found by M2-19).
  esbuild: { keepNames: true },
  worker: { format: 'es' },
  build: { target: 'es2023', sourcemap: true },
});
