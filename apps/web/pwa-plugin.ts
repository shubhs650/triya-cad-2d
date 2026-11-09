// Builds the service worker (M2-19, ARCHITECTURE.md §14, DEC-052): `src/sw/sw.ts` is a second
// entry of the production build, written to `/sw.js` (a fixed name, as a worker's URL must not
// change between versions), and once the build is written the worker's placeholder
// `__TRIYA_OFFLINE__` becomes the list of the build's files (`offlineAssets`), so each build's
// worker carries its own cache name and the browser sees an update when anything changed.
// The dev server registers no worker (`pwa.ts`), so this plugin applies to builds only.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { offlineAssets } from './src/sw/offline-cache';

const PLACEHOLDER = '__TRIYA_OFFLINE__';

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)));
}

export function pwa(): Plugin {
  let root = '';
  return {
    name: 'triya-pwa',
    apply: 'build',
    config(config) {
      root = config.root ?? process.cwd();
      return {
        build: {
          rollupOptions: {
            input: {
              index: path.resolve(root, 'index.html'),
              sw: path.resolve(root, 'src/sw/sw.ts'),
            },
            output: {
              entryFileNames: (chunk) =>
                chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
            },
          },
        },
      };
    },
    writeBundle(options) {
      const dir = options.dir!;
      const sw = path.join(dir, 'sw.js');
      const code = readFileSync(sw, 'utf8');
      // The worker runs as a classic script: anything it imported must have been inlined.
      if (/^\s*(import|export)\b/m.test(code))
        throw new Error('sw.js must not import or export (it shares a module with the app?)');
      if (!code.includes(PLACEHOLDER)) throw new Error(`sw.js has no ${PLACEHOLDER}`);
      const assets = offlineAssets(filesUnder(dir));
      writeFileSync(sw, code.replaceAll(PLACEHOLDER, JSON.stringify(assets)));
    },
  };
}
