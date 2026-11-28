// M10-01: PRD §12 T2, T5 and T7 in the app, on the generated bench drawings (DEC-045), as a user
// meets them: the production build (`pnpm build`, as the installed app runs), each drawing
// opened through the Open button and saved in place with Ctrl+S, as the AC1032 DXFs Triya saves
// (DEC-047). render.spec.ts times the render worker alone and app.spec.ts pan and zoom (T3).
//
// - T2: from the open picker handing over the file to the first frame drawn on its canvas: the
//   file read, parsed and mapped in the I/O worker, the engine and render workers started on
//   it and the first frame drawn.
// - T5: from Ctrl+S to the file handle's writable closing: the change log replayed onto the
//   file read again and written as DXF in the I/O worker (M2-13), then written to the handle.
// - T7: the JavaScript heaps of the page and of every worker, used and backing stores (typed
//   arrays), after a garbage collection, through the DevTools protocol (the page is not
//   cross-origin isolated, which `performance.measureUserAgentSpecificMemory` needs).
//
// Where the app does not meet a target yet, the budget is the time measured when M10-01 set it
// plus TESTING.md §5's runner margin, so it cannot get slower, and the target is reported beside
// it; DEC-097 and M10-01's later parts in ROADMAP.md hold what is left to do. Each number is a test annotation.
import { writeFileSync } from 'node:fs';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import {
  BENCH_100K,
  BENCH_GA,
  benchDxf,
  type BenchSpec,
} from '../../../packages/testkit/src/bench/drawing';
import { activeCanvas, expectShown, serve } from '../app/page';
import { serveBuild, type StaticApp } from '../app/static';

/** TESTING.md §5: thresholds carry a 20 % margin over PRD §12 for the runner. */
const MARGIN = 1.2;

/**
 * Each budget: PRD §12's target, and the budget asserted (the target with the margin, or, while
 * the app is slower, the time M10-01 part 1 measured on CI's runner, where it is asserted, with
 * the margin; DEC-097). Run 46160444447 (`performance budgets`, one spec at a time): bench-ga
 * 2499 ms, bench-100k open 8234 ms, save 4944 ms.
 */
const BUDGETS = {
  openGa: { target: 500, budget: 2500 * MARGIN },
  open100k: { target: 3000, budget: 8300 * MARGIN },
  save100k: { target: 2000, budget: 5000 * MARGIN },
} as const;

/** PRD §12 T7: memory for bench-100k. A heap measure needs no runner margin. */
const T7_BYTES = 1024 ** 3;
/** PRD §12 T7: no growth across 20 open/close cycles (±5 %). */
const CYCLES = 20;
const GROWTH = 0.05;

let app: StaticApp;
const files = new Map<BenchSpec, string>();

test.beforeAll(async () => {
  app = await serveBuild();
  for (const spec of [BENCH_GA, BENCH_100K]) {
    const file = test.info().outputPath(`${spec.name}.dxf`);
    writeFileSync(file, benchDxf(spec));
    files.set(spec, file);
  }
});

test.afterAll(async () => {
  await app?.close();
});

interface Bench {
  /** Frames the render workers drew (page clock), with their canvas. */
  readonly drawn: { t: number; canvas: EventTarget | null }[];
  /** The file the open picker hands out next, and where the page fetches it. */
  next?: { name: string; url: string };
  /** When the open picker last handed a file over. */
  picked: number;
  /** When Ctrl+S was last pressed. */
  saveKey: number;
  /** When each handle's writable closed, by name. */
  readonly written: Record<string, number[]>;
}
type BenchWindow = Window & { __bench: Bench };

