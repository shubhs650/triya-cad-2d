// M1-97: the layout tabs and a layout's sheet follow the layout change sets the drawing's engine
// applies (LAYOUT Rename, dragging a layout tab and PAGESETUP will send them, M6), without
// reopening the drawing; the inverse edits put everything back. sample_AC1018.dwg has three
// layouts: Layout1, Layout2 and MyLayout.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { EditResult, EngineEdit, Layout } from '@triya/engine';
import { DWG, activeCanvas, expectShown, openWithPicker, paperPixels } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

interface DevHooks {
  layouts(): Layout[];
  edit(edit: EngineEdit): Promise<EditResult>;
}

const layouts = (page: Page) =>
  page.evaluate(() => (window as unknown as { triyaDev: DevHooks }).triyaDev.layouts());

async function edit(page: Page, e: EngineEdit): Promise<void> {
  const r = await page.evaluate(
    (x) => (window as unknown as { triyaDev: DevHooks }).triyaDev.edit(x),
    e,
  );
  expect(r).toMatchObject({ ok: true });
}

test('layout tabs and the sheet follow renames, moves and page setup changes', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  await expect(tabs).toHaveText(['Model', 'Layout1', 'Layout2', 'MyLayout']);
  await tabs.nth(1).click();
  await expect(page.getByTestId('space')).toHaveText('PAPER');
  await expect.poll(() => paperPixels(page), { timeout: 15_000 }).toBeGreaterThan(50_000);
  const sheet = await paperPixels(page);

  const byName = new Map((await layouts(page)).map((l) => [l.name, l]));
  const layout1 = byName.get('Layout1')!;
  const layout2 = byName.get('Layout2')!;
  const mine = byName.get('MyLayout')!;
  expect(layout1.plot).toBeDefined();
  const plot = layout1.plot!;

  await edit(page, { kind: 'layout', layout: layout2.handle, name: 'Plan' });
  await expect(tabs).toHaveText(['Model', 'Layout1', 'Plan', 'MyLayout']);
  await edit(page, { kind: 'layout', layout: mine.handle, tabOrder: 1 });
  await expect(tabs).toHaveText(['Model', 'MyLayout', 'Layout1', 'Plan']);
  // The layout showing stays the one showing, wherever its tab went.
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');

  // A sheet half as wide and half as high: about a quarter of the paper.
  await edit(page, {
    kind: 'layout',
    layout: layout1.handle,
    plot: { ...plot, paperWidth: plot.paperWidth / 2, paperHeight: plot.paperHeight / 2 },
  });
  await expect.poll(() => paperPixels(page)).toBeLessThan(sheet * 0.4);

  // The inverse edits restore the tabs and the sheet.
  await edit(page, { kind: 'layout', layout: layout1.handle, plot });
  await edit(page, { kind: 'layout', layout: mine.handle, tabOrder: 3 });
  await edit(page, { kind: 'layout', layout: layout2.handle, name: 'Layout2' });
  await expect(tabs).toHaveText(['Model', 'Layout1', 'Layout2', 'MyLayout']);
  await expect.poll(() => paperPixels(page)).toBeGreaterThan(sheet * 0.95);
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout Layout1');

  // A layout shown for the first time after the edits starts from them.
  await edit(page, { kind: 'layout', layout: mine.handle, name: 'Sheet' });
  await tabs.nth(3).click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout Sheet');
});
