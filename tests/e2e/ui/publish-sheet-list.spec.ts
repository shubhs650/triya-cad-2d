// M2-45 part 3: the Publish dialog's sheet list saved and loaded (a DSD file, as AutoCAD's Save
// Sheet List and Load Sheet List write and read it) and "Open in viewer when done". A list naming
// a drawing that is not open lists its sheets as "Drawing file not found" until Add Sheets
// supplies the drawing; loading over a list asks to Replace or Append.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { pdfSummary } from '../../../packages/testkit/src/pdf/read';
import { DWG, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

const PAGE_SETUPS = path.join(
  import.meta.dirname,
  '../../../packages/testkit/fixtures/page-setups/page-setups.dxf',
);

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

async function openPublish(page: Page) {
  const input = page.getByLabel('Command', { exact: true });
  await input.fill('PUBLISH');
  await input.press('Enter');
  const d = page.getByRole('dialog', { name: 'Publish' });
  await expect(d).toBeVisible();
  return d;
}

const sheetNames = (page: Page) =>
  page
    .getByRole('table', { name: 'Sheets to publish' })
    .getByRole('checkbox')
    .evaluateAll((els) => els.map((e) => e.parentElement!.textContent!.trim()));

const statusOf = (page: Page, sheet: string) =>
  page
    .getByRole('table', { name: 'Sheets to publish' })
    .getByRole('row')
    .filter({ hasText: sheet })
    .getByRole('cell')
    .last();

test('Save Sheet List and Load Sheet List keep the list; Add Sheets finds a drawing not open (M2-45 part 3)', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, PAGE_SETUPS);
  await expectShown(page, path.basename(PAGE_SETUPS));
  let d = await openPublish(page);
  await d.getByLabel('Page setup of page-setups-Layout1').selectOption('A3 Monochrome');
  await d.getByRole('checkbox', { name: 'page-setups-Model' }).uncheck();
  await d.getByLabel('Open in viewer when done').check();
  await d.getByLabel('Publish to').selectOption('png');
  await d.getByLabel('Resolution').selectOption('300');

  // Save Sheet List: the list as a DSD.
  const saving = page.waitForEvent('download');
  await d.getByRole('button', { name: 'Save Sheet List…' }).click();
  const saved = await saving;
  expect(saved.suggestedFilename()).toBe('page-setups.dsd');
  const text = readFileSync((await saved.path())!, 'utf8');
  const lines = text.split('\r\n');
  const at = lines.indexOf('[DWF6Sheet:page-setups-Layout1]');
  expect(lines.slice(at + 1, at + 4)).toEqual([
    'DWG=page-setups.dxf',
    'Layout=Layout1',
    'Setup=A3 Monochrome',
  ]);
  expect(lines).toContain('Include=FALSE');
  expect(lines).toContain('ViewFile=TRUE');
  expect(lines).toContain('PublishTo=PNG');

  // The list with a sheet of the DWG, which is not open, named by a full path as AutoCAD writes.
  const list = test.info().outputPath('with-dwg.dsd');
  writeFileSync(
    list,
    text.replace(
      '[SheetSet Properties]',
      '[DWF6Sheet:sample_AC1018-Model]\r\nDWG=C:\\Drawings\\sample_AC1018.dwg\r\nLayout=Model\r\nSetup=\r\n[SheetSet Properties]',
    ),
  );
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toBeHidden();

  // A fresh Publish dialog lists both sheets, so loading asks to Replace or Append.
  d = await openPublish(page);
  expect(await sheetNames(page)).toEqual(['page-setups-Model', 'page-setups-Layout1']);
  await expect(d.getByLabel('Open in viewer when done')).not.toBeChecked();
  const load = async () => {
    const chooser = page.waitForEvent('filechooser');
    await d.getByRole('button', { name: 'Load Sheet List…' }).click();
    await (await chooser).setFiles(list);
  };
  const ask = page.getByRole('dialog', { name: 'Replace or Append' });
  // Esc is Cancel: the list stays as it was.
  await load();
  await expect(ask).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ask).toBeHidden();
  await expect(d).toBeVisible();
  expect(await sheetNames(page)).toEqual(['page-setups-Model', 'page-setups-Layout1']);

  await load();
  await ask.getByRole('button', { name: 'Replace' }).click();
  await expect(ask).toBeHidden();
  expect(await sheetNames(page)).toEqual([
    'page-setups-Model',
    'page-setups-Layout1',
    'sample_AC1018-Model',
  ]);
  await expect(d.getByRole('checkbox', { name: 'page-setups-Model' })).not.toBeChecked();
  await expect(
    d.getByLabel('Page setup of page-setups-Layout1').locator('option:checked'),
  ).toHaveText('A3 Monochrome');
  await expect(d.getByLabel('Open in viewer when done')).toBeChecked();
  await expect(d.getByLabel('Publish to')).toHaveValue('png');
  await expect(d.getByLabel('Resolution')).toHaveValue('300');
  await expect(statusOf(page, 'sample_AC1018-Model')).toHaveText('Drawing file not found');
  await page.screenshot({ path: test.info().outputPath('m2-45-3-list-loaded.png') });

  // Appending the same list adds nothing.
  await load();
  await ask.getByRole('button', { name: 'Append' }).click();
  expect(await sheetNames(page)).toHaveLength(3);

  // Published alone, that sheet fails as not found, and the viewer tab opened for it closes.
  await d.getByRole('checkbox', { name: 'page-setups-Layout1' }).uncheck();
  const opening = page.waitForEvent('popup');
  await d.getByRole('button', { name: 'Publish' }).click();
  const viewer = await opening;
  await expect(d.getByRole('alert')).toHaveText('No sheet could be published.');
  await expect(statusOf(page, 'sample_AC1018-Model')).toHaveText('Drawing file not found.');
  await expect.poll(() => viewer.isClosed()).toBe(true);
  await d.getByRole('checkbox', { name: 'page-setups-Layout1' }).check();

  // Add Sheets with the DWG finds its sheet in place and adds its layouts after.
  const chooser = page.waitForEvent('filechooser');
  await d.getByRole('button', { name: 'Add Sheets…' }).click();
  await (await chooser).setFiles(DWG);
  await expect(statusOf(page, 'sample_AC1018-Model')).toHaveText('');
  const names = await sheetNames(page);
  expect(names.slice(0, 3)).toEqual([
    'page-setups-Model',
    'page-setups-Layout1',
    'sample_AC1018-Model',
  ]);
  expect(names.length).toBeGreaterThan(3);
  await page.screenshot({ path: test.info().outputPath('m2-45-3-drawing-found.png') });
});

