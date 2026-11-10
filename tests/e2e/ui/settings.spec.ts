// M2-20: Settings. "Clear all local data" (PRD FR-F11, G6) leaves IndexedDB and the
// origin-private file system empty: a pattern file, a font file, the settings themselves and an
// autosave snapshot are all gone after it, and the page starts afresh with nothing to recover.
// The theme, canvas colours, coordinate display, object snap settings and Dynamic Input are
// kept on the device between sessions. Part 2: plot style tables and linetype files are added,
// listed, refused when unusable, removed and kept; the crosshairs take their colour; the
// in-canvas tooltip and ruler follow the dark theme.
import { copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { activeCanvas, colourAt, expectShown, openWithDrop, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';
import { fontBytes, testFont } from '../../../packages/text/test/ttf/fonts';

// The autosave waits 5 s after the last edit.
test.describe.configure({ timeout: 90_000 });

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const DXF32 = path.join(CORPUS, 'ezdxf/examples_dxf/hatches_1.dxf');
const MONOCHROME_CTB = path.join(
  import.meta.dirname,
  '../../../assets/plotstyles/triya-monochrome.ctb',
);
const LIN = '*FENCE2,Fence ----0----\nA,.25,-.1,["O",STANDARD,S=.1,R=0,X=-.03,Y=-.05],-.1\n';
const NAME = path.basename(DXF32);
const prompt = (page: Page) => page.getByTestId('command-prompt');
const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Settings' });

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(settingsDialog(page)).toBeVisible();
  return settingsDialog(page);
}

/** Every record of every IndexedDB database, every OPFS file and every cache, by name. */
function localData(page: Page): Promise<{ records: string[]; files: string[]; caches: string[] }> {
  return page.evaluate(async () => {
    const records: string[] = [];
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      for (const store of db.objectStoreNames) {
        const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
          const r = db.transaction(store).objectStore(store).getAllKeys();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        for (const k of keys) records.push(`${name}/${store}/${String(k)}`);
      }
      db.close();
    }
    const files: string[] = [];
    type Dir = FileSystemDirectoryHandle & {
      entries(): AsyncIterable<[string, FileSystemHandle]>;
    };
    const walk = async (dir: Dir, at: string): Promise<void> => {
      for await (const [name, h] of dir.entries()) {
        if (h.kind === 'file') files.push(`${at}${name}`);
        else await walk(h as Dir, `${at}${name}/`);
      }
    };
    await walk((await navigator.storage.getDirectory()) as Dir, '');
    return { records, files, caches: await caches.keys() };
  });
}

