// M1-60: PRD §12 T3 in the app itself. The generated bench-ga drawing (M1-42, DEC-045: 25k
// entities, a vessel-GA-sized drawing) is opened through the Open button, as a user opens a
// file, and then zoomed with the wheel and panned by dragging with the middle button, through
// Chromium's own input pipeline. The render harness (render.spec.ts) proves the renderer can
// draw 60 frames a second; this proves the app's wheel and pointer handling, view maths and
// renderer messaging keep up on top of it.
//
// A frame counts once the render worker has drawn it: the canvas controller fires `framedrawn`
// on its canvas for each frame the renderer acknowledges, and keeps one frame in flight at a
// time, so every event is a distinct picture (CanvasController, M1-60).
import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { BENCH_GA, benchDwg } from '../../../packages/testkit/src/bench/drawing';
import { activeCanvas, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

/** PRD §12 T3 (60 fps pan/zoom) less TESTING.md §5's 20 % runner margin. */
const T3_MIN_FPS = 60 * 0.8;
/** How long each gesture runs (TESTING.md §5: scripted pan/zoom for 5 s). */
const GESTURE_MS = 5000;
/** Events a second from the scripted mouse: a common USB mouse's report rate. */
const INPUT_HZ = 125;
/** Wheel pixels per event: a smooth (trackpad-like) wheel, 1.3 % zoom per event. */
const WHEEL_DELTA = 6;

let app: Awaited<ReturnType<typeof startApp>>;
let file: string;

test.beforeAll(async () => {
  app = await startApp();
  file = test.info().outputPath('bench-ga.dwg');
  writeFileSync(file, benchDwg(BENCH_GA));
});

test.afterAll(async () => {
  await app?.close();
});

interface Frames {
  /** When each frame was drawn (page clock), with the canvas it was drawn on. */
  readonly drawn: { t: number; canvas: EventTarget | null }[];
  inputs: number;
}

type Instrumented = Window & { __frames: Frames };

/**
 * Records every `framedrawn` from the first page script on. The event does not bubble, but a
 * capturing listener on the document sees it on any canvas, including the first frame of the
 * canvas made while a drawing opens.
 */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const f: Frames = { drawn: [], inputs: 0 };
    (window as unknown as Instrumented).__frames = f;
    document.addEventListener(
      'framedrawn',
      (e) => f.drawn.push({ t: performance.now(), canvas: e.target }),
      true,
    );
    for (const type of ['wheel', 'pointermove'])
      document.addEventListener(type, () => f.inputs++, { capture: true, passive: true });
  });
}

interface Measured {
  readonly frames: number;
  readonly fps: number;
  /** The longest wait for a frame: from the gesture's start, or between two frames. */
  readonly maxFrameMs: number;
  /** Input events the mouse sent: the gesture must outpace the display to measure it. */
  readonly sent: number;
  /** Input events the page saw (the browser coalesces pointer moves to one per frame). */
  readonly inputs: number;
}

/** Runs `gesture`, counting frames drawn on the visible canvas and input events meanwhile. */
async function measure(page: Page, gesture: () => Promise<number>): Promise<Measured> {
  const start = await page.evaluate(() => {
    const f = (window as unknown as Instrumented).__frames;
    f.inputs = 0;
    return { t: performance.now(), from: f.drawn.length };
  });
  const sent = await gesture();
  const m = await activeCanvas(page).evaluate((canvas, start) => {
    const f = (window as unknown as Instrumented).__frames;
    const end = performance.now();
    const drawn = f.drawn.slice(start.from).filter((d) => d.canvas === canvas);
    let maxFrameMs = 0;
    let last = start.t;
    for (const { t } of drawn) {
      maxFrameMs = Math.max(maxFrameMs, t - last);
      last = t;
    }
    const seconds = (end - start.t) / 1000;
    return { frames: drawn.length, fps: drawn.length / seconds, maxFrameMs, inputs: f.inputs };
  }, start);
  return { ...m, sent };
}

/**
 * A mouse that reports at {@link INPUT_HZ}, as a real one does. Playwright's `mouse.wheel` and
 * `mouse.move` wait for each event to be handled, which caps them near 30 and 60 events a
 * second here, so the gesture would measure Playwright instead of the app. These go to
 * Chromium's input pipeline directly, without waiting between events; the browser coalesces
 * pointer moves to one per frame as it does for a real mouse.
 */