test('Open in viewer when done opens the published file in a new tab (M2-45 part 3)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, PAGE_SETUPS);
  await expectShown(page, path.basename(PAGE_SETUPS));
  const d = await openPublish(page);
  await d.getByRole('checkbox', { name: 'page-setups-Model' }).uncheck();
  await d.getByLabel('Open in viewer when done').check();

  // One sheet to PNG: the tab shows the picture.
  await d.getByLabel('Publish to').selectOption('png');
  const downloads: Download[] = [];
  page.on('download', (x) => downloads.push(x));
  const opening = page.waitForEvent('popup');
  await d.getByRole('button', { name: 'Publish' }).click();
  const viewer = await opening;
  await expect(d).toBeHidden({ timeout: 60_000 });
  await expect(viewer).toHaveTitle('page-setups-Layout1.png');
  await expect
    .poll(() => viewer.evaluate(() => document.querySelector('img')?.naturalWidth ?? 0))
    .toBeGreaterThan(100);
  await expect.poll(() => downloads.length).toBe(1);
  expect(downloads[0]!.suggestedFilename()).toBe('page-setups-Layout1.png');
  await viewer.close();

  // A PDF: the tab shows the PDF the publish wrote.
  const again = await openPublish(page);
  await again.getByRole('checkbox', { name: 'page-setups-Model' }).uncheck();
  await again.getByLabel('Open in viewer when done').check();
  const pdfViewer = page.waitForEvent('popup');
  await again.getByRole('button', { name: 'Publish' }).click();
  const tab = await pdfViewer;
  await expect(again).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => downloads.length).toBe(2);
  const pdf = new Uint8Array(readFileSync((await downloads[1]!.path())!));
  // pdf.js takes the bytes' buffer, so the length is read first.
  const length = pdf.length;
  expect((await pdfSummary(pdf, 1)).labels).toEqual(['Layout1']);
  // The tab shows that PDF in the browser's PDF viewer, titled with its name.
  await expect(tab).toHaveTitle('page-setups.pdf');
  const shown = await tab.evaluate(async () => {
    const e = document.querySelector('embed')!;
    const bytes = new Uint8Array(await (await fetch(e.src)).arrayBuffer());
    return { type: e.type, length: bytes.length };
  });
  expect(shown).toEqual({ type: 'application/pdf', length });
});
