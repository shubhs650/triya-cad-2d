// M3-04 part 6, as AutoCAD 2024 selects: a selection window being dragged previews what it would
// take (AutoCAD 2024 Help, "SELECTIONPREVIEWLIMIT (System Variable)": "whenever the selection
// set exceeds the number in this setting, all preview highlighting is discontinued"); PICKAUTO 2
// "begins a window or crossing selection even if the cursor is directly over an object … using
// the click, drag, and release method" at `Command:`; and STRETCH stretches by the crossing lasso
// it was selected with ("Select objects to stretch by crossing-window or crossing-polygon").
// Which objects a polygon previews, and how STRETCH treats each, is unit-tested
// (packages/render/test/select.test.ts, packages/engine/test/commands/edit.test.ts).
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, EntityId } from '@triya/engine';
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

interface DevHooks {
  changes(): readonly ChangeSet[];
  selection(): readonly EntityId[];
}

type Dev = { triyaDev: DevHooks };

const selected = (page: Page) =>
  page.evaluate(() => [...(window as unknown as Dev).triyaDev.selection()].sort((a, b) => a - b));
const added = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Dev).triyaDev
      .changes()
      .flatMap((cs) => (cs.entities?.added ?? []).map((a) => a.entity.id)),
  );
/** The ends of line `id` as its last change left it. */
const ends = (page: Page, id: EntityId) =>
  page.evaluate((id) => {
    let geom: unknown;
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) if (a.entity.id === id) geom = a.entity.geom;
      for (const u of cs.entities?.updated ?? []) if (u.after.id === id) geom = u.after.geom;
    }
    const g = geom as { start: { x: number; y: number }; end: { x: number; y: number } };
    return [g.start.x, g.start.y, g.end.x, g.end.y];
  }, id);
const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** Types a line at the command line and waits for the prompt that follows. */
async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
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

test('window preview, PICKAUTO 2 and STRETCH by a crossing lasso', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expectDrawn(page, { timeout: 15_000 });
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
  const move = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  };
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };

  // An empty part of the plan with two lines across it, a above b. Clicks keep to x ≤ 0.86:
  // the navigation bar's flyout can sit over the canvas's right-hand edge.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'OSMODE', /^Enter new value for OSMODE/);
  await type(page, '0', 'Command:');
  for (const y of [0.3, 0.7]) {
    await type(page, 'L', 'Specify first point:');
    await click(0.2, y);
    await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
    await click(0.8, y);
    await type(page, '', 'Command:');
  }
  const [a, b] = (await added(page)) as [EntityId, EntityId];
  const onA = at(0.35, 0.3);
  const onB = at(0.35, 0.7);
  await move(0.86, 0.5);
  expect(await lit(page, onA)).toBe(0);

  // A window clicked at Command: (left to right) lights up a, which it holds wholly; b, which it
  // crosses, stays dark. Short of a's end, a goes dark again.
  await click(0.1, 0.2);
  await expect(prompt(page)).toHaveText('Specify opposite corner:');
  await move(0.86, 0.5);
  await expect.poll(() => lit(page, onA)).toBeGreaterThan(10);
  expect(await lit(page, onB)).toBe(0);
  await shot(page, '1-window-preview');
  await move(0.6, 0.5);
  await expect.poll(() => lit(page, onA)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // A crossing window (right to left) lights up both lines it crosses.
  await click(0.85, 0.2);
  // The band follows the cursor once the canvas has the corner prompt.
  await expect(prompt(page)).toHaveText('Specify opposite corner:');
  await move(0.5, 0.8);
  await expect.poll(() => lit(page, onA)).toBeGreaterThan(10);
  await expect.poll(() => lit(page, onB)).toBeGreaterThan(10);
  await shot(page, '2-crossing-preview');
  await page.keyboard.press('Escape');

  // SELECTIONPREVIEWLIMIT 1: the crossing window takes two, so it previews none.
  await type(page, 'SELECTIONPREVIEWLIMIT', 'Enter new value for SELECTIONPREVIEWLIMIT <20000>:');
  await type(page, '1', 'Command:');
  await click(0.85, 0.2);
  // The band follows the cursor once the canvas has the corner prompt.
  await expect(prompt(page)).toHaveText('Specify opposite corner:');
  await move(0.5, 0.8);
  await page.waitForTimeout(300);
  expect(await lit(page, onA)).toBe(0);
  await page.keyboard.press('Escape');
  await type(page, 'SELECTIONPREVIEWLIMIT', 'Enter new value for SELECTIONPREVIEWLIMIT <1>:');
  await type(page, '20000', 'Command:');

  // PICKAUTO 5 (initially): a press on a dragged off it picks a alone.
  const press = at(0.5, 0.3);
  const release = at(0.45, 0.85);
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  await page.mouse.move(release.x, release.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => selected(page)).toEqual([a]);
  await page.keyboard.press('Escape');
  await expect.poll(() => selected(page)).toEqual([]);

  // PICKAUTO 7: the same press and drag is a crossing window from a, which takes b too.
  await type(page, 'PICKAUTO', 'Enter new value for PICKAUTO <5>:');
  await type(page, '7', 'Command:');
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  await page.mouse.move(release.x, release.y, { steps: 6 });
  await expect(prompt(page)).toHaveText('Specify opposite corner:');
  await shot(page, '3-pickauto-2-drag-from-object');
  await page.mouse.up();
  await expect.poll(() => selected(page)).toEqual([a, b].sort((x, y) => x - y));
  await expect(prompt(page)).toHaveText('Command:');
  await page.keyboard.press('Escape');
  await expect.poll(() => selected(page)).toEqual([]);
  await type(page, 'PICKAUTO', 'Enter new value for PICKAUTO <7>:');
  await type(page, '5', 'Command:');

  // STRETCH by a crossing lasso round a's right-hand end (dragged left from an empty place):
  // that end moves 10 up, the other stays; b, which the lasso misses, is not touched.
  const before = await ends(page, a);
  await type(page, 'STRETCH', 'Select objects:');
  const lasso: readonly (readonly [number, number])[] = [
    [0.84, 0.22],
    [0.72, 0.22],
    [0.72, 0.4],
    [0.84, 0.4],
  ];
  const first = at(...lasso[0]!);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const [x, y] of lasso.slice(1)) await move(x, y);
  await expect(prompt(page)).toHaveText('Crossing Lasso Press Spacebar to cycle options');
  await shot(page, '4-stretch-crossing-lasso');
  await page.mouse.up();
  await expect.poll(() => selected(page)).toEqual([a]);
  await type(page, '', 'Specify base point or [Displacement] <Displacement>:');
  await type(page, 'D', /^Specify displacement/);
  await type(page, '0,10', 'Command:');
  const after = await ends(page, a);
  expect(after[0]).toBeCloseTo(before[0]!, 6);
  expect(after[1]).toBeCloseTo(before[1]!, 6);
  expect(after[2]).toBeCloseTo(before[2]!, 6);
  expect(after[3]).toBeCloseTo(before[3]! + 10, 6);
  await move(0.9, 0.9);
  await shot(page, '5-stretched-by-lasso');
});
