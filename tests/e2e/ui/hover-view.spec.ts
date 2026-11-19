// M5-20: the selection preview and the rollover tooltip follow the view under a still cursor.
// image-attach.spec.ts failed on PR #571's CI with the checker image lit up and named by a
// Raster Image tooltip by a cursor resting over nothing after a typed ZOOM Window. The canvas
// sends a new view to its render worker only once the frame in flight is drawn (M1-60), and a
// frame with raster images can take a while, so the worker tested the pickbox, and the rest's
// pick, under the view from before the zoom; nothing tested them again once the view reached it.
// Here the render worker's frames are held (their flush answers wait) so that the view lags as
// on a slow runner: what the pickbox lit and the tooltip named under the old view go once the
// new view is drawn, and what lies under the cursor in the new view lights up and is named.
import { expect, test, type Page } from '@playwright/test';
import { DXF, activeCanvas, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** ZOOM Center: (x, y) of the empty part of the plan at the canvas's centre, 100 units high. */
async function zoomCentre(page: Page, x: number, y: number): Promise<void> {
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, 'C', /^Specify center point/);
  await type(page, `${1000000 + x},${1000000 + y}`, /^Enter magnification or height/);
  await type(page, '100', 'Command:');
}

/** Pixels in the selection colour (#4DA3FF and its glow) in a square of the page around a point. */
async function lit(page: Page, p: { x: number; y: number }, r = 8): Promise<number> {
  const png = await page.screenshot({
    clip: { x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r },
  });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [R, G, B] = [d[i]!, d[i + 1]!, d[i + 2]!];
      if (B > 150 && B - R > 80 && G > R) n++;
    }
    return n;
  }, png.toString('base64'));
}

/** Holds the answers to the render workers' flushes while `triyaHoldFrames` is set. */
function holdFrames(page: Page) {
  return page.addInitScript(() => {
    const w = window as unknown as { triyaHoldFrames?: boolean; triyaRelease?: () => void };
    const held: (() => void)[] = [];
    w.triyaRelease = () => {
      w.triyaHoldFrames = false;
      for (const f of held.splice(0)) f();
    };
    const Base = window.Worker;
    window.Worker = class extends Base {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes('render')) return;
        const flushes = new Set<number>();
        const post = this.postMessage.bind(this) as (m: unknown, t?: Transferable[]) => void;
        this.postMessage = ((m: unknown, t?: Transferable[]) => {
          const msg = m as { type?: string; id?: number } | undefined;
          if (w.triyaHoldFrames && msg?.type === 'flush' && msg.id !== undefined) {
            flushes.add(msg.id);
          }
          return t ? post(m, t) : post(m);
        }) as Worker['postMessage'];
        const add = this.addEventListener.bind(this) as Worker['addEventListener'];
        this.addEventListener = ((type: string, listener: EventListener, o?: unknown) => {
          if (type !== 'message') return add(type, listener, o as AddEventListenerOptions);
          return add('message', (e) => {
            const id = ((e as MessageEvent).data as { id?: number } | undefined)?.id;
            if (id !== undefined && flushes.delete(id)) held.push(() => listener.call(this, e));
            else listener.call(this, e);
          });
        }) as Worker['addEventListener'];
      }
    };
  });
}

const hold = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { triyaHoldFrames: boolean }).triyaHoldFrames = true;
  });
const release = (page: Page) =>
  page.evaluate(() => (window as unknown as { triyaRelease(): void }).triyaRelease());

test('the selection preview and rollover tooltip follow a view that lands late (M5-20)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await holdFrames(page);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);

  // View A: an empty part of the plan centred on (80, 50), and a line across its middle.
  await zoomCentre(page, 80, 50);
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000060,1000050', 'Specify next point or [Undo]:');
  await type(page, '1000100,1000050', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });

  const box = (await canvas.boundingBox())!;
  // The canvas's centre: on the line in view A, 25 units below it in view B (centred 80, 25),
  // where the line runs a quarter of the canvas's height higher up.
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const tip = page.getByRole('tooltip').and(page.getByTestId('rollover-tooltip'));
  const park = () => page.mouse.move(box.x + box.width / 2, box.y - 40);
  await park();

  // A frame held in flight (the zoom to A again), then the zoom to B: the worker keeps view A.
  await hold(page);
  await zoomCentre(page, 80, 50);
  await zoomCentre(page, 80, 25);
  // The cursor comes to rest at the centre: under the worker's view A the line is there, but
  // the pickbox and the rest's pick are tested under view B, which they were made in (M5-23).
  await page.mouse.move(centre.x - 30, centre.y - 30);
  await page.mouse.move(centre.x, centre.y, { steps: 4 });
  await page.waitForTimeout(800);
  await expect(tip).toBeHidden();
  // The frame is drawn and view B reaches the worker: still nothing is under the cursor.
  await release(page);
  await expectDrawn(page, { timeout: 15_000 });
  await expect(tip).toBeHidden();
  await page.waitForTimeout(800);
  await expect(tip).toBeHidden();
  // The line, a quarter of the canvas higher up in view B, is drawn unlit.
  const line = { x: centre.x, y: centre.y - (box.height * 25) / 100 };
  await expect.poll(() => lit(page, line), { timeout: 5_000 }).toBe(0);

  // And the other way: the cursor rests over nothing; a view lands that puts the line under it.
  await hold(page);
  await zoomCentre(page, 80, 25);
  await zoomCentre(page, 80, 50);
  await page.waitForTimeout(800);
  await expect(tip).toBeHidden();
  await release(page);
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Line');
  await expect.poll(() => lit(page, centre), { timeout: 5_000 }).toBeGreaterThan(0);
});

// M5-23: a click at a selection prompt right after a zoom takes what lies under it in the new
// view. The engine's pick turns the click into a world point, the canvas turns that into screen
// pixels by its new view and asks the render worker what is there; while a frame is in flight
// the worker still holds the view from before the zoom, so it looked in the wrong place.
test('a pick right after a zoom takes the object under it in the new view (M5-23)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await holdFrames(page);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  const history = page.getByRole('log', { name: 'Recent command lines' });

  // View A centred on (80, 50), a line across its middle.
  await zoomCentre(page, 80, 50);
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000060,1000050', 'Specify next point or [Undo]:');
  await type(page, '1000100,1000050', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y - 40);

  // A frame held in flight, then the zoom to view B (centred 80, 25): the worker keeps view A.
  await hold(page);
  await zoomCentre(page, 80, 50);
  await zoomCentre(page, 80, 25);
  await type(page, 'ERASE', /^Select objects/);
  // In view B the line runs a quarter of the canvas's height above the centre; in view A that
  // point is 25 units above the line, over nothing.
  const line = { x: box.x + box.width / 2, y: box.y + box.height / 2 - (box.height * 25) / 100 };
  await page.mouse.move(line.x - 30, line.y - 30);
  await page.mouse.move(line.x, line.y, { steps: 4 });
  await page.mouse.click(line.x, line.y);
  await expect(history).toContainText('Select objects: 1 found');
  await expect(prompt(page)).toHaveText(/^Select objects/);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await release(page);
  await expectDrawn(page, { timeout: 15_000 });
});
