// M2-67: pre-bundle every test dev server's dependencies once per Playwright run, before any
// worker starts. Each spec file starts its own Vite dev server, and on a cold cache (every CI
// checkout) each one ran the dependency optimiser itself: several committing at once raced
// renaming their `deps_temp_*` onto the same `deps` directory, and one failed with ENOTEMPTY
// before its shard's first test (#319). With the cache written here and its hash matching each
// server's config, the servers only read it.
//
// Vite marks a manual `optimizeDeps` call deprecated, as its dev server optimises by itself; it
// is still the one call that scans and commits up front. `force` rescans every run, so an import
// added since the last run is in the cache too and no server discovers it later.
import { optimizeDeps, resolveConfig } from 'vite';
import { appServerConfig } from './app/server';
import { ioHarnessConfig } from './io/harness';
import { renderHarnessConfig } from './render-harness/server';

export default async function prebundle(): Promise<void> {
  // Each config has its own cacheDir, so they can be optimised side by side.
  await Promise.all(
    [appServerConfig(), renderHarnessConfig(), ioHarnessConfig()].map(async (config) =>
      optimizeDeps(await resolveConfig(config, 'serve'), true),
    ),
  );
}