async function mouseInput(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return async (ms: number, event: (t: number) => Record<string, unknown>): Promise<number> => {
    const sent: Promise<unknown>[] = [];
    const start = Date.now();
    for (let t = 0; t < ms; t = Date.now() - start) {
      sent.push(cdp.send('Input.dispatchMouseEvent', event(t) as never));
      await new Promise((resolve) => setTimeout(resolve, 1000 / INPUT_HZ));
    }
    await Promise.all(sent);
    return sent.length;
  };
}

/** Opens bench-ga with the Open button and waits for its first frame; returns the canvas box. */
async function openBenchGa(page: Page, info: ReturnType<typeof test.info>) {
  await instrument(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(app.url);
  const opened = await page.evaluate(() => performance.now());
  await openWithPicker(page, file);
  await expectShown(page, 'bench-ga.dwg');
  // The tab shows before the render worker has built its replica of the drawing; a gesture
  // started then would time the build, which is T2's (M10-01), not T3's.
  const firstFrame = () =>
    activeCanvas(page).evaluate(
      (canvas) =>
        (window as unknown as Instrumented).__frames.drawn.find((d) => d.canvas === canvas)?.t,
    );
  await expect.poll(firstFrame, { timeout: 30_000, message: 'no frame was drawn' }).toBeDefined();
  const first = (await firstFrame())!;
  const ms = first - opened;
  info.annotations.push({ type: 'open → first frame (ms)', description: ms.toFixed(0) });
  console.log(`app perf, bench-ga: open → first frame ${ms.toFixed(0)} ms`);
  return (await activeCanvas(page).boundingBox())!;
}

function report(info: ReturnType<typeof test.info>, name: string, m: Measured): void {
  info.annotations.push(
    { type: `${name} (fps)`, description: m.fps.toFixed(1) },
    { type: `${name} slowest frame (ms)`, description: m.maxFrameMs.toFixed(0) },
    { type: `${name} input events sent / seen`, description: `${m.sent} / ${m.inputs}` },
  );
  console.log(
    `app perf, bench-ga ${name}: ${m.fps.toFixed(1)} fps (${m.frames} frames), ` +
      `slowest frame ${m.maxFrameMs.toFixed(0)} ms, input events ${m.sent} sent / ${m.inputs} seen`,
  );
}

test.describe('T3 in the app on the generated bench-ga drawing', () => {
  test.describe.configure({ timeout: 120_000 });

  test('wheel zoom at the cursor keeps 60 fps', async ({ page }, info) => {
    const b = await openBenchGa(page, info);
    const x = b.x + b.width * 0.4;
    const y = b.y + b.height * 0.6;
    await page.mouse.move(x, y);
    const drive = await mouseInput(page);
    // In and out about the cursor, half a second each way (about 2.3× each), so the view stays
    // near the extents with every entity in view or close to it.
    const m = await measure(page, () =>
      drive(GESTURE_MS, (ms) => ({
        type: 'mouseWheel',
        x,
        y,
        deltaX: 0,
        deltaY: Math.floor(ms / 500) % 2 === 0 ? -WHEEL_DELTA : WHEEL_DELTA,
      })),
    );
    report(info, 'wheel zoom', m);
    expect(m.sent, 'the mouse must send more events than frames').toBeGreaterThan(m.frames);
    expect(m.fps).toBeGreaterThanOrEqual(T3_MIN_FPS);
  });

  test('middle-button drag pan keeps 60 fps', async ({ page }, info) => {
    const b = await openBenchGa(page, info);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'middle' });
    const drive = await mouseInput(page);
    // A circle of 150 px radius every two seconds, so the drawing stays mostly in view.
    const m = await measure(page, () =>
      drive(GESTURE_MS, (ms) => {
        const a = (ms / 2000) * 2 * Math.PI;
        return {
          type: 'mouseMoved',
          x: cx + 150 * Math.sin(a),
          y: cy - 150 * (1 - Math.cos(a)),
          button: 'middle',
          buttons: 4,
        };
      }),
    );
    await page.mouse.up({ button: 'middle' });
    report(info, 'middle-drag pan', m);
    expect(m.sent, 'the mouse must send more events than frames').toBeGreaterThan(m.frames);
    expect(m.fps).toBeGreaterThanOrEqual(T3_MIN_FPS);
  });
});
