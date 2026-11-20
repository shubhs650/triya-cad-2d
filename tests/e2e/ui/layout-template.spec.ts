// M6-01 part 4: LAYOUT Template (the layout tab menu's From Template... and its Insert Layout(s)
// dialog) and LAYOUT SAveas. ezdxf's colors.dxf (Layout1 and Layout2, no viewports) takes Layout2
// and MyLayout from ACadSharp's AC1032 sample, Layout2 as "Layout2 (2)" and MyLayout's viewport
// showing colors.dxf's model space; SAveas then writes MyLayout as a template DXF, which opens
// with that one layout.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { activeCanvas, enterCommand, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';

const TARGET = path.join(CORPUS, 'ezdxf/examples_dxf/colors.dxf');
const TEMPLATE = path.join(CORPUS, 'acadsharp/sample_AC1032_ascii.dxf');

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

test('From Template... inserts layouts picked in the Insert Layout(s) dialog, and SAveas writes one as a template', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, TARGET);
  await expectShown(page, path.basename(TARGET));
  const shot = async (name: string) => {
    // The cursor off the navigation bar, whose menu it would open.
    await page.mouse.move(640, 690);
    await page.screenshot({ path: test.info().outputPath(`m6-01-part4-${name}.png`) });
  };
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  await expect(tabs).toHaveText(['Model', 'Layout1', 'Layout2']);
  await shot('1-before');

  // From Template... opens Insert Layout(s); the file's layouts come all selected.
  await tabs.nth(0).click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'Layout tab' })
    .getByRole('menuitem', { name: 'From Template...' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Insert Layout(s)' });
  await expect(dialog).toBeVisible();
  const ok = dialog.getByRole('button', { name: 'OK' });
  await expect(ok).toBeDisabled();
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Select Template From File...' }).click();
  await (await chooser).setFiles(TEMPLATE);
  await expect(dialog.getByTestId('insert-layouts-file')).toHaveText(path.basename(TEMPLATE));
  const list = dialog.getByRole('listbox', { name: 'Layout name(s):' });
  await expect(list.getByRole('option')).toHaveText(['Layout1', 'Layout2', 'MyLayout']);
  await expect(list.getByRole('option', { selected: true })).toHaveCount(3);
  await list.selectOption(['Layout2', 'MyLayout']);
  await shot('2-insert-layouts');
  await ok.click();
  await expect(dialog).toBeHidden();
  const all = ['Model', 'Layout1', 'Layout2', 'Layout2 (2)', 'MyLayout'];
  await expect(tabs).toHaveText(all);
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText(
    'Inserted 2 layouts from sample_AC1032_ascii.dxf: Layout2 (2), MyLayout.',
  );

  // MyLayout's sheet, its viewport showing this drawing's model space.
  await tabs.nth(4).click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout MyLayout');
  await expectDrawn(page, { timeout: 15_000 });
  await shot('3-inserted-layout');

  // One U takes both back.
  await enterCommand(page, 'U');
  await expect(tabs).toHaveText(['Model', 'Layout1', 'Layout2']);
  await enterCommand(page, 'REDO');
  await expect(tabs).toHaveText(all);
  await tabs.nth(4).click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout MyLayout');

  // SAveas: MyLayout (the layout shown) as a template DXF, downloaded.
  await page.evaluate(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await enterCommand(page, 'LAYOUT');
  await type(page, 'SA', 'Enter layout to save to template <MyLayout>:');
  await type(page, '', 'Enter template file name <MyLayout.dxf>:');
  const download = page.waitForEvent('download');
  await type(page, '', 'Command:');
  const file = await download;
  expect(file.suggestedFilename()).toBe('MyLayout.dxf');
  const saved = test.info().outputPath('MyLayout.dxf');
  await file.saveAs(saved);
  await openWithPicker(page, saved);
  await expectShown(page, 'MyLayout.dxf');
  await expect(tabs).toHaveText(['Model', 'MyLayout']);
  await tabs.nth(1).click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout MyLayout');
  await expectDrawn(page, { timeout: 15_000 });
  await shot('4-template-opened');
});
