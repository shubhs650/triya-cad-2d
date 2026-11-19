// M1-22 part 5: the document tabs behave like AutoCAD's file tabs (UI_SPEC.md §1). Dragging a
// tab moves it along the row; resting the pointer on a tab shows a preview of the drawing's
// Model and layouts, Model pictured as last drawn, and clicking one shows that drawing and
// space. The keyboard moves the focused tab with Ctrl+Shift+Page Up / Page Down. The close-out
// pictures the layouts not shown yet too, and resting on a thumbnail previews that space in the
// drawing area until the pointer leaves the preview, as AutoCAD does.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DWG, DXF, expectShown, inkOf, openWithPicker, paperPixels } from '../app/page';
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

  test('pictures layouts not shown yet on their sheets', async ({ page }) => {
    await openBoth(page);
    // The DWG has only shown its Model; its three layouts are pictured for the preview.
    await docTabs(page).nth(1).hover();
    const dwg = page.getByRole('group', { name: `${DWG_NAME} preview` });
    const thumbs = dwg.locator('canvas.thumbnail');
    await expect(thumbs).toHaveCount(4);
    for (let i = 1; i < 4; i++) {
      const layout = thumbs.nth(i);
      await expect(layout).toHaveAttribute('data-drawn', 'true', { timeout: 30_000 });
      // The white sheet on the grey surround: the stand-in is grey all over.
      expect(await paperPixels(page, layout)).toBeGreaterThan(500);
    }
    // Picturing a layout leaves the drawing as it was: still the DWG's Model, one Model canvas.
    await expect(page.getByTestId('space')).toHaveText('MODEL');
    const panel = await docTabs(page).nth(1).getAttribute('aria-controls');
    await expect(page.locator(`#${panel} canvas.drawing-canvas`)).toHaveCount(1);
  });

  test('previews a hovered thumbnail in the drawing area until the pointer leaves', async ({
    page,
  }) => {
    await openBoth(page);
    await docTabs(page).first().click();
    await expectShown(page, DXF_NAME);

    // Resting on the DWG's Layout2 thumbnail shows that drawing and layout.
    await docTabs(page).nth(1).hover();
    const dwg = page.getByRole('group', { name: `${DWG_NAME} preview` });
    await dwg.getByRole('button', { name: 'Layout2' }).hover();
    await expect(page.getByTestId('space')).toHaveText('PAPER');
    await expect(docTabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    const layoutTab = (name: string) =>
      page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab', { name });
    await expect(layoutTab('Layout2')).toHaveAttribute('aria-selected', 'true');
    // The preview still marks the space the drawing was in.
    await expect(dwg.getByRole('button', { name: 'Model' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    // Another thumbnail: that one shows.
    await dwg.getByRole('button', { name: 'MyLayout' }).hover();
    await expect(layoutTab('MyLayout')).toHaveAttribute('aria-selected', 'true');

    // Leaving the preview brings back what showed before.
    await page.mouse.move(400, 500);
    await expect(dwg).toBeHidden();
    await expectShown(page, DXF_NAME);
    await expect(page.getByTestId('space')).toHaveText('MODEL');
    // And the DWG is still in its Model.
    await docTabs(page).nth(1).click();
    await expect(page.getByTestId('space')).toHaveText('MODEL');

    // A click on a previewed thumbnail keeps it.
    await docTabs(page).first().click();
    await expectShown(page, DXF_NAME);
    await docTabs(page).nth(1).hover();
    await dwg.getByRole('button', { name: 'Layout1' }).hover();
    await expect(layoutTab('Layout1')).toHaveAttribute('aria-selected', 'true');
    await dwg.getByRole('button', { name: 'Layout1' }).click();
    await expect(dwg).toBeHidden();
    await page.mouse.move(400, 500);
    await expect(layoutTab('Layout1')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('space')).toHaveText('PAPER');
  });

  // M5-15: the preview used to reflow as each picture came in (a stand-in's 160 x 110 slot took
  // the picture's own size, and the right-edge clamp moved the preview 8 px left per picture),
  // so the thumbnail under a resting pointer slid away from it: the pointer left the preview and
  // the drawing went back, while the test's next look still expected the layout.
  test('keeps a thumbnail under the resting pointer while the pictures come in', async ({
    page,
  }) => {
    // Render workers made while `triyaHoldRender` is set keep their replies until it is
    // cleared: the layouts not shown yet are pictured only after the pointer rests.
    await page.addInitScript(() => {
      const w = window as unknown as { triyaHoldRender?: boolean; triyaRelease?: () => void };
      const held: (() => void)[] = [];
      w.triyaRelease = () => {
        w.triyaHoldRender = false;
        for (const f of held.splice(0)) f();
      };
      const Base = window.Worker;
      window.Worker = class extends Base {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          if (!w.triyaHoldRender || !String(url).includes('render')) return;
          const add = this.addEventListener.bind(this) as Worker['addEventListener'];
          this.addEventListener = ((type: string, listener: EventListener, o?: unknown) => {
            if (type !== 'message') return add(type, listener, o as AddEventListenerOptions);
            return add('message', (e) => {
              if (w.triyaHoldRender) held.push(() => listener.call(this, e));
              else listener.call(this, e);
            });
          }) as Worker['addEventListener'];
        }
      };
    });
    await openBoth(page);
    await docTabs(page).first().click();
    await expectShown(page, DXF_NAME);
    await page.evaluate(() => {
      (window as unknown as { triyaHoldRender: boolean }).triyaHoldRender = true;
    });

    await docTabs(page).nth(1).hover();
    const dwg = page.getByRole('group', { name: `${DWG_NAME} preview` });
    const layout2 = dwg.getByRole('button', { name: 'Layout2' });
    const thumbs = dwg.locator('canvas.thumbnail');
    // Model's thumbnail is its canvas's last frame; the layouts wait for their pictures.
    await expect(thumbs.first()).toHaveAttribute('data-drawn', 'true');
    await expect(thumbs.nth(1)).not.toHaveAttribute('data-drawn', 'true');
    const before = (await layout2.boundingBox())!;
    // Near the thumbnail's lower edge, where a preview that shrinks leaves the pointer behind.
    await layout2.hover({ position: { x: before.width / 2, y: before.height - 6 } });
    await expect(page.getByTestId('space')).toHaveText('PAPER');

    await page.evaluate(() => (window as unknown as { triyaRelease: () => void }).triyaRelease());
    for (let i = 1; i < 4; i++) {
      await expect(thumbs.nth(i)).toHaveAttribute('data-drawn', 'true', { timeout: 30_000 });
    }
    expect(await layout2.boundingBox()).toEqual(before);
    await expect(dwg).toBeVisible();
    await expect(page.getByTestId('space')).toHaveText('PAPER');
    await expect(docTabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  });
});