/** Counts frames and keys from the first page script on, and stands in for the file pickers. */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const b: Bench = { drawn: [], picked: 0, saveKey: 0, written: {} };
    (window as unknown as BenchWindow).__bench = b;
    document.addEventListener(
      'framedrawn',
      (e) => b.drawn.push({ t: performance.now(), canvas: e.target }),
      true,
    );
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.ctrlKey && e.key === 's') b.saveKey = performance.now();
      },
      true,
    );
    // Chromium's pickers cannot be driven by Playwright (save.spec.ts): a handle that reads
    // the file when asked, as a real one does (so the recent list, which keeps the handle, keeps
    // no bytes), is the same entry as another of its name, and notes when what is written to
    // it is closed.
    const handle = (name: string, url: string) => ({
      kind: 'file',
      name,
      getFile: async () => new File([await (await fetch(url)).arrayBuffer()], name),
      isSameEntry: (other: { name: string }) => Promise.resolve(other.name === name),
      queryPermission: () => Promise.resolve('granted'),
      requestPermission: () => Promise.resolve('granted'),
      createWritable: () =>
        Promise.resolve({
          write: () => Promise.resolve(),
          close: () => {
            (b.written[name] ??= []).push(performance.now());
            return Promise.resolve();
          },
        }),
    });
    Object.assign(window, {
      showOpenFilePicker: () => {
        const n = b.next!;
        delete b.next;
        b.picked = performance.now();
        return Promise.resolve([handle(n.name, n.url)]);
      },
    });
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(app.url);
}

const bench = (page: Page): Promise<Bench> =>
  page.evaluate(() => (window as unknown as BenchWindow).__bench);

const fileName = (spec: BenchSpec): string => `${spec.name}.dxf`;

/** Opens `spec`'s DXF with the Open button; returns picker → first frame in ms. */
async function openBench(page: Page, spec: BenchSpec): Promise<number> {
  const url = await serve(page, files.get(spec)!);
  await page.evaluate(
    (next) => {
      (window as unknown as BenchWindow).__bench.next = next;
    },
    { url, name: fileName(spec) },
  );
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expectShown(page, fileName(spec));
  const first = () =>
    activeCanvas(page).evaluate((canvas) => {
      const b = (window as unknown as BenchWindow).__bench;
      return b.drawn.find((d) => d.canvas === canvas && d.t > b.picked)?.t;
    });
  await expect.poll(first, { timeout: 60_000, message: 'no frame was drawn' }).toBeDefined();
  return (await first())! - (await bench(page)).picked;
}

async function closeBench(page: Page, spec: BenchSpec): Promise<void> {
  await page.getByTitle(`Close ${fileName(spec)}`, { exact: true }).click();
  await expect(page.locator('.doc-tab', { hasText: fileName(spec) })).toHaveCount(0);
}

type HeapUsage = { usedSize: number; backingStorageSize?: number };

/**
 * The page's and its workers' JavaScript memory after a garbage collection in each, in bytes:
 * heap used and the backing stores of typed arrays (a drawing's file bytes and render buffers).
 * Workers are reached through the DevTools protocol's target messages.
 */
async function memory(cdp: CDPSession): Promise<{ total: number; parts: Record<string, number> }> {
  const bytes = (u: HeapUsage) => u.usedSize + (u.backingStorageSize ?? 0);
  await cdp.send('HeapProfiler.collectGarbage');
  const parts: Record<string, number> = {
    page: bytes((await cdp.send('Runtime.getHeapUsage')) as HeapUsage),
  };
  const pending = new Map<number, (r: unknown) => void>();
  const listener = (e: { message: string }) => {
    const m = JSON.parse(e.message) as { id: number; result?: unknown };
    pending.get(m.id)?.(m.result);
  };
  cdp.on('Target.receivedMessageFromTarget', listener);
  let id = 0;
  try {
    const { targetInfos } = await cdp.send('Target.getTargets');
    for (const t of targetInfos.filter((t) => t.type === 'worker')) {
      const { sessionId } = await cdp.send('Target.attachToTarget', {
        targetId: t.targetId,
        flatten: false,
      });
      const call = (method: string) =>
        new Promise<unknown>((resolve) => {
          pending.set(++id, resolve);
          void cdp.send('Target.sendMessageToTarget', {
            sessionId,
            message: JSON.stringify({ id, method }),
          });
        });
      await call('HeapProfiler.collectGarbage');
      const usage = (await call('Runtime.getHeapUsage')) as HeapUsage | undefined;
      await cdp.send('Target.detachFromTarget', { sessionId });
      if (usage) parts[`${t.url.split('/').pop()} ${t.targetId.slice(0, 6)}`] = bytes(usage);
    }
  } finally {
    cdp.off('Target.receivedMessageFromTarget', listener);
  }
  return { total: Object.values(parts).reduce((a, b) => a + b, 0), parts };
}

