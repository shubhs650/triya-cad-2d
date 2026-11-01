// Encodes the M0-02 contract for .github/workflows (docs/ROADMAP.md M0-02, docs/TESTING.md §1):
// every gate runs on PRs and on main, pnpm and Playwright are cached, fidelity diffs are
// uploaded, a failing suite cannot hide the others, and nothing merges before CI is green.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = path.resolve(import.meta.dirname, '../..');

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
}
interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  steps?: Step[];
  outputs?: Record<string, string>;
}
interface Workflow {
  name: string;
  on: Record<string, unknown>;
  concurrency?: { group: string; 'cancel-in-progress': unknown };
  jobs: Record<string, Job>;
}

const load = (file: string) =>
  parse(readFileSync(path.join(root, '.github/workflows', file), 'utf8')) as Workflow;

const ci = load('ci.yml');
const autoMerge = load('auto-merge.yml');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

const allSteps = (wf: Workflow) => Object.values(wf.jobs).flatMap((j) => j.steps ?? []);
const stepRunning = (job: Job, script: string) =>
  (job.steps ?? []).find((s) => s.run?.split('\n').some((l) => l.trim() === `pnpm ${script}`));
const jobRunning = (script: string) =>
  Object.entries(ci.jobs).find(([, job]) => stepRunning(job, script));

/** Names branch protection must list as required (docs/SETUP.md Part 1 step 4). */
const REQUIRED_CHECKS = ['lint · typecheck · unit · round-trip', 'fidelity · offline · ui'];

describe('ci.yml triggers', () => {
  it('runs on every pull request and on pushes to main', () => {
    expect(ci.on).toHaveProperty('pull_request');
    expect(ci.on['push']).toEqual({ branches: ['main'] });
  });

  it('cancels superseded PR runs but never a run on main', () => {
    expect(ci.concurrency?.group).toContain('github.ref');
    expect(String(ci.concurrency?.['cancel-in-progress'])).toContain(
      "github.event_name == 'pull_request'",
    );
  });
});

describe('ci.yml gates', () => {
  it.each(['lint', 'typecheck', 'test', 'corpus:validate'])(
    '`pnpm %s` runs in the required checks job',
    (script) => {
      expect(pkg.scripts[script]).toBeDefined();
      expect(jobRunning(script)?.[1].name).toBe(REQUIRED_CHECKS[0]);
    },
  );

  it.each(['test:fidelity', 'test:offline', 'test:ui', 'test:io'])(
    '`pnpm %s` runs in the required browser job',
    (script) => {
      expect(pkg.scripts[script]).toBeDefined();
      expect(jobRunning(script)?.[1].name).toBe(REQUIRED_CHECKS[1]);
    },
  );

  it('keeps the required check names stable', () => {
    const names = Object.values(ci.jobs).map((j) => j.name);
    for (const required of REQUIRED_CHECKS) expect(names).toContain(required);
  });

  it('runs every browser suite even when an earlier one fails', () => {
    const [, browser] = jobRunning('test:fidelity')!;
    for (const script of ['test:offline', 'test:ui', 'test:io']) {
      expect(stepRunning(browser, script)?.if).toBe('${{ !cancelled() }}');
    }
  });

  it('runs perf on main, on PRs touching hot paths, and on request', () => {
    const [perfId, perf] = jobRunning('test:perf')!;
    expect(perfId).toBe('perf');
    const cond = perf.if ?? '';
    expect(cond).toContain("github.ref == 'refs/heads/main'");
    expect(cond).toContain("needs.changes.outputs.hot == 'true'");
    expect(cond).toContain("'perf'");
    expect(([] as string[]).concat(perf.needs ?? [])).toContain('changes');
  });

  it('detects hot-path changes in render, engine and io', () => {
    const changes = ci.jobs['changes'];
    expect(changes?.outputs?.['hot']).toBeDefined();
    const script = (changes?.steps ?? []).map((s) => s.run ?? '').join('\n');
    for (const dir of ['packages/render/', 'packages/engine/', 'packages/io/']) {
      expect(script).toContain(dir);
    }
  });
});

describe('ci.yml caching and artifacts', () => {
  it('caches the pnpm store in every job that installs', () => {
    for (const job of Object.values(ci.jobs)) {
      if (!stepRunning(job, 'install --frozen-lockfile')) continue;
      const node = (job.steps ?? []).find((s) => s.uses?.startsWith('actions/setup-node@'));
      expect(node?.with?.['cache']).toBe('pnpm');
    }
  });

  it('caches Playwright browsers keyed on the Playwright version in every browser job', () => {
    const browserJobs = Object.values(ci.jobs).filter((j) =>
      (j.steps ?? []).some((s) => s.run?.includes('playwright install')),
    );
    expect(browserJobs.length).toBeGreaterThanOrEqual(2);
    for (const job of browserJobs) {
      const cache = (job.steps ?? []).find((s) => s.uses?.startsWith('actions/cache@'));
      expect(cache?.with?.['path']).toContain('ms-playwright');
      expect(String(cache?.with?.['key'])).toContain('playwright');
      // System libraries are not cacheable; browsers are only downloaded on a miss.
      const install = (job.steps ?? []).find((s) => s.run?.includes('playwright install '));
      expect(install?.if).toContain("cache-hit != 'true'");
      expect((job.steps ?? []).some((s) => s.run?.includes('playwright install-deps'))).toBe(true);
    }
  });

  it('uploads fidelity diff images when the browser job fails', () => {
    const [, browser] = jobRunning('test:fidelity')!;
    const upload = (browser.steps ?? []).find((s) =>
      s.uses?.startsWith('actions/upload-artifact@'),
    );
    expect(upload?.if).toBe('failure()');
    expect(String(upload?.with?.['path'])).toContain('test-results/');
  });
});

describe('auto-merge.yml', () => {
  it('only acts after CI has completed, so a red check can never be merged', () => {
    expect(autoMerge.on).toHaveProperty('workflow_run');
    expect(autoMerge.on['workflow_run']).toMatchObject({
      workflows: [ci.name],
      types: ['completed'],
    });
    expect(autoMerge.on).not.toHaveProperty('pull_request');
  });

  it('requires a successful CI conclusion on the PR head before enabling auto-merge', () => {
    const job = Object.values(autoMerge.jobs)[0]!;
    expect(job.if).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(job.if).toContain("github.event.workflow_run.event == 'pull_request'");
    const script = (job.steps ?? []).map((s) => s.run ?? '').join('\n');
    expect(script).toMatch(/gh pr merge \S+ --auto --squash/);
    // A stale run (PR pushed again since) or a draft PR must not be merged.
    expect(script).toContain('headRefOid');
    expect(script).toContain('isDraft');
  });

  it('does not use pull_request_target or check out PR code', () => {
    expect(autoMerge.on).not.toHaveProperty('pull_request_target');
    expect(allSteps(autoMerge).some((s) => s.uses?.startsWith('actions/checkout@'))).toBe(false);
  });
});
