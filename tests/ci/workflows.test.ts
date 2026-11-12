// Encodes the M0-02 contract for .github/workflows (docs/ROADMAP.md M0-02, docs/TESTING.md §1):
// every gate runs on PRs and on main, pnpm and Playwright are cached, fidelity diffs are
// uploaded, a failing suite cannot hide the others, and nothing merges before CI is green.
// DEC-053 (M2-58): gates run as parallel pieces; each required check is the job that gathers its
// pieces and fails unless every one of them succeeded.
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
  env?: Record<string, string>;
}
interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  strategy?: { 'fail-fast'?: boolean; matrix?: Record<string, unknown> };
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
/** A line `pnpm <script>`, alone or with arguments. */
const runsScript = (line: string, script: string) =>
  line.trim() === `pnpm ${script}` || line.trim().startsWith(`pnpm ${script} `);
const stepRunning = (job: Job, script: string) =>
  (job.steps ?? []).find((s) => s.run?.split('\n').some((l) => runsScript(l, script)));
const jobRunning = (script: string) =>
  Object.entries(ci.jobs).find(([, job]) => stepRunning(job, script));
const needsOf = (job: Job) => ([] as string[]).concat(job.needs ?? []);
const jobNamed = (name: string) => Object.entries(ci.jobs).find(([, j]) => j.name === name)!;
/** The ids of the jobs a required check stands for: its own job and every job it needs. */
const gatedBy = (name: string): string[] => {
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    needsOf(ci.jobs[id]!).forEach(visit);
  };
  visit(jobNamed(name)[0]);
  return [...seen];
};
const shardCount = (job: Job) => (job.strategy?.matrix?.['shard'] as unknown[] | undefined)?.length;

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
  // A required check that is skipped counts as passed, and one that only `needs` its pieces is
  // skipped when a piece fails; so each runs unless the run was cancelled and checks every piece.
  it.each(REQUIRED_CHECKS)('"%s" fails unless every piece it gathers succeeded', (name) => {
    const [, job] = jobNamed(name);
    expect(job.if).toBe('${{ !cancelled() }}');
    expect(needsOf(job).length).toBeGreaterThan(0);
    const check = job.steps?.[0]?.run ?? '';
    for (const id of needsOf(job)) {
      expect(check).toContain(`test "\${{ needs.${id}.result }}" = success`);
    }
  });

  it.each(['lint', 'typecheck', 'corpus:validate', 'changelog:check', 'test:shard', 'test:merge'])(
    '`pnpm %s` runs under the required unit check',
    (script) => {
      expect(pkg.scripts[script]).toBeDefined();
      expect(gatedBy(REQUIRED_CHECKS[0]!)).toContain(jobRunning(script)?.[0]);
    },
  );

  // `pnpm test` runs in CI as shards whose merged report is the gate (DEC-053): every shard runs
  // the whole configuration (no file filter), the merge waits for one blob per shard, and the
  // merged run applies the coverage gates (which a shard alone skips, vitest.config.ts).
  it('runs the whole Vitest suite as shards and gates on their merged report', () => {
    expect(pkg.scripts['test']).toBe('vitest run --coverage');
    expect(pkg.scripts['test:shard']).toBe(
      'vitest run --coverage --reporter=default --reporter=blob',
    );
    const merge = pkg.scripts['test:merge']!;
    expect(merge).toContain('--merge-reports=test-reports/vitest-blobs');
    expect(merge).toContain('--coverage');
    expect(merge).not.toContain('--shard');
    const [unitId, unit] = jobRunning('test:shard')!;
    const n = shardCount(unit)!;
    expect(n).toBeGreaterThan(1);
    expect(unit.strategy?.['fail-fast']).toBe(false);
    const shard = stepRunning(unit, 'test:shard')!.run!;
    expect(shard).toContain(`--shard=\${{ matrix.shard }}/${n}`);
    expect(shard).toContain(
      '--outputFile.blob=test-reports/vitest-blobs/blob-${{ matrix.shard }}.json',
    );
    const [checksId, checks] = jobRunning('test:merge')!;
    expect(checks.name).toBe(REQUIRED_CHECKS[0]);
    expect(needsOf(checks)).toContain(unitId);
    expect(checksId).toBe('checks');
    const steps = checks.steps ?? [];
    const count = steps.findIndex((s) => s.run?.includes("-name 'blob-*.json' | wc -l)\" -eq"));
    expect(steps[count]?.run).toMatch(new RegExp(`-eq ${n}$`));
    expect(count).toBeLessThan(steps.indexOf(stepRunning(checks, 'test:merge')!));
    const config = readFileSync(path.join(root, 'vitest.config.ts'), 'utf8');
    expect(config).toContain('...(sharded ? {} : { thresholds: COVERAGE_GATES })');
    expect(config).toContain('sequencer: BalancedSequencer');
  });

  // M1-105 (DEC-047 item 7): the corpus suites write every AC1032 DXF save, unedited and edited,
  // and ezdxf's recover + audit must pass on each before the required check goes green.
  it('audits the DXF saves every unit shard writes with ezdxf in the required checks job', () => {
    const [, unit] = jobRunning('test:shard')!;
    const dir = stepRunning(unit, 'test:shard')?.env?.['TRIYA_DXF_AUDIT_DIR'];
    expect(dir).toBe('test-reports/dxf-audit');
    const kept = (unit.steps ?? []).find((s) => s.uses?.startsWith('actions/upload-artifact@'));
    expect(kept?.if).toBe('${{ !cancelled() }}');
    expect(String(kept?.with?.['path'])).toContain(`${dir}/`);
    const job = ci.jobs['checks']!;
    expect(job.name).toBe(REQUIRED_CHECKS[0]);
    const steps = job.steps ?? [];
    const at = (pred: (s: Step) => boolean) => steps.findIndex(pred);
    const download = at((s) => s.uses?.startsWith('actions/download-artifact@') === true);
    expect(steps[download]?.with?.['merge-multiple']).toBe(true);
    expect(steps[download]?.with?.['path']).toBe('test-reports');
    const install = at((s) => s.run?.includes('-r scripts/dxf-audit/requirements.txt') === true);
    const unittest = at((s) => s.run?.includes('unittest discover -s scripts/dxf-audit') === true);
    const audit = at((s) => s.run?.trim() === `python scripts/dxf-audit/audit.py ${dir}`);
    expect(download).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(-1);
    expect(unittest).toBeGreaterThan(install);
    expect(audit).toBeGreaterThan(Math.max(download, unittest));
    const upload = steps.find(
      (s) => s.uses?.startsWith('actions/upload-artifact@') && s.with?.['name'] === 'dxf-audit',
    );
    expect(upload?.if).toBe('failure()');
    expect(String(upload?.with?.['path'])).toContain(dir);
  });

  it('checks the PDF writer’s test plot with qpdf under the required unit check (M2-16)', () => {
    const [jobId, job] = Object.entries(ci.jobs).find(([, j]) =>
      (j.steps ?? []).some((s) => s.run?.includes('qpdf --check')),
    )!;
    expect(gatedBy(REQUIRED_CHECKS[0]!)).toContain(jobId);
    const steps = job.steps ?? [];
    const install = steps.findIndex(
      (s) => s.run?.includes('apt-get install') && s.run.includes('qpdf'),
    );
    const check = steps.findIndex(
      (s) => s.run?.trim() === 'qpdf --check packages/testkit/fixtures/pdf/plot-sheet.pdf',
    );
    expect(install).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(install);
    // When apt cannot reach the Ubuntu archive (2026-11-11), qpdf's own release build is used.
    expect(steps[install]!.run).toContain('gh release download --repo qpdf/qpdf');
    expect(readFileSync(path.join(root, 'ATTRIBUTION.md'), 'utf8')).toMatch(/\| qpdf \(/);
  });

  it('pins ezdxf, which runs in CI only', () => {
    const req = readFileSync(path.join(root, 'scripts/dxf-audit/requirements.txt'), 'utf8');
    const version = /^ezdxf==(\d+\.\d+\.\d+)$/m.exec(req)?.[1];
    expect(version).toBeDefined();
    expect(readFileSync(path.join(root, 'ATTRIBUTION.md'), 'utf8')).toContain(`ezdxf ${version}`);
  });

  it.each(['build', 'test:fidelity', 'test:offline', 'test:ui', 'test:io'])(
    '`pnpm %s` runs under the required browser check',
    (script) => {
      expect(pkg.scripts[script]).toBeDefined();
      expect(gatedBy(REQUIRED_CHECKS[1]!)).toContain(jobRunning(script)?.[0]);
    },
  );

  // Playwright splits a suite by `--shard=i/n`; each shard job must name its own piece of the
  // same n, or a piece of the suite would never run.
  it.each(['test:fidelity', 'test:ui'])('runs every shard of `pnpm %s`', (script) => {
    const [, job] = jobRunning(script)!;
    const n = shardCount(job)!;
    expect(n).toBeGreaterThan(1);
    expect(job.strategy?.matrix?.['shard']).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(job.strategy?.['fail-fast']).toBe(false);
    expect(stepRunning(job, script)!.run!.trim()).toBe(
      `pnpm ${script} --shard=\${{ matrix.shard }}/${n}`,
    );
  });

  // A beforeAll hook in a file of parallel tests makes Playwright keep them in one group per
  // worker, which `--shard` cannot split; the fidelity specs share their app as a worker fixture.
  it.each(['golden.spec.ts', 'fixtures.spec.ts'])(
    'lets the fidelity shards split %s by test',
    (file) => {
      const spec = readFileSync(path.join(root, 'tests/e2e/fidelity', file), 'utf8');
      expect(spec).not.toMatch(/test\.(beforeAll|afterAll)\(/);
      expect(spec).toContain("mode: 'parallel'");
    },
  );

  // A shard cannot split a test file, so the longest file sets every unit shard's floor.
  it('keeps every Vitest file well under a CI shard', () => {
    const timings = JSON.parse(
      readFileSync(path.join(root, 'tests/ci/vitest-timings.json'), 'utf8'),
    ) as Record<string, number>;
    for (const [file, seconds] of Object.entries(timings)) {
      expect(seconds, file).toBeLessThan(300);
    }
  });

  it('keeps the required check names stable', () => {
    const names = Object.values(ci.jobs).map((j) => j.name);
    for (const required of REQUIRED_CHECKS) expect(names).toContain(required);
  });

  it('runs every browser suite even when an earlier one in the same job fails', () => {
    for (const job of Object.values(ci.jobs)) {
      const suites = (job.steps ?? []).filter((s) =>
        ['test:fidelity', 'test:offline', 'test:ui', 'test:io'].some((t) =>
          s.run?.split('\n').some((l) => runsScript(l, t)),
        ),
      );
      for (const later of suites.slice(1)) expect(later.if).toBe('${{ !cancelled() }}');
    }
  });

  it('runs perf on main, on PRs touching hot paths, and on request', () => {
    const [perfId, perf] = jobRunning('test:perf')!;
    expect(perfId).toBe('perf');
    const cond = perf.if ?? '';
    expect(cond).toContain("github.ref == 'refs/heads/main'");
    expect(cond).toContain("needs.changes.outputs.hot == 'true'");
    expect(cond).toContain("'perf'");
    expect(needsOf(perf)).toContain('changes');
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
      const deps = (job.steps ?? []).find((s) => s.run?.includes('playwright install-deps'));
      expect(deps).toBeDefined();
      // Without apt (2026-11-11) the job still fails when Chromium misses a library.
      expect(deps!.run).toContain("grep 'not found'");
    }
  });

  it('uploads fidelity diff images when a fidelity shard fails', () => {
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
