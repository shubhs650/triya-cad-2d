// M9-07: the About dialog's smoke test. Tools > Help > About opens it, with no drawing open as
// with one; it shows the PlaneGCS module's notice (LGPL-2.1+ with the source link) and Eigen's
// (MPL-2.0 with the source link), the third-party software the app ships, and the LGPL's full
// text on request. ABOUT at the command line opens it too, transparently inside LINE, and closing
// it answers the command. What it lists is unit-tested in apps/web/test/about.test.ts.
// TRIYA_SHOTS=<dir> writes screenshots there.
import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { DXF, enterCommand, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const about = (page: Page) => page.getByRole('dialog', { name: 'About Triya CAD 2D' });

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

async function openFromRibbon(page: Page): Promise<Locator> {
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();
  await page
    .getByRole('group', { name: 'Help' })
    .getByRole('button', { name: 'About', exact: true })
    .click();
  await expect(about(page)).toBeVisible();
  return about(page);
}

test('Tools > About shows the PlaneGCS and Eigen notices with their source links', async ({
  page,
}) => {
  await page.goto(app.url);
  const dialog = await openFromRibbon(page);
  await expect(dialog).toContainText(/Triya CAD 2D v\d+\.\d+\.\d+/);

  const solver = dialog.getByRole('region', { name: 'Constraint solver module' });
  await expect(solver).toContainText(
    'under the GNU Lesser General Public License version 2.1 or later',
  );
  await expect(
    solver.getByRole('link', {
      name: 'https://github.com/FreeCAD/FreeCAD/tree/4fd3bf320d9566a27e60069fc8387448aaa3a094/src/Mod/Sketcher/App/planegcs',
    }),
  ).toBeVisible();
  await expect(solver).toContainText('Eigen 3.4.0, under the Mozilla Public License 2.0');
  await expect(
    solver.getByRole('link', { name: 'https://gitlab.com/libeigen/eigen/-/tree/3.4.0' }),
  ).toBeVisible();
  await expect(solver.getByRole('link', { name: 'https://mozilla.org/MPL/2.0/' })).toBeVisible();
  // Links open in a tab of their own; the dialog loads nothing from the network.
  for (const link of await dialog.getByRole('link').all()) {
    await expect(link).toHaveAttribute('target', '_blank');
  }
  await shot(page, '1-about-notices');

  const software = dialog.getByRole('region', { name: 'Third-party software' });
  await expect(software).toContainText('PlaneGCS (FreeCAD)');
  await expect(software).toContainText('LGPL-2.1+');
  await expect(software).toContainText('MPL-2.0');
  await expect(software).toContainText('The Hershey Fonts were originally created by');
  await software.getByText('Microsoft Fluent UI System Icons').scrollIntoViewIfNeeded();
  await shot(page, '2-about-third-party');

  // The LGPL's full text, read from the build when first shown.
  const lgpl = dialog.getByRole('button', { name: /GNU Lesser General Public License 2\.1/ });
  await expect(lgpl).toHaveAttribute('aria-expanded', 'false');
  await lgpl.click();
  await expect(lgpl).toHaveAttribute('aria-expanded', 'true');
  const text = dialog.getByLabel('GNU Lesser General Public License 2.1 (PlaneGCS)', {
    exact: true,
  });
  await expect(text).toContainText('GNU LESSER GENERAL PUBLIC LICENSE');
  await expect(text).toContainText('Version 2.1, February 1999');
  await text.scrollIntoViewIfNeeded();
  await shot(page, '3-about-lgpl-text');

  await page.keyboard.press('Escape');
  await expect(about(page)).toHaveCount(0);
});

test('ABOUT opens it at the command line and inside another command', async ({ page }) => {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');

  await enterCommand(page, 'ABOUT');
  await expect(about(page)).toBeVisible();
  await about(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(about(page)).toHaveCount(0);
  await expect(prompt(page)).toHaveText('Command:');

  // 'ABOUT inside LINE: LINE asks for its first point again once the dialog closes.
  await enterCommand(page, 'LINE');
  await expect(prompt(page)).toHaveText(/^Specify first point/);
  await page.keyboard.type("'ABOUT");
  await page.keyboard.press('Enter');
  await expect(about(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(about(page)).toHaveCount(0);
  await expect(prompt(page)).toHaveText(/^Specify first point/);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // Tools > About with the drawing open.
  await openFromRibbon(page);
  await shot(page, '4-about-over-drawing');
  await page.keyboard.press('Escape');
  await expect(about(page)).toHaveCount(0);
});
