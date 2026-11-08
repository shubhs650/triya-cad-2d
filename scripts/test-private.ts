// `pnpm test:private` (M1-106, TESTING.md §2.2): the round-trip and golden-image suites on the
// owner's own drawings, listed in corpus/private/corpus.json (gitignored, never committed or
// uploaded). Without that manifest it says so and exits 0: the private corpus is optional
// (DEC-047). Both suites run even when the first fails; the exit code is 1 if either failed.
//
//   pnpm test:private                         # both suites on corpus/private/corpus.json
//   TRIYA_UPDATE_BASELINE=1 pnpm test:private # also (re)writes corpus/private/roundtrip-baseline.json
//   TRIYA_UPDATE_GOLDEN=1 pnpm test:private   # writes golden images under corpus/private/refs/golden/
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** One suite to run: a command, its arguments and the environment it adds. */
export interface Step {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface PrivateRunOptions {
  /** The private manifest; corpus/private/corpus.json by default. */
  readonly manifest?: string;
  /** Runs a step from the repository root and returns its exit code. */
  readonly run: (step: Step) => number;
  readonly log: (message: string) => void;
}

export function runPrivate(o: PrivateRunOptions): number {
  const manifest = o.manifest ?? path.join(ROOT, 'corpus/private/corpus.json');
  if (!existsSync(manifest)) {
    o.log(
      `[triya] No private corpus (${path.relative(ROOT, manifest) || manifest} does not exist); nothing to run. See corpus/private/README.md.`,
    );
    return 0;
  }
  const env = { TRIYA_CORPUS: 'private', TRIYA_PRIVATE_MANIFEST: manifest };
  const steps: Step[] = [
    {
      command: 'pnpm',
      args: ['exec', 'vitest', 'run', '--config', 'vitest.private.config.ts'],
      env,
    },
    {
      command: 'pnpm',
      args: [
        'exec',
        'playwright',
        'test',
        '--project=fidelity',
        'tests/e2e/fidelity/golden.spec.ts',
      ],
      env,
    },
  ];
  let failed = false;
  for (const step of steps) if (o.run(step) !== 0) failed = true;
  return failed ? 1 : 0;
}

function spawnStep(step: Step): number {
  const r = spawnSync(step.command, step.args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...step.env },
    shell: process.platform === 'win32',
  });
  return r.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runPrivate({ run: spawnStep, log: (m) => console.log(m) });
}