test('Clear all local data leaves IndexedDB and the private file system empty', async ({
  page,
}) => {
  const pat = test.info().outputPath('my-grid.pat');
  writeFileSync(pat, '*MY_GRID, a test grid\n0, 0,0, 0,5\n90, 0,0, 0,5\n');
  const font = test.info().outputPath('Arial.TTF');
  writeFileSync(font, fontBytes(testFont()));
  await page.goto(app.url);
  await openWithDrop(page, pat);
  await expect(page.locator('.banner', { hasText: 'my-grid.pat' })).toBeVisible();
  await openWithDrop(page, font);
  await expect(
    page.locator('.banner', { hasText: 'Added TrueType font Arial.TTF.' }),
  ).toBeVisible();
  // M2-20 part 2: a plot style table and a linetype file dropped on the window are kept too.
  const ctb = test.info().outputPath('office.ctb');
  copyFileSync(MONOCHROME_CTB, ctb);
  const lin = test.info().outputPath('fences.lin');
  writeFileSync(lin, LIN);
  await openWithDrop(page, [ctb, lin]);
  await expect(
    page.locator('.banner', { hasText: 'Added color-dependent plot style table office.ctb.' }),
  ).toBeVisible();
  await expect(
    page.locator('.banner', { hasText: 'Added 1 linetype from fences.lin: FENCE2.' }),
  ).toBeVisible();
  const settings = await openSettings(page);
  await settings.getByLabel('Color theme').selectOption('dark');
  await page.keyboard.press('Escape');

  // A drawing with an unsaved line, which autosave writes within 5 s.
  await openWithPicker(page, DXF32);
  await expectShown(page, NAME);
  await activeCanvas(page).hover();
  for (const [text, next] of [
    ['LINE', 'Specify first point:'],
    ['0,0', /^Specify next point/],
    ['@40<30', /^Specify next point/],
    ['', 'Command:'],
  ] as const) {
    if (text) await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await expect(prompt(page)).toHaveText(next);
  }
  await expect
    .poll(async () => (await localData(page)).records.join(' '), { timeout: 15_000 })
    .toMatch(/triya-recovery\/drawings\//);
  const before = await localData(page);
  expect(before.records.join(' ')).toMatch(/triya-patterns\/files\//);
  expect(before.records.join(' ')).toMatch(/triya-settings\/settings\/preferences/);
  expect([...before.files].sort()).toEqual([
    'fonts/Arial.TTF',
    'linetypes/fences.lin',
    'plotstyles/office.ctb',
  ]);

  await openSettings(page);
  await settingsDialog(page).getByRole('button', { name: 'Clear all local data…' }).click();
  await expect(
    settingsDialog(page).getByRole('group', { name: 'Clear all local data' }),
  ).toContainText('unsaved changes are lost');
  const reloaded = page.waitForEvent('load');
  await settingsDialog(page).getByRole('button', { name: 'Clear and restart' }).click();
  await reloaded;

  // The page starts afresh: no drawing, nothing to recover, the default theme.
  await expect(page.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
  await expect(page.getByTestId('recovery-offer')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  // The stores the new page opens again are empty.
  await expect.poll(() => localData(page)).toEqual({ records: [], files: [], caches: [] });
  const fresh = await openSettings(page);
  await expect(fresh.getByText('No pattern files added.')).toBeVisible();
  await expect(fresh.getByText('No font files added.')).toBeVisible();
  await expect(fresh.getByText('No plot style tables added.')).toBeVisible();
  await expect(fresh.getByText('No linetype files added.')).toBeVisible();
  await expect(fresh.getByLabel('Color theme')).toHaveValue('system');
});

test('settings are kept between sessions and apply to the canvas and status bar', async ({
  page,
}) => {
  await page.goto(app.url);
  const settings = await openSettings(page);
  await settings.getByLabel('Color theme').selectOption('dark');
  await settings.getByLabel('Model space background').fill('#ffffff');
  await settings.getByLabel('Coordinates').selectOption('decimal');
  await settings.getByLabel('Midpoint').check();
  await settings.getByLabel('Polar increment angle').selectOption('45');
  await settings.getByLabel('Dynamic Input (F12)').uncheck();
  await page.screenshot({ path: test.info().outputPath('settings-dark.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTitle('Dynamic Input (F12)')).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTitle('Dynamic Input (F12)')).toHaveAttribute('aria-pressed', 'false');
  const again = await openSettings(page);
  await expect(again.getByLabel('Model space background')).toHaveValue('#ffffff');
  await expect(again.getByLabel('Coordinates')).toHaveValue('decimal');
  await expect(again.getByLabel('Midpoint')).toBeChecked();
  await expect(again.getByLabel('Polar increment angle')).toHaveValue('45');
  await page.keyboard.press('Escape');

  // Model space draws on the chosen colour, ACI 7 in black on it.
  await openWithPicker(page, DXF32);
  await expectShown(page, NAME);
  const box = (await activeCanvas(page).boundingBox())!;
  await expect
    .poll(async () => (await colourAt(page, { x: 3, y: box.height - 3 })).slice(0, 3))
    .toEqual([255, 255, 255]);
  await page.screenshot({ path: test.info().outputPath('dark-chrome-white-canvas.png') });

  // Restoring the defaults puts the dark model canvas back.
  await (await openSettings(page)).getByRole('button', { name: 'Restore default colors' }).click();
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await colourAt(page, { x: 3, y: box.height - 3 })).slice(0, 3))
    .toEqual([0x21, 0x28, 0x30]);
});

test('plot style tables and linetype files are added in Settings, listed, refused and kept', async ({
  page,
}) => {
  const ctb = test.info().outputPath('Office.ctb');
  copyFileSync(MONOCHROME_CTB, ctb);
  const wrong = test.info().outputPath('wrong.stb');
  copyFileSync(MONOCHROME_CTB, wrong);
  const lin = test.info().outputPath('fences.lin');
  writeFileSync(lin, LIN);
  await page.goto(app.url);
  const settings = await openSettings(page);
  await page.getByTestId('plot-style-picker').setInputFiles([ctb]);
  const tables = settings.getByRole('list', { name: 'Plot style tables' });
  await expect(tables).toContainText('Office.ctb');
  await expect(tables).toContainText('Color-dependent, 255 styles: Triya: plot every object black');
  // A colour-dependent table named .stb cannot work, so it is refused with the reason.
  await page.getByTestId('plot-style-picker').setInputFiles([wrong]);
  await expect(settings.getByRole('alert')).toHaveText(
    'wrong.stb holds a color-dependent plot style table, so its name must end in .ctb.',
  );
  await page.getByTestId('linetype-picker').setInputFiles([lin]);
  await expect(settings.getByRole('list', { name: 'Linetype files' })).toContainText(
    'fences.linFENCE2',
  );
  await settings.getByRole('heading', { name: 'Plot style tables' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('support-files.png') });

  // Kept between visits; Remove takes one off the device.
  await page.reload();
  const again = await openSettings(page);
  await expect(again.getByRole('list', { name: 'Plot style tables' })).toContainText('Office.ctb');
  await expect(again.getByRole('list', { name: 'Linetype files' })).toContainText('fences.lin');
  await again.getByRole('button', { name: 'Remove Office.ctb' }).click();
  await expect(again.getByText('No plot style tables added.')).toBeVisible();
  await page.reload();
  await expect((await openSettings(page)).getByText('No plot style tables added.')).toBeVisible();
});

test('the crosshairs take their colour, and the tooltip and ruler follow the dark theme', async ({
  page,
}) => {
  await page.goto(app.url);
  await openWithPicker(page, DXF32);
  await expectShown(page, NAME);
  const cursor = () => activeCanvas(page).evaluate((c) => getComputedStyle(c).cursor);
  // Automatic: white crosshairs on the dark model canvas.
  await expect.poll(cursor).toContain('%23ffffff');
  const settings = await openSettings(page);
  await settings.getByLabel('Crosshairs: Automatic').uncheck();
  await settings.getByLabel('Crosshairs', { exact: true }).fill('#ff0000');
  await settings.getByLabel('Color theme').selectOption('dark');
  await page.keyboard.press('Escape');
  await expect.poll(cursor).toContain('%23ff0000');
  // The same crosshairs at a point prompt.
  await activeCanvas(page).hover();
  await page.keyboard.type('LINE');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Specify first point:');
  await expect.poll(cursor).toContain('%23ff0000');
  await page.keyboard.press('Escape');
  // The in-canvas tooltip and the MTEXT ruler draw in the dark chrome's colours.
  const vars = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return [s.getPropertyValue('--tip-bg').trim(), s.getPropertyValue('--ruler-mark').trim()];
  });
  expect(vars).toEqual(['#3a3523', '#e6e8eb']);
  // Kept between visits.
  await page.reload();
  const again = await openSettings(page);
  await expect(again.getByLabel('Crosshairs: Automatic')).not.toBeChecked();
  await expect(again.getByLabel('Crosshairs', { exact: true })).toHaveValue('#ff0000');
});
