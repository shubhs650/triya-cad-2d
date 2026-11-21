// M6-06: what a new layout gets the first time it is shown. sample_AC1018.dwg has three layouts;
// a fourth made by the tab menu's New Layout and shown gets a viewport filling its printable area
// that shows model space (LAYOUTCREATEVIEWPORT 1, AutoCAD's initial value), which U takes away;
// with LAYOUTCREATEVIEWPORT 0 the next one gets none. The Page Setup Manager's "Display when
// creating a new layout" (SHOWPAGESETUPFORNEWLAYOUTS) opens the manager on the next one first, and
// its Page Setup dialog's Preview... shows the plot preview and comes back.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  DWG,
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectInputsRead,
  expectShown,
  lightPixels,
  openWithPicker,
} from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Change = {
  entities?: {
    added?: { entity: { handle: string; owner: string; geom: { kind: string } } }[];
    removed?: { entity: { handle: string } }[];
  };
};
type Dev = {
  triyaDev: {
    layouts(): { name: string; blockRecord: string }[];
    changes(): readonly Change[];
  };
};

/** The viewports on a layout's sheet that the drawing's changes have made and not taken back. */
const viewportsMade = (page: Page, layout: string) =>
  page.evaluate((name) => {
    const dev = (window as unknown as Dev).triyaDev;
    const block = dev.layouts().find((l) => l.name === name)?.blockRecord;
    const made = new Set<string>();
    for (const c of dev.changes()) {
      for (const a of c.entities?.added ?? []) {
        if (a.entity.owner === block && a.entity.geom.kind === 'VIEWPORT')
          made.add(a.entity.handle);
      }
      for (const r of c.entities?.removed ?? []) made.delete(r.entity.handle);
    }
    return made.size;
  }, layout);

test('a new layout gets a viewport showing model space the first time it is shown', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  const menu = page.getByRole('menu', { name: 'Layout tab' });
  const newLayout = async (name: string) => {
    await tabs.nth(0).click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'New Layout' }).click();
    await expect(tabs.last()).toHaveText(name);
  };

  await newLayout('Layout4');
  // Not shown yet: LAYOUT New makes no viewport.
  expect(await viewportsMade(page, 'Layout4')).toBe(0);
  await tabs.last().click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout Layout4');
  await expectDrawn(page, { timeout: 15_000 });
  // The layout's own paper-space viewport and the floating one.
  await expect.poll(() => viewportsMade(page, 'Layout4')).toBe(2);
  await expectInputsRead(page);

  // The sheet's middle shows model space through the viewport; U leaves the paper blank there.
  const box = (await activeCanvas(page).boundingBox())!;
  const a = { x: box.width * 0.3, y: box.height * 0.3 };
  const b = { x: box.width * 0.7, y: box.height * 0.7 };
  const blank = () => lightPixels(page, a, b);
  const shown = await blank();
  await enterCommand(page, 'U');
  await expect.poll(() => viewportsMade(page, 'Layout4')).toBe(0);
  await expect.poll(blank).toBeGreaterThan(shown + 200);
  const empty = await blank();

  // LAYOUTCREATEVIEWPORT 0: the next new layout shown gets none.
  await enterCommand(page, 'LAYOUTCREATEVIEWPORT');
  await enterCommand(page, '0');
  await newLayout('Layout5');
  await tabs.last().click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout Layout5');
  await expectDrawn(page, { timeout: 15_000 });
  await expectInputsRead(page);
  expect(await viewportsMade(page, 'Layout5')).toBe(0);
  await enterCommand(page, 'LAYOUTCREATEVIEWPORT');
  await enterCommand(page, '1');

  // "Display when creating a new layout": the manager opens on the next new layout first shown.
  const manager = page.getByRole('dialog', { name: 'Page Setup Manager' });
  await tabs.last().click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Page Setup Manager...' }).click();
  const show = manager.getByRole('checkbox', { name: 'Display when creating a new layout' });
  await expect(show).not.toBeChecked();
  await show.check();
  await manager.getByRole('button', { name: 'Close' }).click();
  await expect(manager).toBeHidden();
  await newLayout('Layout6');
  await tabs.last().click();
  await expect(manager).toBeVisible();
  await expect(manager).toContainText('Layout6');
  await expect(show).toBeChecked();

  // The Page Setup dialog's Preview... shows the plot preview; closing it brings the dialogs back.
  await manager.getByRole('button', { name: 'Modify...' }).click();
  const setup = page.getByRole('dialog', { name: 'Page Setup - Layout6' });
  await setup.getByRole('button', { name: 'Preview…' }).click();
  const preview = page.getByRole('region', { name: /^Plot preview - / });
  await expect(preview).toBeVisible();
  await expect(manager).toBeHidden();
  await preview.getByRole('button', { name: 'Close Preview Window' }).click();
  await expect(preview).toBeHidden();
  await expect(setup).toBeVisible();
  await setup.getByRole('button', { name: 'Cancel' }).click();
  await manager.getByRole('button', { name: 'Close' }).click();
  await expect(manager).toBeHidden();
  // The viewport is made once the manager closes.
  await expect.poll(() => viewportsMade(page, 'Layout6')).toBe(2);
  await expectDrawn(page, { timeout: 15_000 });
  await expect.poll(blank).toBeLessThan(empty - 200);
});
