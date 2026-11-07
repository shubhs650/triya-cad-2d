// M1-22 part 5: the document tabs behave like AutoCAD's file tabs (UI_SPEC.md §1). Dragging a
// tab moves it along the row; resting the pointer on a tab shows a preview of the drawing's
// Model and layouts, Model pictured as last drawn, and clicking one shows that drawing and
// space. The keyboard moves the focused tab with Ctrl+Shift+Page Up / Page Down.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DWG, DXF, expectShown, inkOf, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const DXF_NAME = path.basename(DXF);
const DWG_NAME = path.basename(DWG);

const docTabs = (page: Page) =>
  page.getByRole('tablist', { name: 'Open drawings' }).getByRole('tab');

async function openBoth(page: Page): Promise<void> {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, DXF_NAME);
  await openWithPicker(page, DWG);
  await expectShown(page, DWG_NAME);
  await expect(docTabs(page)).toHaveText([DXF_NAME, DWG_NAME]);
}

test.describe('document tabs', () => {
  test.describe.configure({ timeout: 90_000 });

  test('drags a tab to a new place along the row', async ({ page }) => {
    await openBoth(page);
    const first = (await docTabs(page).first().boundingBox())!;
    const second = (await docTabs(page).nth(1).boundingBox())!;
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    // Past the second tab's middle: the dragged tab goes after it, and shows.
    await page.mouse.move(second.x + second.width * 0.75, second.y + 5, { steps: 8 });
    await page.mouse.move(second.x + second.width + 10, second.y + 5, { steps: 4 });
    await page.mouse.up();
    await expect(docTabs(page)).toHaveText([DWG_NAME, DXF_NAME]);
    await expectShown(page, DXF_NAME);

    // A click without a drag still just shows the tab.
    await docTabs(page).first().click();
    await expectShown(page, DWG_NAME);
    await expect(docTabs(page)).toHaveText([DWG_NAME, DXF_NAME]);
  });

  test('moves the focused tab with Ctrl+Shift+Page Up and Page Down', async ({ page }) => {
    await openBoth(page);
    await docTabs(page).nth(1).focus();
    await page.keyboard.press('Control+Shift+PageUp');
    await expect(docTabs(page)).toHaveText([DWG_NAME, DXF_NAME]);
    await page.keyboard.press('Control+Shift+PageDown');
    await expect(docTabs(page)).toHaveText([DXF_NAME, DWG_NAME]);
  });

  test('previews a drawing’s Model and layouts and shows the one clicked', async ({ page }) => {
    await openBoth(page);
    // The DXF's tab, while the DWG shows: its Model was drawn when it opened.
    await docTabs(page).first().hover();
    const preview = page.getByRole('group', { name: `${DXF_NAME} preview` });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('button').first()).toHaveText('Model');
    const model = preview.locator('canvas.thumbnail').first();
    await expect(model).toHaveAttribute('data-drawn', 'true');
    expect(await inkOf(page, model)).toBeGreaterThan(20);
    // Leaving the tab and the preview hides it.
    await page.mouse.move(400, 500);
    await expect(preview).toBeHidden();

    // The DWG lists its three layouts after Model; picking one shows it on its sheet.
    await docTabs(page).nth(1).hover();
    const dwg = page.getByRole('group', { name: `${DWG_NAME} preview` });
    await expect(dwg.getByRole('button')).toHaveText(['Model', 'Layout1', 'Layout2', 'MyLayout']);
    await expect(dwg.getByRole('button', { name: 'Model' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await dwg.getByRole('button', { name: 'Layout2' }).click();
    await expect(dwg).toBeHidden();
    await expect(page.getByTestId('space')).toHaveText('PAPER');
    await expect(
      page
        .getByRole('tablist', { name: 'Model and layouts' })
        .getByRole('tab', { name: 'Layout2' }),
    ).toHaveAttribute('aria-selected', 'true');

    // From the DXF's preview, its Model: that drawing shows.
    await docTabs(page).first().hover();
    await page
      .getByRole('group', { name: `${DXF_NAME} preview` })
      .getByRole('button', { name: 'Model' })
      .click();
    await expectShown(page, DXF_NAME);
    await expect(page.getByTestId('space')).toHaveText('MODEL');
  });
});
