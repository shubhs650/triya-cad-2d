// M6-03: the status bar's annotation scale controls on the acadsharp AC1032 sample, whose
// annotative TEXT "Hello this is a single line text" (3BA, model space) supports 1:1 only. The
// Annotation Scale button shows CANNOSCALE (1:1) and lists the drawing's scales; 1:2 picked sets
// CANNOSCALE as typed at `Command:` (one undo step); with Annotation Visibility on the text still
// shows, off (ANNOALLVISIBLE 0) it is hidden, and back at 1:1 it shows again. AutoScale on makes
// a scale change say that Triya adds no scale to objects (DEC-013). A layout shows no controls.
// The engine, renderer and corpus behaviour are unit-tested (annotation-scale.test.ts,
// canvas2d-annotation.test.ts, annotation-visibility.corpus.test.ts).
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import path from 'node:path';
import {
  enterCommand,
  expectDrawn,
  expectInputsRead,
  expectShown,
  openWithPicker,
  viewOf,
  gridOff,
} from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const FILE = path.join(CORPUS, 'acadsharp/sample_AC1032_ascii.dxf');
type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The value the change sets last gave header variable `name`. */
const headerNow = (page: Page, name: string) =>
  page.evaluate((n) => {
    let out: unknown;
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const h of cs.header ?? []) if (h.name === n) out = h.after;
    }
    return out;
  }, name);

/** Pixels in a box of the page that differ from its first pixel (the canvas background). */
async function ink(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const png = await page.screenshot({ clip: box });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const diff =
        Math.abs(d[i]! - d[0]!) + Math.abs(d[i + 1]! - d[1]!) + Math.abs(d[i + 2]! - d[2]!);
      if (diff > 60) n++;
    }
    return n;
  }, png.toString('base64'));
}

test('the annotation scale, Annotation Visibility and AutoScale on the status bar', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  // The ink below is the text's alone, not the grid's the drawing was saved with.
  await gridOff(page);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const scale = page.getByRole('button', { name: 'Annotation Scale' });
  const visibility = page.getByRole('button', { name: 'Annotation Visibility' });
  const autoScale = page.getByRole('button', { name: 'AutoScale' });
  await expect(scale).toHaveText('1:1 ▴');
  await expect(visibility).toHaveAttribute('aria-pressed', 'true');
  await expect(autoScale).toHaveAttribute('aria-pressed', 'false');

  // The annotative text alone on the canvas: about 147.8 … 167 by 10.3 … 11.3.
  await enterCommand(page, 'ZOOM');
  await page.keyboard.type('W');
  await page.keyboard.press('Enter');
  await page.keyboard.type('146,8');
  await page.keyboard.press('Enter');
  await page.keyboard.type('174,13.5');
  await page.keyboard.press('Enter');
  await expectInputsRead(page);
  await expectDrawn(page);
  const v = await viewOf(page);
  await page.mouse.move(v.box.x + 5, v.box.y + 5);
  const a = v.at(147.5, 12);
  const b = v.at(169, 10);
  const text = { x: v.box.x + a.x, y: v.box.y + a.y, width: b.x - a.x, height: b.y - a.y };
  const shown = await ink(page, text);
  expect(shown).toBeGreaterThan(50);

  // The scale list, the current scale checked; 1:2 picked.
  await scale.click();
  const menu = page.getByRole('menu', { name: 'Annotation scales' });
  await expect(menu.getByRole('menuitemradio', { name: '1:1', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(menu.getByRole('menuitemradio')).toHaveCount(33);
  await shot('1-annotation-scale-list.png');
  await menu.getByRole('menuitemradio', { name: '1:2', exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(scale).toHaveText('1:2 ▴');
  expect(await headerNow(page, 'CANNOSCALE')).toBe('1:2');
  expect(await headerNow(page, 'CANNOSCALEVALUE')).toBe(0.5);
  // ANNOALLVISIBLE 1: the text not supporting 1:2 still shows.
  await expectDrawn(page);
  await expect.poll(() => ink(page, text)).toBeGreaterThan(shown / 2);

  // Annotation Visibility off: hidden.
  await visibility.click();
  await expect(visibility).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => ink(page, text)).toBeLessThan(5);
  await shot('2-hidden-at-1-2.png');
  // Back at 1:1 by undo (one step): shown again, ANNOALLVISIBLE still 0.
  await enterCommand(page, 'U');
  await expect(scale).toHaveText('1:1 ▴');
  await expect.poll(() => ink(page, text)).toBeGreaterThan(shown / 2);

  // AutoScale on: a scale change says Triya adds no scale to objects.
  await autoScale.click();
  await expect(autoScale).toHaveAttribute('aria-pressed', 'true');
  await scale.click();
  await page
    .getByRole('menu', { name: 'Annotation scales' })
    .getByRole('menuitemradio', { name: '1:2', exact: true })
    .click();
  await expect(scale).toHaveText('1:2 ▴');
  const log = page.getByRole('log', { name: 'Recent command lines' });
  await expect(log).toContainText(
    'Triya does not add annotation scales to objects: annotative objects keep the scales they have.',
  );
  await expect.poll(() => ink(page, text)).toBeLessThan(5);
  await shot('3-autoscale-notice.png');

  // SETVAR's ANNOALLVISIBLE is the button.
  await enterCommand(page, 'ANNOALLVISIBLE');
  await page.keyboard.type('1');
  await page.keyboard.press('Enter');
  await expect(visibility).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => ink(page, text)).toBeGreaterThan(shown / 2);

  // A layout shows no annotation scale controls.
  await page.getByRole('tab', { name: 'Layout1' }).click();
  await expect(page.getByTestId('space')).toHaveText('PAPER');
  await expect(scale).toBeHidden();
});
