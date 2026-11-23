// Hashes the inputs and outputs of the PlaneGCS WASM build (third_party/planegcs/build.sh).
//
//   node scripts/planegcs-stamp.mjs --write   after a build: writes packages/constraints/wasm/build-stamp.json
//   node scripts/planegcs-stamp.mjs --check   exits 1 when the inputs or outputs differ from the stamp
//   node scripts/planegcs-stamp.mjs --key     prints the inputs' hash (CI's build cache key)
//
// The built module is committed, so every test and the app use it without Emscripten. The
// stamp ties it to its inputs: tests/third-party/planegcs-build.test.ts runs --check, so
// changing a source, patch, shim, binding or the build script without rebuilding fails, and
// CI's planegcs job rebuilds from the inputs and compares the output's hashes.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PLANEGCS = path.join(ROOT, 'third_party/planegcs');
const OUT = path.join(ROOT, 'packages/constraints/wasm');
const STAMP = path.join(OUT, 'build-stamp.json');

/** Every file the build reads from the repository, as repository-relative paths, sorted. */
export function inputFiles() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  };
  for (const dir of ['src', 'patches', 'shim', 'bindings']) walk(path.join(PLANEGCS, dir));
  files.push('third_party/planegcs/build.sh');
  return files.sort();
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** One hash over every input's path and content. Line endings count: the tree is `-text`. */
export function inputsHash() {
  const h = createHash('sha256');
  for (const f of inputFiles()) {
    h.update(`${f}\0`);
    h.update(readFileSync(path.join(ROOT, f)));
    h.update('\0');
  }
  return h.digest('hex');
}

export function currentStamp() {
  return {
    inputs: inputsHash(),
    outputs: {
      'planegcs.mjs': sha256(readFileSync(path.join(OUT, 'planegcs.mjs'))),
      'planegcs.wasm': sha256(readFileSync(path.join(OUT, 'planegcs.wasm'))),
    },
  };
}

const mode = process.argv[2];
if (mode === '--key') {
  console.log(inputsHash());
} else if (mode === '--write') {
  writeFileSync(STAMP, `${JSON.stringify(currentStamp(), null, 2)}\n`);
} else if (mode === '--check') {
  const saved = JSON.parse(readFileSync(STAMP, 'utf8'));
  const now = currentStamp();
  if (JSON.stringify(saved) !== JSON.stringify(now)) {
    console.error(
      'planegcs: the built module does not match its inputs. Run `pnpm planegcs:build`.',
    );
    console.error(`stamp:   ${JSON.stringify(saved)}\ncurrent: ${JSON.stringify(now)}`);
    process.exit(1);
  }
  console.log('planegcs: build stamp matches');
} else if (mode !== undefined) {
  console.error(`unknown option ${mode}`);
  process.exit(2);
}
