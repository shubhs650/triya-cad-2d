// M2-70: view categories. New View's View category and the View Manager's Category row give a
// named view a category, which the save writes where AutoCAD keeps it (DXF 300 of the VIEW's
// `ADSK_XREC_VTRVIEWINFO` XRECORD, in its extension dictionary), and the drawing opened again
// lists each view under the category it was given. The pickers are stand-ins installed before
// the app loads, as in save.spec.ts: Chromium's File System Access pickers cannot be driven.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectShown, serve } from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

/** An AC1032 ASCII DXF without named views, which Save writes over in place. */
const DXF32 = path.join(CORPUS, 'ezdxf/examples_dxf/hatches_1.dxf');

interface Fs {
  next?: { name: string; bytes: ArrayBuffer };
  written: Record<string, string[]>;
}
type FsWindow = { __fs: Fs };

async function fakePickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fs: Fs = { written: {} };
    (window as unknown as FsWindow).__fs = fs;
    const handle = (name: string, bytes: ArrayBuffer) => ({
      kind: 'file',
      name,
      getFile: () => Promise.resolve(new File([bytes], name)),
      queryPermission: () => Promise.resolve('granted'),
      requestPermission: () => Promise.resolve('granted'),
      createWritable: () => {
        const parts: Blob[] = [];
        return Promise.resolve({
          write: (b: Blob) => Promise.resolve(void parts.push(b)),
          close: async () => {
            (fs.written[name] ??= []).push(await new Blob(parts).text());
          },
        });
      },
    });
    Object.assign(window, {
      showOpenFilePicker: () => {
        const n = fs.next!;
        delete fs.next;
        return Promise.resolve([handle(n.name, n.bytes)]);
      },
      showSaveFilePicker: (o: { suggestedName: string }) =>
        Promise.resolve(handle(o.suggestedName, new ArrayBuffer(0))),
    });
  });
}

const fs = (page: Page) => page.evaluate(() => (window as unknown as FsWindow).__fs);
const prompt = (page: Page) => page.getByTestId('command-prompt');
const manager = (page: Page) => page.getByRole('dialog', { name: 'View Manager' });
const newView = (page: Page) => page.getByRole('dialog', { name: 'New View / Shot Properties' });
const props = (page: Page) => manager(page).getByRole('table', { name: 'View properties' });
const item = (page: Page, name: string) =>
  manager(page).getByRole('tree', { name: 'Views' }).getByRole('treeitem', { name, exact: true });

/** Opens VIEW's dialog from the command line. */
async function openManager(page: Page): Promise<void> {
  await expect(prompt(page)).toHaveText('Command:');
  await page.getByLabel('Command', { exact: true }).click();
  await page.keyboard.type('VIEW');
  await page.keyboard.press('Enter');
  await expect(manager(page)).toBeVisible();
}

/** Each VIEW record's category as the DXF's ADSK_XREC_VTRVIEWINFO XRECORDs say (group 300). */
function savedCategories(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2)
    pairs.push([lines[i]!.trim(), lines[i + 1]!.trim()]);
  // VIEW name by its extension dictionary's handle, then that dictionary's info XRECORD.
  const viewOfXdict = new Map<string, string>();
  const infoOfXdict = new Map<string, string>();
  const category = new Map<string, string>();
  let type = '';
  let handle = '';
  let name = '';
  let xdict = '';
  let lastKey = '';
  const flush = () => {
    if (type === 'VIEW' && xdict) viewOfXdict.set(xdict, name);
  };
  for (const [code, value] of pairs) {
    if (code === '0') {
      flush();
      [type, handle, name, xdict] = [value, '', '', ''];
    } else if (code === '5') handle = value;
    else if (type === 'VIEW' && code === '2') name = value;
    else if (type === 'VIEW' && code === '360') xdict = value;
    else if (type === 'DICTIONARY' && code === '3') lastKey = value;
    else if (type === 'DICTIONARY' && code === '360' && lastKey === 'ADSK_XREC_VTRVIEWINFO')
      infoOfXdict.set(handle, value);
    else if (type === 'XRECORD' && code === '300') category.set(handle, value);
  }
  flush();
  const out: Record<string, string> = {};
  for (const [x, view] of viewOfXdict) {
    const info = infoOfXdict.get(x);
    const c = info && category.get(info);
    if (c !== undefined && c !== '') out[view] = c;
  }
  return out;
}

test('a view given a category in the View Manager keeps it through a save (M2-70)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await fakePickers(page);
  await page.goto(app.url);
  const url = await serve(page, DXF32);
  const name = path.basename(DXF32);
  await page.evaluate(
    async ({ url, name }) => {
      const bytes = await (await fetch(url)).arrayBuffer();
      (window as unknown as FsWindow).__fs.next = { name, bytes };
    },
    { url, name },
  );
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expectShown(page, name);

  // New View's View category: typed, a category the drawing does not have yet.
  await openManager(page);
  await manager(page).getByRole('button', { name: 'New...' }).click();
  await expect(newView(page).getByLabel('View category')).toHaveValue('<None>');
  await newView(page).getByLabel('View name').fill('Front');
  await newView(page).getByLabel('View category').fill('Elevations');
  await page.screenshot({ path: test.info().outputPath('1-new-view-category.png') });
  await newView(page).getByRole('button', { name: 'OK' }).click();
  await expect(newView(page)).toBeHidden();
  await expect(props(page).getByLabel('Category')).toHaveValue('Elevations');

  // A view saved with <None>, then given one in its Category row (Enter takes it).
  await manager(page).getByRole('button', { name: 'New...' }).click();
  await newView(page).getByLabel('View name').fill('Plan');
  await newView(page).getByRole('button', { name: 'OK' }).click();
  await expect(item(page, 'Plan')).toHaveAttribute('aria-selected', 'true');
  const category = props(page).getByLabel('Category');
  await expect(category).toHaveValue('<None>');
  // The field offers <None> and the drawing's categories.
  await expect(manager(page).locator('datalist option')).toHaveCount(2);
  await category.fill('Sections');
  await category.press('Enter');
  await expect(manager(page).locator('datalist option')).toHaveCount(3);
  await page.screenshot({ path: test.info().outputPath('2-category-row.png') });
  await manager(page).getByRole('button', { name: 'OK' }).click();
  await expect(manager(page)).toBeHidden();

  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await fs(page)).written[name]?.length).toBe(1);
  const dxf = (await fs(page)).written[name]![0]!;
  expect(savedCategories(dxf)).toEqual({ Front: 'Elevations', Plan: 'Sections' });

  // Opened again, each view is listed under the category it was given.
  await page.evaluate((text) => {
    (window as unknown as FsWindow).__fs.next = {
      name: 'reopened.dxf',
      bytes: new TextEncoder().encode(text).buffer as ArrayBuffer,
    };
  }, dxf);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expectShown(page, 'reopened.dxf');
  await openManager(page);
  await item(page, 'Front').click();
  await expect(props(page).getByLabel('Category')).toHaveValue('Elevations');
  await item(page, 'Plan').click();
  await expect(props(page).getByLabel('Category')).toHaveValue('Sections');
  await page.screenshot({ path: test.info().outputPath('3-reopened-category.png') });
});