const mb = (bytes: number): string => (bytes / 1024 ** 2).toFixed(0);

function report(name: string, ms: number, b: { target: number; budget: number }): void {
  const met = ms < b.target * MARGIN ? 'met' : 'NOT met';
  test.info().annotations.push({
    type: `${name} (ms)`,
    description: `${ms.toFixed(0)} (target ${b.target}, ${met}; budget ${b.budget.toFixed(0)})`,
  });
  console.log(`bench perf, ${name}: ${ms.toFixed(0)} ms (target ${b.target} ms, ${met})`);
}

test.describe('T2, T5 and T7 in the app on the generated bench drawings', () => {
  test.describe.configure({ timeout: 300_000 });

  test('T2: bench-ga opens to its first frame', async ({ page }) => {
    await instrument(page);
    const ms = await openBench(page, BENCH_GA);
    report('bench-ga open → first frame', ms, BUDGETS.openGa);
    expect(ms).toBeLessThan(BUDGETS.openGa.budget);
  });

  test('T2 and T5: bench-100k opens to its first frame and saves in place', async ({ page }) => {
    await instrument(page);
    const open = await openBench(page, BENCH_100K);
    report('bench-100k open → first frame', open, BUDGETS.open100k);
    await page.screenshot({ path: test.info().outputPath('bench-100k-open.png') });

    await activeCanvas(page).hover();
    await page.keyboard.press('Control+s');
    const name = fileName(BENCH_100K);
    await expect(page.getByRole('status')).toHaveText(new RegExp(`Saved ${name}\\.`), {
      timeout: 60_000,
    });
    const b = await bench(page);
    expect(b.written[name]).toHaveLength(1);
    const save = b.written[name]![0]! - b.saveKey;
    report('bench-100k save in place', save, BUDGETS.save100k);

    expect(open).toBeLessThan(BUDGETS.open100k.budget);
    expect(save).toBeLessThan(BUDGETS.save100k.budget);
  });

  test('T7: bench-100k in memory, and no growth over 20 opens and closes', async ({ page }) => {
    test.setTimeout(600_000);
    await instrument(page);
    const cdp = await page.context().newCDPSession(page);
    await openBench(page, BENCH_100K);
    const open = await memory(cdp);
    test.info().annotations.push({
      type: 'bench-100k open, memory (MB)',
      description: `${mb(open.total)} (${Object.entries(open.parts)
        .map(([k, v]) => `${k} ${mb(v)}`)
        .join(', ')})`,
    });
    console.log(`bench perf, bench-100k open: ${mb(open.total)} MB`, open.parts);
    expect(open.total).toBeLessThan(T7_BYTES);
    await closeBench(page, BENCH_100K);

    // bench-ga's cycles (each opens it to its first frame and closes it): what a closed drawing
    // leaves behind shows after any number of them, and 20 of bench-100k would take minutes.
    let first: number | undefined;
    let last = 0;
    for (let i = 0; i < CYCLES; i++) {
      await openBench(page, BENCH_GA);
      await closeBench(page, BENCH_GA);
      if (i === 0 || i === CYCLES - 1) {
        // Closing a drawing ends its workers; they may take a moment to go.
        last = (await memory(cdp)).total;
        first ??= last;
      }
    }
    const growth = last / first! - 1;
    test.info().annotations.push({
      type: `memory after ${CYCLES} opens and closes of bench-ga (MB)`,
      description: `${mb(first!)} after the first, ${mb(last)} after the last (${(growth * 100).toFixed(1)} %)`,
    });
    console.log(
      `bench perf, ${CYCLES} cycles: ${mb(first!)} MB → ${mb(last)} MB (${(growth * 100).toFixed(1)} %)`,
    );
    expect(growth).toBeLessThanOrEqual(GROWTH);
  });
});
