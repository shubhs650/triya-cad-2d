// M1-106: `pnpm test:private` runs the round-trip and golden-image suites on the owner's own
// drawings (corpus/private/corpus.json, gitignored) and is a quiet no-op without them.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPrivate, type Step } from '../../scripts/test-private.ts';

function harness(exitCodes: number[] = []) {
  const steps: Step[] = [];
  const logs: string[] = [];
  return {
    steps,
    logs,
    o: {
      run: (s: Step) => {
        steps.push(s);
        return exitCodes[steps.length - 1] ?? 0;
      },
      log: (m: string) => logs.push(m),
    },
  };
}

describe('pnpm test:private', () => {
  it('exits 0 saying so when there is no private corpus', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'triya-private-'));
    const h = harness();
    expect(runPrivate({ ...h.o, manifest: path.join(dir, 'corpus.json') })).toBe(0);
    expect(h.steps).toEqual([]);
    expect(h.logs.join('\n')).toMatch(/no private corpus .*corpus\.json.*nothing to run/i);
  });

  it('runs the round-trip and golden-image suites on the private manifest', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'triya-private-'));
    const manifest = path.join(dir, 'corpus.json');
    writeFileSync(manifest, '{}');
    const h = harness();
    expect(runPrivate({ ...h.o, manifest })).toBe(0);
    expect(h.steps.map((s) => [s.command, ...s.args].join(' '))).toEqual([
      'pnpm exec vitest run --config vitest.private.config.ts',
      'pnpm exec playwright test --project=fidelity tests/e2e/fidelity/golden.spec.ts',
    ]);
    for (const s of h.steps) {
      expect(s.env).toMatchObject({ TRIYA_CORPUS: 'private', TRIYA_PRIVATE_MANIFEST: manifest });
    }
  });

  it('runs both suites and fails when either fails', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'triya-private-'));
    const manifest = path.join(dir, 'corpus.json');
    writeFileSync(manifest, '{}');
    const h = harness([1, 0]);
    expect(runPrivate({ ...h.o, manifest })).toBe(1);
    expect(h.steps).toHaveLength(2);
  });
});
