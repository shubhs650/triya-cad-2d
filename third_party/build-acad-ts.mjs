// Compiles the vendored acad-ts (third_party/acad-ts/src) to third_party/acad-ts/dist with its
// own upstream tsconfig, so @triya/io consumes plain ESM + .d.ts and our strict compiler
// settings never type-check upstream sources. Runs on `pnpm install` (root postinstall) and is
// skipped when nothing under src/ or the build config changed since the last build.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(root, 'third_party/acad-ts');
const dist = path.join(pkg, 'dist');
const stampFile = path.join(dist, '.triya-build-stamp');

function files(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]))
    .sort();
}

const hash = createHash('sha256');
const tsc = path.join(root, 'node_modules/typescript/package.json');
hash.update(JSON.parse(readFileSync(tsc, 'utf8')).version);
for (const f of [...files(path.join(pkg, 'src')), path.join(pkg, 'tsconfig.json')]) {
  hash.update(path.relative(pkg, f));
  hash.update(readFileSync(f));
}
const stamp = hash.digest('hex');

const force = process.argv.includes('--force');
if (!force && existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) {
  console.log('[acad-ts] dist is up to date');
  process.exit(0);
}

rmSync(dist, { recursive: true, force: true });
console.log('[acad-ts] compiling third_party/acad-ts → dist …');
execFileSync(
  process.execPath,
  [
    path.join(root, 'node_modules/typescript/bin/tsc'),
    '-p',
    path.join(pkg, 'tsconfig.json'),
    // Upstream ships a file named `CadTemplate[T].ts` whose JS source map URL Vite cannot
    // resolve; JS maps add nothing for consumers here, declaration maps are kept.
    '--sourceMap',
    'false',
  ],
  { stdio: 'inherit' },
);
writeFileSync(stampFile, stamp);
console.log('[acad-ts] done');
